import { ComponenteCardFeatured, ProdutoResolvido } from "./tipos";
import { childLogger } from "../../utils/logger";
import { resolverProdutoMercadoLivreViaNavegador } from "./navegador-mercado-livre";

const log = childLogger("mercado-livre-resolver");

const TIMEOUT_HTTP_MS = 15_000;
const ID_COMPONENTE_ALVO = "card-featured";

const HEADERS_NAVEGADOR: Record<string, string> = {
  accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
  "accept-language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
  "cache-control": "no-cache",
  pragma: "no-cache",
  "upgrade-insecure-requests": "1",
  "user-agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36",
};

// Resolve o produto original de um link do Mercado Livre.
// Caminho rápido: tenta o HTML por HTTP.
// Fallback robusto: usa o MESMO Chromium persistente do Link Builder/Amazon,
// segue o redirect real, espera o DOM renderizar e procura somente sinais do
// produto destacado (card-featured ou CTA "Ir para produto").
export async function resolverProdutoMercadoLivre(urlCurta: string): Promise<ProdutoResolvido> {
  validarUrlEntrada(urlCurta);

  try {
    const html = await baixarHtmlViaHttp(urlCurta);
    const porHtml = tentarResolverPorCardFeatured(html);
    if (porHtml) return porHtml;

    log.warn(
      { url: urlCurta },
      'HTML do Mercado Livre não trouxe "card-featured"; usando Chromium compartilhado'
    );
  } catch (erro: any) {
    if (erro instanceof ErroDestinoMercadoLivre) throw erro;
    log.warn(
      { url: urlCurta, status: erro?.status, erro: String(erro?.message ?? erro) },
      "Falha na resolução HTTP do Mercado Livre; usando Chromium compartilhado"
    );
  }

  const viaBrowser = await resolverProdutoMercadoLivreViaNavegador(urlCurta);

  // Primeira preferência: o mesmo card-featured, agora após a página ter sido
  // realmente renderizada dentro da sessão persistente.
  const porHtmlRenderizado = tentarResolverPorCardFeatured(viaBrowser.html);
  if (porHtmlRenderizado) return porHtmlRenderizado;

  // Segunda preferência: o CTA do card principal ("Ir para produto") ou link
  // localizado dentro de uma região featured. O navegador já filtra esses casos
  // para não selecionar produtos das listas de recomendação.
  if (viaBrowser.urlProdutoPrincipal) {
    const urlCanonica = normalizarUrl(viaBrowser.urlProdutoPrincipal);
    return {
      productId: extrairProductIdDaUrl(urlCanonica),
      urlCanonica,
    };
  }

  throw new Error(
    'Produto destacado não encontrado nem em "card-featured" nem no CTA principal da página renderizada pelo Chromium'
  );
}

function tentarResolverPorCardFeatured(html: string): ProdutoResolvido | null {
  try {
    const componente = localizarComponenteCardFeatured(html);
    const metadata = componente.recommendation_data?.recommendation_info?.polycards?.[0]?.metadata;
    if (!metadata?.url) return null;

    return {
      productId: metadata.product_id ?? extrairProductIdDaUrl(metadata.url),
      urlCanonica: normalizarUrl(metadata.url),
    };
  } catch {
    return null;
  }
}

async function baixarHtmlViaHttp(urlCurta: string): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_HTTP_MS);

  try {
    const resposta = await fetch(urlCurta, {
      redirect: "follow",
      headers: HEADERS_NAVEGADOR,
      signal: controller.signal,
    });

    if (!resposta.ok) {
      throw new ErroHttpMercadoLivre(
        resposta.status,
        `Falha ao seguir o link curto (HTTP ${resposta.status}) — url final: ${resposta.url}`
      );
    }

    validarUrlFinalMercadoLivre(resposta.url);
    return await resposta.text();
  } catch (erro: any) {
    if (erro?.name === "AbortError") {
      throw new Error(`Timeout ao resolver o link curto (${TIMEOUT_HTTP_MS}ms)`);
    }
    throw erro;
  } finally {
    clearTimeout(timeout);
  }
}

class ErroHttpMercadoLivre extends Error {
  constructor(public readonly status: number, mensagem: string) {
    super(mensagem);
    this.name = "ErroHttpMercadoLivre";
  }
}

class ErroDestinoMercadoLivre extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = "ErroDestinoMercadoLivre";
  }
}

function validarUrlEntrada(valor: string): void {
  let url: URL;
  try {
    url = new URL(valor);
  } catch {
    throw new Error(`Link Mercado Livre inválido: ${valor}`);
  }

  if (url.protocol !== "https:") {
    throw new Error("O link do Mercado Livre precisa usar HTTPS");
  }

  const host = url.hostname.toLowerCase();
  if (host !== "meli.la" && !ehHostMercadoLivre(host)) {
    throw new Error(`Domínio não permitido para resolução Mercado Livre: ${host}`);
  }
}

