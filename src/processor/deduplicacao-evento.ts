import { prisma } from "../db/client";

export async function eventoJaConhecido(grupoFonteId: string, idExternoOriginal: string): Promise<boolean> {
  const existente = await prisma.mensagem.findUnique({
    where: {
      grupoFonteId_idExternoOriginal: { grupoFonteId, idExternoOriginal },
    },
    select: { id: true },
  });
  if (existente) return true;

  const ignorada = await prisma.mensagemIgnorada.findFirst({
    where: { grupoFonteId, idExternoOriginal },
    select: { id: true },
  });
  return Boolean(ignorada);
}
