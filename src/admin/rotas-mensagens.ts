import * as fs from "fs";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db/client";
import { autenticar } from "./auth-middleware";
import { publicarNosDestinos } from "../publishers/publicar-nos-destinos";
import { childLogger } from "../utils/logger";
import { rotaAsync } from "./async-route";
import { formatarPromocaoAutomaticamente } from "../processor/formatar-promocao";
import { STATUS_PUBLICAVEIS_MANUALMENTE } from "../domain/status-mensagem";
import { obterRoteamentoMensagem } from "../processor/roteamento-categorias";
import { classificarESalvarCategorias } from "../processor/classificar-categorias";
import { env } from "../config/env";
import { obterConfiguracaoProcessamento, salvarConfiguracaoProcessamento } from "../processor/configuracao-processamento";
import { garantirRodapeObrigatorio } from "../processor/mensagem-preservada";

const log = childLogger("rotas-mensagens");
const DELAY_PUBLICACAO_LOTE_MS = 30_000;

export const rotasMensagens = Router();
rotasMensagens.use(autenticar);

const statusMensagemSchema = z.enum([
  "RECEBIDA", "PROCESSANDO", "PROCESSADA", "AGUARDANDO_REVISAO", "PUBLICANDO",
  "PUBLICADA_TELEGRAM", "PUBLICADA_WHATSAPP", "FALHOU", "DESCARTADA_DUPLICADA", "DESCARTADA_MANUAL",
]);

const filtroCategoriaFilaSchema = z.object({
  categoriaId: z.string().uuid().optional(),
  semCategoria: z.boolean().optional(),
  baixaConfiancaCategoria: z.boolean().optional(),
}).default({});

function whereFilaRevisao(filtro: { categoriaId?: string; semCategoria?: boolean; baixaConfiancaCategoria?: boolean }) {
  const where: any = { status: "AGUARDANDO_REVISAO" };
  if (filtro.categoriaId) where.categorias = { some: { categoriaId: filtro.categoriaId } };
  if (filtro.semCategoria) where.categorias = { none: {} };
  if (filtro.baixaConfiancaCategoria) {
    where.categorias = { some: { principal: true, confianca: { lt: env.CONFIANCA_CATEGORIA_MINIMA } } };
  }
  return where;
}

type ResultadoPublicacaoManual = {
  statusHttp: number;
  corpo: any;
};

type EstadoPublicacaoLote = {
  emAndamento: boolean;
  total: number;
  processadas: number;
  publicadas: number;
  falhas: number;
  iniciadaEm: Date | null;
  finalizadaEm: Date | null;
  mensagemAtualId: string | null;
};

const estadoLote: EstadoPublicacaoLote = {
  emAndamento: false,
  total: 0,
  processadas: 0,
  publicadas: 0,
  falhas: 0,
  iniciadaEm: null,
  finalizadaEm: null,
  mensagemAtualId: null,
};

