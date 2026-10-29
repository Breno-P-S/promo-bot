/**
 * Converte a marcação canônica salva no banco para HTML do Telegram.
 * O conteúdo textual não muda entre Telegram e WhatsApp; somente a sintaxe
 * visual necessária por cada plataforma é convertida no momento do envio.
 */
export function formatarTextoTelegramHtml(texto: string): string {
  if (!texto) return texto;

  let resultado = texto
    .replace(/\\\*\\\*/g, "**")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  // Links Markdown, caso algum texto editado manualmente use esse formato.
  resultado = resultado.replace(
    /\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g,
    (_match, rotulo: string, url: string) => {
      const hrefSeguro = url.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
      return `<a href="${hrefSeguro}">${rotulo}</a>`;
    }
  );

  // Ordem importante: negrito antes de itálico para não confundir ** com *.
  resultado = resultado.replace(/\*\*([^*\n]+?)\*\*/g, "<b>$1</b>");
  resultado = resultado.replace(/~~([^~\n]+?)~~/g, "<s>$1</s>");
  resultado = resultado.replace(/_([^_\n]+?)_/g, "<i>$1</i>");

  return resultado;
}
