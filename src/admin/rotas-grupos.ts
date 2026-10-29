import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db/client";
import { autenticar } from "./auth-middleware";
import { rotaAsync } from "./async-route";

export const rotasGrupos = Router();
rotasGrupos.use(autenticar);
const statusSchema = z.object({ ativo: z.boolean() });


const criarGrupoSchema = z.object({
  plataformaChave: z.enum(["telegram", "whatsapp"]),
  tipo: z.enum(["FONTE", "DESTINO"]),
  identificadorExterno: z.string().min(1),
  nome: z.string().min(1),
});

// Listar (com filtro opcional por tipo/plataforma)
rotasGrupos.get("/", rotaAsync(async (req, res) => {
  const { tipo, plataforma } = req.query;
  const tipoValidado = tipo ? z.enum(["FONTE", "DESTINO"]).safeParse(String(tipo)) : null;
  if (tipoValidado && !tipoValidado.success) {
    return res.status(400).json({ erro: "tipo deve ser FONTE ou DESTINO" });
  }
  const grupos = await prisma.grupo.findMany({
    where: {
      tipo: tipoValidado?.success ? tipoValidado.data : undefined,
      plataforma: plataforma ? { chave: String(plataforma) } : undefined,
    },
    include: { plataforma: true },
    orderBy: { criadoEm: "desc" },
  });
  res.json(grupos);
}));

// Adicionar fonte/destino
rotasGrupos.post("/", rotaAsync(async (req, res) => {
  const parsed = criarGrupoSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ erro: "Dados inválidos", detalhes: parsed.error.issues });

  const plataforma = await prisma.plataforma.findUnique({ where: { chave: parsed.data.plataformaChave } });
  if (!plataforma) return res.status(400).json({ erro: "Plataforma não encontrada" });

  const grupo = await prisma.grupo.create({
    data: {
      plataformaId: plataforma.id,
      tipo: parsed.data.tipo,
      identificadorExterno: parsed.data.identificadorExterno,
      nome: parsed.data.nome,
    },
  });
  res.status(201).json(grupo);
}));

// Vínculos de replicação entre destinos Telegram e WhatsApp.
rotasGrupos.get("/vinculos-destino", rotaAsync(async (_req, res) => {
  const vinculos = await prisma.vinculoDestino.findMany({
    where: { ativo: true },
    include: {
      origem: { include: { plataforma: true } },
      destino: { include: { plataforma: true } },
    },
    orderBy: { id: "asc" },
  });
  res.json(vinculos);
}));

const vinculosWhatsappSchema = z.object({ destinoIds: z.array(z.string().uuid()).max(100) });

// Substitui os vínculos WhatsApp de um destino Telegram de forma idempotente.
rotasGrupos.put("/:id/vinculos-whatsapp", rotaAsync(async (req, res) => {
  const parsed = vinculosWhatsappSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ erro: "Dados inválidos", detalhes: parsed.error.issues });

  const origem = await prisma.grupo.findUnique({
    where: { id: req.params.id },
    include: { plataforma: true },
  });
  if (!origem || origem.tipo !== "DESTINO" || origem.plataforma.chave !== "telegram") {
    return res.status(400).json({ erro: "A origem precisa ser um grupo Telegram do tipo DESTINO" });
  }

  const ids = [...new Set(parsed.data.destinoIds)];
  const destinos = await prisma.grupo.findMany({
    where: {
      id: { in: ids },
      tipo: "DESTINO",
      plataforma: { chave: "whatsapp", ativo: true },
    },
    select: { id: true },
  });
  if (destinos.length !== ids.length) {
    return res.status(400).json({ erro: "Todos os vínculos precisam apontar para destinos WhatsApp válidos" });
  }

  await prisma.$transaction(async (tx) => {
    await tx.vinculoDestino.deleteMany({ where: { origemId: origem.id } });
    if (ids.length) {
      await tx.vinculoDestino.createMany({
        data: ids.map((destinoId) => ({ origemId: origem.id, destinoId })),
        skipDuplicates: true,
      });
    }
  });

  const atualizados = await prisma.vinculoDestino.findMany({
    where: { origemId: origem.id, ativo: true },
    include: { destino: { include: { plataforma: true } } },
  });
  res.json(atualizados);
}));

// Ativar/desativar
rotasGrupos.patch("/:id/status", rotaAsync(async (req, res) => {
  const parsed = statusSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ erro: "ativo deve ser booleano" });
  const grupo = await prisma.grupo.update({ where: { id: req.params.id }, data: { ativo: parsed.data.ativo } });
  res.json(grupo);
}));

// Remover
rotasGrupos.delete("/:id", rotaAsync(async (req, res) => {
  await prisma.grupo.delete({ where: { id: req.params.id } });
  res.status(204).send();
}));

// Vincular um destino Telegram a um destino WhatsApp (replicação automática)
rotasGrupos.post("/vincular-destino", rotaAsync(async (req, res) => {
  const schema = z.object({ origemId: z.string(), destinoId: z.string() });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ erro: "Dados inválidos" });

  const vinculo = await prisma.vinculoDestino.create({ data: parsed.data });
  res.status(201).json(vinculo);
}));
