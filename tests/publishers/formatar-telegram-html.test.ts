import { describe, expect, it } from "vitest";
import { formatarTextoTelegramHtml } from "../../src/publishers/formatar-telegram-html";

describe("formatarTextoTelegramHtml", () => {
  it("converte negrito Markdown para HTML do Telegram", () => {
    expect(formatarTextoTelegramHtml("**🛒 Compre aqui:** https://exemplo.com"))
      .toBe("<b>🛒 Compre aqui:</b> https://exemplo.com");
  });

  it("aceita marcadores de negrito que chegaram escapados", () => {
    expect(formatarTextoTelegramHtml("\\*\\*Compre aqui\\*\\*"))
      .toBe("<b>Compre aqui</b>");
  });

  it("converte links Markdown para links HTML", () => {
    expect(formatarTextoTelegramHtml("[Abrir](https://exemplo.com/oferta)"))
      .toBe('<a href="https://exemplo.com/oferta">Abrir</a>');
  });

  it("converte negrito e link na mesma mensagem", () => {
    expect(formatarTextoTelegramHtml("**🛒 Compre aqui:** [Oferta](https://exemplo.com)"))
      .toBe('<b>🛒 Compre aqui:</b> <a href="https://exemplo.com">Oferta</a>');
  });
});
