import { Prisma } from "@prisma/client";
import { prisma } from "../db/client";
import { env } from "../config/env";
import { MensagemNormalizada } from "../utils/types";
import { gerarHashMensagem } from "../utils/hash";
import { aplicarRegrasDeTexto } from "./aplicar-regras";
import { aplicarLinksMercadoLivreDetalhado } from "./mercado-livre/aplicar-links-mercado-livre";
import { aplicarLinksAmazon } from "./amazon/aplicar-links-amazon";
import { childLogger } from "../utils/logger";
import { registrarMensagemIgnoradaPersistida } from "../utils/mensagens-ignoradas";
import { formatarPromocaoAutomaticamente } from "./formatar-promocao";
import { triarPromocao } from "./triagem-promocao";
import { STATUS_NAO_REPROCESSAVEIS } from "../domain/status-mensagem";
import { classificarESalvarCategorias } from "./classificar-categorias";
import { obterConfiguracaoProcessamento } from "./configuracao-processamento";
import { garantirRodapeObrigatorio } from "./mensagem-preservada";

const log = childLogger("pipeline");

async function registrarLog(mensagemId: string, etapa: string, status: "OK" | "ERRO", detalhe?: string) {
  await prisma.log.create({ data: { mensagemId, etapa, status, detalhe } });
}

async function buscarEventoExistente(msg: MensagemNormalizada) {
  return prisma.mensagem.findUnique({
    where: {
      grupoFonteId_idExternoOriginal: {
        grupoFonteId: msg.grupoFonteId,
        idExternoOriginal: msg.idExternoOriginal,
      },
    },
  });
}

async function ehConteudoDuplicadoRecente(hash: string): Promise<boolean> {
  const desde = new Date(Date.now() - env.DEDUP_WINDOW_HOURS * 60 * 60 * 1000);
  return Boolean(await prisma.mensagem.findFirst({
    where: {
      hashUnico: hash,
      criadoEm: { gte: desde },
      status: { notIn: ["FALHOU", "DESCARTADA_MANUAL"] },
    },
    select: { id: true },
  }));
}

async function ignorar(msg: MensagemNormalizada, motivo: string) {
  await registrarMensagemIgnoradaPersistida({
    motivo,
    grupoFonteId: msg.grupoFonteId,
    idExternoOriginal: msg.idExternoOriginal,
    conteudo: msg.texto,
  });
  log.info({ grupoFonteId: msg.grupoFonteId, idExternoOriginal: msg.idExternoOriginal, motivo }, "mensagem filtrada antes do painel");
  return null;
}

