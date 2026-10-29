import { sessaoMercadoLivreConfigurada } from "./sessao-mercado-livre";
import { converterLinkAfiliadoMercadoLivre } from "./afiliados-mercado-livre";
import { buscarNoCache, salvarNoCache } from "./cache-mercado-livre";
import { extrairDominio, extrairLinks } from "../extrair-links";
import { childLogger } from "../../utils/logger";

const log = childLogger("mercado-livre-substituir");
const DOMINIO_MELI_LA = "meli.la";
const MAX_TENTATIVAS_CONVERSAO = 2;
const ESPERA_RETRY_MS = 700;

export type DiagnosticoMercadoLivre = {
  linkOriginal: string;
  convertido: boolean;
  tentativas: number;
  linkGerado?: string;
  erro?: string;
};

export type ResultadoAplicacaoMercadoLivre = {
  texto: string;
  diagnosticos: DiagnosticoMercadoLivre[];
};

function extrairCodigoMeliLa(url: string): string | null {
  if (extrairDominio(url) !== DOMINIO_MELI_LA) return null;
  try {
    const { pathname } = new URL(url);
    const codigo = pathname.replace(/^\/+/, "").split("/")[0];
    return codigo || null;
  } catch {
    return null;
  }
}

function esperar(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

/**
 * Versão detalhada usada pelo pipeline. Além do texto final, retorna
 * diagnósticos para o painel conseguir sinalizar links que ficaram originais.
 */
export async function aplicarLinksMercadoLivreDetalhado(texto: string): Promise<ResultadoAplicacaoMercadoLivre> {
  if (!sessaoMercadoLivreConfigurada()) {
    return { texto, diagnosticos: [] };
  }

  const linksEncontrados = extrairLinks(texto);
  let resultado = texto;
  const diagnosticos: DiagnosticoMercadoLivre[] = [];

  for (const linkOriginal of linksEncontrados) {
    const codigo = extrairCodigoMeliLa(linkOriginal);
    if (!codigo) continue;

    let ultimoErro: unknown = null;
    let convertido = false;

    for (let tentativa = 1; tentativa <= MAX_TENTATIVAS_CONVERSAO; tentativa++) {
      try {
        const novoLink = await converterOuBuscarCache(codigo, linkOriginal);
        resultado = resultado.split(linkOriginal).join(novoLink);
        diagnosticos.push({
          linkOriginal,
          convertido: true,
          tentativas: tentativa,
          linkGerado: novoLink,
        });
        convertido = true;
        break;
      } catch (erro) {
        ultimoErro = erro;
        const mensagemErro = erro instanceof Error ? erro.message : String(erro);

        if (tentativa < MAX_TENTATIVAS_CONVERSAO) {
          log.warn(
            { erro: mensagemErro, link: linkOriginal, tentativa },
            "falha na primeira tentativa de conversão do Mercado Livre — tentando novamente"
          );
          await esperar(ESPERA_RETRY_MS);
        }
      }
    }

    if (!convertido) {
      const mensagemErro = ultimoErro instanceof Error ? ultimoErro.message : String(ultimoErro ?? "erro desconhecido");
      diagnosticos.push({
        linkOriginal,
        convertido: false,
        tentativas: MAX_TENTATIVAS_CONVERSAO,
        erro: mensagemErro,
      });

      log.error(
        { erro: mensagemErro, link: linkOriginal, tentativas: MAX_TENTATIVAS_CONVERSAO },
        "falha ao converter link de afiliado do Mercado Livre após 2 tentativas — mantendo link original"
      );
    }
  }

  return { texto: resultado, diagnosticos };
}

/**
 * API compatível com o restante do projeto/testes antigos: retorna apenas texto.
 */
export async function aplicarLinksMercadoLivre(texto: string): Promise<string> {
  return (await aplicarLinksMercadoLivreDetalhado(texto)).texto;
}

async function converterOuBuscarCache(codigo: string, linkOriginal: string): Promise<string> {
  const doCache = await buscarNoCache(codigo);
  if (doCache) {
    log.debug({ codigo }, "link Mercado Livre resolvido via cache");
    return doCache;
  }

  const { linkAfiliado, productId, urlCanonica } = await converterLinkAfiliadoMercadoLivre(linkOriginal);

  await salvarNoCache({ codigoOriginal: codigo, productId, urlCanonica, linkGerado: linkAfiliado });

  log.info({ codigo, productId, linkAfiliado }, "link Mercado Livre convertido para link de afiliado próprio");
  return linkAfiliado;
}
