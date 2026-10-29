import { env } from "./config/env";
import { logger } from "./utils/logger";
import { iniciarBotTelegram } from "./publishers/telegram-bot";
import { iniciarWhatsapp } from "./publishers/whatsapp-baileys";
import { iniciarUserbotListener } from "./collectors/telegram/userbot-listener";
import { iniciarWorkerMensagens } from "./queue/fila-mensagens";
import { iniciarServidorAdmin } from "./admin/server";
import { limparMidiasTemporarias } from "./utils/limpar-midias-temporarias";

type ResultadoInicio = { nome: string; ok: boolean };

async function iniciarIntegracao(nome: string, fn: () => Promise<unknown>): Promise<ResultadoInicio> {
  try {
    await fn();
    return { nome, ok: true };
  } catch (erro) {
    logger.error({ erro, servico: nome }, `Falha ao iniciar "${nome}"`);
    return { nome, ok: false };
  }
}

async function main() {
  logger.info({ ambiente: env.NODE_ENV }, "Iniciando central de promoções...");
  iniciarServidorAdmin();
  await limparMidiasTemporarias();

  const telegram = await iniciarIntegracao("bot_telegram", iniciarBotTelegram);
  const whatsapp = env.WHATSAPP_ENABLED
    ? await iniciarIntegracao("whatsapp", iniciarWhatsapp)
    : { nome: "whatsapp", ok: true };

  if (!env.WHATSAPP_ENABLED) logger.warn("WhatsApp desativado (WHATSAPP_ENABLED=false).");

  // O worker depende do publicador Telegram. Não consumimos a fila se a
  // dependência obrigatória não estiver disponível.
  if (telegram.ok) {
    iniciarWorkerMensagens();
  } else {
    logger.error("Worker não iniciado porque o bot Telegram não ficou disponível.");
  }

  const userbot = await iniciarIntegracao("userbot", iniciarUserbotListener);
  logger.info({ telegram: telegram.ok, whatsapp: whatsapp.ok, userbot: userbot.ok }, "Inicialização concluída");
}

main().catch((erro) => {
  logger.fatal({ erro }, "Falha fatal ao iniciar o sistema");
  process.exit(1);
});

process.on("unhandledRejection", (erro) => {
  logger.fatal({ erro }, "unhandledRejection não tratado; encerrando para reinício limpo");
  process.exitCode = 1;
  setTimeout(() => process.exit(1), 100).unref();
});
