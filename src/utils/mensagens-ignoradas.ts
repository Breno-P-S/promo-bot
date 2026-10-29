import { prisma } from "../db/client";
import { childLogger } from "./logger";
import { registrarMensagemIgnorada as registrarNoRuntime } from "./estado-runtime";

const log = childLogger("mensagens-ignoradas");

type IgnoradaInput = {
  motivo: string;
  grupoFonteId?: string | null;
  identificadorChat?: string | null;
  idExternoOriginal?: string | null;
  conteudo?: string | null;
  plataforma?: string;
};

/**
 * Registra somente mensagens que eram candidatas reais ao pipeline e foram
 * ignoradas por uma regra do bot. Chats não cadastrados não entram aqui para
 * evitar poluir o banco com todo o tráfego da conta pessoal do Telegram.
 */
export async function registrarMensagemIgnoradaPersistida(input: IgnoradaInput): Promise<void> {
  registrarNoRuntime(input.motivo);

  try {
    if (input.grupoFonteId && input.idExternoOriginal) {
      const existente = await prisma.mensagemIgnorada.findFirst({
        where: {
          grupoFonteId: input.grupoFonteId,
          idExternoOriginal: input.idExternoOriginal,
          motivo: input.motivo,
        },
        select: { id: true },
      });
      if (existente) return;
    }

    await prisma.mensagemIgnorada.create({
      data: {
        plataforma: input.plataforma ?? "telegram",
        grupoFonteId: input.grupoFonteId ?? null,
        identificadorChat: input.identificadorChat ?? null,
        idExternoOriginal: input.idExternoOriginal ?? null,
        conteudo: input.conteudo ?? null,
        motivo: input.motivo,
      },
    });
  } catch (erro) {
    log.warn({ erro, motivo: input.motivo }, "não foi possível persistir mensagem ignorada");
  }
}
