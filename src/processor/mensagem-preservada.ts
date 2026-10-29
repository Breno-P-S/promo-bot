export const RODAPE_GRUPOS = "**Entre nos outros grupos:** https://linktr.ee/promocoesdobigode";

function normalizarLinha(linha: string): string {
  return linha.trim().replace(/^[-•\s]+/, "");
}

function ehLinhaRodapeGrupos(linha: string): boolean {
  const l = normalizarLinha(linha);
  return /^(?:\*\*)?Entre nos outros grupos:(?:\*\*)?/i.test(l);
}

function ehLinktreeIsolado(linha: string): boolean {
  const l = normalizarLinha(linha);
  return /^(?:https?:\/\/)?(?:www\.)?linktr\.ee\/[^\s]+\/?$/i.test(l);
}

/**
 * Mantém o corpo da mensagem e garante exatamente UM rodapé oficial.
 * Remove qualquer rodapé antigo/duplicado de "Entre nos outros grupos",
 * independentemente do Linktree usado anteriormente.
 */
export function garantirRodapeObrigatorio(texto: string): string {
  const linhas = String(texto ?? "").replace(/\r\n/g, "\n").split("\n");
  const saida: string[] = [];

  for (let i = 0; i < linhas.length; i += 1) {
    const linha = linhas[i];

    if (ehLinhaRodapeGrupos(linha)) {
      // Se o formato vier em duas linhas:
      // "Entre nos outros grupos:"
      // "https://linktr.ee/..."
      if (i + 1 < linhas.length && ehLinktreeIsolado(linhas[i + 1])) i += 1;
      continue;
    }

    saida.push(linha);
  }

  const corpo = saida.join("\n").trim();
  return corpo ? `${corpo}\n\n${RODAPE_GRUPOS}` : RODAPE_GRUPOS;
}
