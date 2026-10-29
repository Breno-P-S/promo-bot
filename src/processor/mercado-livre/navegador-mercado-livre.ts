import { CdpClient, BROWSER_TIMEOUT_EVALUATE_MS, BROWSER_TIMEOUT_PAGE_MS, dormir } from "../../browser/cdp-client";
import { abrirPagina, executarNoBrowser, invalidarBrowserCompartilhado, mostrarJanela, obterBrowserCompartilhado, portaDevToolsAtiva } from "../../browser/chromium";
import { childLogger } from "../../utils/logger";

const log = childLogger("mercado-livre-browser");
const URL_LINK_BUILDER = "https://www.mercadolivre.com.br/afiliados/linkbuilder";
const TIMEOUT_PAGE_MS = BROWSER_TIMEOUT_PAGE_MS;
const TIMEOUT_EVALUATE_MS = BROWSER_TIMEOUT_EVALUATE_MS;

type ResultadoCreateLinkBrowser = { status: number; body: string; urlAtual: string };

export async function criarLinkAfiliadoViaNavegador(
  urlProduto: string,
  tag: string
): Promise<ResultadoCreateLinkBrowser> {
  // Serializa as operações porque todas usam o mesmo perfil/aba do Link Builder.
  // Isso evita corridas quando duas promoções chegam quase ao mesmo tempo.
  return await executarNoBrowser(async (browser) => {
    let cdp: CdpClient | null = null;

    try {
      cdp = await abrirPagina(browser.porta, URL_LINK_BUILDER, "mercadolivre.com.br");
      

      const direto = await tentarCreateLinkDireto(cdp, urlProduto, tag);
      if (direto && respostaCreateLinkTemSucesso(direto)) {
        return direto;
      }

      // Importante: o endpoint pode responder HTTP 200 e, ainda assim,
      // retornar total_success=0/total_error=1. Antes nós devolvíamos essa
      // resposta como se fosse sucesso e o fluxo terminava sem tentar o
      // Link Builder. Agora qualquer resposta sem um short_url válido cai
      // automaticamente para a interface, que reproduz exatamente o fluxo
      // que funciona quando o usuário clica em "Gerar" manualmente.
      if (direto) {
        log.warn(
          {
            status: direto.status,
            diagnostico: resumirFalhaCreateLink(direto.body),
          },
          "createLink direto não gerou link; tentando Link Builder pela interface"
        );
      }

      return await criarLinkPelaInterface(cdp, urlProduto);
    } catch (erro) {
      // Se o navegador compartilhado caiu no meio da operação, invalida o handle
      // para a próxima tentativa iniciar uma instância limpa.
      if (!(await portaDevToolsAtiva(browser.porta))) invalidarBrowserCompartilhado();
      throw erro;
    } finally {
      cdp?.fechar();
      // Não encerramos o navegador aqui. Mantê-lo vivo deixa as próximas
      // conversões muito mais rápidas e evita o ciclo headless -> visível.
    }
  });
}


export type ResultadoResolucaoMercadoLivreBrowser = {
  html: string;
  urlAtual: string;
  urlProdutoPrincipal: string | null;
};

