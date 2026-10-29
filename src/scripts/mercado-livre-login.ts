import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { abrirLoginMercadoLivreInterativo } from "../processor/mercado-livre/navegador-mercado-livre";
import { caminhoPerfilBrowser } from "../browser/chromium";

async function main() {
  console.log("Abrindo o Chromium compartilhado do Promo Bot para o Mercado Livre...");
  console.log(`Perfil persistente: ${caminhoPerfilBrowser()}`);
  console.log("Faça login na sua conta do Mercado Livre e abra o Link Builder se necessário.");

  await abrirLoginMercadoLivreInterativo();
  const rl = createInterface({ input, output });

  try {
    await rl.question("\nQuando estiver logado e enxergando o Link Builder, pressione ENTER aqui para concluir o comando. O Chromium compartilhado pode permanecer aberto. ");
  } finally {
    rl.close();
  }

  console.log("Sessão salva no perfil compartilhado. Agora você pode iniciar o Promo Bot normalmente.");
}

main().catch((erro) => {
  console.error("Falha ao preparar a sessão do Mercado Livre:", erro instanceof Error ? erro.message : erro);
  process.exit(1);
});
