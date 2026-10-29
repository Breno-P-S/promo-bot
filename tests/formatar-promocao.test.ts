import { describe, expect, it } from "vitest";
import { formatarPromocaoAutomaticamente, removerLinksExternosEChamadas } from "../src/processor/formatar-promocao";

describe("formatador automático de promoções", () => {
  it("remove link externo e a chamada que o acompanha, mantendo link de compra", () => {
    const entrada = `GELA IGUAL O PRIMO DELE (por mto mais barato)\n\n🫙 Copo Térmico Gigante 1,2L Inox com Tampa\n💵 DE 77 | POR 48\n\n🛒 Compre aqui: https://meli.la/1EnrXVd\n\nAtive seu alerta grátis! 🛎\nhttps://promouai.com.br/alerta`;
    const r = formatarPromocaoAutomaticamente(entrada);
    expect(r.texto).toContain("👨‍🦲 **Copo Térmico Gigante 1,2L Inox com Tampa**");
    expect(r.texto).toContain("💸 De R$ 77");
    expect(r.texto).toContain("💰 Por R$ 48");
    expect(r.confianca).toBe(100);
    expect(r.texto).toContain("https://meli.la/1EnrXVd");
    expect(r.texto).not.toContain("promouai.com.br");
    expect(r.texto).not.toContain("Ative seu alerta");
  });

  it("sempre acrescenta o rodapé oficial em negrito", () => {
    const r = formatarPromocaoAutomaticamente("Fone Bluetooth X1\nPor R$ 99,90\nhttps://link.amazon/AbC123");
    expect(r.texto.endsWith("**Entre nos outros grupos:** https://linktr.ee/homerpromocoes")).toBe(true);
  });

  it("remove linktree antigo/duplicado e deixa apenas o rodapé oficial", () => {
    const r = formatarPromocaoAutomaticamente("Fone Bluetooth X1\nPor R$ 99,90\nhttps://link.amazon/AbC123\n\nSiga a gente\nhttps://linktr.ee/outracoisa");
    expect(r.texto).not.toContain("outracoisa");
    expect((r.texto.match(/linktr\.ee\/homerpromocoes/g) ?? []).length).toBe(1);
  });

  it("limpa blocos curtos de propaganda externa", () => {
    expect(removerLinksExternosEChamadas("Ative seu alerta grátis!\nhttps://promouai.com.br/alerta")).toBe("");
  });
  it("prefere o nome real do produto a uma chamada em caixa alta e lê preço antes de à vista", () => {
    const entrada = `SHORTINHO DE QUEM TEM PERNA PRA MOSTRAR

Kit 03 un. Shorts 2 Em 1 Com Bolso
\- use o cupom ` + "`MODA0209`" + `

63,00 à vista
https://meli.la/1Htsie6`;
    const r = formatarPromocaoAutomaticamente(entrada);
    expect(r.produto).toBe("Kit 03 un. Shorts 2 Em 1 Com Bolso");
    expect(r.precoAtual).toBe("R$ 63,00");
    expect(r.cupom).toBe("MODA0209");
    expect(r.texto).toContain("👨‍🦲 **Kit 03 un. Shorts 2 Em 1 Com Bolso**");
    expect(r.texto).toContain("💰 Por R$ 63,00");
    expect(r.confianca).toBe(100);
  });

});

it("ignora linha de vendedor e usa o nome real do produto", () => {
  const entrada = `A LORO PIANA DO TRABALHADOR

Camiseta Modal Malha Peruana

De R$ 119 por R$ 55

Vendido por Loja Oficial no ML

🛒 Compre aqui: https://meli.la/2GoseTa

Ative seu alerta grátis! 🛎
https://promouai.com.br/alerta`;

  const resultado = formatarPromocaoAutomaticamente(entrada);

  expect(resultado.produto).toBe("Camiseta Modal Malha Peruana");
  expect(resultado.precoAntigo).toBe("R$ 119");
  expect(resultado.precoAtual).toBe("R$ 55");
  expect(resultado.texto).toContain("👨‍🦲 **Camiseta Modal Malha Peruana**");
  expect(resultado.texto).not.toContain("Vendido por Loja Oficial no ML");
  expect(resultado.texto).not.toContain("promouai.com.br");
});

