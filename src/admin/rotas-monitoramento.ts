import { Router } from "express";
import { prisma } from "../db/client";
import { autenticar } from "./auth-middleware";
import { obterEstadoRuntime } from "../utils/estado-runtime";
import { rotaAsync } from "./async-route";
import { env } from "../config/env";

export const rotasMonitoramento = Router();
rotasMonitoramento.use(autenticar);

// Mensagens recentes, com seus logs de pipeline
rotasMonitoramento.get("/mensagens", rotaAsync(async (req, res) => {
  const limite = Math.min(Number(req.query.limite) || 50, 200);
  const mensagens = await prisma.mensagem.findMany({
    take: limite,
    orderBy: { criadoEm: "desc" },
    include: { logs: { orderBy: { criadoEm: "asc" } }, grupoFonte: true },
  });
  res.json(mensagens);
}));

// Status das integrações (userbot Telegram, bot Telegram, WhatsApp)
rotasMonitoramento.get("/status-integracoes", rotaAsync(async (_req, res) => {
  const status = await prisma.statusIntegracao.findMany();
  res.json(status);
}));

// Contagem de erros recentes — útil para um painel de saúde do sistema
rotasMonitoramento.get("/resumo", rotaAsync(async (_req, res) => {
  const [totalMensagens, totalFalhas, totalDuplicadas] = await Promise.all([
    prisma.mensagem.count(),
    prisma.mensagem.count({ where: { status: "FALHOU" } }),
    prisma.log.count({ where: { status: "ERRO" } }),
  ]);
  res.json({ totalMensagens, totalFalhas, totalErrosDeLog: totalDuplicadas });
}));

// Endpoint consolidado para o dashboard: junta o status persistido no
// banco (StatusIntegracao) com o estado em tempo real do processo
// (estado-runtime — conexão viva, atividade de leitura/ignoro do
// userbot) e um resumo geral, tudo numa única chamada.
rotasMonitoramento.get("/painel", rotaAsync(async (_req, res) => {
  const [
    statusIntegracoes,
    totalMensagens,
    totalFalhas,
    totalErrosDeLog,
    ultimasMensagens,
    totalFontesCadastradas,
    totalAguardandoRevisao,
    totalBaixaConfianca,
    totalSemCategoria,
    totalCorrecoesCategoria,
    totalConfirmacoesCategoria,
    totalMapeamentosCategoria,
    categoriasResumo,
  ] = await Promise.all([
    prisma.statusIntegracao.findMany(),
    prisma.mensagem.count(),
    prisma.mensagem.count({ where: { status: "FALHOU" } }),
    prisma.log.count({ where: { status: "ERRO" } }),
    prisma.mensagem.findMany({
      take: 10,
      orderBy: { criadoEm: "desc" },
      include: {
        grupoFonte: true,
        categorias: { include: { categoria: true }, orderBy: [{ principal: "desc" }, { confianca: "desc" }] },
        logs: {
          where: {
            status: "ERRO",
            etapa: { in: ["afiliado_mercado_livre", "afiliado_amazon"] },
          },
          orderBy: { criadoEm: "asc" },
        },
      },
    }),
    prisma.grupo.count({ where: { tipo: "FONTE", ativo: true } }),
    prisma.mensagem.count({ where: { status: "AGUARDANDO_REVISAO" } }),
    prisma.mensagem.count({ where: { confianca: { lt: env.CONFIANCA_MINIMA_SEM_REVISAO } } }),
    prisma.mensagem.count({ where: { categorias: { none: {} } } }),
    prisma.log.count({ where: { etapa: "categoria_manual_correcao", status: "OK" } }),
    prisma.log.count({ where: { etapa: "categoria_manual_confirmacao", status: "OK" } }),
    prisma.categoriaDestino.count({ where: { ativo: true } }),
    prisma.categoria.findMany({
      where: { ativo: true },
      orderBy: [{ prioridade: "desc" }, { nome: "asc" }],
      select: {
        id: true, chave: true, nome: true, limiarConfianca: true,
        _count: { select: { mensagens: true, destinos: true } },
      },
    }),
  ]);

  const totalDecisoesCategoria = totalCorrecoesCategoria + totalConfirmacoesCategoria;
  const taxaCorrecaoCategoriaAmostra = totalDecisoesCategoria > 0
    ? Math.round((totalCorrecoesCategoria / totalDecisoesCategoria) * 1000) / 10
    : null;

  res.json({
    statusIntegracoes,
    runtime: obterEstadoRuntime(),
    resumo: {
      totalMensagens,
      totalFalhas,
      totalErrosDeLog,
      totalFontesCadastradas,
      totalAguardandoRevisao,
      totalBaixaConfianca,
      totalSemCategoria,
      totalCorrecoesCategoria,
      totalConfirmacoesCategoria,
      totalDecisoesCategoria,
      taxaCorrecaoCategoriaAmostra,
      totalMapeamentosCategoria,
      limiarConfianca: env.CONFIANCA_MINIMA_SEM_REVISAO,
      limiarConfiancaCategoria: env.CONFIANCA_CATEGORIA_MINIMA,
    },
    categoriasResumo,
    ultimasMensagens,
  });
}));
