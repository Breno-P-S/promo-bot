import "dotenv/config";
import { randomBytes } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  await prisma.plataforma.upsert({
    where: { chave: "telegram" },
    update: {},
    create: { chave: "telegram", nome: "Telegram" },
  });
  await prisma.plataforma.upsert({
    where: { chave: "whatsapp" },
    update: {},
    create: { chave: "whatsapp", nome: "WhatsApp" },
  });

  const emailAdmin = process.env.ADMIN_INITIAL_EMAIL?.trim() || "admin@promobot.local";
  const senhaConfigurada = process.env.ADMIN_INITIAL_PASSWORD?.trim();
  const senhaInicial = senhaConfigurada || randomBytes(18).toString("base64url");
  const existente = await prisma.admin.findUnique({ where: { email: emailAdmin } });

  if (!existente) {
    await prisma.admin.create({
      data: {
        email: emailAdmin,
        nome: "Administrador",
        senhaHash: await bcrypt.hash(senhaInicial, 12),
      },
    });
    console.log(`Admin criado: ${emailAdmin}`);
    console.log(`Senha inicial: ${senhaInicial}`);
    if (!senhaConfigurada) console.log("Guarde esta senha: ela foi gerada aleatoriamente e não será exibida novamente.");
  }

  console.log("Seed concluído.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