export async function processarMensagem(msg: MensagemNormalizada) {
  // Resolve a fonte real pelo cadastro do grupo ANTES de escolher o parser.
  // Isso evita inferir MP/Urubu/Pobres apenas pelo conteúdo da mensagem.
  const grupoFonte = await prisma.grupo.findUnique({
    where: { id: msg.grupoFonteId },
    select: { id: true, nome: true, identificadorExterno: true },
  });
  const contextoFonte = {
    grupoFonteId: msg.grupoFonteId,
    nomeGrupoFonte: grupoFonte?.nome ?? null,
    identificadorExterno: grupoFonte?.identificadorExterno ?? null,
  };

  const existente = await buscarEventoExistente(msg);
  if (existente) {
    if (STATUS_NAO_REPROCESSAVEIS.includes(existente.status as any)) return existente;
    await prisma.mensagem.update({ where: { id: existente.id }, data: { status: "PROCESSANDO" } });
  }

  // Triagem é deliberadamente a primeira etapa de negócio: mensagens de lojas
  // não suportadas nem chegam ao painel e não gastam navegador/conversão.
  const triagem = triarPromocao(msg.texto, msg.linksEncontrados);
  if (!triagem.aceita && !existente) {
    return ignorar(msg, triagem.motivo ?? "mensagem rejeitada na triagem");
  }

  const primeiroLinkSuportado = triagem.linksSuportados[0] ?? msg.linksEncontrados[0] ?? null;
  const hash = gerarHashMensagem(msg.texto, primeiroLinkSuportado);

  let mensagem = existente;
  if (!mensagem) {
    if (await ehConteudoDuplicadoRecente(hash)) {
      return ignorar(msg, `conteúdo duplicado nas últimas ${env.DEDUP_WINDOW_HOURS}h`);
    }

    try {
      mensagem = await prisma.mensagem.create({
        data: {
          grupoFonteId: msg.grupoFonteId,
          hashUnico: hash,
          idExternoOriginal: msg.idExternoOriginal,
          conteudoOriginal: msg.texto,
          midias: msg.midias as any,
          status: "PROCESSANDO",
        },
      });
      await registrarLog(mensagem.id, "captura", "OK");
      await registrarLog(mensagem.id, "triagem", "OK", JSON.stringify({
        linksSuportados: triagem.linksSuportados,
        linksExternos: triagem.linksExternos,
      }));
    } catch (erro) {
      if (erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === "P2002") {
        return buscarEventoExistente(msg);
      }
      throw erro;
    }
  }

  try {
    // A conversão dos links é sempre obrigatória, independentemente da opção
    // de reescrita. Quando a reescrita está desligada, preservamos todo o
    // restante do texto e apenas garantimos o rodapé oficial.
    const configuracao = await obterConfiguracaoProcessamento();
    const mercadoLivre = await aplicarLinksMercadoLivreDetalhado(msg.texto);
    const amazon = await aplicarLinksAmazon(mercadoLivre.texto);

    let textoFinal: string;
    if (configuracao.reescritaAutomaticaAtiva) {
      const textoComRegras = await aplicarRegrasDeTexto(amazon.texto, msg.grupoFonteId);
      textoFinal = formatarPromocaoAutomaticamente(textoComRegras, contextoFonte).texto;
    } else {
      textoFinal = amazon.texto;
    }

    // Em qualquer modo, remove rodapés antigos/duplicados e deixa exatamente
    // um Linktree oficial no final.
    textoFinal = garantirRodapeObrigatorio(textoFinal);

    // O formatador ainda pode ser usado como analisador para confiança/categoria,
    // mas, com a reescrita desligada, seu texto montado NÃO é publicado.
    const formatada = formatarPromocaoAutomaticamente(textoFinal, contextoFonte);

    const classificacaoCategorias = await classificarESalvarCategorias(mensagem.id, {
      produto: formatada.produto,
      textoOriginal: msg.texto,
      textoProcessado: textoFinal,
    });

    const falhaDeLink =
      mercadoLivre.diagnosticos.some((d) => !d.convertido) ||
      amazon.diagnosticos.some((d) => !d.convertido);
    const baixaConfianca =
      configuracao.reescritaAutomaticaAtiva &&
      formatada.confianca < env.CONFIANCA_MINIMA_SEM_REVISAO;
    const semCategoria = classificacaoCategorias.categoriasAtivas > 0 && classificacaoCategorias.classificacoes.length === 0;
    const baixaConfiancaCategoria =
      classificacaoCategorias.classificacoes.length > 0 &&
      classificacaoCategorias.confiancaPrincipal < env.CONFIANCA_CATEGORIA_MINIMA;
    const exigeRevisao =
      falhaDeLink ||
      (configuracao.reescritaAutomaticaAtiva && formatada.camposAusentes.length > 0) ||
      baixaConfianca ||
      semCategoria ||
      baixaConfiancaCategoria;

    const analise = {
      fonte: formatada.fonte,
      origemDeteccaoFonte: formatada.origemDeteccaoFonte,
      grupoFonte: grupoFonte ? { id: grupoFonte.id, nome: grupoFonte.nome, identificadorExterno: grupoFonte.identificadorExterno } : null,
      confianca: formatada.confianca,
      motivosConfianca: formatada.motivosConfianca,
      confiancaProduto: formatada.confiancaProduto,
      camposAusentes: formatada.camposAusentes,
      produto: formatada.produto,
      precoAntigo: formatada.precoAntigo,
      precoAtual: formatada.precoAtual,
      parcelamento: formatada.parcelamento,
      cupom: formatada.cupom,
      freteGratis: formatada.freteGratis,
      linkCompra: formatada.linkCompra,
      triagem,
      categorias: classificacaoCategorias.classificacoes,
      categoriaPrincipal: classificacaoCategorias.principal,
      confiancaCategoria: classificacaoCategorias.confiancaPrincipal,
      semCategoria,
      reescritaAutomaticaAtiva: configuracao.reescritaAutomaticaAtiva,
    };

    await registrarLog(
      mensagem.id,
      "classificacao_categoria",
      semCategoria || baixaConfiancaCategoria ? "ERRO" : "OK",
      JSON.stringify({ categorias: classificacaoCategorias.classificacoes, confiancaPrincipal: classificacaoCategorias.confiancaPrincipal })
    );

    await registrarLog(
      mensagem.id,
      "formatacao_automatica",
      exigeRevisao ? "ERRO" : "OK",
      JSON.stringify(analise)
    );

    const atualizada = await prisma.mensagem.update({
      where: { id: mensagem.id },
      data: {
        conteudoProcessado: textoFinal,
        confianca: formatada.confianca,
        analise: analise as any,
        status: exigeRevisao ? "AGUARDANDO_REVISAO" : "PROCESSADA",
      },
    });

    for (const diagnostico of mercadoLivre.diagnosticos) {
      await registrarLog(mensagem.id, "afiliado_mercado_livre", diagnostico.convertido ? "OK" : "ERRO", JSON.stringify(diagnostico));
    }
    for (const diagnostico of amazon.diagnosticos) {
      await registrarLog(mensagem.id, "afiliado_amazon", diagnostico.convertido ? "OK" : "ERRO", JSON.stringify(diagnostico));
    }
    await registrarLog(mensagem.id, "processamento", "OK", `confianca=${formatada.confianca}`);
    return atualizada;
  } catch (erro: any) {
    await prisma.mensagem.update({ where: { id: mensagem.id }, data: { status: "FALHOU" } });
    await registrarLog(mensagem.id, "processamento", "ERRO", String(erro?.message ?? erro));
    log.error({ erro, mensagemId: mensagem.id }, "falha no processamento da mensagem");
    throw erro;
  }
}