export async function resolverProdutoMercadoLivreViaNavegador(
  urlCurta: string
): Promise<ResultadoResolucaoMercadoLivreBrowser> {
  return await executarNoBrowser(async (browser) => {
    let ultimoErro: unknown = null;

    // Uma navegação por shortlink pode destruir o contexto JavaScript durante
    // os redirects. Reabrir um CDP novo uma vez é mais robusto do que manter
    // uma conexão presa a um execution context que acabou de ser substituído.
    for (let tentativa = 1; tentativa <= 2; tentativa++) {
      let cdp: CdpClient | null = null;

      try {
        cdp = await abrirPagina(browser.porta, urlCurta, "mercadolivre.com.br");

        const estadoInicial = await cdp.avaliar(`({ url: location.href, ready: document.readyState })`);
        const urlInicial = String(estadoInicial?.url || "");

        // Se a sessão não estiver pronta, falhar com uma mensagem útil em vez
        // de esperar o loop de leitura do DOM até estourar o timeout.
        if (/mercadolivre\.com\/(?:jms\/)?mlb\/lgz\/msl\/login|user-recaptcha-social/i.test(urlInicial)) {
          throw new Error(
            `Sessão do Mercado Livre ainda não está autenticada (URL atual: ${urlInicial}). Rode npm run ml:login, conclua login/recaptcha e só então pressione ENTER no terminal.`
          );
        }

        const limite = Date.now() + TIMEOUT_PAGE_MS;
        let ultimo: ResultadoResolucaoMercadoLivreBrowser | null = null;

        while (Date.now() < limite) {
          try {
            const resultado = await cdp.avaliar(`
              (() => {
                const html = document.documentElement?.outerHTML || '';
                const urlAtual = location.href;

                const hrefAbsoluto = (el) => {
                  try { return new URL(el.getAttribute('href') || '', location.href).href; } catch { return ''; }
                };
                const ehProduto = (href) => {
                  try {
                    const u = new URL(href, location.href);
                    const hostValido = u.hostname === 'mercadolivre.com.br' || u.hostname.endsWith('.mercadolivre.com.br');
                    const caminho = u.pathname.toUpperCase();
                    return hostValido && caminho.includes('/P/MLB') && caminho.split('/P/MLB')[1]?.match(/^[0-9]+/);
                  } catch {
                    return false;
                  }
                };
                const links = Array.from(document.querySelectorAll('a[href]'));

                const porTexto = links.find((el) => {
                  const texto = String(el.innerText || el.textContent || '').toLowerCase();
                  const href = hrefAbsoluto(el);
                  const pareceCta = texto.includes('ir para produto') || texto.includes('ir para o produto');
                  return pareceCta && ehProduto(href);
                });

                const porFeatured = links.find((el) => {
                  const href = hrefAbsoluto(el);
                  if (!ehProduto(href)) return false;
                  let atual = el;
                  for (let i = 0; i < 6 && atual; i++, atual = atual.parentElement) {
                    const pista = [
                      atual.id || '',
                      typeof atual.className === 'string' ? atual.className : '',
                      atual.getAttribute?.('data-testid') || '',
                      atual.getAttribute?.('data-component') || ''
                    ].join(' ').toLowerCase();
                    if (pista.includes('featured') || pista.includes('card-featured')) return true;
                  }
                  return false;
                });

                const escolhido = porTexto || porFeatured || null;
                return {
                  html,
                  urlAtual,
                  urlProdutoPrincipal: escolhido ? hrefAbsoluto(escolhido) : null
                };
              })()
            `) as ResultadoResolucaoMercadoLivreBrowser | null;

            if (resultado) {
              ultimo = resultado;
              if (resultado.urlProdutoPrincipal || resultado.html.includes('card-featured')) {
                return resultado;
              }
            }
          } catch (erroLeitura) {
            ultimoErro = erroLeitura;
            // Durante redirects o execution context pode desaparecer. Sai da
            // tentativa atual e reconecta ao target em vez de mascarar o erro.
            break;
          }

          await dormir(250);
        }

        if (ultimo) return ultimo;
      } catch (erro) {
        ultimoErro = erro;
        const mensagem = erro instanceof Error ? erro.message : String(erro);

        // Erros de autenticação/recaptcha não melhoram com retry automático.
        if (/Sessão do Mercado Livre ainda não está autenticada/i.test(mensagem)) {
          throw erro;
        }
      } finally {
        cdp?.fechar();
      }

      if (tentativa < 2) await dormir(500);
    }

    if (!(await portaDevToolsAtiva(browser.porta))) invalidarBrowserCompartilhado();
    const detalhe = ultimoErro instanceof Error ? `: ${ultimoErro.message}` : '';
    throw new Error(`Não foi possível ler o DOM da página do Mercado Livre pelo navegador${detalhe}`);
  });
}


