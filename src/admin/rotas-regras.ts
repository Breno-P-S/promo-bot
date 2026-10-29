import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db/client";
import { autenticar } from "./auth-middleware";
import { rotaAsync } from "./async-route";

export const rotasRegras = Router();
rotasRegras.use(autenticar);
const statusSchema = z.object({ ativo: z.boolean() });


const criarRegraSchema = z.object({
  grupoFonteId: z.string().nullable().optional(), // null/omitido = regra global
  tipo: z.enum(["REMOVER_TEXTO", "ADICIONAR_TEXTO", "REMOVER_LINK", "ASSINATURA", "SUBSTITUIR_TEXTO"]),
  padrao: z.string().min(1),
  valor: z.string().optional(),
  ordem: z.number().int().default(0),
});

rotasRegras.get("/", rotaAsync(async (req, res) => {
  const { grupoFonteId } = req.query;
  const regras = await prisma.regra.findMany({
    where: grupoFonteId ? { grupoFonteId: String(grupoFonteId) } : undefined,
    orderBy: { ordem: "asc" },
  });
  res.json(regras);
}));

rotasRegras.post("/", rotaAsync(async (req, res) => {
  const parsed = criarRegraSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ erro: "Dados inválidos", detalhes: parsed.error.issues });
  const regra = await prisma.regra.create({ data: parsed.data });
  res.status(201).json(regra);
}));

rotasRegras.patch("/:id/status", rotaAsync(async (req, res) => {
  const parsed = statusSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ erro: "ativo deve ser booleano" });
  const regra = await prisma.regra.update({
    where: { id: req.params.id },
    data: { ativo: parsed.data.ativo },
  });
  res.json(regra);
}));

rotasRegras.delete("/:id", rotaAsync(async (req, res) => {
  await prisma.regra.delete({ where: { id: req.params.id } });
  res.status(204).send();
}));
