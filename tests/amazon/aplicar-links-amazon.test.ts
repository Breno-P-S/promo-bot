import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/config/env", () => ({
  env: {
    AMAZON_AFFILIATE_TAG: "teste-20",
    LOG_LEVEL: "silent",
    NODE_ENV: "test",
  },
}));

const { resolverMock, linksMock } = vi.hoisted(() => ({
  resolverMock: vi.fn(),
  linksMock: vi.fn(),
}));

vi.mock("../../src/processor/amazon/resolver-amazon", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../src/processor/amazon/resolver-amazon")>();
  return { ...original, resolverAsinAmazon: resolverMock };
});

vi.mock("../../src/processor/amazon/navegador-amazon", () => ({
  criarLinksAmazonViaNavegador: linksMock,
}));

import { aplicarLinksAmazon, gerarLinkAfiliadoAmazon } from "../../src/processor/amazon/aplicar-links-amazon";

describe("aplicarLinksAmazon", () => {
  beforeEach(() => vi.clearAllMocks());

  it("monta a URL afiliada canônica com a própria tag", () => {
    expect(gerarLinkAfiliadoAmazon("B0FPNLPXX9")).toBe(
      "https://www.amazon.com.br/dp/B0FPNLPXX9?tag=teste-20"
    );
  });

  it("troca pelo shortlink e retorna diagnóstico separado do texto", async () => {
    resolverMock.mockResolvedValue({
      asin: "B0FPNLPXX9",
      urlFinal: "https://www.amazon.com.br/produto/dp/B0FPNLPXX9?tag=outra-20",
    });
    linksMock.mockResolvedValue({
      shortUrl: "https://link.amazon/B0abc1234",
      longUrl: "https://www.amazon.com.br/dp/B0FPNLPXX9?th=1&linkCode=sl2&tag=teste-20&ref_=as_li_ss_tl",
    });

    const resultado = await aplicarLinksAmazon("🔥 Oferta: https://link.amazon/B039Zc7Vk");

    expect(resultado.texto).toBe("🔥 Oferta: https://link.amazon/B0abc1234");
    expect(resultado.diagnosticos).toEqual([
      expect.objectContaining({
        asin: "B0FPNLPXX9",
        tag: "teste-20",
        shortUrl: "https://link.amazon/B0abc1234",
      }),
    ]);
  });

  it("mantém o link original se a geração falhar", async () => {
    resolverMock.mockResolvedValue({ asin: "B0FPNLPXX9", urlFinal: "https://www.amazon.com.br/dp/B0FPNLPXX9" });
    linksMock.mockRejectedValue(new Error("falhou"));

    const original = "Veja: https://link.amazon/B039Zc7Vk";

const resultado = await aplicarLinksAmazon(original);

expect(resultado.texto).toBe(original);

expect(resultado.diagnosticos).toEqual([
  expect.objectContaining({
    convertido: false,
    erro: "falhou",
    linkOriginal: "https://link.amazon/B039Zc7Vk",
    tag: "teste-20"
  })
]);
  });
});
