import pino from "pino";
import { env } from "../config/env";

// Alguns testes mockam parcialmente o módulo de configuração e fornecem
// somente as variáveis necessárias ao cenário testado. Nesses casos,
// LOG_LEVEL/NODE_ENV podem não existir no objeto mockado. O logger não deve
// derrubar a aplicação (ou a suíte de testes) por causa disso.
const logLevel = env.LOG_LEVEL ?? "info";
const nodeEnv = env.NODE_ENV ?? "test";

export const logger = pino({
  level: logLevel,
  transport:
    nodeEnv === "development"
      ? { target: "pino-pretty", options: { colorize: true, translateTime: "HH:MM:ss" } }
      : undefined,
});

export function childLogger(escopo: string) {
  return logger.child({ escopo });
}
