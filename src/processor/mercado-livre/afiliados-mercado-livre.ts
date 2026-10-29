import { criarLinkAfiliadoViaNavegador } from "./navegador-mercado-livre";
import { resolverProdutoMercadoLivre } from "./resolver-mercado-livre";
import { RespostaCreateLink } from "./tipos";
import { obterTagAfiliado, verificarStatusAutenticacao } from "./sessao-mercado-livre";
import { childLogger } from "../../utils/logger";

const log = childLogger("mercado-livre-afiliados");

export async function criarLinkAfiliadoMercadoLivre(urlProduto: string): Promise<string> {
  const tag = obterTagAfiliado();
  const resposta = await criarLinkAfiliadoViaNavegador(urlProduto, tag);

  verificarStatusAutenticacao(resposta.status);
  if (resposta.status < 200 || resposta.status >= 300) {
    throw new Error(`createLink via navegador retornou HTTP ${resposta.status}`);
  }

  let dados: RespostaCreateLink;
  try {
    dados = JSON.parse(resposta.body) as RespostaCreateLink;
  } catch {
    throw new Error("createLink via navegador retornou uma resposta que não é JSON válido");
  }

  return extrairShortUrl(dados);
}

function extrairShortUrl(dados: RespostaCreateLink): string {
  if (!dados.urls?.length || (dados.total_success ?? 0) === 0) {
    log.error(
      {
        status: dados.status,
        total_items: dados.total_items,
        total_success: dados.total_success,
        total_error: dados.total_error,
      },
      "createLink não retornou nenhum link com sucesso"
    );
    throw new Error("createLink não gerou nenhum link de afiliado (total_success = 0 ou urls vazio)");
  }

  const item = dados.urls.find((url) => Boolean(url.short_url));
  if (!item?.short_url) throw new Error("createLink retornou sucesso, mas sem short_url");
  return item.short_url;
}

export async function converterLinkAfiliadoMercadoLivre(urlCurta: string): Promise<{
  linkAfiliado: string;
  productId: string | null;
  urlCanonica: string;
}> {
  const { productId, urlCanonica } = await resolverProdutoMercadoLivre(urlCurta);
  const linkAfiliado = await criarLinkAfiliadoMercadoLivre(urlCanonica);
  return { linkAfiliado, productId, urlCanonica };
}
