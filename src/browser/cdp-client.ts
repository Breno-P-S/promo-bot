import WebSocket from "ws";

export const BROWSER_TIMEOUT_START_MS = 15_000;
export const BROWSER_TIMEOUT_PAGE_MS = 20_000;
export const BROWSER_TIMEOUT_EVALUATE_MS = 20_000;

export class CdpClient {
  private seq = 0;
  private readonly pendentes = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();

  private constructor(private readonly ws: any) {
    ws.on("message", (raw: any) => {
      try {
        const msg = JSON.parse(String(raw));
        if (!msg.id) return;
        const pendente = this.pendentes.get(msg.id);
        if (!pendente) return;
        this.pendentes.delete(msg.id);
        if (msg.error) pendente.reject(new Error(msg.error.message || "Erro CDP"));
        else pendente.resolve(msg.result);
      } catch {
        // Eventos CDP sem id não pertencem a chamadas pendentes.
      }
    });

    ws.on("close", () => {
      for (const [, pendente] of this.pendentes) {
        pendente.reject(new Error("Conexão CDP encerrada"));
      }
      this.pendentes.clear();
    });
  }

  static async conectar(url: string): Promise<CdpClient> {
    return await new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      const timer = setTimeout(() => {
        try { ws.close(); } catch {}
        reject(new Error("Timeout ao conectar ao Chromium via CDP"));
      }, BROWSER_TIMEOUT_START_MS);

      ws.once("open", () => {
        clearTimeout(timer);
        resolve(new CdpClient(ws));
      });
      ws.once("error", (erro: Error) => {
        clearTimeout(timer);
        reject(erro);
      });
    });
  }

  async chamar(method: string, params: Record<string, unknown> = {}): Promise<any> {
    const id = ++this.seq;
    return await new Promise((resolve, reject) => {
      this.pendentes.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }), (erro?: Error) => {
        if (!erro) return;
        this.pendentes.delete(id);
        reject(erro);
      });
    });
  }

  async avaliar(expression: string): Promise<any> {
    const resultado = await comTimeout(
      this.chamar("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }),
      BROWSER_TIMEOUT_EVALUATE_MS,
      "Timeout ao executar JavaScript no Chromium"
    );

    if (resultado?.exceptionDetails) {
      throw new Error(
        resultado.exceptionDetails?.exception?.description ||
          resultado.exceptionDetails?.text ||
          "Erro ao executar JavaScript no Chromium"
      );
    }
    return resultado?.result?.value;
  }

  fechar(): void {
    try { this.ws.close(); } catch {}
  }
}

export async function comTimeout<T>(promise: Promise<T>, ms: number, mensagem: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(mensagem)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function dormir(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