function esperar(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

async function publicarMensagemManual(id: string): Promise<ResultadoPublicacaoManual> {
  const existente = await prisma.mensagem.findUnique({ where: { id } });
  if (!existente) return { statusHttp: 404, corpo: { erro: "Mensagem não encontrada" } };

  if (!STATUS_PUBLICAVEIS_MANUALMENTE.includes(existente.status as any)) {
    return {
      statusHttp: 409,
      corpo: { erro: "Mensagem não pode ser publicada no status atual", statusAtual: existente.status },
    };
  }

  const statusAnterior = existente.status;
  const reserva = await prisma.mensagem.updateMany({
    where: { id, status: existente.status },
    data: { status: "PUBLICANDO" as any },
  });

  if (reserva.count === 0) {
    const atual = await prisma.mensagem.findUnique({ where: { id } });
    return {
      statusHttp: 409,
      corpo: { erro: "Mensagem já está sendo alterada/publicada", statusAtual: atual?.status ?? null },
    };
  }

  const mensagem = await prisma.mensagem.findUniqueOrThrow({ where: { id } });
  const roteamento = await obterRoteamentoMensagem(id);
  if (roteamento.modo === "sem-destino") {
    await prisma.mensagem.update({ where: { id }, data: { status: statusAnterior as any } });
    return {
      statusHttp: 409,
      corpo: {
        erro: "A mensagem não possui uma categoria com destino configurado",
        roteamento,
      },
    };
  }

  let resultado;
  try {
    resultado = await publicarNosDestinos(
      mensagem,
      roteamento.modo === "categorias" ? { destinosTelegramIds: roteamento.destinosTelegramIds } : {}
    );
  } catch (erro) {
    await prisma.mensagem.update({
      where: { id },
      data: { status: statusAnterior as any },
    }).catch(() => undefined);
    throw erro;
  }

  if (resultado.telegram.enviados === 0) {
    await prisma.mensagem.update({
      where: { id },
      data: { status: statusAnterior as any },
    });
    log.error({ mensagemId: id, resultado }, "nenhum destino Telegram recebeu a publicação manual");
    return {
      statusHttp: 502,
      corpo: { erro: "Nenhum destino Telegram recebeu a mensagem", publicacao: resultado },
    };
  }

  const atualizada = await prisma.mensagem.findUnique({ where: { id } });
  return {
    statusHttp: resultado.parcial ? 207 : 200,
    corpo: { ...atualizada, publicacao: resultado, roteamento },
  };
}

async function executarPublicacaoEmLote(ids: string[]) {
  try {
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i];
      estadoLote.mensagemAtualId = id;

      try {
        const resultado = await publicarMensagemManual(id);
        if (resultado.statusHttp >= 200 && resultado.statusHttp < 300) estadoLote.publicadas += 1;
        else estadoLote.falhas += 1;
      } catch (erro) {
        estadoLote.falhas += 1;
        log.error({ erro, mensagemId: id }, "falha ao publicar mensagem durante publicação em lote");
      } finally {
        estadoLote.processadas += 1;
      }

      if (i < ids.length - 1) await esperar(DELAY_PUBLICACAO_LOTE_MS);
    }
  } finally {
    estadoLote.emAndamento = false;
    estadoLote.mensagemAtualId = null;
    estadoLote.finalizadaEm = new Date();
  }
}

function referenciasMidia(midias: unknown): string[] {
  if (!Array.isArray(midias)) return [];
  return midias
    .map((m: any) => typeof m?.referencia === "string" ? m.referencia : null)
    .filter((v): v is string => Boolean(v));
}

// Ignoradas precisam vir antes de /:id para não serem interpretadas como id.

const configuracaoProcessamentoSchema = z.object({
  reescritaAutomaticaAtiva: z.boolean(),
});

rotasMensagens.get("/configuracao-processamento", rotaAsync(async (_req, res) => {
  res.json(await obterConfiguracaoProcessamento());
}));

rotasMensagens.patch("/configuracao-processamento", rotaAsync(async (req, res) => {
  const parsed = configuracaoProcessamentoSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ erro: "Configuração inválida", detalhes: parsed.error.issues });
  const configuracao = await salvarConfiguracaoProcessamento(parsed.data);
  res.json(configuracao);
}));

rotasMensagens.get("/ignoradas", rotaAsync(async (req, res) => {
  const limite = Math.min(Math.max(Number(req.query.limite) || 100, 1), 500);
  const ignoradas = await prisma.mensagemIgnorada.findMany({
    take: limite,
    orderBy: { criadoEm: "desc" },
    include: { grupoFonte: true },
  });
  res.json(ignoradas);
}));

rotasMensagens.delete("/ignoradas", rotaAsync(async (_req, res) => {
  const resultado = await prisma.mensagemIgnorada.deleteMany();
  res.json({ removidas: resultado.count });
}));

rotasMensagens.get("/publicacao-lote", (_req, res) => {
  res.json({ ...estadoLote, delaySegundos: DELAY_PUBLICACAO_LOTE_MS / 1000 });
});

rotasMensagens.post("/publicar-todas", rotaAsync(async (req, res) => {
  const filtroParsed = filtroCategoriaFilaSchema.safeParse(req.body ?? {});
  if (!filtroParsed.success) return res.status(400).json({ erro: "Filtro de categoria inválido" });

  if (estadoLote.emAndamento) {
    return res.status(409).json({ erro: "Já existe uma publicação em lote em andamento", estado: estadoLote });
  }

  const mensagens = await prisma.mensagem.findMany({
    where: whereFilaRevisao(filtroParsed.data),
    orderBy: { criadoEm: "asc" },
    select: { id: true },
  });

  if (mensagens.length === 0) {
    return res.json({ iniciada: false, total: 0, mensagem: "Não há mensagens aguardando revisão" });
  }

  Object.assign(estadoLote, {
    emAndamento: true,
    total: mensagens.length,
    processadas: 0,
    publicadas: 0,
    falhas: 0,
    iniciadaEm: new Date(),
    finalizadaEm: null,
    mensagemAtualId: null,
  });

  void executarPublicacaoEmLote(mensagens.map((m) => m.id));

  return res.status(202).json({
    iniciada: true,
    total: mensagens.length,
    delaySegundos: DELAY_PUBLICACAO_LOTE_MS / 1000,
  });
}));

