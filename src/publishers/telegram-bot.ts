import { Bot, InputFile } from "grammy";
import { env } from "../config/env";
import { prisma } from "../db/client";
import { childLogger } from "../utils/logger";
import { atualizarBotTelegram } from "../utils/estado-runtime";
import { MidiaNormalizada } from "../utils/types";
import { formatarTextoTelegramHtml } from "./formatar-telegram-html";

const log = childLogger("telegram-publisher");

export const botTelegram = new Bot(env.TELEGRAM_BOT_TOKEN);

// Publica o texto (e a imagem, se houver) já processados no chat de
// destino informado. Se houver uma mídia do tipo "imagem" na lista,
// publica como foto com legenda; caso contrário, manda só texto.
// Retorna o id da mensagem publicada (útil para futuras funcionalidades,
// como editar/apagar depois).
export async function publicarNoTelegram(
  identificadorExternoDestino: string,
  texto: string,
  midias: MidiaNormalizada[] = []
): Promise<{ ok: true; idMensagem: number } | { ok: false; erro: string }> {
  try {
    const imagem = midias.find((m) => m.tipo === "imagem");
    const textoTelegram = formatarTextoTelegramHtml(texto);

    const enviada = imagem
      ? await botTelegram.api.sendPhoto(identificadorExternoDestino, new InputFile(imagem.referencia), {
          caption: textoTelegram,
          parse_mode: "HTML",
        })
      : await botTelegram.api.sendMessage(identificadorExternoDestino, textoTelegram, {
          parse_mode: "HTML",
          link_preview_options: { is_disabled: false },
        });

    return { ok: true, idMensagem: enviada.message_id };
  } catch (erro: any) {
    log.error({ erro: erro?.message, destino: identificadorExternoDestino }, "falha ao publicar no Telegram");
    return { ok: false, erro: String(erro?.message ?? erro) };
  }
}

export async function iniciarBotTelegram() {
  // O bot só precisa estar "vivo" para poder chamar a API de envio;
  // não usamos polling/webhook aqui pois ele não recebe mensagens,
  // apenas publica (quem escuta é o userbot em outro módulo).
  try {
    await botTelegram.init();

    atualizarBotTelegram({ conectado: true, erro: null, username: botTelegram.botInfo.username });
    await prisma.statusIntegracao.upsert({
      where: { servico: "telegram_bot" },
      update: { conectado: true, detalhe: null },
      create: { servico: "telegram_bot", conectado: true },
    });

    log.info({ username: botTelegram.botInfo.username }, "Bot Telegram (publicador) pronto");
  } catch (erro: any) {
    const mensagemErro = String(erro?.message ?? erro);
    atualizarBotTelegram({ conectado: false, erro: mensagemErro });
    await prisma.statusIntegracao.upsert({
      where: { servico: "telegram_bot" },
      update: { conectado: false, detalhe: mensagemErro },
      create: { servico: "telegram_bot", conectado: false, detalhe: mensagemErro },
    });
    log.error({ erro: mensagemErro }, "falha ao iniciar o bot Telegram (publicador) — token inválido?");
    throw erro;
  }
}
