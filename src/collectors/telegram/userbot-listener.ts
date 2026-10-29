import * as fs from "fs";
import * as path from "path";
import { Api, TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions";
import { NewMessage, NewMessageEvent } from "telegram/events";
import { env } from "../../config/env";
import { prisma } from "../../db/client";
import { enfileirarMensagem } from "../../queue/fila-mensagens";
import { extrairLinks } from "../../processor/extrair-links";
import { MidiaNormalizada } from "../../utils/types";
import { childLogger } from "../../utils/logger";
import {
  atualizarUserbot,
  registrarMensagemLida,
} from "../../utils/estado-runtime";
import { registrarMensagemIgnoradaPersistida } from "../../utils/mensagens-ignoradas";
import { eventoJaConhecido } from "../../processor/deduplicacao-evento";

const log = childLogger("telegram-userbot");

const PASTA_MIDIAS = path.join(process.cwd(), "tmp", "midias");

// Cache em memória dos ids externos (chat id) das fontes ativas.
// Recarregado periodicamente para refletir mudanças feitas no painel
// sem precisar reiniciar o processo.
let fontesAtivas = new Set<string>();
let mapaGrupoIdPorExterno = new Map<string, string>(); // externo -> id interno (uuid)

async function recarregarFontes() {
  const fontes = await prisma.grupo.findMany({
    where: { tipo: "FONTE", ativo: true, plataforma: { chave: "telegram" } },
  });
  fontesAtivas = new Set(fontes.map((f) => f.identificadorExterno));
  mapaGrupoIdPorExterno = new Map(fontes.map((f) => [f.identificadorExterno, f.id]));
  atualizarUserbot({ totalFontesAtivas: fontesAtivas.size });
  log.debug({ total: fontesAtivas.size }, "fontes Telegram recarregadas");

  if (fontesAtivas.size === 0) {
    log.warn(
      "Nenhuma fonte Telegram ativa cadastrada — TODAS as mensagens estão sendo " +
        "ignoradas. Cadastre uma fonte com POST /grupos (tipo=FONTE) e confira o painel."
    );
  }
}

// Baixa a mídia (se houver) de uma mensagem para um arquivo local e
// devolve a referência normalizada. Usada tanto pelo listener ao vivo
// quanto pelo polling de segurança — os dois recebem um objeto de
// mensagem do GramJS com a mesma forma (`.media`, `.id`, `.chatId`).
//
// O arquivo fica em tmp/midias/ até a mensagem ser publicada (o
// publicador consome esse caminho local diretamente, já que roda no
// mesmo processo). É apagado depois de publicada com sucesso.
async function baixarMidias(client: TelegramClient, mensagem: Api.Message): Promise<MidiaNormalizada[]> {
  const midias: MidiaNormalizada[] = [];
  const media = mensagem.media as any;
  if (!media) return midias;

  try {
    await fs.promises.mkdir(PASTA_MIDIAS, { recursive: true });

    if (media.photo) {
      const caminho = path.join(PASTA_MIDIAS, `${mensagem.chatId}_${mensagem.id}.jpg`);
      await client.downloadMedia(mensagem, { outputFile: caminho } as any);
      midias.push({ tipo: "imagem", referencia: caminho });
    } else if (media.document) {
      const mime = media.document?.mimeType as string | undefined;
      const ehVideo = mime?.startsWith("video/") ?? false;
      const extensao = ehVideo ? "mp4" : "jpg"; // ex: foto enviada "como arquivo"
      const caminho = path.join(PASTA_MIDIAS, `${mensagem.chatId}_${mensagem.id}.${extensao}`);
      await client.downloadMedia(mensagem, { outputFile: caminho } as any);
      midias.push({ tipo: ehVideo ? "video" : "imagem", referencia: caminho });
    }
  } catch (erro) {
    log.warn({ erro, msgId: mensagem.id }, "falha ao baixar mídia da mensagem — publicará sem imagem");
  }

  return midias;
}

async function atualizarStatusDb(conectado: boolean, detalhe: string | null) {
  await prisma.statusIntegracao.upsert({
    where: { servico: "telegram_userbot" },
    update: { conectado, detalhe },
    create: { servico: "telegram_userbot", conectado, detalhe },
  });
}

// Rede de segurança: além do listener ao vivo (addEventHandler), buscamos
// ativamente as últimas 5 mensagens de cada fonte a cada poucos minutos.
// Isso cobre os casos em que o Telegram não empurra o update em tempo real
// para esta sessão (comum em canais grandes/com muitos inscritos) — sem
// depender de entender exatamente por que o update ao vivo falhou.
//
// Não precisa controlar duplicatas manualmente: o pipeline (processarMensagem)
// já descarta mensagens repetidas pelo hash de conteúdo, então buscar a
// mesma mensagem mais de uma vez é inofensivo.
async function pollarFontesTelegram(client: TelegramClient) {
  if (mapaGrupoIdPorExterno.size === 0) return;

  for (const [chatId, grupoFonteId] of mapaGrupoIdPorExterno.entries()) {
    try {
      const mensagens = await client.getMessages(chatId, { limit: 5 });
      let comTexto = 0;

      for (const mensagem of mensagens) {
        const texto = mensagem.message ?? "";
        if (!texto.trim()) continue; // mesma regra do listener ao vivo: sem texto, ignora
        comTexto += 1;

        const idExternoOriginal = String(mensagem.id);
        if (await eventoJaConhecido(grupoFonteId, idExternoOriginal)) continue;

        const midias = await baixarMidias(client, mensagem);

        await enfileirarMensagem({
          grupoFonteId,
          idExternoOriginal,
          texto,
          midias,
          linksEncontrados: extrairLinks(texto),
        });
      }

      log.debug({ chatId, verificadas: mensagens.length, comTexto }, "polling de fonte concluído");
    } catch (erro) {
      log.warn({ erro, chatId }, "falha ao pollar mensagens recentes desta fonte");
    }
  }
}

export async function iniciarUserbotListener() {
  const apiId = Number(env.TELEGRAM_API_ID);
  const apiHash = env.TELEGRAM_API_HASH;

  if (!env.TELEGRAM_USERBOT_SESSION) {
    const mensagemErro =
      "TELEGRAM_USERBOT_SESSION vazio. Rode src/collectors/telegram/gerar-sessao.ts primeiro.";
    log.error(mensagemErro);
    atualizarUserbot({ conectado: false, erro: mensagemErro });
    await atualizarStatusDb(false, mensagemErro);
    throw new Error("Sessão do userbot não configurada");
  }

  const client = new TelegramClient(
    new StringSession(env.TELEGRAM_USERBOT_SESSION),
    apiId,
    apiHash,
    { connectionRetries: 5 }
  );

  try {
    await client.connect();
  } catch (erro: any) {
    const mensagemErro = String(erro?.message ?? erro);
    log.error({ erro: mensagemErro }, "falha ao conectar o userbot Telegram");
    atualizarUserbot({ conectado: false, erro: mensagemErro });
    await atualizarStatusDb(false, mensagemErro);
    throw erro;
  }

  // "Aquece" a lista de diálogos logo após conectar. Isso resolve o
  // access_hash/entidade de cada canal e faz o cliente "abrir" o estado
  // de sincronização (pts) de cada canal perante o servidor do Telegram.
  // Sem isso, canais (diferente de grupos comuns) podem simplesmente não
  // receber updates ao vivo nesta sessão até serem "abertos" ao menos
  // uma vez — o Telegram não empurra updates de canal por padrão para
  // uma sessão que nunca os listou/acessou.
  try {
    const dialogos = await client.getDialogs({});
    log.info({ total: dialogos.length }, "diálogos sincronizados (warmup de canais/grupos)");
  } catch (erro) {
    log.warn({ erro }, "falha ao sincronizar diálogos no warmup — updates de canal podem não chegar");
  }

  await recarregarFontes();
  setInterval(recarregarFontes, 60_000); // recarrega fontes a cada 1 min

  // Rede de segurança: busca ativamente as últimas 5 mensagens de cada
  // fonte a cada 3 minutos, cobrindo os casos em que o update ao vivo
  // não chega (ex: canais grandes). Roda uma vez logo de cara também,
  // sem esperar o primeiro ciclo do intervalo.
  const INTERVALO_POLLING_MS = env.TELEGRAM_POLL_INTERVAL_MS;
  pollarFontesTelegram(client).catch((erro) => log.warn({ erro }, "falha no polling inicial"));
  setInterval(() => {
    pollarFontesTelegram(client).catch((erro) => log.warn({ erro }, "falha no polling periódico"));
  }, INTERVALO_POLLING_MS);

  // Checagem periódica de saúde: o GramJS reconecta sozinho por baixo dos
  // panos, mas se a sessão cair de vez (ex: revogada, ou o número deslogado
  // no app oficial), queremos refletir isso no painel — sem isso o registro
  // no banco ficaria "conectado" para sempre, mesmo com o cliente morto.
  setInterval(async () => {
    const conectado = client.connected === true;
    atualizarUserbot({ conectado, erro: conectado ? null : "Conexão perdida (checagem periódica)" });
    await atualizarStatusDb(conectado, conectado ? null : "Conexão perdida (checagem periódica)");
    if (!conectado) {
      log.warn("userbot Telegram aparenta estar desconectado (checagem periódica)");
    }
  }, 15_000);

  client.addEventHandler(async (event: NewMessageEvent) => {
    try {
      const chatId = event.message.chatId?.toString();

      if (!chatId || !fontesAtivas.has(chatId)) {
        // Tráfego fora das fontes cadastradas não é uma mensagem candidata
        // do bot e, por isso, não entra na aba de ignoradas.
        return;
      }

      const grupoFonteId = mapaGrupoIdPorExterno.get(chatId)!;
      const texto = event.message.message ?? "";
      if (!texto.trim()) {
        await registrarMensagemIgnoradaPersistida({
          motivo: "mensagem sem texto (só mídia) — não suportado ainda",
          grupoFonteId,
          identificadorChat: chatId,
          idExternoOriginal: String(event.message.id),
          conteudo: null,
        });
        return; // ignora mensagens sem texto (por ora)
      }

      const idExternoOriginal = String(event.message.id);
      if (await eventoJaConhecido(grupoFonteId, idExternoOriginal)) return;

      const midias = await baixarMidias(client, event.message);

      await enfileirarMensagem({
        grupoFonteId,
        idExternoOriginal,
        texto,
        midias,
        linksEncontrados: extrairLinks(texto),
      });

      registrarMensagemLida();
      log.info({ chatId, msgId: event.message.id }, "mensagem capturada e enfileirada");
    } catch (erro) {
      const mensagemErro = String((erro as any)?.message ?? erro);
      atualizarUserbot({ erro: mensagemErro });
      log.error({ erro }, "erro ao processar evento de nova mensagem");
    }
  }, new NewMessage({}));

  atualizarUserbot({ conectado: true, ultimaConexaoEm: new Date(), erro: null });
  await atualizarStatusDb(true, null);

  log.info("Userbot Telegram conectado e escutando fontes ativas");
  return client;
}
