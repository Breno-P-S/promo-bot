import { env } from "../../config/env";
import { childLogger } from "../../utils/logger";
import { extrairLinks } from "../extrair-links";
import { criarLinksAmazonViaNavegador } from "./navegador-amazon";
import { ehLinkAmazon, resolverAsinAmazon } from "./resolver-amazon";

const log = childLogger("amazon-substituir");

export type ConversaoAmazon = {
  asin: string;
  shortUrl: string;
  longUrl: string;
};

export type DiagnosticoAmazon = {
  linkOriginal: string;
  tag: string;
  convertido: boolean;
  asin?: string;
  shortUrl?: string;
  longUrl?: string;
  erro?: string;
};

export type ResultadoAplicacaoAmazon = {
  texto: string;
  diagnosticos: DiagnosticoAmazon[];
};

export function gerarLinkAfiliadoAmazon(asin: string, tag = env.AMAZON_AFFILIATE_TAG): string {
  const tagNormalizada = tag.trim();
  if (!tagNormalizada) throw new Error("AMAZON_AFFILIATE_TAG não configurada");
  return `https://www.amazon.com.br/dp/${encodeURIComponent(asin.toUpperCase())}?tag=${encodeURIComponent(tagNormalizada)}`;
}

export async function converterLinkAfiliadoAmazon(linkOriginal: string): Promise<ConversaoAmazon> {
  const { asin } = await resolverAsinAmazon(linkOriginal);
  const tag = env.AMAZON_AFFILIATE_TAG.trim();
  if (!tag) throw new Error("AMAZON_AFFILIATE_TAG não configurada");

  const { shortUrl, longUrl } = await criarLinksAmazonViaNavegador(asin, tag);
  return { asin, shortUrl, longUrl };
}

export async function aplicarLinksAmazon(texto: string): Promise<ResultadoAplicacaoAmazon> {
  if (!env.AMAZON_AFFILIATE_TAG.trim()) return { texto, diagnosticos: [] };

  const links = extrairLinks(texto);
  let resultado = texto;
  const diagnosticos: DiagnosticoAmazon[] = [];

  for (const linkOriginal of links) {
    if (!ehLinkAmazon(linkOriginal)) continue;

    try {
      const conversao = await converterLinkAfiliadoAmazon(linkOriginal);
      resultado = resultado.split(linkOriginal).join(conversao.shortUrl);
      diagnosticos.push({
        ...conversao,
        linkOriginal,
        tag: env.AMAZON_AFFILIATE_TAG.trim(),
        convertido: true,
      });

      log.info(
        {
          linkOriginal,
          asin: conversao.asin,
          shortUrl: conversao.shortUrl,
          longUrl: conversao.longUrl,
          tag: env.AMAZON_AFFILIATE_TAG,
        },
        "link Amazon convertido"
      );
    } catch (erro: any) {
      const mensagemErro = String(erro?.message ?? erro);
      diagnosticos.push({
        linkOriginal,
        tag: env.AMAZON_AFFILIATE_TAG.trim(),
        convertido: false,
        erro: mensagemErro,
      });
      log.error(
        { erro: mensagemErro, link: linkOriginal },
        "falha ao converter link da Amazon — mantendo link original"
      );
    }
  }

  return { texto: resultado, diagnosticos };
}