rotasMensagens.post("/reclassificar-pendentes", rotaAsync(async (_req, res) => {
  const mensagens = await prisma.mensagem.findMany({
    where: { status: "AGUARDANDO_REVISAO", categorias: { none: { origem: "MANUAL" } } },
    orderBy: { criadoEm: "asc" },
    take: 500,
    select: {
      id: true,
      conteudoOriginal: true,
      conteudoProcessado: true,
      analise: true,
      grupoFonte: { select: { id: true, nome: true, identificadorExterno: true } },
    },
  });

  let classificadas = 0;
  let semCategoria = 0;
  for (const mensagem of mensagens) {
    const analise = (mensagem.analise && typeof mensagem.analise === "object") ? mensagem.analise as any : {};
    const produto = typeof analise?.produto === "string" && analise.produto.trim()
      ? analise.produto
      : formatarPromocaoAutomaticamente(
          mensagem.conteudoProcessado ?? mensagem.conteudoOriginal,
          {
            grupoFonteId: mensagem.grupoFonte.id,
            nomeGrupoFonte: mensagem.grupoFonte.nome,
            identificadorExterno: mensagem.grupoFonte.identificadorExterno,
          },
        ).produto;
    const resultado = await classificarESalvarCategorias(mensagem.id, {
      produto,
      textoOriginal: mensagem.conteudoOriginal,
      textoProcessado: mensagem.conteudoProcessado,
    });
    if (resultado.classificacoes.length) classificadas += 1;
    else semCategoria += 1;
  }

  res.json({ total: mensagens.length, classificadas, semCategoria });
}));

rotasMensagens.delete("/revisao", rotaAsync(async (req, res) => {
  const filtroParsed = filtroCategoriaFilaSchema.safeParse({
    categoriaId: req.query.categoriaId ? String(req.query.categoriaId) : undefined,
    semCategoria: String(req.query.semCategoria) === "true" ? true : undefined,
    baixaConfiancaCategoria: String(req.query.baixaConfiancaCategoria) === "true" ? true : undefined,
  });
  if (!filtroParsed.success) return res.status(400).json({ erro: "Filtro de categoria inválido" });

  if (estadoLote.emAndamento) {
    return res.status(409).json({ erro: "Não é possível excluir a fila durante uma publicação em lote" });
  }

  const mensagens = await prisma.mensagem.findMany({
    where: whereFilaRevisao(filtroParsed.data),
    select: { id: true, midias: true },
  });
  const ids = mensagens.map((m) => m.id);
  if (ids.length === 0) return res.json({ removidas: 0 });

  await prisma.$transaction([
    prisma.log.deleteMany({ where: { mensagemId: { in: ids } } }),
    prisma.mensagem.deleteMany({ where: { id: { in: ids } } }),
  ]);

  const arquivos = mensagens.flatMap((m) => referenciasMidia(m.midias));
  await Promise.all(arquivos.map((arquivo) => fs.promises.unlink(arquivo).catch(() => undefined)));

  res.json({ removidas: ids.length });
}));

// Lista mensagens, com filtros por status/categoria.
rotasMensagens.get("/", rotaAsync(async (req, res) => {
  const { status, categoriaId, semCategoria, baixaConfiancaCategoria } = req.query;
  const statusValidado = status ? statusMensagemSchema.safeParse(String(status)) : null;
  if (statusValidado && !statusValidado.success) {
    return res.status(400).json({ erro: "Status inválido" });
  }

  const where: any = {};
  if (statusValidado?.success) where.status = statusValidado.data;
  if (categoriaId) where.categorias = { some: { categoriaId: String(categoriaId) } };
  if (String(semCategoria) === "true") where.categorias = { none: {} };
  if (String(baixaConfiancaCategoria) === "true") {
    where.categorias = { some: { principal: true, confianca: { lt: 70 } } };
  }

  const mensagens = await prisma.mensagem.findMany({
    where,
    orderBy: { criadoEm: "desc" },
    take: 100,
    include: {
      grupoFonte: true,
      categorias: {
        orderBy: [{ principal: "desc" }, { confianca: "desc" }],
        include: { categoria: true },
      },
      logs: {
        where: { etapa: { in: ["afiliado_mercado_livre", "afiliado_amazon", "formatacao_automatica", "classificacao_categoria"] } },
        orderBy: { criadoEm: "asc" },
      },
    },
  });
  res.json(mensagens);
}));

