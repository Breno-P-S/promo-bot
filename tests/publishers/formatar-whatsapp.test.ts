import { describe, expect, it } from "vitest";
import { formatarWhatsapp } from "../../src/publishers/formatar-whatsapp";

describe("formatarWhatsapp", () => {
  it("converte negrito Markdown duplo para negrito do WhatsApp", () => {
    expect(formatarWhatsapp("**🛒 Compre aqui:** https://exemplo.com"))
      .toBe("*🛒 Compre aqui:* https://exemplo.com");
  });

  it("converte asteriscos duplos escapados", () => {
    expect(formatarWhatsapp("\\*\\*R$ 199,90\\*\\*"))
      .toBe("*R$ 199,90*");
  });

  it("mantém texto sem Markdown inalterado", () => {
    expect(formatarWhatsapp("Frete Grátis"))
      .toBe("Frete Grátis");
  });
});
