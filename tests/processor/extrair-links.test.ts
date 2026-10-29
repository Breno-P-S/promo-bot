import { describe, expect, it } from "vitest";
import { extrairLinks } from "../../src/processor/extrair-links";

describe("extrairLinks", () => {
  it("remove pontuação comum colocada depois do link", () => {
    const texto = [
      "A https://meli.la/ABC.",
      "B https://meli.la/DEF,",
      "C https://meli.la/GHI!",
      "D https://meli.la/JKL]",
    ].join(" ");

    expect(extrairLinks(texto)).toEqual([
      "https://meli.la/ABC",
      "https://meli.la/DEF",
      "https://meli.la/GHI",
      "https://meli.la/JKL",
    ]);
  });

  it("preserva parênteses balanceados que fazem parte da URL", () => {
    expect(extrairLinks("veja https://exemplo.com/produto_(novo) agora")).toEqual([
      "https://exemplo.com/produto_(novo)",
    ]);
  });

  it("remove parêntese final que pertence à frase, não à URL", () => {
    expect(extrairLinks("(veja https://meli.la/ABC)")).toEqual(["https://meli.la/ABC"]);
  });
});
