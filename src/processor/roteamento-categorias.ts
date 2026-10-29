import { prisma } from "../db/client";

export type ResultadoRoteamento = {
  modo: "categorias" | "legado" | "sem-destino";
  destinosTelegramIds: string[];
  categorias: Array<{ id: string; chave: string; nome: string; confianca: number; principal: boolean }>;
};

export async function obterRoteamentoMensagem(mensagemId: string): Promise<ResultadoRoteamento> {
  const totalMapeamentosAtivos = await prisma.categoriaDestino.count({
    where: {
      ativo: true,
      categoria: { ativo: true },
      grupoDestino: { ativo: true, tipo: "DESTINO", plataforma: { chave: "telegram", ativo: true } },
    },
  });

  // Enquanto o usuário ainda não configurou nenhum destino por categoria,
  // mantém o comportamento antigo para não interromper o bot existente.
  if (totalMapeamentosAtivos === 0) {
    return { modo: "legado", destinosTelegramIds: [], categorias: [] };
  }

  const classificacoes = await prisma.mensagemCategoria.findMany({
    where: { mensagemId, categoria: { ativo: true } },
    include: {
      categoria: {
        include: {
          destinos: {
            where: {
              ativo: true,
              grupoDestino: { ativo: true, tipo: "DESTINO", plataforma: { chave: "telegram", ativo: true } },
            },
            include: { grupoDestino: true },
          },
        },
      },
    },
    orderBy: [{ principal: "desc" }, { confianca: "desc" }],
  });

  const destinos = new Set<string>();
  for (const classificacao of classificacoes) {
    for (const vinculo of classificacao.categoria.destinos) destinos.add(vinculo.grupoDestinoId);
  }

  return {
    modo: destinos.size ? "categorias" : "sem-destino",
    destinosTelegramIds: [...destinos],
    categorias: classificacoes.map((c) => ({
      id: c.categoria.id,
      chave: c.categoria.chave,
      nome: c.categoria.nome,
      confianca: c.confianca,
      principal: c.principal,
    })),
  };
}