function respostaCreateLinkTemSucesso(resultado: ResultadoCreateLinkBrowser): boolean {
  if (resultado.status < 200 || resultado.status >= 300) return false;

  try {
    const body = JSON.parse(resultado.body);
    const urls = Array.isArray(body?.urls) ? body.urls : [];
    const possuiShortUrl = urls.some((item: any) =>
      typeof item?.short_url === "string" && item.short_url.trim().length > 0
    );

    return body?.total_success > 0 && possuiShortUrl;
  } catch {
    return false;
  }
}

function resumirFalhaCreateLink(bodyTexto: string): unknown {
  try {
    const body = JSON.parse(bodyTexto);
    const primeiro = Array.isArray(body?.urls) ? body.urls[0] : undefined;
    return {
      total_items: body?.total_items,
      total_success: body?.total_success,
      total_error: body?.total_error,
      erro: primeiro?.error ?? primeiro?.message ?? primeiro?.status ?? null,
      origin_url: primeiro?.origin_url ?? null,
    };
  } catch {
    return bodyTexto.slice(0, 500);
  }
}

async function tentarCreateLinkDireto(
  cdp: CdpClient,
  urlProduto: string,
  tag: string
): Promise<ResultadoCreateLinkBrowser | null> {
  const expression = `
    (async () => {
      const csrf = document.querySelector('meta[name="csrf-token"]')?.getAttribute('content');
      const urlAtual = location.href;
      if (!csrf) return { status: 0, body: JSON.stringify({ error: 'csrf-ausente' }), urlAtual };

      const resposta = await fetch('/affiliate-program/api/v2/affiliates/createLink', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'accept': 'application/json, text/plain, */*',
          'content-type': 'application/json',
          'x-csrf-token': csrf
        },
        body: JSON.stringify({ urls: [${JSON.stringify(urlProduto)}], tag: ${JSON.stringify(tag)} })
      });

      return {
        status: resposta.status,
        body: await resposta.text(),
        urlAtual: location.href
      };
    })()
  `;

  const resultado = await cdp.avaliar(expression);
  if (!resultado || typeof resultado.status !== "number") return null;
  return resultado as ResultadoCreateLinkBrowser;
}

