/**
 * Converte a marcação canônica do painel para a marcação do WhatsApp.
 * O texto, linhas, emojis e ordem são os mesmos enviados ao Telegram.
 * Só os delimitadores visuais mudam:
 *   **negrito** -> *negrito*
 *   ~~riscado~~ -> ~riscado~
 *   _itálico_   -> _itálico_ (já é nativo do WhatsApp)
 */
export function formatarWhatsapp(texto: string): string {
  return texto
    .replace(/\\\*\\\*([^\n]+?)\\\*\\\*/g, "*$1*")
    .replace(/\*\*([^*\n]+?)\*\*/g, "*$1*")
    .replace(/~~([^~\n]+?)~~/g, "~$1~");
}
