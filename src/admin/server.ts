import express, { NextFunction, Request, Response } from "express";
import path from "path";
import { env } from "../config/env";
import { rotasLogin } from "./rotas-login";
import { rotasGrupos } from "./rotas-grupos";
import { rotasRegras } from "./rotas-regras";
import { rotasMonitoramento } from "./rotas-monitoramento";
import { rotasMensagens } from "./rotas-mensagens";
import { rotasCategorias } from "./rotas-categorias";
import { childLogger } from "../utils/logger";

const log = childLogger("admin-server");

export function criarServidorAdmin() {
  const app = express();
  app.use(express.json());

  app.get("/saude", (_req, res) => res.json({ ok: true }));

  app.use("/auth", rotasLogin);
  app.use("/grupos", rotasGrupos);
  app.use("/regras", rotasRegras);
  app.use("/monitoramento", rotasMonitoramento);
  app.use("/mensagens", rotasMensagens);
  app.use("/categorias", rotasCategorias);

  // Serve as imagens baixadas temporariamente (tmp/midias/) para que o
  // painel consiga exibi-las na fila de revisão antes de publicar.
  // Não tem autenticação própria (é um caminho de arquivo estático) —
  // como os nomes de arquivo incluem chatId+msgId, não são adivinháveis
  // à toa, mas não é um segredo forte. Aceitável para uso local/privado.
  app.use("/midias", express.static(path.join(process.cwd(), "tmp", "midias")));

  // Dashboard de monitoramento (arquivo estático, consome as rotas acima).
  // Acesse em http://localhost:<ADMIN_PORT>/painel.html
  app.use(express.static(path.join(__dirname, "public")));

  // Express 4 não encaminha rejeições de handlers async sozinho; as rotas
  // usam rotaAsync e este middleware transforma qualquer falha não tratada
  // em resposta HTTP consistente, sem expor stack/credenciais ao cliente.
  app.use((erro: unknown, req: Request, res: Response, _next: NextFunction) => {
    log.error({ erro, metodo: req.method, caminho: req.originalUrl }, "erro não tratado na API admin");
    if (res.headersSent) return;
    res.status(500).json({ erro: "Erro interno do servidor" });
  });

  return app;
}

export function iniciarServidorAdmin() {
  const app = criarServidorAdmin();
  app.listen(env.ADMIN_PORT, env.ADMIN_HOST, () => {
    log.info(`Painel admin (API) rodando em http://${env.ADMIN_HOST}:${env.ADMIN_PORT}`);
  });
}
