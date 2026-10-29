const REGEX_URL = /https?:\/\/[^\s]+/gi;
const PONTUACAO_FINAL = /[.,!?;:'"\]}>]+$/;

function limparPontuacaoFinal(url: string): string {
  let limpa = url.replace(PONTUACAO_FINAL, "");

  // Remove ')' finais apenas quando não existe um '(' correspondente
  // dentro da própria URL. Isso evita quebrar URLs válidas com parênteses.
  while (limpa.endsWith(")")) {
    const abertos = (limpa.match(/\(/g) ?? []).length;
    const fechados = (limpa.match(/\)/g) ?? []).length;
    if (fechados <= abertos) break;
    limpa = limpa.slice(0, -1);
  }

  return limpa;
}

export function extrairLinks(texto: string): string[] {
  const encontrados = texto.match(REGEX_URL) ?? [];
  const normalizados = encontrados.map(limparPontuacaoFinal).filter(Boolean);
  // Remove duplicados mantendo a ordem de aparição
  return [...new Set(normalizados)];
}

export function extrairDominio(url: string): string | null {
  try {
    const { hostname } = new URL(url);
    return hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}
