import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/config/env", () => ({
  env: { ML_AFFILIATE_TAG: "tag-de-teste", LOG_LEVEL: "silent", NODE_ENV: "test" },
}));

const { browserMock } = vi.hoisted(() => ({ browserMock: vi.fn() }));
vi.mock("../../src/processor/mercado-livre/navegador-mercado-livre", () => ({
  criarLinkAfiliadoViaNavegador: browserMock,
}));

import { criarLinkAfiliadoMercadoLivre } from "../../src/processor/mercado-livre/afiliados-mercado-livre";
import { ErroSessaoMercadoLivre } from "../../src/processor/mercado-livre/sessao-mercado-livre";

const URL_PRODUTO = "https://www.mercadolivre.com.br/produto/p/MLB18425328";

function respostaValida(shortUrl = "https://meli.la/33Fu7xM") {
  return {
    status: 200,
    body: JSON.stringify({
      status: 200,
      urls: [{ short_url: shortUrl, origin_url: URL_PRODUTO }],
      total_items: 1,
      total_success: 1,
      total_error: 0,
    }),
    urlAtual: "https://www.mercadolivre.com.br/afiliados/linkbuilder",
  };
}

describe("criarLinkAfiliadoMercadoLivre", () => {
  beforeEach(() => browserMock.mockReset());

  it("retorna o short_url gerado no Chromium", async () => {
    browserMock.mockResolvedValue(respostaValida());
    await expect(criarLinkAfiliadoMercadoLivre(URL_PRODUTO)).resolves.toBe("https://meli.la/33Fu7xM");
    expect(browserMock).toHaveBeenCalledWith(URL_PRODUTO, "tag-de-teste");
  });

  it("lança ErroSessaoMercadoLivre em 401/403", async () => {
    browserMock.mockResolvedValue({ status: 403, body: "{}", urlAtual: "https://www.mercadolivre.com.br/afiliados/linkbuilder" });
    await expect(criarLinkAfiliadoMercadoLivre(URL_PRODUTO)).rejects.toBeInstanceOf(ErroSessaoMercadoLivre);
  });

  it("rejeita resposta 200 sem short_url", async () => {
    browserMock.mockResolvedValue({
      status: 200,
      body: JSON.stringify({ status: 200, urls: [], total_items: 1, total_success: 0, total_error: 1 }),
      urlAtual: "https://www.mercadolivre.com.br/afiliados/linkbuilder",
    });
    await expect(criarLinkAfiliadoMercadoLivre(URL_PRODUTO)).rejects.toThrow(/total_success/);
  });
});
