import * as fs from "fs";
import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  WASocket,
} from "@whiskeysockets/baileys";
import { Boom } from "@hapi/boom";
import qrcode from "qrcode-terminal";
import { env } from "../config/env";
import { prisma } from "../db/client";
import { MidiaNormalizada } from "../utils/types";
import { childLogger } from "../utils/logger";
import { formatarWhatsapp } from "./formatar-whatsapp";

const log = childLogger("whatsapp-publisher");

let socket: WASocket | null = null;

// Conecta ao WhatsApp via Baileys. Na primeira execução, mostra um QR
// code no terminal — escaneie com o WhatsApp do número DEDICADO
// (nunca o seu número pessoal, para isolar o risco de banimento).
// A sessão fica salva em WHATSAPP_SESSION_PATH e reconecta sozinha
// nas próximas execuções.
export async function iniciarWhatsapp(): Promise<WASocket> {
  const { state, saveCreds } = await useMultiFileAuthState(env.WHATSAPP_SESSION_PATH);

  socket = makeWASocket({ auth: state, printQRInTerminal: false });

  socket.ev.on("creds.update", saveCreds);

  socket.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      log.info("Escaneie o QR code abaixo com o WhatsApp do número dedicado:");
      qrcode.generate(qr, { small: true });
    }

    if (connection === "open") {
      log.info("WhatsApp conectado");
      await prisma.statusIntegracao.upsert({
        where: { servico: "whatsapp" },
        update: { conectado: true, detalhe: null },
        create: { servico: "whatsapp", conectado: true },
      });
    }

    if (connection === "close") {
      const motivo = (lastDisconnect?.error as Boom)?.output?.statusCode;
      const deveReconectar = motivo !== DisconnectReason.loggedOut;

      await prisma.statusIntegracao.upsert({
        where: { servico: "whatsapp" },
        update: { conectado: false, detalhe: `Desconectado (código ${motivo})` },
        create: { servico: "whatsapp", conectado: false, detalhe: `Desconectado (código ${motivo})` },
      });

      log.warn({ motivo, deveReconectar }, "conexão WhatsApp fechada");
      if (deveReconectar) {
        await iniciarWhatsapp();
      } else {
        log.error("Sessão do WhatsApp foi deslogada — apague a pasta de sessão e escaneie o QR novamente.");
      }
    }
  });

  return socket;
}

export type ResultadoPublicacaoWhatsapp =
  | { ok: true; midiaEnviada: boolean; aviso?: string }
  | { ok: false; erro: string };

// Publica a promoção no WhatsApp. Quando houver imagem local, envia a
// imagem com o texto como legenda. Se a imagem falhar por qualquer motivo,
// tenta uma segunda estratégia segura: envia somente o texto para não perder
// a promoção e devolve um aviso para o log do pipeline.
export async function publicarNoWhatsapp(
  jidDestino: string,
  texto: string,
  midias: MidiaNormalizada[] = []
): Promise<ResultadoPublicacaoWhatsapp> {
  if (!socket) {
    return { ok: false, erro: "socket do WhatsApp não inicializado" };
  }

  const textoWhatsapp = formatarWhatsapp(texto);
  const imagem = midias.find((m) => m.tipo === "imagem");

  if (imagem) {
    try {
      // Buffer é mais previsível no Baileys do que depender de resolução de
      // caminho/URL pelo próprio cliente, e o arquivo já está local em tmp/midias.
      const buffer = await fs.promises.readFile(imagem.referencia);
      await socket.sendMessage(jidDestino, {
        image: buffer,
        caption: textoWhatsapp,
      });

      return { ok: true, midiaEnviada: true };
    } catch (erroImagem: any) {
      const detalheImagem = String(erroImagem?.message ?? erroImagem);
      log.warn(
        { erro: detalheImagem, destino: jidDestino, arquivo: imagem.referencia },
        "falha ao publicar imagem no WhatsApp — tentando somente texto"
      );

      try {
        await socket.sendMessage(jidDestino, { text: textoWhatsapp });
        return {
          ok: true,
          midiaEnviada: false,
          aviso: `imagem não enviada; fallback para texto: ${detalheImagem}`,
        };
      } catch (erroTexto: any) {
        const detalheTexto = String(erroTexto?.message ?? erroTexto);
        log.error(
          { erro: detalheTexto, erroImagem: detalheImagem, destino: jidDestino },
          "falha ao publicar no WhatsApp após fallback para texto"
        );
        return {
          ok: false,
          erro: `imagem falhou (${detalheImagem}); texto também falhou (${detalheTexto})`,
        };
      }
    }
  }

  try {
    await socket.sendMessage(jidDestino, { text: textoWhatsapp });
    return { ok: true, midiaEnviada: false };
  } catch (erro: any) {
    log.error({ erro: erro?.message, destino: jidDestino }, "falha ao publicar no WhatsApp");
    return { ok: false, erro: String(erro?.message ?? erro) };
  }
}
