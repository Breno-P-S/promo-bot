// Script de diagnóstico TEMPORÁRIO — não faz parte do app normal.
// Rode com: npx ts-node src/collectors/telegram/debug-updates.ts
// e espere uma mensagem real chegar num dos canais grandes.
//
// Objetivo específico desta versão: confirmar se o Telegram está
// mandando "UpdateChannelTooLong" no lugar da mensagem de verdade —
// sinal de que o canal é grande/agitado demais para receber updates
// individuais sem uma sincronização manual (getChannelDifference).
import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions";
import { Raw } from "telegram/events";
import { env } from "../../config/env";

async function main() {
  const apiId = Number(env.TELEGRAM_API_ID);
  const apiHash = env.TELEGRAM_API_HASH;

  if (!env.TELEGRAM_USERBOT_SESSION) {
    console.error("TELEGRAM_USERBOT_SESSION vazio no .env.");
    process.exit(1);
  }

  const client = new TelegramClient(
    new StringSession(env.TELEGRAM_USERBOT_SESSION),
    apiId,
    apiHash,
    { connectionRetries: 5 }
  );

  await client.connect();

  const me = await client.getMe();
  console.log("\n=== Conectado como ===");
  console.log("id:", me.id?.toString());
  console.log("username:", (me as any).username);
  console.log("=======================\n");

  console.log("Sincronizando diálogos (warmup)...");
  const dialogos = await client.getDialogs({});
  console.log(`${dialogos.length} diálogos sincronizados.\n`);

  console.log("Escutando updates... espere uma mensagem real chegar num canal grande.\n");

  client.addEventHandler((update: any) => {
    const nome = update?.className;

    if (nome === "UpdateChannelTooLong") {
      console.log("\n🚨🚨🚨 CONFIRMADO: UpdateChannelTooLong recebido! 🚨🚨🚨");
      console.log("channelId:", update.channelId?.toString());
      console.log("Isso confirma que o Telegram está pulando updates individuais para este canal.\n");
      return;
    }

    if (nome === "UpdateNewChannelMessage" || nome === "UpdateNewMessage") {
      const msg = update.message;
      console.log("\n✅ MENSAGEM REAL CAPTURADA:");
      console.log("texto:", msg?.message?.slice(0, 80));
      console.log("peerId:", JSON.stringify(msg?.peerId));
      console.log();
      return;
    }

    // outros updates (status, digitando, etc.) — só um resumo pra não poluir
    console.log(".", nome);
  }, new Raw({}));

  await new Promise(() => {});
}

main();
