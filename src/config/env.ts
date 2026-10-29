import "dotenv/config";
import { z } from "zod";

const booleanoEnv = (padrao: "true" | "false") =>
  z.string().default(padrao).transform((v) => v.toLowerCase() !== "false");

const envSchema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL é obrigatório"),
  REDIS_URL: z.string().min(1, "REDIS_URL é obrigatório"),

  TELEGRAM_API_ID: z.string().min(1, "TELEGRAM_API_ID é obrigatório"),
  TELEGRAM_API_HASH: z.string().min(1, "TELEGRAM_API_HASH é obrigatório"),
  TELEGRAM_USERBOT_SESSION: z.string().default(""),
  TELEGRAM_BOT_TOKEN: z.string().min(1, "TELEGRAM_BOT_TOKEN é obrigatório"),

  WHATSAPP_SESSION_PATH: z.string().default("./sessions/whatsapp"),
  WHATSAPP_ENABLED: booleanoEnv("true"),

  ADMIN_JWT_SECRET: z.string().min(32, "ADMIN_JWT_SECRET precisa ter pelo menos 32 caracteres"),
  ADMIN_PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  ADMIN_HOST: z.string().default("127.0.0.1"),

  REVISAO_MANUAL_ATIVA: booleanoEnv("true"),

  // Um único Chromium e um único perfil são compartilhados por Amazon e Mercado Livre.
  BROWSER_EXECUTABLE: z.string().default(""),
  BROWSER_PROFILE_PATH: z.string().default("./sessions/browser"),

  ML_AFFILIATE_TAG: z.string().default(""),
  AMAZON_AFFILIATE_TAG: z.string().default(""),

  TMP_MEDIA_MAX_AGE_DAYS: z.coerce.number().int().min(1).default(7),
  DEDUP_WINDOW_HOURS: z.coerce.number().int().min(1).default(24),
  CONFIANCA_MINIMA_SEM_REVISAO: z.coerce.number().int().min(0).max(100).default(95),
  CONFIANCA_CATEGORIA_MINIMA: z.coerce.number().int().min(0).max(100).default(70),
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(10).default(3),
  TELEGRAM_POLL_INTERVAL_MS: z.coerce.number().int().min(30_000).default(180_000),

  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  LOG_LEVEL: z.string().default("info"),
});

function loadEnv() {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error("❌ Erro de configuração — variáveis de ambiente inválidas ou ausentes:");
    for (const issue of parsed.error.issues) {
      console.error(`  - ${issue.path.join(".")}: ${issue.message}`);
    }
    console.error("\nConfira o arquivo .env.example e crie um .env com esses valores.");
    process.exit(1);
  }
  return parsed.data;
}

export const env = loadEnv();