function validarUrlFinalMercadoLivre(valor: string): void {
  let url: URL;
  try {
    url = new URL(valor);
  } catch {
    throw new Error(`URL final inválida ao resolver link Mercado Livre: ${valor}`);
  }

  if (!ehHostMercadoLivre(url.hostname.toLowerCase())) {
    throw new ErroDestinoMercadoLivre(`Link curto não redirecionou para o Mercado Livre (chegou em: ${valor})`);
  }
}

function ehHostMercadoLivre(host: string): boolean {
  return host === "mercadolivre.com.br" || host.endsWith(".mercadolivre.com.br");
}

function extrairProductIdDaUrl(valor: string): string | null {
  const match = valor.match(/\/p\/(MLB\d+)/i);
  return match?.[1]?.toUpperCase() ?? null;
}

// Localiza o objeto JSON do componente card-featured dentro do HTML.
function localizarComponenteCardFeatured(html: string): ComponenteCardFeatured {
  const agulha = new RegExp(`"id"\\s*:\\s*"${ID_COMPONENTE_ALVO}"`);
  const match = agulha.exec(html);

  if (!match) {
    throw new Error(
      `Componente "${ID_COMPONENTE_ALVO}" não encontrado no HTML retornado pelo Mercado Livre — a página pode ter mudado de estrutura, ou o link não levou a uma página /social/...`
    );
  }

  const inicioObjeto = encontrarInicioObjeto(html, match.index);
  const fimObjeto = encontrarFimObjeto(html, inicioObjeto);
  const trechoJson = html.slice(inicioObjeto, fimObjeto + 1);

  try {
    return JSON.parse(trechoJson) as ComponenteCardFeatured;
  } catch (erro) {
    log.error({ erro }, "falha ao fazer JSON.parse do componente card-featured isolado");
    throw new Error('Componente "card-featured" encontrado, mas não foi possível interpretá-lo como JSON válido');
  }
}

// Os balanceadores abaixo ignoram chaves dentro de strings JSON, evitando
// quebrar em conteúdos como "2x {price} sem juros".
function encontrarInicioObjeto(texto: string, posicao: number): number {
  let profundidade = 0;

  // Para andar para trás com segurança, calculamos primeiro quais posições
  // estão dentro de strings até a posição-alvo.
  const dentroDeString = mapaPosicoesEmString(texto, posicao);

  for (let i = posicao; i >= 0; i--) {
    if (dentroDeString[i]) continue;
    if (texto[i] === "}") profundidade++;
    else if (texto[i] === "{") {
      if (profundidade === 0) return i;
      profundidade--;
    }
  }

  throw new Error('Não foi possível encontrar o início do objeto JSON do componente "card-featured"');
}

function encontrarFimObjeto(texto: string, inicio: number): number {
  let profundidade = 0;
  let emString = false;
  let escapado = false;

  for (let i = inicio; i < texto.length; i++) {
    const char = texto[i];

    if (emString) {
      if (escapado) {
        escapado = false;
      } else if (char === "\\") {
        escapado = true;
      } else if (char === '"') {
        emString = false;
      }
      continue;
    }

    if (char === '"') {
      emString = true;
      continue;
    }

    if (char === "{") profundidade++;
    else if (char === "}") {
      profundidade--;
      if (profundidade === 0) return i;
    }
  }

  throw new Error('Não foi possível encontrar o fim do objeto JSON do componente "card-featured"');
}

function mapaPosicoesEmString(texto: string, ate: number): boolean[] {
  const mapa = new Array<boolean>(ate + 1).fill(false);
  let emString = false;
  let escapado = false;

  for (let i = 0; i <= ate; i++) {
    const char = texto[i];
    mapa[i] = emString;

    if (emString) {
      if (escapado) escapado = false;
      else if (char === "\\") escapado = true;
      else if (char === '"') emString = false;
    } else if (char === '"') {
      emString = true;
      mapa[i] = true;
    }
  }

  return mapa;
}

function normalizarUrl(url: string): string {
  const comProtocolo = url.startsWith("http") ? url : `https://${url}`;
  const parsed = new URL(comProtocolo);

  if (parsed.protocol !== "https:" || !ehHostMercadoLivre(parsed.hostname.toLowerCase())) {
    throw new Error(`URL de produto inválida retornada pelo Mercado Livre: ${url}`);
  }

  return `${parsed.origin}${parsed.pathname}`;
}
