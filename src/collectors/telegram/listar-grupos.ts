// Rode este script (npx ts-node src/collectors/telegram/listar-grupos.ts)
// sempre que precisar descobrir o chat_id de um grupo/canal para cadastrar
// como fonte ou destino no painel admin. Usa a mesma sessão do userbot já
// configurada no .env — não pede login de novo.
import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions";
import { env } from "../../config/env";

async function main() {
  const apiId = Number(env.TELEGRAM_API_ID);
  const apiHash = env.TELEGRAM_API_HASH;

  if (!env.TELEGRAM_USERBOT_SESSION) {
    console.error("TELEGRAM_USERBOT_SESSION vazio no .env. Rode gerar-sessao.ts primeiro.");
    process.exit(1);
  }

  const client = new TelegramClient(
    new StringSession(env.TELEGRAM_USERBOT_SESSION),
    apiId,
    apiHash,
    { connectionRetries: 5 }
  );

  await client.connect();

  const dialogs = await client.getDialogs({});

  console.log("\n=== Grupos e canais encontrados ===\n");
  for (const dialog of dialogs) {
    if (dialog.isGroup || dialog.isChannel) {
      console.log(`Nome: ${dialog.title}`);
      console.log(`chat_id: ${dialog.id?.toString()}`);
      console.log(`tipo: ${dialog.isChannel ? "canal" : "grupo"}`);
      console.log("---");
    }
  }

  await client.disconnect();
  process.exit(0);
}

main();