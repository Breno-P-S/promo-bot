import { describe, expect, it, vi, afterEach } from "vitest";
import { extrairAsinAmazon, resolverAsinAmazon } from "../../src/processor/amazon/resolver-amazon";

describe("resolver Amazon", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("extrai ASIN de URL /dp/", () => {
    expect(extrairAsinAmazon("https://www.amazon.com.br/produto/dp/B0GXLB3PFL?tag=outra-20")).toBe("B0GXLB3PFL");
  });

  it("resolve link.amazon seguindo redirect e extrai o ASIN", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        url: "https://www.amazon.com.br/Kit-Limpa-Moto/dp/B0GXLB3PFL?tag=pob-tele-20",
        text: vi.fn().mockResolvedValue(""),
      })
    );

    const result = await resolverAsinAmazon("https://link.amazon/B02uUhOkD");
    expect(result.asin).toBe("B0GXLB3PFL");
  });
});