rotasMensagens.get("/:id", rotaAsync(async (req, res) => {
  const mensagem = await prisma.mensagem.findUnique({
    where: { id: req.params.id },
    include: { grupoFonte: true, categorias: { include: { categoria: true }, orderBy: [{ principal: "desc" }, { confianca: "desc" }] }, logs: { orderBy: { criadoEm: "asc" } } },
  });
  if (!mensagem) return res.status(404).json({ erro: "Mensagem não encontrada" });
  res.json(mensagem);
}));

const editarMensagemSchema = z.object({
  conteudoProcessado: z.string().min(1),
});

rotasMensagens.patch("/:id", rotaAsync(async (req, res) => {
  const parsed = editarMensagemSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ erro: "Dados inválidos", detalhes: parsed.error.issues });

  const existente = await prisma.mensagem.findUnique({
    where: { id: req.params.id },
    include: { grupoFonte: true },
  });
  if (!existente) return res.status(404).json({ erro: "Mensagem não encontrada" });

  const conteudoSeguro = garantirRodapeObrigatorio(parsed.data.conteudoProcessado);
  const formatacao = formatarPromocaoAutomaticamente(conteudoSeguro, {
    grupoFonteId: existente.grupoFonte.id,
    nomeGrupoFonte: existente.grupoFonte.nome,
    identificadorExterno: existente.grupoFonte.identificadorExterno,
  });
  await prisma.mensagem.update({
    where: { id: req.params.id },
    data: {
      conteudoProcessado: conteudoSeguro,
      confianca: formatacao.confianca,
      analise: {
        fonte: formatacao.fonte,
        origemDeteccaoFonte: formatacao.origemDeteccaoFonte,
        confianca: formatacao.confianca,
        motivosConfianca: formatacao.motivosConfianca,
        camposAusentes: formatacao.camposAusentes,
        produto: formatacao.produto,
        precoAntigo: formatacao.precoAntigo,
        precoAtual: formatacao.precoAtual,
        parcelamento: formatacao.parcelamento,
        cupom: formatacao.cupom,
        freteGratis: formatacao.freteGratis,
        linkCompra: formatacao.linkCompra,
        origem: "edicao_manual",
      } as any,
    },
  });

  await classificarESalvarCategorias(req.params.id, {
    produto: formatacao.produto,
    textoOriginal: existente.conteudoOriginal,
    textoProcessado: conteudoSeguro,
  });
  await prisma.log.create({
    data: { mensagemId: req.params.id, etapa: "edicao_manual", status: "OK", detalhe: `confianca=${formatacao.confianca}` },
  }).catch(() => undefined);

  const mensagem = await prisma.mensagem.findUnique({
    where: { id: req.params.id },
    include: { categorias: { include: { categoria: true }, orderBy: [{ principal: "desc" }, { confianca: "desc" }] } },
  });
  res.json(mensagem);
}));


const formatarMensagemSchema = z.object({
  texto: z.string().min(1).optional(),
});

