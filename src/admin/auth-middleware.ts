import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { env } from "../config/env";

export interface RequisicaoAutenticada extends Request {
  adminId?: string;
}

export function autenticar(req: RequisicaoAutenticada, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return res.status(401).json({ erro: "Token ausente" });
  }
  const token = header.replace("Bearer ", "");
  try {
    const payload = jwt.verify(token, env.ADMIN_JWT_SECRET) as { adminId: string };
    req.adminId = payload.adminId;
    next();
  } catch {
    return res.status(401).json({ erro: "Token inválido ou expirado" });
  }
}
