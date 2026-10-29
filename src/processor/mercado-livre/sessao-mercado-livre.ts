import { env } from "../../config/env";
import { childLogger } from "../../utils/logger";

const log = childLogger("mercado-livre-sessao");

export function sessaoMercadoLivreConfigurada(): boolean {
  return Boolean(env.ML_AFFILIATE_TAG.trim());
}

export function obterTagAfiliado(): string {
  const tag = env.ML_AFFILIATE_TAG.trim();
  if (!tag) throw new ErroSessaoMercadoLivre("ML_AFFILIATE_TAG não configurada no .env");
  return tag;
}

export class ErroSessaoMercadoLivre extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = "ErroSessaoMercadoLivre";
  }
}

export function verificarStatusAutenticacao(status: number): void {
  if (status !== 401 && status !== 403) return;
  log.warn({ status }, "sessão do Mercado Livre inválida");
  throw new ErroSessaoMercadoLivre(
    `Sessão do Mercado Livre expirada ou inválida (HTTP ${status}). Execute "npm run ml:login" e faça login no Chromium compartilhado.`
  );
}
