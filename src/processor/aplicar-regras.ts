import { prisma } from "../db/client";
import { childLogger } from "../utils/logger";

const log = childLogger("aplicar-regras");

// Busca as regras aplicáveis a uma fonte: regras globais (grupoFonteId
// null) + regras específicas daquela fonte, ordenadas por `ordem`.
export async function buscarRegrasAplicaveis(grupoFonteId: string) {
  return prisma.regra.findMany({
    where: {
      ativo: true,
      OR: [{ grupoFonteId: null }, { grupoFonteId }],
    },
    orderBy: { ordem: "asc" },
  });
}

export async function aplicarRegrasDeTexto(texto: string, grupoFonteId: string): Promise<string> {
  const regras = await buscarRegrasAplicaveis(grupoFonteId);
  let resultado = texto;

  for (const regra of regras) {
    try {
      switch (regra.tipo) {
        case "REMOVER_TEXTO":
          resultado = resultado.replace(new RegExp(regra.padrao, "gi"), "");
          break;
        case "SUBSTITUIR_TEXTO":
          resultado = resultado.replace(new RegExp(regra.padrao, "gi"), regra.valor ?? "");
          break;
        case "ADICIONAR_TEXTO":
          resultado = `${resultado}\n${regra.valor ?? ""}`;
          break;
        case "ASSINATURA":
          resultado = `${resultado}\n\n${regra.valor ?? ""}`;
          break;
        case "REMOVER_LINK":
          resultado = resultado.replace(new RegExp(regra.padrao, "gi"), "");
          break;
      }
    } catch (erro) {
      // Uma regra malformada (ex: regex inválida cadastrada no painel)
      // não pode derrubar o processamento da mensagem inteira.
      log.warn({ regraId: regra.id, erro }, "falha ao aplicar regra, pulando");
    }
  }

  return resultado.trim();
}
