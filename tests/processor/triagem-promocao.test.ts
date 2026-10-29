import { describe, expect, it } from "vitest";
import { triarPromocao } from "../../src/processor/triagem-promocao";

describe("triagem de promoções", () => {
  it("aceita Mercado Livre", () => {
    const r = triarPromocao("Produto\nhttps://meli.la/ABC123");
    expect(r.aceita).toBe(true);
    expect(r.linksSuportados).toEqual(["https://meli.la/ABC123"]);
  });

  it("aceita links Amazon que o conversor sabe resolver", () => {
    const r = triarPromocao("Produto\nhttps://www.amazon.com.br/dp/B0ABCDEFGHI");
    expect(r.aceita).toBe(true);
  });

  it("rejeita promoção de loja não suportada antes do painel", () => {
    const r = triarPromocao("Produto\nhttps://loja-exemplo.com/produto");
    expect(r.aceita).toBe(false);
    expect(r.motivo).toContain("sem link de Mercado Livre/Amazon");
  });
});
