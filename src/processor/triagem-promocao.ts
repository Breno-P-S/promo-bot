import { ehLinkSuportadoNaOrigem } from "../domain/promocao";
import { extrairLinks } from "./extrair-links";

export type ResultadoTriagemPromocao = {
  aceita: boolean;
  motivo: string | null;
  linksSuportados: string[];
  linksExternos: string[];
};

/**
 * Filtro barato executado ANTES de navegador, banco principal e painel.
 * Hoje só processamos promoções que tenham ao menos um link de loja suportada.
 * Isso reduz ruído e deixa um ponto único para incluir novas lojas no futuro.
 */
export function triarPromocao(texto: string, linksInformados?: string[]): ResultadoTriagemPromocao {
  const links = linksInformados?.length ? linksInformados : extrairLinks(texto);
  const linksSuportados = links.filter(ehLinkSuportadoNaOrigem);
  const linksExternos = links.filter((link) => !ehLinkSuportadoNaOrigem(link));

  if (!texto.trim()) {
    return { aceita: false, motivo: "mensagem sem texto", linksSuportados, linksExternos };
  }

  if (linksSuportados.length === 0) {
    return {
      aceita: false,
      motivo: links.length > 0
        ? "promoção sem link de Mercado Livre/Amazon suportado"
        : "mensagem sem link de compra suportado",
      linksSuportados,
      linksExternos,
    };
  }

  return { aceita: true, motivo: null, linksSuportados, linksExternos };
}
