import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db/client";
import { autenticar } from "./auth-middleware";
import { rotaAsync } from "./async-route";
import { invalidarCacheCategorias } from "../processor/classificar-categorias";

export const rotasCategorias = Router();
rotasCategorias.use(autenticar);

const atualizarCategoriaSchema = z.object({
  nome: z.string().min(1).max(80).optional(),
  descricao: z.string().max(300).nullable().optional(),
  ativo: z.boolean().optional(),
  prioridade: z.number().int().min(0).max(1000).optional(),
  limiarConfianca: z.number().int().min(0).max(100).optional(),
  palavrasChave: z.array(z.string().min(1).max(80)).max(200).optional(),
  palavrasExclusao: z.array(z.string().min(1).max(80)).max(200).optional(),
});


const criarCategoriaSchema = z.object({
  nome: z.string().min(1).max(80),
  chave: z.string().min(1).max(80).regex(/^[a-z0-9_-]+$/).optional(),
  descricao: z.string().max(300).optional(),
  palavrasChave: z.array(z.string().min(1).max(80)).max(200).default([]),
  palavrasExclusao: z.array(z.string().min(1).max(80)).max(200).default([]),
  limiarConfianca: z.number().int().min(0).max(100).default(60),
});

function gerarChave(nome: string) {
  return nome.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 70) || "categoria";
}

rotasCategorias.post("/", rotaAsync(async (req, res) => {
  const parsed = criarCategoriaSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ erro: "Dados inválidos", detalhes: parsed.error.issues });
  const chaveBase = parsed.data.chave ?? gerarChave(parsed.data.nome);
  let chave = chaveBase;
  let sufixo = 2;
  while (await prisma.categoria.findUnique({ where: { chave }, select: { id: true } })) chave = `${chaveBase}-${sufixo++}`;

  const categoria = await prisma.categoria.create({
    data: {
      chave,
      nome: parsed.data.nome,
      descricao: parsed.data.descricao,
      palavrasChave: parsed.data.palavrasChave,
      palavrasExclusao: parsed.data.palavrasExclusao,
      limiarConfianca: parsed.data.limiarConfianca,
    },
  });
  invalidarCacheCategorias();
  res.status(201).json(categoria);
}));

rotasCategorias.get("/", rotaAsync(async (_req, res) => {
  const categorias = await prisma.categoria.findMany({
    orderBy: [{ ativo: "desc" }, { prioridade: "desc" }, { nome: "asc" }],
    include: {
      destinos: {
        where: { ativo: true },
        include: { grupoDestino: { include: { plataforma: true } } },
      },
      _count: {
        select: {
          mensagens: { where: { mensagem: { status: "AGUARDANDO_REVISAO" } } },
        },
      },
    },
  });
  res.json(categorias);
}));

rotasCategorias.patch("/:id", rotaAsync(async (req, res) => {
  const parsed = atualizarCategoriaSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ erro: "Dados inválidos", detalhes: parsed.error.issues });

  const categoria = await prisma.categoria.update({
    where: { id: req.params.id },
    data: parsed.data,
  });
  invalidarCacheCategorias();
  res.json(categoria);
}));

const destinosSchema = z.object({ grupoDestinoIds: z.array(z.string().uuid()).max(100) });

rotasCategorias.put("/:id/destinos", rotaAsync(async (req, res) => {
  const parsed = destinosSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ erro: "Dados inválidos", detalhes: parsed.error.issues });

  const categoria = await prisma.categoria.findUnique({ where: { id: req.params.id } });
  if (!categoria) return res.status(404).json({ erro: "Categoria não encontrada" });

  const ids = [...new Set(parsed.data.grupoDestinoIds)];
  const destinosValidos = await prisma.grupo.findMany({
    where: {
      id: { in: ids },
      tipo: "DESTINO",
      plataforma: { chave: "telegram", ativo: true },
    },
    select: { id: true },
  });
  if (destinosValidos.length !== ids.length) {
    return res.status(400).json({ erro: "Todos os destinos precisam ser grupos Telegram do tipo DESTINO" });
  }

  await prisma.$transaction(async (tx) => {
    await tx.categoriaDestino.deleteMany({ where: { categoriaId: categoria.id } });
    if (ids.length) {
      await tx.categoriaDestino.createMany({
        data: ids.map((grupoDestinoId) => ({ categoriaId: categoria.id, grupoDestinoId })),
        skipDuplicates: true,
      });
    }
  });

  const atualizada = await prisma.categoria.findUnique({
    where: { id: categoria.id },
    include: {
      destinos: { include: { grupoDestino: { include: { plataforma: true } } } },
    },
  });
  res.json(atualizada);
}));