// Reaplica o template determinístico à mensagem atual do painel.
// Links externos são removidos; somente meli.la/link.amazon sobrevivem e o Linktree oficial
// é acrescentado obrigatoriamente no final.
rotasMensagens.post("/:id/formatar", rotaAsync(async (req, res) => {
  const parsed = formatarMensagemSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ erro: "Dados inválidos", detalhes: parsed.error.issues });

  const existente = await prisma.mensagem.findUnique({
    where: { id: req.params.id },
    include: { grupoFonte: true },
  });
  if (!existente) return res.status(404).json({ erro: "Mensagem não encontrada" });

  const origem = parsed.data.texto ?? existente.conteudoProcessado ?? existente.conteudoOriginal ?? "";
  if (!origem.trim()) return res.status(400).json({ erro: "Mensagem sem texto para formatar" });

  const formatada = formatarPromocaoAutomaticamente(origem, {
    grupoFonteId: existente.grupoFonte.id,
    nomeGrupoFonte: existente.grupoFonte.nome,
    identificadorExterno: existente.grupoFonte.identificadorExterno,
  });
  const textoFormatadoSeguro = garantirRodapeObrigatorio(formatada.texto);
  const analise = {
    fonte: formatada.fonte,
    origemDeteccaoFonte: formatada.origemDeteccaoFonte,
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
    origem: "formatacao_manual",
  };

  const mensagem = await prisma.mensagem.update({
    where: { id: req.params.id },
    data: {
      conteudoProcessado: textoFormatadoSeguro,
      confianca: formatada.confianca,
      analise: analise as any,
    },
  });

  await classificarESalvarCategorias(existente.id, {
    produto: formatada.produto,
    textoOriginal: existente.conteudoOriginal,
    textoProcessado: textoFormatadoSeguro,
  });

  await prisma.log.create({
    data: {
      mensagemId: existente.id,
      etapa: "formatacao_manual",
      status: formatada.camposAusentes.length ? "ERRO" : "OK",
      detalhe: JSON.stringify(analise),
    },
  }).catch(() => undefined);

  res.json({ ...mensagem, formatacao: formatada });
}));

const categoriasMensagemSchema = z.object({
  categoriaIds: z.array(z.string().uuid()).max(20),
  principalId: z.string().uuid().nullable().optional(),
});

rotasMensagens.put("/:id/categorias", rotaAsync(async (req, res) => {
  const parsed = categoriasMensagemSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ erro: "Dados inválidos", detalhes: parsed.error.issues });

  const mensagem = await prisma.mensagem.findUnique({ where: { id: req.params.id } });
  if (!mensagem) return res.status(404).json({ erro: "Mensagem não encontrada" });

  const ids = [...new Set(parsed.data.categoriaIds)];
  const principalId = parsed.data.principalId && ids.includes(parsed.data.principalId)
    ? parsed.data.principalId
    : ids[0] ?? null;

  const validas = await prisma.categoria.findMany({ where: { id: { in: ids }, ativo: true }, select: { id: true } });
  if (validas.length !== ids.length) return res.status(400).json({ erro: "Uma ou mais categorias são inválidas/inativas" });

  const anteriores = await prisma.mensagemCategoria.findMany({
    where: { mensagemId: mensagem.id },
    select: { categoriaId: true, principal: true },
  });
  const idsAnteriores = anteriores.map((c) => c.categoriaId).sort();
  const idsNovos = [...ids].sort();
  const principalAnterior = anteriores.find((c) => c.principal)?.categoriaId ?? null;
  const alterou = JSON.stringify(idsAnteriores) !== JSON.stringify(idsNovos) || principalAnterior !== principalId;

  await prisma.$transaction(async (tx) => {
    await tx.mensagemCategoria.deleteMany({ where: { mensagemId: mensagem.id } });
    if (ids.length) {
      await tx.mensagemCategoria.createMany({
        data: ids.map((categoriaId) => ({
          mensagemId: mensagem.id,
          categoriaId,
          confianca: 100,
          principal: categoriaId === principalId,
          origem: "MANUAL",
          motivos: ["categoria confirmada manualmente no painel"],
        })),
      });
    }
  });

  await prisma.log.create({
    data: {
      mensagemId: mensagem.id,
      etapa: alterou ? "categoria_manual_correcao" : "categoria_manual_confirmacao",
      status: "OK",
      detalhe: JSON.stringify({ categoriaIds: ids, principalId, idsAnteriores, principalAnterior }),
    },
  }).catch(() => undefined);

  const atualizada = await prisma.mensagem.findUnique({
    where: { id: mensagem.id },
    include: { categorias: { include: { categoria: true }, orderBy: [{ principal: "desc" }, { confianca: "desc" }] } },
  });
  res.json(atualizada);
}));

rotasMensagens.post("/:id/publicar", rotaAsync(async (req, res) => {
  const resultado = await publicarMensagemManual(req.params.id);
  return res.status(resultado.statusHttp).json(resultado.corpo);
}));

rotasMensagens.post("/:id/descartar", rotaAsync(async (req, res) => {
  const mensagem = await prisma.mensagem.update({
    where: { id: req.params.id },
    data: { status: "DESCARTADA_MANUAL" },
  });
  res.json(mensagem);
}));
