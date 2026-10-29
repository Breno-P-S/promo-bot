import { abrirLoginAmazonInterativo } from "../processor/amazon/navegador-amazon";
import { caminhoPerfilBrowser } from "../browser/chromium";

async function main() {
  console.log("Abrindo o navegador compartilhado de afiliados para a Amazon...");
  console.log(`Perfil persistente compartilhado: ${caminhoPerfilBrowser()}`);
  console.log("Faça login na Amazon com a conta de Associados e confirme que o SiteStripe aparece.");

  await abrirLoginAmazonInterativo();
  console.log("Quando terminar o login, pressione Enter para concluir o comando. O Chromium compartilhado pode permanecer aberto.");

  process.stdin.resume();
  process.stdin.once("data", () => {
    process.exit(0);
  });
}

main().catch((erro) => {
  console.error("Falha ao preparar a sessão da Amazon:", erro instanceof Error ? erro.message : erro);
  process.exit(1);
});
