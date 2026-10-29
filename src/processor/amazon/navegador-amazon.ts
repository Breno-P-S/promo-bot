import { abrirPagina, executarNoBrowser, invalidarBrowserCompartilhado, mostrarJanela, portaDevToolsAtiva } from "../../browser/chromium";
import { CdpClient } from "../../browser/cdp-client";

export type ResultadoLinksAmazon = {
  shortUrl: string;
  longUrl: string;
};

export async function criarLinksAmazonViaNavegador(
  asin: string,
  tag: string
): Promise<ResultadoLinksAmazon> {
  return await executarNoBrowser(async (browser) => {
    let cdp: CdpClient | null = null;
    try {
      const asinNormalizado = asin.trim().toUpperCase();
      const tagNormalizada = tag.trim();
      if (!/^[A-Z0-9]{10}$/.test(asinNormalizado)) {
        throw new Error(`ASIN inválido para geração de link curto: ${asin}`);
      }
      if (!tagNormalizada) throw new Error("AMAZON_AFFILIATE_TAG não configurada");

      const urlProduto = `https://www.amazon.com.br/dp/${encodeURIComponent(asinNormalizado)}?th=1`;
      cdp = await abrirPagina(browser.porta, urlProduto, "amazon.com.br");

      const resultado = await cdp.avaliar(`
        (async () => {
          const asin = ${JSON.stringify(asinNormalizado)};
          const tag = ${JSON.stringify(tagNormalizada)};
          const longUrl = new URL('https://www.amazon.com.br/dp/' + encodeURIComponent(asin));
          longUrl.searchParams.set('th', '1');
          longUrl.searchParams.set('linkCode', 'sl2');
          longUrl.searchParams.set('tag', tag);
          longUrl.searchParams.set('ref_', 'as_li_ss_tl');

          const endpoint = new URL('/associates/sitestripe/getShortUrl', location.origin);
          endpoint.searchParams.set('longUrl', longUrl.toString());
          endpoint.searchParams.set('marketplaceId', '526970');
          endpoint.searchParams.set('storeId', tag);

          const resposta = await fetch(endpoint.toString(), {
            method: 'GET',
            credentials: 'include',
            headers: {
              accept: 'application/json, text/javascript, */*; q=0.01',
              'x-requested-with': 'XMLHttpRequest'
            }
          });

          const texto = await resposta.text();
          let body = null;
          try { body = JSON.parse(texto); } catch {}
          return { status: resposta.status, okHttp: resposta.ok, body, texto: texto.slice(0, 500), urlAtual: location.href };
        })()
      `);

      if (!resultado?.okHttp) {
        throw new Error(
          `Amazon getShortUrl falhou (HTTP ${resultado?.status ?? "?"}; URL atual: ${resultado?.urlAtual ?? "desconhecida"}). ` +
          `Faça login com "npm run amazon:login".`
        );
      }

      const shortUrl = resultado?.body?.shortUrl;
      if (resultado?.body?.ok !== true || resultado?.body?.isOk !== true || typeof shortUrl !== "string") {
        throw new Error(`Amazon getShortUrl não retornou shortUrl válido. Resposta: ${JSON.stringify(resultado?.body ?? resultado?.texto ?? null)}`);
      }

      const short = new URL(shortUrl);
      if (short.hostname.toLowerCase() !== "link.amazon") {
        throw new Error(`Amazon retornou domínio inesperado no shortUrl: ${short.hostname}`);
      }

      const longUrlResposta = resultado?.body?.longUrl;
      const longUrl = typeof longUrlResposta === "string" && longUrlResposta.trim()
        ? longUrlResposta
        : `https://www.amazon.com.br/dp/${encodeURIComponent(asinNormalizado)}?th=1&linkCode=sl2&tag=${encodeURIComponent(tagNormalizada)}&ref_=as_li_ss_tl`;

      return { shortUrl, longUrl };
    } catch (erro) {
      if (!(await portaDevToolsAtiva(browser.porta))) invalidarBrowserCompartilhado();
      throw erro;
    } finally {
      cdp?.fechar();
    }
  });
}

export async function abrirLoginAmazonInterativo(): Promise<void> {
  return await executarNoBrowser(async (browser) => {
    const cdp = await abrirPagina(browser.porta, "https://www.amazon.com.br/", "amazon.com.br");
    try {
      await mostrarJanela(cdp);
    } finally {
      cdp.fechar();
    }
  });
}
