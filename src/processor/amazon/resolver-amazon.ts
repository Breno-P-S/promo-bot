import { childLogger } from "../../utils/logger";

const log = childLogger("amazon-resolver");

const DOMINIOS_AMAZON = new Set([
  "amazon.com.br",
  "www.amazon.com.br",
  "link.amazon",
  "amzn.to",
  "a.co",
]);

const HEADERS_NAVEGADOR = {
  "user-agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36",
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "accept-language": "pt-BR,pt;q=0.9,en;q=0.8",
};

export function ehLinkAmazon(url: string): boolean {
  try {
    return DOMINIOS_AMAZON.has(new URL(url).hostname.toLowerCase());
  } catch {
    return false;
  }
}

export function extrairAsinAmazon(url: string): string | null {
  let decoded = url;
  try {
    decoded = decodeURIComponent(url);
  } catch {
    // URL pode conter '%' inválido; nesse caso usa a string original.
  }

  const padroes = [
    /\/dp\/([A-Z0-9]{10})(?:[/?#]|$)/i,
    /\/gp\/product\/([A-Z0-9]{10})(?:[/?#]|$)/i,
    /\/gp\/aw\/d\/([A-Z0-9]{10})(?:[/?#]|$)/i,
    /[?&](?:asin|ASIN)=([A-Z0-9]{10})(?:&|$)/,
  ];

  for (const padrao of padroes) {
    const match = decoded.match(padrao);
    if (match?.[1]) return match[1].toUpperCase();
  }

  return null;
}

async function fetchComTimeout(url: string, init: RequestInit = {}, timeoutMs = 12_000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function validarDestinoAmazon(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Amazon retornou URL final inválida: ${url}`);
  }

  const host = parsed.hostname.toLowerCase();
  if (host !== "amazon.com.br" && host !== "www.amazon.com.br") {
    throw new Error(`Link curto da Amazon redirecionou para domínio inesperado: ${host}`);
  }
}

export async function resolverAsinAmazon(linkOriginal: string): Promise<{ asin: string; urlFinal: string }> {
  if (!ehLinkAmazon(linkOriginal)) {
    throw new Error(`URL não reconhecida como Amazon: ${linkOriginal}`);
  }

  // URLs longas geralmente já carregam o ASIN e não precisam de rede.
  const asinDireto = extrairAsinAmazon(linkOriginal);
  if (asinDireto) {
    return { asin: asinDireto, urlFinal: linkOriginal };
  }

  let resposta: Response;
  try {
    resposta = await fetchComTimeout(linkOriginal, {
      method: "GET",
      redirect: "follow",
      headers: HEADERS_NAVEGADOR,
    });
  } catch (erro: any) {
    if (erro?.name === "AbortError") {
      throw new Error("Tempo esgotado ao resolver link curto da Amazon");
    }
    throw new Error(`Falha ao resolver link curto da Amazon: ${String(erro?.message ?? erro)}`);
  }

  const urlFinal = resposta.url || linkOriginal;
  validarDestinoAmazon(urlFinal);

  const asinDaUrl = extrairAsinAmazon(urlFinal);
  if (asinDaUrl) {
    return { asin: asinDaUrl, urlFinal };
  }

  // Fallback restrito ao produto principal. Evita capturar ASINs de recomendações.
  const html = await resposta.text();
  const candidatosPrincipais = [
    html.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i)?.[1],
    html.match(/<meta[^>]+property=["']og:url["'][^>]+content=["']([^"']+)["']/i)?.[1],
    html.match(/<input[^>]+id=["']ASIN["'][^>]+value=["']([A-Z0-9]{10})["']/i)?.[1],
  ].filter((v): v is string => Boolean(v));

  for (const candidato of candidatosPrincipais) {
    const asin = /^[A-Z0-9]{10}$/i.test(candidato) ? candidato.toUpperCase() : extrairAsinAmazon(candidato);
    if (asin) {
      log.debug({ asin }, "ASIN principal encontrado no HTML da Amazon");
      return { asin, urlFinal };
    }
  }

  throw new Error(`Não foi possível encontrar o ASIN do produto Amazon (URL final: ${urlFinal})`);
}
