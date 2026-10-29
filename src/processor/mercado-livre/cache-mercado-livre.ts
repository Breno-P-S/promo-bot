import { prisma } from "../../db/client";
import { childLogger } from "../../utils/logger";

const log = childLogger("mercado-livre-cache");

// Busca um link já convertido anteriormente para este código curto
// (ex: "2cYeScY" de meli.la/2cYeScY). Retorna null se nunca foi
// resolvido antes.
export async function buscarNoCache(codigoOriginal: string): Promise<string | null> {
  const registro = await prisma.linkAfiliadoMercadoLivre.findUnique({
    where: { codigoOriginal },
  });
  return registro?.linkGerado ?? null;
}

// Salva o resultado de uma conversão para reaproveitar da próxima vez
// que o mesmo link curto aparecer. Usa upsert porque, em tese, o mesmo
// código poderia ser processado em paralelo (duas mensagens quase
// simultâneas) — não queremos que a segunda tentativa quebre por
// violação de unique.
export async function salvarNoCache(params: {
  codigoOriginal: string;
  productId: string | null;
  urlCanonica: string;
  linkGerado: string;
}): Promise<void> {
  try {
    await prisma.linkAfiliadoMercadoLivre.upsert({
      where: { codigoOriginal: params.codigoOriginal },
      update: {
        productId: params.productId,
        urlCanonica: params.urlCanonica,
        linkGerado: params.linkGerado,
      },
      create: params,
    });
  } catch (erro) {
    // Falhar ao salvar o cache não pode derrubar o processamento da
    // mensagem — na pior das hipóteses, resolvemos de novo da próxima vez.
    log.warn({ erro, codigoOriginal: params.codigoOriginal }, "falha ao salvar cache de link Mercado Livre");
  }
}
