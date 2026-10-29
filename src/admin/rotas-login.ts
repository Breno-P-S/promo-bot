import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { prisma } from "../db/client";
import { env } from "../config/env";
import { rotaAsync } from "./async-route";

export const rotasLogin = Router();

const loginSchema = z.object({
  email: z.string().email(),
  senha: z.string().min(6),
});

rotasLogin.post("/login", rotaAsync(async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ erro: "Dados inválidos", detalhes: parsed.error.issues });
  }

  const { email, senha } = parsed.data;
  const admin = await prisma.admin.findUnique({ where: { email } });
  if (!admin) return res.status(401).json({ erro: "Credenciais inválidas" });

  const senhaOk = await bcrypt.compare(senha, admin.senhaHash);
  if (!senhaOk) return res.status(401).json({ erro: "Credenciais inválidas" });

  const token = jwt.sign({ adminId: admin.id }, env.ADMIN_JWT_SECRET, { expiresIn: "8h" });
  res.json({ token });
}));
