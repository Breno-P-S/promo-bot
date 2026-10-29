import { readdir, stat, unlink } from "node:fs/promises";
import { join } from "node:path";
import { env } from "../config/env";
import { childLogger } from "./logger";

const log = childLogger("limpeza-midias");

export async function limparMidiasTemporarias(): Promise<void> {
  const pasta = join(process.cwd(), "tmp", "midias");
  const limite = Date.now() - env.TMP_MEDIA_MAX_AGE_DAYS * 24 * 60 * 60 * 1000;

  let arquivos: string[];
  try {
    arquivos = await readdir(pasta);
  } catch {
    return;
  }

  let removidos = 0;
  await Promise.all(arquivos.map(async (nome) => {
    const caminho = join(pasta, nome);
    try {
      const info = await stat(caminho);
      if (!info.isFile() || info.mtimeMs >= limite) return;
      await unlink(caminho);
      removidos++;
    } catch (erro) {
      log.debug({ erro, caminho }, "não foi possível avaliar/remover mídia temporária");
    }
  }));

  if (removidos > 0) log.info({ removidos }, "mídias temporárias antigas removidas");
}
