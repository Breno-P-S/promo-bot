import { ChildProcess, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { env } from "../config/env";
import { BROWSER_TIMEOUT_PAGE_MS, BROWSER_TIMEOUT_START_MS, CdpClient, comTimeout, dormir } from "./cdp-client";

type DevToolsTarget = { type?: string; url?: string; webSocketDebuggerUrl?: string };
export type BrowserHandle = { processo: ChildProcess | null; porta: number; reutilizado: boolean };

let compartilhado: BrowserHandle | null = null;
let fila: Promise<void> = Promise.resolve();
let limpezaRegistrada = false;

export function caminhoPerfilBrowser(): string {
  return resolve(env.BROWSER_PROFILE_PATH);
}

function encontrarChromium(): string | null {
  if (env.BROWSER_EXECUTABLE.trim()) {
    return existsSync(env.BROWSER_EXECUTABLE) ? env.BROWSER_EXECUTABLE : null;
  }

  const candidatos: string[] = [];
  const adicionar = (p?: string) => { if (p) candidatos.push(p); };

  if (process.platform === "win32") {
    const pf = process.env.PROGRAMFILES;
    const pf86 = process.env["PROGRAMFILES(X86)"];
    const local = process.env.LOCALAPPDATA;
    adicionar(local ? join(local, "Chromium/Application/chrome.exe") : undefined);
    adicionar(pf ? join(pf, "Chromium/Application/chrome.exe") : undefined);
    adicionar(pf86 ? join(pf86, "Chromium/Application/chrome.exe") : undefined);
  } else if (process.platform === "darwin") {
    adicionar("/Applications/Chromium.app/Contents/MacOS/Chromium");
  } else {
    adicionar("/usr/bin/chromium");
    adicionar("/usr/bin/chromium-browser");
  }

  return candidatos.find(existsSync) ?? null;
}

export async function executarNoBrowser<T>(fn: (browser: BrowserHandle) => Promise<T>): Promise<T> {
  const anterior = fila;
  let liberar!: () => void;
  fila = new Promise<void>((resolve) => { liberar = resolve; });
  await anterior;
  try {
    const browser = await obterBrowserCompartilhado();
    return await fn(browser);
  } finally {
    liberar();
  }
}

export async function obterBrowserCompartilhado(minimizar = true): Promise<BrowserHandle> {
  if (compartilhado && await portaDevToolsAtiva(compartilhado.porta)) return compartilhado;
  compartilhado = await iniciarOuReutilizarBrowser(minimizar);
  registrarLimpeza();
  return compartilhado;
}

export function invalidarBrowserCompartilhado(): void {
  compartilhado = null;
}

export async function abrirPagina(
  porta: number,
  urlDestino: string,
  hostPreferido?: string
): Promise<CdpClient> {
  const inicio = Date.now();

  while (Date.now() - inicio < BROWSER_TIMEOUT_PAGE_MS) {
    const targets = await obterTargets(porta).catch(() => [] as DevToolsTarget[]);
    const paginas = targets.filter((t) => t.type === "page" && Boolean(t.webSocketDebuggerUrl));
    const pagina =
      (hostPreferido ? paginas.find((t) => (t.url || "").includes(hostPreferido)) : undefined) ||
      paginas[0];

    if (!pagina?.webSocketDebuggerUrl) {
      await dormir(150);
      continue;
    }

    const cdp = await CdpClient.conectar(pagina.webSocketDebuggerUrl);
    try {
      await cdp.chamar("Page.enable").catch(() => undefined);
      const atual = String(await cdp.avaliar("location.href").catch(() => ""));
      if (atual !== urlDestino) await cdp.chamar("Page.navigate", { url: urlDestino });
      await esperarPaginaCarregar(cdp, hostPreferido);
      return cdp;
    } catch (erro) {
      cdp.fechar();
      throw erro;
    }
  }

  throw new Error(`Não foi possível abrir ${urlDestino} no Chromium compartilhado`);
}

export async function mostrarJanela(cdp: CdpClient): Promise<void> {
  const info = await cdp.chamar("Browser.getWindowForTarget").catch(() => null);
  if (!info?.windowId) return;
  await cdp.chamar("Browser.setWindowBounds", {
    windowId: info.windowId,
    bounds: { windowState: "normal" },
  }).catch(() => undefined);
}

export async function portaDevToolsAtiva(porta: number): Promise<boolean> {
  try {
    const resposta = await comTimeout(fetch(`http://127.0.0.1:${porta}/json/version`), 1_500, "Timeout verificando DevTools");
    return resposta.ok;
  } catch {
    return false;
  }
}

async function iniciarOuReutilizarBrowser(minimizar: boolean): Promise<BrowserHandle> {
  const executavel = encontrarChromium();
  if (!executavel) {
    throw new Error(
      "Chromium não encontrado. Configure BROWSER_EXECUTABLE com o caminho do executável chromium/chrome.exe."
    );
  }

  const perfil = caminhoPerfilBrowser();
  await mkdir(perfil, { recursive: true });
  const arquivoPorta = join(perfil, "DevToolsActivePort");

  const portaExistente = await lerPortaDevTools(arquivoPorta);
  if (portaExistente && await portaDevToolsAtiva(portaExistente)) {
    return { processo: null, porta: portaExistente, reutilizado: true };
  }

  await rm(arquivoPorta, { force: true }).catch(() => undefined);

  const args = [
    `--user-data-dir=${perfil}`,
    "--remote-debugging-port=0",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-component-update",
    "about:blank",
  ];
  if (minimizar) args.push("--start-minimized");

  const processo = spawn(executavel, args, { stdio: "ignore", windowsHide: false });
  try {
    const porta = await aguardarPortaDevTools(arquivoPorta, processo);
    const handle: BrowserHandle = { processo, porta, reutilizado: false };
    processo.once("exit", () => {
      // No Windows o launcher pode sair com código 0 enquanto o processo real
      // do Chromium continua ativo. Só invalida o handle se o DevTools também caiu.
      void portaDevToolsAtiva(handle.porta).then((ativa) => {
        if (!ativa && compartilhado === handle) compartilhado = null;
      });
    });
    return handle;
  } catch (erro) {
    encerrarProcesso(processo);
    throw erro;
  }
}

async function lerPortaDevTools(arquivo: string): Promise<number | null> {
  try {
    const conteudo = await readFile(arquivo, "utf8");
    const porta = Number(conteudo.split(/\r?\n/)[0]);
    return Number.isInteger(porta) && porta > 0 ? porta : null;
  } catch {
    return null;
  }
}

async function aguardarPortaDevTools(arquivo: string, processo: ChildProcess): Promise<number> {
  const inicio = Date.now();
  let codigoSaida: number | null = null;

  while (Date.now() - inicio < BROWSER_TIMEOUT_START_MS) {
    const porta = await lerPortaDevTools(arquivo);
    if (porta && await portaDevToolsAtiva(porta)) return porta;

    if (processo.exitCode !== null) {
      codigoSaida = processo.exitCode;
      if (codigoSaida !== 0) {
        throw new Error(`Chromium encerrou antes de iniciar o DevTools (código ${codigoSaida})`);
      }
    }
    await dormir(100);
  }

  if (codigoSaida === 0) {
    throw new Error("O launcher do Chromium encerrou, mas o DevTools não ficou disponível a tempo. Verifique se o perfil já está em uso.");
  }
  throw new Error("Timeout aguardando o Chromium iniciar o DevTools");
}

async function obterTargets(porta: number): Promise<DevToolsTarget[]> {
  const resposta = await fetch(`http://127.0.0.1:${porta}/json/list`);
  if (!resposta.ok) throw new Error(`DevTools respondeu HTTP ${resposta.status}`);
  return await resposta.json() as DevToolsTarget[];
}

async function esperarPaginaCarregar(cdp: CdpClient, hostEsperado?: string): Promise<void> {
  const inicio = Date.now();
  let ultimaUrl = "desconhecida";

  while (Date.now() - inicio < BROWSER_TIMEOUT_PAGE_MS) {
    const estado = await cdp.avaliar(`({ ready: document.readyState, url: location.href })`).catch(() => null);
    if (estado?.url) ultimaUrl = estado.url;

    const carregada = estado?.ready === "complete" || estado?.ready === "interactive";
    let hostOk = !hostEsperado;
    if (hostEsperado && typeof estado?.url === "string") {
      try {
        const host = new URL(estado.url).hostname.toLowerCase();
        const esperado = hostEsperado.toLowerCase();
        hostOk = host === esperado || host.endsWith(`.${esperado}`);
      } catch {}
    }
    if (carregada && hostOk) return;
    await dormir(150);
  }

  throw new Error(`Timeout aguardando página carregar (URL atual: ${ultimaUrl})`);
}

function registrarLimpeza(): void {
  if (limpezaRegistrada) return;
  limpezaRegistrada = true;
  const limpar = () => {
    const atual = compartilhado;
    compartilhado = null;
    if (atual?.processo && !atual.reutilizado) encerrarProcesso(atual.processo);
  };
  process.once("exit", limpar);
  process.once("SIGINT", () => { limpar(); process.exit(0); });
  process.once("SIGTERM", () => { limpar(); process.exit(0); });
}

function encerrarProcesso(processo: ChildProcess): void {
  if (processo.exitCode !== null) return;
  try { processo.kill(); } catch {}
}
