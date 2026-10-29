import { Categoria } from "@prisma/client";
import { prisma } from "../db/client";
import { childLogger } from "../utils/logger";

const log = childLogger("classificar-categorias");
const TTL_CACHE_CATEGORIAS_MS = 30_000;
let cacheCategorias: { ate: number; categorias: Categoria[] } | null = null;

export function invalidarCacheCategorias() {
  cacheCategorias = null;
}

async function obterCategoriasAtivas() {
  if (cacheCategorias && cacheCategorias.ate > Date.now()) return cacheCategorias.categorias;
  const categorias = await prisma.categoria.findMany({
    where: { ativo: true },
    orderBy: [{ prioridade: "desc" }, { nome: "asc" }],
  });
  cacheCategorias = { ate: Date.now() + TTL_CACHE_CATEGORIAS_MS, categorias };
  return categorias;
}

export type ClassificacaoCategoria = {
  categoriaId: string;
  chave: string;
  nome: string;
  confianca: number;
  principal: boolean;
  motivos: string[];
};

export type ResultadoClassificacaoCategorias = {
  classificacoes: ClassificacaoCategoria[];
  principal: ClassificacaoCategoria | null;
  confiancaPrincipal: number;
  categoriasAtivas: number;
};

function normalizar(texto: string) {
  return texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function contemFrase(textoNormalizado: string, termo: string) {
  const termoNormalizado = normalizar(termo);
  if (!termoNormalizado) return false;
  return (` ${textoNormalizado} `).includes(` ${termoNormalizado} `);
}

function pontuarCategoria(
  categoria: Categoria,
  produto: string | null,
  textoCompleto: string
): Omit<ClassificacaoCategoria, "principal"> {
  const produtoNorm = normalizar(produto ?? "");
  const textoNorm = normalizar(textoCompleto);
  const motivos: string[] = [];
  let pontos = 0;
  let acertosProduto = 0;
  let acertosTexto = 0;

  for (const termo of categoria.palavrasChave) {
    if (produtoNorm && contemFrase(produtoNorm, termo)) {
      pontos += 72;
      acertosProduto += 1;
      motivos.push(`produto contém “${termo}”`);
      continue;
    }
    if (contemFrase(textoNorm, termo)) {
      pontos += 30;
      acertosTexto += 1;
      motivos.push(`mensagem contém “${termo}”`);
    }
  }

  for (const termo of categoria.palavrasExclusao) {
    if (contemFrase(textoNorm, termo)) {
      pontos -= 45;
      motivos.push(`exclusão por “${termo}”`);
    }
  }

  // Mais de um sinal independente torna a decisão muito mais confiável.
  const totalAcertos = acertosProduto + acertosTexto;
  if (totalAcertos >= 2) pontos += 10;
  if (acertosProduto >= 2) pontos += 8;

  // Prioridade só desempata categorias; nunca transforma ausência de evidência em match.
  if (pontos > 0) pontos += Math.min(5, Math.max(0, Math.floor(categoria.prioridade / 25)));

  const confianca = Math.max(0, Math.min(100, pontos));
  return {
    categoriaId: categoria.id,
    chave: categoria.chave,
    nome: categoria.nome,
    confianca,
    motivos,
  };
}

export function classificarCategorias(
  categorias: Categoria[],
  dados: { produto: string | null; textoOriginal: string; textoProcessado?: string | null }
): ResultadoClassificacaoCategorias {
  const ativas = categorias.filter((c) => c.ativo);
  const textoCompleto = [dados.produto, dados.textoOriginal, dados.textoProcessado]
    .filter(Boolean)
    .join("\n");

  const pontuadas = ativas
    .map((categoria) => ({ categoria, resultado: pontuarCategoria(categoria, dados.produto, textoCompleto) }))
    .filter(({ categoria, resultado }) => resultado.confianca >= categoria.limiarConfianca)
    .sort((a, b) => {
      if (b.resultado.confianca !== a.resultado.confianca) return b.resultado.confianca - a.resultado.confianca;
      return b.categoria.prioridade - a.categoria.prioridade;
    });

  const classificacoes: ClassificacaoCategoria[] = pontuadas.map(({ resultado }, i) => ({
    ...resultado,
    principal: i === 0,
  }));

  return {
    classificacoes,
    principal: classificacoes[0] ?? null,
    confiancaPrincipal: classificacoes[0]?.confianca ?? 0,
    categoriasAtivas: ativas.length,
  };
}

export async function classificarESalvarCategorias(
  mensagemId: string,
  dados: { produto: string | null; textoOriginal: string; textoProcessado?: string | null }
): Promise<ResultadoClassificacaoCategorias> {
  const categorias = await obterCategoriasAtivas();
  const resultado = classificarCategorias(categorias, dados);

  await prisma.$transaction(async (tx) => {
    // Preserva escolhas manuais: reprocessar texto não deve apagar uma decisão humana.
    const manuais = await tx.mensagemCategoria.findMany({
      where: { mensagemId, origem: "MANUAL" },
      select: { categoriaId: true },
    });
    const idsManuais = new Set(manuais.map((m) => m.categoriaId));

    await tx.mensagemCategoria.deleteMany({ where: { mensagemId, origem: "AUTOMATICA" } });

    const automaticas = manuais.length > 0 ? [] : resultado.classificacoes
      .filter((c) => !idsManuais.has(c.categoriaId))
      .map((c) => ({
        mensagemId,
        categoriaId: c.categoriaId,
        confianca: c.confianca,
        principal: c.principal && manuais.length === 0,
        origem: "AUTOMATICA" as const,
        motivos: c.motivos,
      }));

    if (automaticas.length) {
      await tx.mensagemCategoria.createMany({ data: automaticas, skipDuplicates: true });
    }
  });

  log.debug({ mensagemId, categorias: resultado.classificacoes.map((c) => `${c.chave}:${c.confianca}`) }, "categorias classificadas");
  return resultado;
}
