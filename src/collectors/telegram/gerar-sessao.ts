// Rode este script UMA VEZ manualmente (ts-node src/collectors/telegram/gerar-sessao.ts)
// para autenticar sua conta pessoal/dedicada e obter a STRING SESSION.
// Copie o valor impresso para TELEGRAM_USERBOT_SESSION no seu .env.
//
// Isso usa a API de cliente do Telegram (MTProto), necessária porque a
// Bot API não permite "escutar" grupos/canais que você não administra.
import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions";
import * as readline from "readline";
import { env } from "../../config/env";

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const pergunta = (texto: string): Promise<string> =>
  new Promise((resolve) => rl.question(texto, resolve));

async function main() {
  const apiId = Number(env.TELEGRAM_API_ID);
  const apiHash = env.TELEGRAM_API_HASH;

  const client = new TelegramClient(new StringSession(""), apiId, apiHash, {
    connectionRetries: 5,
  });

  await client.start({
    phoneNumber: async () => await pergunta("Número de telefone (com DDI, ex: +5521999999999): "),
    password: async () => await pergunta("Senha de verificação em duas etapas (se houver): "),
    phoneCode: async () => await pergunta("Código recebido no Telegram: "),
    onError: (err) => console.error(err),
  });

  console.log("\n✅ Login realizado com sucesso!");
  console.log("Copie a linha abaixo para TELEGRAM_USERBOT_SESSION no seu .env:\n");
  console.log(client.session.save());

  await client.disconnect();
  rl.close();
}

main();
