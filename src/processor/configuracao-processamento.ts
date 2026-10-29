import { prisma } from "../db/client";

export type ConfiguracaoProcessamento = {
  reescritaAutomaticaAtiva: boolean;
};

const CHAVE = "processamento";
const PADRAO: ConfiguracaoProcessamento = { reescritaAutomaticaAtiva: true };

let cache: { valor: ConfiguracaoProcessamento; expiraEm: number } | null = null;

function normalizar(valor: unknown): ConfiguracaoProcessamento {
  if (!valor || typeof valor !== "object") return { ...PADRAO };
  const obj = valor as Record<string, unknown>;
  return {
    reescritaAutomaticaAtiva: obj.reescritaAutomaticaAtiva !== false,
  };
}

export async function obterConfiguracaoProcessamento(): Promise<ConfiguracaoProcessamento> {
  if (cache && cache.expiraEm > Date.now()) return cache.valor;

  const registro = await prisma.configuracaoSistema.findUnique({ where: { chave: CHAVE } });
  const valor = normalizar(registro?.valor);
  cache = { valor, expiraEm: Date.now() + 3000 };
  return valor;
}

export async function salvarConfiguracaoProcessamento(
  parcial: Partial<ConfiguracaoProcessamento>
): Promise<ConfiguracaoProcessamento> {
  const atual = await obterConfiguracaoProcessamento();
  const valor: ConfiguracaoProcessamento = {
    ...atual,
    ...parcial,
  };

  await prisma.configuracaoSistema.upsert({
    where: { chave: CHAVE },
    create: { chave: CHAVE, valor: valor as any },
    update: { valor: valor as any },
  });

  cache = { valor, expiraEm: Date.now() + 3000 };
  return valor;
}
