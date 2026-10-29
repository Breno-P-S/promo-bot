export type FontePromocao = "MP" | "POBRES" | "URUBU";
export type OrigemDeteccaoFonte = "GRUPO" | "CONTEUDO";

export type ContextoFontePromocao = {
  grupoFonteId?: string | null;
  nomeGrupoFonte?: string | null;
  identificadorExterno?: string | null;
};

export type ResultadoFormatacaoPromocao = {
  texto: string;
  fonte: FontePromocao;
  origemDeteccaoFonte: OrigemDeteccaoFonte;
  produto: string | null;
  precoAntigo: string | null;
  precoAtual: string | null;
  parcelamento: string | null;
  cupom: string | null;
  freteGratis: boolean;
  linkCompra: string | null;
  camposAusentes: string[];
  confianca: number;
  motivosConfianca: string[];
  confiancaProduto: "alta" | "media" | "baixa";
};

type Fonte = FontePromocao;

type LinkRotulado = { url: string; rotulo: string | null };

type DadosExtraidos = {
  fonte: Fonte;
  origemDeteccaoFonte: OrigemDeteccaoFonte;
  titulo: string | null;
  produto: string | null;
  mostrarProdutoSeparado: boolean;
  precoAntigo: string | null;
  precoAtual: string | null;
  parcelamento: string | null;
  cupom: string | null;
  freteGratis: boolean;
  links: LinkRotulado[];
  observacoes: string[];
  condicaoPreco: string | null;
};

const RODAPE_GRUPOS = "**Entre nos outros grupos:** https://linktr.ee/promocoesdobigode";
const RE_VALOR = /\d{1,3}(?:\.\d{3})*,\d{2}/g;
const RE_URL = /https?:\/\/[^\s<>"]+/gi;

function normalizarEntrada(texto: string) {
  return String(texto ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/\u00a0|\u202f/g, " ")
    .replace(/https\\:\/\//gi, "https://")
    .replace(/\[([^\]]*https?:\/\/[^\]]+)\]\((https?:\/\/[^)]+)\)/gi, "$2")
    .replace(/\[(https?:\/\/[^\]]+)\]\((https?:\/\/[^)]+)\)/gi, "$2")
    .trim();
}

function limparMarkdown(valor: string) {
  return String(valor ?? "")
    .replace(/\*\*/g, "")
    .replace(/(?<!\*)\*(?!\*)/g, "")
    .replace(/[_`~]/g, "")
    .replace(/\\([*_`~])/g, "$1")
    .replace(/[ \t]+/g, " ")
    .trim();
}

function limparDecoracaoInicio(valor: string) {
  return limparMarkdown(valor)
    .replace(/^[\p{Extended_Pictographic}\uFE0F\u200D\s]+/gu, "")
    .trim();
}

function limparUrl(url: string) {
  return url.replace(/[),.;!?]+$/g, "");
}

function ehLinkCompra(url: string) {
  const u = limparUrl(url);
  return /^https:\/\/meli\.la\/[A-Za-z0-9_-]+$/i.test(u)
    || /^https:\/\/link\.amazon\/[A-Za-z0-9_-]+$/i.test(u);
}

function extrairLinksRotulados(texto: string): LinkRotulado[] {
  const saida: LinkRotulado[] = [];
  const vistos = new Set<string>();

  for (const linhaOriginal of texto.split(/\r?\n/)) {
    const urls = linhaOriginal.match(RE_URL) ?? [];
    for (const bruto of urls) {
      const url = limparUrl(bruto);
      if (!ehLinkCompra(url) || vistos.has(url)) continue;
      vistos.add(url);

      const pos = linhaOriginal.indexOf(bruto);
      let rotulo = limparMarkdown(linhaOriginal.slice(0, Math.max(0, pos)))
        .replace(/^[\-•·\s]+/, "")
        .replace(/[:\-–—\s]+$/, "")
        .trim();
      if (/^(?:ver agora|compre aqui|link|resgate aqui)$/i.test(rotulo)) rotulo = "";
      saida.push({ url, rotulo: rotulo || null });
    }
  }

  return saida;
}

