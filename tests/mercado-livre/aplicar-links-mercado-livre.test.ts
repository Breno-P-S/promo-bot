import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/config/env", () => ({
  env: { ML_AFFILIATE_TAG: "tag" },
}));

const { prismaMock, converterMock } = vi.hoisted(() => ({
  prismaMock: {
    linkAfiliadoMercadoLivre: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
  },
  converterMock: vi.fn(),
}));

vi.mock("../../src/db/client", () => ({ prisma: prismaMock }));

vi.mock("../../src/processor/mercado-livre/afiliados-mercado-livre", () => ({
  converterLinkAfiliadoMercadoLivre: converterMock,
}));

import { aplicarLinksMercadoLivre, aplicarLinksMercadoLivreDetalhado } from "../../src/processor/mercado-livre/aplicar-links-mercado-livre";

describe("aplicarLinksMercadoLivre", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.linkAfiliadoMercadoLivre.findUnique.mockResolvedValue(null);
    prismaMock.linkAfiliadoMercadoLivre.upsert.mockResolvedValue({});
  });

  it("substitui o link meli.la pelo link de afiliado gerado, preservando o resto do texto", async () => {
    converterMock.mockResolvedValue({
      linkAfiliado: "https://meli.la/33Fu7xM",
      productId: "MLB18425328",
      urlCanonica: "https://www.mercadolivre.com.br/produto/p/MLB18425328",
    });

    const texto = "🔥 MIXER EM PROMOÇÃO\nDe R$ 88 por R$ 54\n\nhttps://meli.la/2cYeScY";
    const resultado = await aplicarLinksMercadoLivre(texto);

    expect(resultado).toContain("https://meli.la/33Fu7xM");
    expect(resultado).not.toContain("https://meli.la/2cYeScY");
    expect(resultado).toContain("MIXER EM PROMOÇÃO");
    expect(resultado).toContain("De R$ 88 por R$ 54");
  });

  it("processa múltiplos links Mercado Livre na mesma mensagem", async () => {
    converterMock
      .mockResolvedValueOnce({ linkAfiliado: "https://meli.la/AAA", productId: "MLB1", urlCanonica: "u1" })
      .mockResolvedValueOnce({ linkAfiliado: "https://meli.la/BBB", productId: "MLB2", urlCanonica: "u2" });

    const texto = "Produto 1: https://meli.la/2cYeScY\nProduto 2: https://meli.la/9xYzAbC";
    const resultado = await aplicarLinksMercadoLivre(texto);

    expect(resultado).toContain("https://meli.la/AAA");
    expect(resultado).toContain("https://meli.la/BBB");
  });

  it("usa o cache quando o código já foi resolvido antes, sem chamar a conversão de novo", async () => {
    prismaMock.linkAfiliadoMercadoLivre.findUnique.mockResolvedValue({
      linkGerado: "https://meli.la/CACHEADO",
    });

    const resultado = await aplicarLinksMercadoLivre("veja: https://meli.la/2cYeScY");

    expect(resultado).toContain("https://meli.la/CACHEADO");
    expect(converterMock).not.toHaveBeenCalled();
  });

  it("tenta duas vezes e mantém o link original se ambas as conversões falharem", async () => {
    converterMock.mockRejectedValue(new Error("sessão do Mercado Livre expirada"));

    const original = "confira: https://meli.la/2cYeScY";
    const resultado = await aplicarLinksMercadoLivreDetalhado(original);

    expect(resultado.texto).toBe(original);
    expect(converterMock).toHaveBeenCalledTimes(2);
    expect(resultado.diagnosticos).toEqual([
      expect.objectContaining({
        linkOriginal: "https://meli.la/2cYeScY",
        convertido: false,
        tentativas: 2,
      }),
    ]);
  });

  it("converte na segunda tentativa quando a primeira falha", async () => {
    converterMock
      .mockRejectedValueOnce(new Error("falha transitória"))
      .mockResolvedValueOnce({
        linkAfiliado: "https://meli.la/RECUPERADO",
        productId: "MLB18425328",
        urlCanonica: "https://www.mercadolivre.com.br/produto/p/MLB18425328",
      });

    const resultado = await aplicarLinksMercadoLivreDetalhado("confira: https://meli.la/2cYeScY");

    expect(resultado.texto).toContain("https://meli.la/RECUPERADO");
    expect(converterMock).toHaveBeenCalledTimes(2);
    expect(resultado.diagnosticos[0]).toEqual(
      expect.objectContaining({ convertido: true, tentativas: 2 })
    );
  });

  it("não mexe em links que não são do Mercado Livre", async () => {
    const original = "confira: https://amazon.com.br/produto-x";
    const resultado = await aplicarLinksMercadoLivre(original);

    expect(resultado).toBe(original);
    expect(converterMock).not.toHaveBeenCalled();
  });
});
