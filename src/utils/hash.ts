import { createHash } from "crypto";

// Gera um identificador único e estável para uma mensagem, usado para
// evitar publicar a mesma promoção mais de uma vez.
//
// Normaliza o texto (minúsculas, sem espaços extras, sem pontuação de
// borda) e combina com o primeiro link encontrado — assim pequenas
// variações de formatação entre republicações do mesmo produto ainda
// geram o mesmo hash na maioria dos casos práticos.
export function gerarHashMensagem(texto: string, primeiroLink: string | null): string {
  const textoNormalizado = texto
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[^\p{L}\p{N} ]/gu, "")
    .trim();

  const base = `${textoNormalizado}|${primeiroLink ?? ""}`;
  return createHash("sha256").update(base).digest("hex");
}