function linhasSemRodape(texto: string) {
  return texto
    .split(/\r?\n/)
    .map((original) => ({ original: original.trim(), limpa: limparMarkdown(original) }))
    .filter(({ limpa }) => limpa)
    .filter(({ limpa }) => !/^entre nos outros grupos:/i.test(limpa))
    .filter(({ limpa }) => !/^https?:\/\/linktr\.ee\//i.test(limpa));
}

function normalizarNomeGrupoFonte(valor: string | null | undefined) {
  return limparMarkdown(String(valor ?? ""))
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function fontePeloGrupo(contexto?: ContextoFontePromocao): Fonte | null {
  const nome = normalizarNomeGrupoFonte(contexto?.nomeGrupoFonte);
  if (!nome) return null;

  if (/\bclube\s+de\s+ofertas\s+mp\b/.test(nome) || nome === "mp") return "MP";
  if (/\bpromocoes\s+para\s+pobres\b/.test(nome)) return "POBRES";
  if (/\burubu\s+das\s+promocoes\b/.test(nome) || /^urubu\b/.test(nome)) return "URUBU";

  return null;
}

function detectarFonte(texto: string, contexto?: ContextoFontePromocao): {
  fonte: Fonte;
  origem: OrigemDeteccaoFonte;
} {
  // Na captura automática, o grupo real de origem tem prioridade absoluta.
  const peloGrupo = fontePeloGrupo(contexto);
  if (peloGrupo) return { fonte: peloGrupo, origem: "GRUPO" };

  // Fallback para textos formatados sem contexto de grupo.
  if (/^\s*[🥈🥉]/mu.test(texto) || /🎟\s*cupom\s*:/iu.test(texto)) {
    return { fonte: "URUBU", origem: "CONTEUDO" };
  }
  if (/\bVER\s+AGORA\s*👇?/iu.test(texto)) {
    return { fonte: "MP", origem: "CONTEUDO" };
  }
  return { fonte: "POBRES", origem: "CONTEUDO" };
}

function moeda(valor: string | null | undefined) {
  if (!valor) return null;
  const m = valor.match(/\d{1,3}(?:\.\d{3})*,\d{2}/);
  return m ? `R$ ${m[0]}` : null;
}

function numeroBR(valor: string | null) {
  if (!valor) return null;
  const n = Number(valor.replace(/^R\$\s*/i, "").replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function ordenarAntigoAtual(a: string, b: string) {
  const ma = moeda(a)!;
  const mb = moeda(b)!;
  const na = numeroBR(ma)!;
  const nb = numeroBR(mb)!;
  return na >= nb
    ? { precoAntigo: ma, precoAtual: mb }
    : { precoAntigo: mb, precoAtual: ma };
}

function valoresDaLinha(linha: string) {
  return [...linha.matchAll(new RegExp(RE_VALOR.source, "g"))].map((m) => m[0]);
}

function ehLinhaPreco(linha: string) {
  return /\d{1,3}(?:\.\d{3})*,\d{2}/.test(linha)
    && /(?:R\$|\bde\b|\bpor\b|\bpix\b|\bà\s*vista\b|\ba\s*vista\b|\bsem\s*juros\b|\bem\s+at[eé]\b|\b\d{1,2}\s*x\b|➡️|💥|❌)/iu.test(linha);
}

function ehLinhaPagamento(linha: string) {
  return /(?:💳|\bsem\s*juros\b|\bcart[aã]o\b|\bparcelas?\b|\bem\s+at[eé]\s+\d{1,2}\s*x\b|\b\d{1,2}\s*x\b)/iu.test(linha);
}

function normalizarParcelamento(linha: string, precoAtual: string | null) {
  let l = limparMarkdown(linha)
    .replace(/^[💥💳\s]+/u, "")
    .replace(/^(?:ou|pague)\s+/i, "")
    .replace(/[.!]+$/, "")
    .trim();

  if (!l) return null;

  // Se a própria linha contém o preço principal seguido de parcelamento,
  // remove somente o preço principal e mantém a condição.
  if (precoAtual) {
    const atualSemRs = precoAtual.replace(/^R\$\s*/i, "");
    l = l.replace(new RegExp(`^(?:por\\s+)?(?:R\\$\\s*)?${atualSemRs.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*`, "i"), "").trim();
  }

  l = l
    .replace(/^em\s+at[eé]\s+(\d{1,2})\s*x\s+(?:de\s+)?R\$/i, "$1x de R$")
    .replace(/^em\s+at[eé]\s+(\d{1,2})\s*x\b/i, "em até $1x")
    .replace(/^em\s+(\d{1,2})\s*x\b/i, "$1x")
    .replace(/^(\d{1,2})\s*x\s+R\$/i, "$1x de R$")
    .replace(/\s{2,}/g, " ")
    .trim();

  return l || null;
}


function cupomValido(valor: string | null | undefined) {
  if (!valor) return null;
  const v = valor.trim();
  if (/^(?:exclusivo|novo|meli|meli\+|no|na|do|da|de|off)$/i.test(v)) return null;
  return v;
}
function extrairCupom(texto: string) {
  for (const linha of texto.split(/\r?\n/)) {
    const l = limparMarkdown(linha).replace(/^[🎟🏷️💡\s-]+/u, "").trim();

    const codigo = l.match(/\bcupom\s*[:\-]?\s*[`']?([A-Z0-9][A-Z0-9_-]{2,})[`']?/i);
    const codigoValido = cupomValido(codigo?.[1]);
    if (codigoValido) return codigoValido;

    const use = l.match(/\b(?:use|resgate)\s+(?:o\s+)?cupom\s+[`']?([A-Z0-9][A-Z0-9_-]{2,})[`']?/i);
    const useValido = cupomValido(use?.[1]);
    if (useValido) return useValido;

    const desconto = l.match(/\bresgate\s+(?:o\s+)?cupom\s+(?:de\s+)?(.+?)(?:\s+do\s+an[uú]ncio|\s+no\s+an[uú]ncio|$)/i);
    if (desconto?.[1]) return desconto[1].trim();
  }
  return null;
}

function extrairObservacoes(texto: string) {
  const out: string[] = [];
  for (const linha of texto.split(/\r?\n/)) {
    let l = limparMarkdown(linha).replace(/^[💡⚠️\-•·\s]+/u, "").trim();
    if (!l) continue;
    if (/\b(?:compre\s+em\s+recorr[eê]ncia|programe\s+e\s+poupe|quantidade\s+m[ií]n|min(?:imo|ima)?\.?\s+\d+\s*un|compra\s+m[ií]nima\s+\d+)\b/i.test(l)) {
      l = l.replace(/^selecione\s+/i, "Selecione ");
      out.push(l.replace(/[.!]+$/, ""));
    }
  }
  return [...new Set(out)].slice(0, 3);
}

function pareceDescricao(linha: string) {
  const l = limparMarkdown(linha);
  if (!l) return false;
  if (ehLinhaPreco(l) || /https?:\/\//i.test(l)) return false;
  if (/^(?:corre|aproveite|garanta|estoque|n[aã]o\s+perca)/i.test(l)) return true;
  return /[.!?]$/.test(l)
    || /\b(?:transforme|garante|garantem|aproveite|qualidade|conforto|pot[eê]ncia|durabilidade|design|performance|perfeito|perfeita|ideal|economia|resist[eê]ncia|praticidade|tecnologia|imagem|cozinhe|ilumine|banho)\b/i.test(l);
}

function limparPrefixoPromocional(titulo: string) {
  return limparDecoracaoInicio(titulo)
    .replace(/^(?:super\s+)?(?:oferta\s+imperd[ií]vel|ofert[aã]o\s+imperd[ií]vel|ofert[aã]o|queima\s+de\s+estoque|economize\s+agora|descont[aã]o\s+imperd[ií]vel(?:\s+em)?|super\s+desconto(?:\s+em)?|imperd[ií]vel|incr[ií]vel|mega\s+oferta|promo[cç][aã]o)\s*[:\-–—]?\s*/i, "")
    .trim();
}

function ehLinhaAuxiliar(linha: string) {
  return /^(?:-\s*)?(?:loja\s+oficial|use\s+o\s+cupom|resgate\s+o\s+cupom|compre\s+em\s+recorr[eê]ncia|m[ií]nimo|menor\s+valor|exclusivo|cupom\s+exclusivo|quantidade\s+m[ií]n|selecione\s+["']?programe)/i.test(linha)
    || /^🎟\s*cupom/i.test(linha)
    || /^💡/u.test(linha)
    || /^⚠️/u.test(linha);
}

function extrairTituloEProdutoMP(texto: string) {
  const linhas = linhasSemRodape(texto)
    .filter(({ limpa }) => !/^VER\s+AGORA/i.test(limpa))
    .filter(({ limpa }) => !/^https?:\/\//i.test(limpa));

  const primeira = linhas[0]?.limpa ?? null;
  if (!primeira) return { titulo: null, produto: null, mostrarProdutoSeparado: false };

  const titulo = primeira;
  const candidatos = linhas.slice(1).filter(({ limpa }) =>
    !ehLinhaPreco(limpa)
    && !ehLinhaPagamento(limpa)
    && !ehLinhaAuxiliar(limpa)
    && !/\bfrete\s+gr[aá]tis\b/i.test(limpa)
    && !/^(?:corre|aproveite|garanta|estoque|n[aã]o\s+perca)/i.test(limpa)
  );

  const segunda = candidatos[0]?.limpa ?? null;
  if (segunda && !pareceDescricao(segunda)) {
    return { titulo, produto: segunda, mostrarProdutoSeparado: true };
  }

  const produtoDoTitulo = limparPrefixoPromocional(titulo) || titulo;
  return { titulo, produto: produtoDoTitulo, mostrarProdutoSeparado: false };
}

function extrairTituloEProdutoPobres(texto: string) {
  // "Promoções para pobres" costuma organizar a mensagem em blocos:
  //
  // BLOCO 1 = chamada/piada (pode ter 1 ou mais linhas)
  // BLOCO 2 = produto + observações
  // BLOCO 3 = preço/condição
  // depois = link
  //
  // Por isso NÃO podemos assumir que a segunda linha da mensagem é o produto.
  // Exemplo:
  // N SEJA REFÉM DO MIOJO C OVO MEXIDO
  // faz um arrozinho de vez em quando p variar
  //
  // Panela De Arroz Elétrica Midea...
  //
  // Nesse caso a segunda linha ainda pertence à chamada.
  const blocos = texto
    .split(/\n\s*\n+/)
    .map((bloco) =>
      bloco
        .split(/\r?\n/)
        .map((linha) => limparMarkdown(linha).trim())
        .filter(Boolean)
        .filter((linha) => !/^entre nos outros grupos:/i.test(linha))
        .filter((linha) => !/^https?:\/\/linktr\.ee\//i.test(linha)),
    )
    .filter((bloco) => bloco.length > 0);

  const primeiroBloco = blocos[0] ?? [];
  const titulo = primeiroBloco[0] ?? null;

  let produto: string | null = null;

  // O produto normalmente começa no primeiro bloco útil APÓS a chamada.
  // Dentro desse bloco, ignoramos auxiliares, preço e links.
  for (const bloco of blocos.slice(1)) {
    for (const limpa of bloco) {
      if (/^https?:\/\//i.test(limpa)) continue;
      if (ehLinhaAuxiliar(limpa) || ehLinhaPreco(limpa) || ehLinhaPagamento(limpa)) continue;
      if (pareceDescricao(limpa)) continue;
      produto = limpa;
      break;
    }
    if (produto) break;
  }

  // Fallback conservador para mensagens sem linhas em branco.
  // Começa depois de TODO o primeiro bloco, não depois da primeira linha.
  if (!produto) {
    const linhas = linhasSemRodape(texto)
      .filter(({ limpa }) => !/^https?:\/\//i.test(limpa));

    const quantidadePrimeiroBloco = primeiroBloco.length;
    for (const { limpa } of linhas.slice(Math.max(1, quantidadePrimeiroBloco))) {
      if (ehLinhaAuxiliar(limpa) || ehLinhaPreco(limpa) || ehLinhaPagamento(limpa)) continue;
      if (pareceDescricao(limpa)) continue;
      produto = limpa;
      break;
    }
  }

  return { titulo, produto, mostrarProdutoSeparado: Boolean(produto) };
}

function extrairTituloEProdutoUrubu(texto: string) {
  const linhas = linhasSemRodape(texto)
    .filter(({ limpa }) => !/^https?:\/\//i.test(limpa));

  const titulo = linhas[0]?.limpa ?? null;
  if (titulo && /^CUPOM\b/i.test(titulo) && !texto.match(/\d{1,3}(?:\.\d{3})*,\d{2}/)) {
    return { titulo, produto: null, mostrarProdutoSeparado: false };
  }
  let produto: string | null = null;
  for (const { limpa } of linhas.slice(1)) {
    if (ehLinhaAuxiliar(limpa) || ehLinhaPreco(limpa) || ehLinhaPagamento(limpa)) continue;
    if (/^(?:resgate\s+aqui|cupom\s+no\s+ml)/i.test(limpa)) continue;
    produto = limpa;
    break;
  }
  return { titulo, produto, mostrarProdutoSeparado: Boolean(produto) };
}

function extrairPrecosMP(texto: string) {
  const linhas = texto.split(/\r?\n/).map(limparMarkdown).filter(Boolean);
  let precoAntigo: string | null = null;
  let precoAtual: string | null = null;
  let parcelamento: string | null = null;
  let condicaoPreco: string | null = null;

  for (const linha of linhas) {
    const valores = valoresDaLinha(linha);
    if (!valores.length) continue;

    if (valores.length >= 2 && !ehLinhaPagamento(linha)) {
      const par = ordenarAntigoAtual(valores[0], valores[1]);
      precoAntigo = par.precoAntigo;
      precoAtual = par.precoAtual;
      if (/\b(?:à|a)\s*vista\b/i.test(linha)) condicaoPreco = "à vista";
      continue;
    }

    if (valores.length >= 2 && /\b(?:de|pre[cç]o\s+especial\s+de)\b[\s\S]*\bpor\b/i.test(linha)) {
      const par = ordenarAntigoAtual(valores[0], valores[1]);
      precoAntigo = par.precoAntigo;
      precoAtual = par.precoAtual;
      if (/\b(?:à|a)\s*vista\b/i.test(linha)) condicaoPreco = "à vista";
      if (valores[2]) parcelamento = `R$ ${valores[2]} sem juros no cartão`;
      else {
        const px = linha.match(/\b(\d{1,2})\s*x\s+sem\s+juros/i);
        if (px?.[1]) parcelamento = `${px[1]}x sem juros`;
      }
      continue;
    }

    if (valores.length >= 3 && /\bde\b[\s\S]*\bpor\b/i.test(linha)) {
      const par = ordenarAntigoAtual(valores[0], valores[1]);
      precoAntigo = par.precoAntigo;
      precoAtual = par.precoAtual;
      if (/\b(?:à|a)\s*vista\b/i.test(linha)) condicaoPreco = "à vista";
      parcelamento = `R$ ${valores[2]} sem juros no cartão`;
      continue;
    }

    if (ehLinhaPagamento(linha)) {
      // Se há "por PREÇO" na mesma linha, esse primeiro valor ainda é o preço principal.
      const por = linha.match(new RegExp(`\\bpor\\s+(?:R\\$\\s*)?(${RE_VALOR.source})`, "i"));
      if (por?.[1] && !precoAtual) precoAtual = moeda(por[1]);
      parcelamento ??= normalizarParcelamento(linha, precoAtual);
      continue;
    }

    if (!precoAtual) {
      precoAtual = moeda(valores[valores.length - 1]);
      if (/\b(?:à|a)\s*vista\b/i.test(linha)) condicaoPreco = "à vista";
      else if (/\bpix\b/i.test(linha)) condicaoPreco = "no Pix";
    }
  }

  // Linhas com 2 preços e pagamento na mesma linha: "De 631 por 284 à vista ou 355 cartão".
  for (const linha of linhas) {
    const valores = valoresDaLinha(linha);
    if (valores.length >= 2 && /\bde\b[\s\S]*\bpor\b/i.test(linha)) {
      const par = ordenarAntigoAtual(valores[0], valores[1]);
      precoAntigo = par.precoAntigo;
      precoAtual = par.precoAtual;
      if (valores.length >= 3 && /sem\s+juros|cart[aã]o/i.test(linha)) {
        parcelamento = `R$ ${valores[2]} sem juros no cartão`;
      }
      break;
    }
  }

  return { precoAntigo, precoAtual, parcelamento, condicaoPreco };
}

function extrairPrecosPobres(texto: string) {
  const linhas = texto.split(/\r?\n/).map(limparMarkdown).filter(Boolean);
  let precoAtual: string | null = null;
  let parcelamento: string | null = null;
  let condicaoPreco: string | null = null;

  // Pix / à vista têm prioridade como menor preço principal.
  for (const linha of linhas) {
    const valores = valoresDaLinha(linha);
    if (!valores.length) continue;
    if (/(?:pix|à\s*vista|a\s*vista|por\s+un\.?|por\s+cx\.?)/i.test(linha)) {
      precoAtual = moeda(valores[0]);
      if (/pix/i.test(linha)) condicaoPreco = "no Pix";
      else if (/(?:à|a)\s*vista/i.test(linha)) condicaoPreco = "à vista";
      else if (/por\s+un\.?/i.test(linha)) condicaoPreco = "por un.";
      else if (/por\s+cx\.?/i.test(linha)) condicaoPreco = "por cx.";
      break;
    }
  }

  // Se não há Pix/à vista, o preço de uma linha "49,98 em até 2x" é o preço principal.
  if (!precoAtual) {
    for (const linha of linhas) {
      const valores = valoresDaLinha(linha);
      if (!valores.length) continue;
      if (/\bem\s+at[eé]\s+\d{1,2}\s*x\b/i.test(linha)) {
        precoAtual = moeda(valores[0]);
        parcelamento = normalizarParcelamento(linha, precoAtual);
        break;
      }
    }
  }

  // Se existe preço no Pix e outra linha de cartão, preserva o total do cartão.
  if (precoAtual) {
    for (const linha of linhas) {
      const valores = valoresDaLinha(linha);
      if (!valores.length || !ehLinhaPagamento(linha)) continue;
      const candidato = moeda(valores[0]);
      if (candidato !== precoAtual) {
        parcelamento = `${candidato} ${normalizarParcelamento(linha, candidato) ?? ""}`.trim();
        break;
      }
      parcelamento ??= normalizarParcelamento(linha, precoAtual);
    }
  }

  return { precoAntigo: null, precoAtual, parcelamento, condicaoPreco };
}

function extrairPrecosUrubu(texto: string) {
  const linhas = texto.split(/\r?\n/).map(limparMarkdown).filter(Boolean);
  let precoAtual: string | null = null;
  let parcelamento: string | null = null;
  let condicaoPreco: string | null = null;

  for (const linha of linhas) {
    const m = linha.match(/\bpor\s+(?:R\$\s*)?(\d{1,3}(?:\.\d{3})*(?:,\d{2})?)/i);
    if (!m?.[1]) continue;
    const valorNormalizado = /,\d{2}$/.test(m[1]) ? m[1] : `${m[1]},00`;
    precoAtual = moeda(valorNormalizado);
    if (/\bpix\b/i.test(linha)) condicaoPreco = "no Pix";
    else if (/(?:à|a)\s*vista/i.test(linha)) condicaoPreco = "à vista";
    if (ehLinhaPagamento(linha)) parcelamento = normalizarParcelamento(linha, precoAtual);
    break;
  }

  return { precoAntigo: null, precoAtual, parcelamento, condicaoPreco };
}

function montarDados(texto: string, contexto?: ContextoFontePromocao): DadosExtraidos {
  const fonteResolvida = detectarFonte(texto, contexto);
  const fonte = fonteResolvida.fonte;
  const tituloProduto = fonte === "MP"
    ? extrairTituloEProdutoMP(texto)
    : fonte === "URUBU"
      ? extrairTituloEProdutoUrubu(texto)
      : extrairTituloEProdutoPobres(texto);

  const precos = fonte === "MP"
    ? extrairPrecosMP(texto)
    : fonte === "URUBU"
      ? extrairPrecosUrubu(texto)
      : extrairPrecosPobres(texto);

  return {
    fonte,
    origemDeteccaoFonte: fonteResolvida.origem,
    ...tituloProduto,
    ...precos,
    cupom: extrairCupom(texto),
    freteGratis: /\bfrete\s+gr[aá]tis\b/i.test(texto),
    links: extrairLinksRotulados(texto),
    observacoes: extrairObservacoes(texto),
    condicaoPreco: precos.condicaoPreco ?? null,
  };
}

function formatarTitulo(titulo: string | null) {
  if (!titulo) return "🔥 **OFERTA IMPERDÍVEL!**";
  const t = limparMarkdown(titulo).trim();
  return `**${t}**`;
}

function montarTexto(d: DadosExtraidos) {
  const linhas: string[] = [];
  linhas.push(formatarTitulo(d.titulo));

  if (d.mostrarProdutoSeparado && d.produto) {
    linhas.push("");
    linhas.push(`**${limparMarkdown(d.produto)}**`);
  }

  linhas.push("");
  if (d.precoAntigo && d.precoAtual) {
    linhas.push(`❌ ~~${d.precoAntigo}~~ por **${d.precoAtual}**${d.condicaoPreco ? ` ${d.condicaoPreco}` : ""}${d.freteGratis ? " + **FRETE GRÁTIS**" : ""} 💥`);
  } else if (d.precoAtual) {
    linhas.push(`💥 **${d.precoAtual}**${d.condicaoPreco ? ` ${d.condicaoPreco}` : ""}${d.freteGratis ? " + **FRETE GRÁTIS**" : ""}`);
  } else if (d.freteGratis) {
    linhas.push("🚚 **FRETE GRÁTIS**");
  }

  if (d.parcelamento) linhas.push(`💳 ${d.parcelamento}`);
  if (d.cupom) linhas.push(`🏷️ Cupom: **${d.cupom}**`);
  for (const obs of d.observacoes) linhas.push(`ℹ️ ${obs}`);

  linhas.push("");
  linhas.push("🚀 Corre que essa oferta pode acabar!");
  linhas.push("");
  linhas.push("**VER AGORA👇**");

  if (d.links.length <= 1) {
    linhas.push(d.links[0]?.url ?? "LINK NÃO IDENTIFICADO");
  } else {
    for (const link of d.links) {
      linhas.push(link.rotulo ? `${link.rotulo}: ${link.url}` : link.url);
    }
  }

  linhas.push("");
  linhas.push(RODAPE_GRUPOS);
  return linhas.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * Formatador refeito do zero para os 3 grupos-fonte atuais:
 * - CLUBE DE OFERTAS MP
 * - promoções para pobres
 * - Urubu das Promoções
 *
 * Na captura automática, o grupo-fonte real é resolvido ANTES do parser e
 * seleciona diretamente MP, POBRES ou URUBU. A detecção pelo texto existe
 * apenas como fallback para usos sem contexto de grupo.
 */
export function formatarPromocaoAutomaticamente(
  texto: string,
  contexto?: ContextoFontePromocao,
): ResultadoFormatacaoPromocao {
  const normalizado = normalizarEntrada(texto);
  const dados = montarDados(normalizado, contexto);

  const produto = dados.produto;
  const precoAtual = dados.precoAtual;
  const linkCompra = dados.links[0]?.url ?? null;
  const camposAusentes: string[] = [];
  if (!produto) camposAusentes.push("produto");
  if (!precoAtual) camposAusentes.push("precoAtual");
  if (!linkCompra) camposAusentes.push("linkCompra");

  let confianca = 0;
  const motivosConfianca: string[] = [
    `fonte: ${dados.fonte} (${dados.origemDeteccaoFonte === "GRUPO" ? "grupo de origem" : "conteúdo"})`,
  ];
  if (produto) { confianca += 35; motivosConfianca.push("produto identificado pelo padrão da fonte"); }
  else motivosConfianca.push("produto não identificado");
  if (precoAtual) { confianca += 30; motivosConfianca.push("preço atual identificado"); }
  else motivosConfianca.push("preço atual não identificado");
  if (linkCompra) { confianca += 35; motivosConfianca.push("link final de compra válido"); }
  else motivosConfianca.push("link final de compra inválido/ausente");

  const multiplosLinksSemRotulo = dados.links.length > 1 && dados.links.some((l) => !l.rotulo);
  if (multiplosLinksSemRotulo) {
    confianca = Math.max(0, confianca - 20);
    motivosConfianca.push("múltiplos links sem rótulo: revisão manual recomendada");
  }

  return {
    texto: montarTexto(dados),
    fonte: dados.fonte,
    origemDeteccaoFonte: dados.origemDeteccaoFonte,
    produto,
    precoAntigo: dados.precoAntigo,
    precoAtual,
    parcelamento: dados.parcelamento,
    cupom: dados.cupom,
    freteGratis: dados.freteGratis,
    linkCompra,
    camposAusentes,
    confianca,
    motivosConfianca,
    confiancaProduto: produto ? "alta" : "baixa",
  };
}

// Mantida para compatibilidade com testes/imports antigos. O novo formatador
// já ignora links externos ao montar o texto e publica apenas meli.la/link.amazon.
export function removerLinksExternosEChamadas(texto: string) {
  const normalizado = normalizarEntrada(texto);
  return normalizado
    .split(/\r?\n/)
    .filter((linha) => {
      const urls = linha.match(RE_URL) ?? [];
      return !urls.some((url) => !ehLinkCompra(url) && !/linktr\.ee/i.test(url));
    })
    .join("\n")
    .trim();
}
