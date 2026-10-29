export const LINKTREE_GRUPOS = "https://linktr.ee/homerpromocoes";

const DOMINIOS_AMAZON_ORIGEM = new Set([
  "amazon.com.br",
  "www.amazon.com.br",
  "link.amazon",
  "amzn.to",
  "a.co",
]);

export function limparUrlPromocao(url: string): string {
  return url.replace(/[),.;!?]+$/g, "");
}

export function dominioDaUrl(url: string): string | null {
  try {
    return new URL(limparUrlPromocao(url)).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

/** Links que o pipeline sabe converter para afiliado. */
export function ehLinkSuportadoNaOrigem(url: string): boolean {
  const dominio = dominioDaUrl(url);
  return dominio === "meli.la" || (dominio !== null && DOMINIOS_AMAZON_ORIGEM.has(dominio));
}

/** Links aceitos no texto final, depois da conversão. */
export function ehLinkCompraFinalValido(url: string): boolean {
  const limpo = limparUrlPromocao(url);
  return /^https:\/\/meli\.la\/[A-Za-z0-9_-]+$/i.test(limpo)
    || /^https:\/\/link\.amazon\/[A-Za-z0-9_-]+$/i.test(limpo);
}

export function ehLinktreeOficial(url: string): boolean {
  try {
    const u = new URL(limparUrlPromocao(url));
    return u.protocol === "https:"
      && u.hostname.toLowerCase() === "linktr.ee"
      && u.pathname.replace(/\/+$/, "") === "/homerpromocoes";
  } catch {
    return false;
  }
}
