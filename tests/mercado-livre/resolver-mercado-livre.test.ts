import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";

const { browserResolverMock } = vi.hoisted(() => ({ browserResolverMock: vi.fn() }));
vi.mock("../../src/processor/mercado-livre/navegador-mercado-livre", () => ({
  resolverProdutoMercadoLivreViaNavegador: browserResolverMock,
}));

import { resolverProdutoMercadoLivre } from "../../src/processor/mercado-livre/resolver-mercado-livre";

// Monta um HTML fake com o mesmo formato do estado embutido real
// (_n.ctx.r.appProps.pageProps.data.components), sem depender do nome
// exato da variável — o resolver busca pelo "id":"card-featured" no
// texto bruto, então só o JSON precisa estar bem formado.
function montarHtmlComComponentes(components: unknown[]): string {
  const estado = { appProps: { pageProps: { data: { components } } } };
  return `<html><body><script>_n.ctx.r = ${JSON.stringify(estado)};</script></body></html>`;
}

const produtoCorreto = {
  id: "card-featured",
  type: "recommendations",
  recommendation_data: {
    recommendation_info: {
      polycards: [
        {
          metadata: {
            id: "MLB4621345745",
            product_id: "MLB18425328",
            url: "www.mercadolivre.com.br/mixer-de-mao-200w-compacto-leve-e-ergonomico-mix1001-elgin/p/MLB18425328",
          },
        },
      ],
    },
  },
};

const produtoRecomendado = {
  id: "recommendations-para-voce",
  type: "recommendations",
  recommendation_data: {
    recommendation_info: {
      polycards: [
        {
          metadata: { id: "MLB000", product_id: "MLB000", url: "www.mercadolivre.com.br/produto-errado/p/MLB000" },
        },
      ],
    },
  },
};

function mockarFetchComHtml(html: string, urlFinal = "https://www.mercadolivre.com.br/social/pobredasofertas") {
  global.fetch = vi.fn(async () => ({
    ok: true,
    status: 200,
    url: urlFinal,
    text: async () => html,
  })) as any;
}

describe("resolverProdutoMercadoLivre", () => {
  beforeEach(() => {
    browserResolverMock.mockReset();
    browserResolverMock.mockRejectedValue(new Error("fallback-browser-sem-produto"));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("extrai o produto do componente card-featured, ignorando produtos de recomendação ao redor", async () => {
    mockarFetchComHtml(montarHtmlComComponentes([produtoRecomendado, produtoCorreto, produtoRecomendado]));

    const resultado = await resolverProdutoMercadoLivre("https://meli.la/2cYeScY");

    expect(resultado.productId).toBe("MLB18425328");
    expect(resultado.urlCanonica).toBe(
      "https://www.mercadolivre.com.br/mixer-de-mao-200w-compacto-leve-e-ergonomico-mix1001-elgin/p/MLB18425328"
    );
  });

  it("converte www... para https://www... e remove parâmetros de tracking", async () => {
    const componenteComTracking = {
      ...produtoCorreto,
      recommendation_data: {
        recommendation_info: {
          polycards: [
            {
              metadata: {
                id: "MLB1",
                product_id: "MLB18425328",
                url: "www.mercadolivre.com.br/produto/p/MLB18425328?matt_word=pobre01&matt_tool=58967575&forceInApp=true",
              },
            },
          ],
        },
      },
    };

    mockarFetchComHtml(montarHtmlComComponentes([componenteComTracking]));

    const resultado = await resolverProdutoMercadoLivre("https://meli.la/2cYeScY");

    expect(resultado.urlCanonica).toBe("https://www.mercadolivre.com.br/produto/p/MLB18425328");
  });

  it("lança um erro claro quando o componente card-featured não existe no HTML", async () => {
    mockarFetchComHtml(montarHtmlComComponentes([produtoRecomendado]));

    await expect(resolverProdutoMercadoLivre("https://meli.la/2cYeScY")).rejects.toThrow(/fallback-browser-sem-produto/);
  });

  it("rejeita imediatamente redirect para domínio fora do Mercado Livre", async () => {
    mockarFetchComHtml("<html></html>", "https://outro-site.com/pagina-qualquer");

    await expect(resolverProdutoMercadoLivre("https://meli.la/2cYeScY")).rejects.toThrow(/Mercado Livre/);
    expect(browserResolverMock).not.toHaveBeenCalled();
  });

  it("lança um erro claro quando card-featured existe mas sem metadata.url", async () => {
    const componenteSemUrl = {
      id: "card-featured",
      recommendation_data: { recommendation_info: { polycards: [{ metadata: { id: "X" } }] } },
    };
    mockarFetchComHtml(montarHtmlComComponentes([componenteSemUrl]));

    await expect(resolverProdutoMercadoLivre("https://meli.la/2cYeScY")).rejects.toThrow(/fallback-browser-sem-produto/);
  });
  it("não se perde com chaves dentro de strings do card-featured", async () => {
    const componenteComChavesNoTexto = {
      ...produtoCorreto,
      components: [{ price: { installments: { text: "2x {price} sem juros" } } }],
    };
    mockarFetchComHtml(montarHtmlComComponentes([componenteComChavesNoTexto]));

    const resultado = await resolverProdutoMercadoLivre("https://meli.la/2cYeScY");
    expect(resultado.productId).toBe("MLB18425328");
  });

  it("rejeita domínio que apenas contém o texto mercadolivre.com.br", async () => {
    mockarFetchComHtml("<html></html>", "https://mercadolivre.com.br.site-malicioso.example/pagina");

    await expect(resolverProdutoMercadoLivre("https://meli.la/2cYeScY")).rejects.toThrow(/Mercado Livre/);
    expect(browserResolverMock).not.toHaveBeenCalled();
  });

});