async function criarLinkPelaInterface(
  cdp: CdpClient,
  urlProduto: string
): Promise<ResultadoCreateLinkBrowser> {
  // Instala os hooks ANTES de tocar na interface para capturar a requisição
  // createLink independentemente de ela ser feita via fetch ou XHR.
  await cdp.avaliar(`
    (() => {
      window.__mlCreateLinkCapture = null;

      if (!window.__mlCreateLinkHooksInstalled) {
        window.__mlCreateLinkHooksInstalled = true;

        const fetchOriginal = window.fetch.bind(window);
        window.fetch = async (...args) => {
          const resp = await fetchOriginal(...args);
          try {
            const url = String(args[0] && args[0].url ? args[0].url : args[0]);
            if (url.includes('/affiliate-program/api/v2/affiliates/createLink')) {
              const clone = resp.clone();
              window.__mlCreateLinkCapture = {
                status: clone.status,
                body: await clone.text(),
                urlAtual: location.href
              };
            }
          } catch {}
          return resp;
        };

        const XHROpen = XMLHttpRequest.prototype.open;
        const XHRSend = XMLHttpRequest.prototype.send;
        XMLHttpRequest.prototype.open = function(method, url, ...rest) {
          this.__mlUrl = String(url || '');
          return XHROpen.call(this, method, url, ...rest);
        };
        XMLHttpRequest.prototype.send = function(...args) {
          if (String(this.__mlUrl || '').includes('/affiliate-program/api/v2/affiliates/createLink')) {
            this.addEventListener('loadend', () => {
              try {
                window.__mlCreateLinkCapture = {
                  status: this.status,
                  body: this.responseText || '',
                  urlAtual: location.href
                };
              } catch {}
            }, { once: true });
          }
          return XHRSend.apply(this, args);
        };
      }

      return true;
    })()
  `);

  // O Link Builder é renderizado no cliente. readyState=complete não garante que
  // o campo já exista, então esperamos explicitamente até a interface aparecer.
  const limiteCampo = Date.now() + TIMEOUT_PAGE_MS;
  let ultimoDiagnostico: any = null;

  while (Date.now() < limiteCampo) {
    const diagnostico = await cdp.avaliar(`
      (() => {
        const visivel = (el) => {
          if (!el) return false;
          const s = getComputedStyle(el);
          const r = el.getBoundingClientRect();
          return s.display !== 'none' && s.visibility !== 'hidden' && r.width > 0 && r.height > 0;
        };

        // Percorre a arvore inteira, incluindo shadow roots abertos. A versao
        // anterior so entrava no shadowRoot quando o HOST ja era input/textarea/
        // button, o que falha em Web Components como <andes-...>.
        const coletar = (root, saida = [], visitados = new Set()) => {
          if (!root || visitados.has(root)) return saida;
          visitados.add(root);

          try {
            const todos = root.querySelectorAll ? root.querySelectorAll('*') : [];
            for (const el of todos) {
              try {
                if (el.matches?.('input:not([type="hidden"]), textarea, [contenteditable], [role="textbox"], button, [role="button"]')) {
                  saida.push(el);
                }
                if (el.shadowRoot) coletar(el.shadowRoot, saida, visitados);
                if (el.tagName === 'IFRAME') {
                  try {
                    if (el.contentDocument) coletar(el.contentDocument, saida, visitados);
                  } catch {}
                }
              } catch {}
            }
          } catch {}
          return saida;
        };

        const elementos = coletar(document);
        const campos = elementos.filter((el) =>
          visivel(el) && (
            el.matches?.('input:not([type="hidden"]), textarea, [role="textbox"]') ||
            el.hasAttribute?.('contenteditable')
          )
        );

        // DOM real observado no Link Builder em 27/08/2026:
        // <textarea id="url-0" data-andes-textfield-input="true" ...></textarea>
        // Prefere esse seletor exato antes de qualquer heurística.
        const campoExato = (() => {
          const direto = document.querySelector('#url-0, textarea[data-andes-textfield-input="true"]');
          if (direto && visivel(direto)) return direto;
          return campos.find((el) =>
            el.id === 'url-0' || el.getAttribute?.('data-andes-textfield-input') === 'true'
          ) || null;
        })();

        const descrever = (el) => ({
          tag: el.tagName,
          type: el.getAttribute?.('type') || '',
          placeholder: el.getAttribute?.('placeholder') || '',
          aria: el.getAttribute?.('aria-label') || '',
          name: el.getAttribute?.('name') || '',
          role: el.getAttribute?.('role') || ''
        });

        const pontuarCampo = (el) => {
          const texto = [
            el.getAttribute?.('placeholder'),
            el.getAttribute?.('aria-label'),
            el.getAttribute?.('name'),
            el.getAttribute?.('id'),
            el.getAttribute?.('data-testid')
          ].filter(Boolean).join(' ').toLowerCase();

          let score = 0;
          if (texto.includes('link')) score += 6;
          if (texto.includes('url')) score += 6;
          if (texto.includes('cole')) score += 5;
          if (texto.includes('produto')) score += 3;
          if (el.tagName === 'TEXTAREA') score += 2;
          if (el.getAttribute?.('contenteditable') === 'true') score += 1;
          return score;
        };

        const ordenados = campos
          .map((el) => ({ el, score: pontuarCampo(el) }))
          .sort((a, b) => b.score - a.score);
        const campo = campoExato || ordenados[0]?.el || null;

        if (!campo) {
          return {
            ok: false,
            motivo: 'campo-url-nao-encontrado',
            urlAtual: location.href,
            campos: campos.slice(0, 8).map(descrever)
          };
        }

        // Guarda uma referência global para as próximas etapas e foca o campo.
        window.__mlLinkBuilderCampo = campo;
        try { campo.scrollIntoView({ block: 'center', inline: 'nearest' }); } catch {}
        try { campo.focus(); } catch {}

        return {
          ok: true,
          urlAtual: location.href,
          campo: descrever(campo),
          score: ordenados[0]?.score || 0
        };
      })()
    `).catch(() => null);

    ultimoDiagnostico = diagnostico;
    if (diagnostico?.ok) break;
    await dormir(250);
  }

  if (!ultimoDiagnostico?.ok) {
    const pagina = await cdp.avaliar(`(() => ({
      titulo: document.title,
      texto: (document.body?.innerText || '').replace(/\s+/g, ' ').slice(0, 500),
      inputs: document.querySelectorAll('input').length,
      textareas: document.querySelectorAll('textarea').length,
      iframes: document.querySelectorAll('iframe').length,
      shadowHosts: Array.from(document.querySelectorAll('*')).filter(el => !!el.shadowRoot).length
    }))()`).catch(() => null);

    throw new Error(
      `Não foi possível operar o Link Builder automaticamente (campo-url-nao-encontrado; URL atual: ${ultimoDiagnostico?.urlAtual || "desconhecida"}). ` +
      `A interface não expôs um campo de URL após ${Math.round(TIMEOUT_PAGE_MS / 1000)}s. ` +
      `Diagnóstico: ${JSON.stringify(pagina || {})}`
    );
  }

  // Preenche usando o setter nativo + eventos de input/beforeinput. Isso é mais
  // confiável em inputs controlados por React/Andes do que atribuir .value apenas.
  const preenchido = await cdp.avaliar(`
    (() => {
      const campo = window.__mlLinkBuilderCampo;
      if (!campo || !campo.isConnected) return { ok: false, motivo: 'campo-desapareceu' };

      const valor = ${JSON.stringify(urlProduto)};
      try { campo.focus(); } catch {}

      if (campo.getAttribute?.('contenteditable') === 'true') {
        try {
          campo.textContent = '';
          campo.dispatchEvent(new InputEvent('beforeinput', {
            bubbles: true,
            inputType: 'insertText',
            data: valor
          }));
          campo.textContent = valor;
          campo.dispatchEvent(new InputEvent('input', {
            bubbles: true,
            inputType: 'insertText',
            data: valor
          }));
        } catch {
          campo.textContent = valor;
          campo.dispatchEvent(new Event('input', { bubbles: true }));
        }
      } else {
        const proto = campo.tagName === 'TEXTAREA'
          ? HTMLTextAreaElement.prototype
          : HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;

        // Limpa primeiro para gerar a mesma transição que ocorreria ao digitar.
        if (setter) setter.call(campo, '');
        else campo.value = '';
        campo.dispatchEvent(new Event('input', { bubbles: true }));

        if (setter) setter.call(campo, valor);
        else campo.value = valor;

        try {
          campo.dispatchEvent(new InputEvent('beforeinput', {
            bubbles: true,
            inputType: 'insertText',
            data: valor
          }));
          campo.dispatchEvent(new InputEvent('input', {
            bubbles: true,
            inputType: 'insertText',
            data: valor
          }));
        } catch {
          campo.dispatchEvent(new Event('input', { bubbles: true }));
        }
        campo.dispatchEvent(new Event('change', { bubbles: true }));
      }

      return {
        ok: true,
        valorAtual: campo.value ?? campo.textContent ?? ''
      };
    })()
  `);

  if (!preenchido?.ok) {
    throw new Error(`Não foi possível preencher o campo do Link Builder (${preenchido?.motivo || "erro desconhecido"}).`);
  }

  // Agora esperamos o botão "Gerar" realmente ficar habilitado. O site só o
  // libera depois que o estado interno reconhece uma URL válida.
  const limiteBotao = Date.now() + TIMEOUT_PAGE_MS;
  let ultimoBotao: any = null;

  while (Date.now() < limiteBotao) {
    const estadoBotao = await cdp.avaliar(`
      (() => {
        const visivel = (el) => {
          if (!el) return false;
          const s = getComputedStyle(el);
          const r = el.getBoundingClientRect();
          return s.display !== 'none' && s.visibility !== 'hidden' && r.width > 0 && r.height > 0;
        };

        const coletar = (root, saida = [], visitados = new Set()) => {
          if (!root || visitados.has(root)) return saida;
          visitados.add(root);

          try {
            const todos = root.querySelectorAll ? root.querySelectorAll('*') : [];
            for (const el of todos) {
              try {
                if (el.matches?.('button, [role="button"]')) saida.push(el);
                if (el.shadowRoot) coletar(el.shadowRoot, saida, visitados);
                if (el.tagName === 'IFRAME') {
                  try {
                    if (el.contentDocument) coletar(el.contentDocument, saida, visitados);
                  } catch {}
                }
              } catch {}
            }
          } catch {}
          return saida;
        };

        const botoes = coletar(document).filter(visivel);
        // DOM real: button.links-form__button[data-andes-button] contendo "Gerar".
        const botaoExato = document.querySelector('button.links-form__button[data-andes-button="true"]');
        const botao = (botaoExato && visivel(botaoExato) ? botaoExato : null) || botoes.find((el) => {
          const txt = (el.innerText || el.textContent || '').trim().toLowerCase();
          return txt === 'gerar' || txt.includes('gerar link') || txt.startsWith('gerar');
        });

        if (!botao) {
          return { ok: false, motivo: 'botao-gerar-nao-encontrado', urlAtual: location.href };
        }

        const desabilitado = Boolean(
          botao.disabled ||
          botao.hasAttribute?.('disabled') ||
          botao.getAttribute?.('aria-disabled') === 'true' ||
          botao.classList?.contains('andes-button--disabled')
        );

        window.__mlLinkBuilderBotaoGerar = botao;
        return {
          ok: true,
          habilitado: !desabilitado,
          texto: (botao.innerText || botao.textContent || '').trim(),
          urlAtual: location.href
        };
      })()
    `).catch(() => null);

    ultimoBotao = estadoBotao;
    if (estadoBotao?.ok && estadoBotao?.habilitado) break;
    await dormir(250);
  }

  if (!ultimoBotao?.ok) {
    throw new Error(
      `Não foi possível operar o Link Builder automaticamente (${ultimoBotao?.motivo || "botao-gerar-nao-encontrado"}; URL atual: ${ultimoBotao?.urlAtual || "desconhecida"}).`
    );
  }

  if (!ultimoBotao?.habilitado) {
    throw new Error(
      `O campo foi preenchido, mas o botão Gerar continuou desabilitado. O Link Builder não reconheceu a URL do produto como válida.`
    );
  }

  const clicou = await cdp.avaliar(`
    (() => {
      const botao = window.__mlLinkBuilderBotaoGerar;
      if (!botao || !botao.isConnected) return false;
      try { botao.scrollIntoView({ block: 'center', inline: 'nearest' }); } catch {}
      try { botao.focus(); } catch {}
      botao.click();
      return true;
    })()
  `);

  if (!clicou) {
    throw new Error("O botão Gerar foi encontrado, mas não foi possível acioná-lo.");
  }

  const limiteResposta = Date.now() + TIMEOUT_EVALUATE_MS;
  while (Date.now() < limiteResposta) {
    const capturado = await cdp.avaliar(`window.__mlCreateLinkCapture || null`).catch(() => null);
    if (capturado && typeof capturado.status === "number") {
      return capturado as ResultadoCreateLinkBrowser;
    }
    await dormir(250);
  }

  throw new Error(
    "O Link Builder foi preenchido e o botão Gerar foi acionado, mas a requisição createLink não foi capturada. Confirme se a página consegue gerar um link manualmente nesse mesmo perfil."
  );
}



export async function abrirLoginMercadoLivreInterativo(): Promise<void> {
  const browser = await obterBrowserCompartilhado(false);

  // No primeiro login o Mercado Livre pode redirecionar para mercadolivre.com
  // (sem .br), /login/ e até /user-recaptcha-social. Essa navegação faz parte
  // do fluxo normal de autenticação e não deve ser tratada como timeout.
  // Por isso, no modo interativo não exigimos um host final específico.
  const cdp = await abrirPagina(browser.porta, URL_LINK_BUILDER);
  try {
    await mostrarJanela(cdp);
  } finally {
    cdp.fechar();
  }
  // O Chromium é compartilhado e permanece disponível para as integrações.
}
