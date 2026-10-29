import * as fs from "fs";
import { Mensagem } from "@prisma/client";
import { prisma } from "../db/client";
import { publicarNoTelegram } from "./telegram-bot";
import { publicarNoWhatsapp } from "./whatsapp-baileys";
import { MidiaNormalizada } from "../utils/types";
import { childLogger } from "../utils/logger";
import { env } from "../config/env";

const log = childLogger("publicar-nos-destinos");

async function registrarLog(mensagemId: string, etapa: string, status: "OK" | "ERRO", detalhe?: string) {
  await prisma.log.create({ data: { mensagemId, etapa, status, detalhe } });
}

export interface ResultadoPublicacao {
  sucesso: boolean;
  parcial: boolean;
  telegram: { total: number; enviados: number; falhas: number };
  whatsapp: { total: number; enviados: number; falhas: number };
}

export type OpcoesPublicacao = {
  /** Futuro roteamento por categoria pode informar apenas os destinos selecionados. */
  destinosTelegramIds?: string[];
};

export async function publicarNosDestinos(
  mensagem: Mensagem,
  opcoes: OpcoesPublicacao = {}
): Promise<ResultadoPublicacao> {
  const texto = mensagem.conteudoProcessado ?? mensagem.conteudoOriginal;
  const midias = ((mensagem.midias as unknown as MidiaNormalizada[] | null) ?? []).filter(
    (m) => m.tipo === "imagem"
  );

  const destinosTelegram = await prisma.grupo.findMany({
    where: {
      tipo: "DESTINO",
      ativo: true,
      id: opcoes.destinosTelegramIds?.length ? { in: opcoes.destinosTelegramIds } : undefined,
      plataforma: { chave: "telegram", ativo: true },
    },
  });

  let telegramEnviados = 0;
  let telegramFalhas = 0;
  let whatsappTotal = 0;
  let whatsappEnviados = 0;
  let whatsappFalhas = 0;

  for (const destino of destinosTelegram) {
    const resultado = await publicarNoTelegram(destino.identificadorExterno, texto, midias);

    if (resultado.ok) {
      telegramEnviados++;
      await registrarLog(mensagem.id, "publicacao_telegram", "OK", `destino=${destino.nome}`);

      const whatsapp = await replicarNoWhatsappVinculado(destino.id, mensagem.id, texto, midias);
      whatsappTotal += whatsapp.total;
      whatsappEnviados += whatsapp.enviados;
      whatsappFalhas += whatsapp.falhas;
    } else {
      telegramFalhas++;
      await registrarLog(mensagem.id, "publicacao_telegram", "ERRO", resultado.erro);
      log.error({ destino: destino.nome, erro: resultado.erro }, "falha ao publicar no Telegram");
    }
  }

  if (telegramEnviados > 0) {
    // Mantém o status principal como publicação no Telegram. As publicações
    // WhatsApp ficam registradas individualmente em Log, sem sobrescrever e
    // perder a informação de que o Telegram também foi publicado.
    await prisma.mensagem.update({
      where: { id: mensagem.id },
      data: { status: "PUBLICADA_TELEGRAM" },
    });

    for (const midia of midias) {
      fs.promises.unlink(midia.referencia).catch(() => undefined);
    }
  }

  const totalFalhas = telegramFalhas + whatsappFalhas;
  const algumaPublicacao = telegramEnviados > 0;

  return {
    sucesso: algumaPublicacao && totalFalhas === 0,
    parcial: algumaPublicacao && totalFalhas > 0,
    telegram: {
      total: destinosTelegram.length,
      enviados: telegramEnviados,
      falhas: telegramFalhas,
    },
    whatsapp: {
      total: whatsappTotal,
      enviados: whatsappEnviados,
      falhas: whatsappFalhas,
    },
  };
}

async function replicarNoWhatsappVinculado(
  destinoTelegramId: string,
  mensagemId: string,
  texto: string,
  midias: MidiaNormalizada[]
): Promise<{ total: number; enviados: number; falhas: number }> {
  if (!env.WHATSAPP_ENABLED) return { total: 0, enviados: 0, falhas: 0 };

  const vinculos = await prisma.vinculoDestino.findMany({
    where: { origemId: destinoTelegramId, ativo: true },
    include: {
      destino: {
        include: { plataforma: true },
      },
    },
  });

  let total = 0;
  let enviados = 0;
  let falhas = 0;

  for (const vinculo of vinculos) {
    const destino = vinculo.destino;
    if (
      destino.tipo !== "DESTINO" ||
      !destino.ativo ||
      !destino.plataforma.ativo ||
      destino.plataforma.chave !== "whatsapp"
    ) {
      continue;
    }

    total++;
    const resultado = await publicarNoWhatsapp(destino.identificadorExterno, texto, midias);

    if (resultado.ok) {
      enviados++;
      const detalhe = resultado.aviso
        ? `destino=${destino.nome}; ${resultado.aviso}`
        : `destino=${destino.nome}; imagem=${resultado.midiaEnviada ? "sim" : "não"}`;
      await registrarLog(mensagemId, "publicacao_whatsapp", "OK", detalhe);

      if (resultado.aviso) {
        await registrarLog(mensagemId, "publicacao_whatsapp_midia", "ERRO", resultado.aviso);
        log.warn({ destino: destino.nome, aviso: resultado.aviso }, "WhatsApp publicado sem imagem");
      }
    } else {
      falhas++;
      await registrarLog(mensagemId, "publicacao_whatsapp", "ERRO", resultado.erro);
      log.error({ destino: destino.nome, erro: resultado.erro }, "falha ao publicar no WhatsApp");
    }
  }

  return { total, enviados, falhas };
}
