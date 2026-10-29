// Estado em memória (não persistido) do processo em execução.
//
// O StatusIntegracao (Prisma) guarda o estado "durável" de cada
// integração (conectado/desconectado), útil para consultar mesmo depois
// de um restart. Este módulo complementa isso com informações de alta
// frequência que não vale a pena gravar no banco a cada evento — por
// exemplo, "o userbot está de fato recebendo mensagens?" e "quantas
// mensagens foram ignoradas e por quê?". É isso que o painel usa para
// diferenciar "conectado mas nada chega" de "conectado e funcionando".

interface EstadoUserbot {
  conectado: boolean;
  ultimaConexaoEm: Date | null;
  erro: string | null;
  totalFontesAtivas: number;
  totalMensagensLidas: number;
  totalMensagensIgnoradas: number;
  ultimaMensagemLidaEm: Date | null;
  ultimaMensagemIgnoradaEm: Date | null;
  ultimoMotivoIgnorada: string | null;
}

interface EstadoBotTelegram {
  conectado: boolean;
  erro: string | null;
  username: string | null;
}

interface EstadoRuntime {
  processoIniciadoEm: Date;
  userbot: EstadoUserbot;
  botTelegram: EstadoBotTelegram;
}

const estado: EstadoRuntime = {
  processoIniciadoEm: new Date(),
  userbot: {
    conectado: false,
    ultimaConexaoEm: null,
    erro: null,
    totalFontesAtivas: 0,
    totalMensagensLidas: 0,
    totalMensagensIgnoradas: 0,
    ultimaMensagemLidaEm: null,
    ultimaMensagemIgnoradaEm: null,
    ultimoMotivoIgnorada: null,
  },
  botTelegram: {
    conectado: false,
    erro: null,
    username: null,
  },
};

export function atualizarUserbot(patch: Partial<EstadoUserbot>) {
  Object.assign(estado.userbot, patch);
}

export function registrarMensagemLida() {
  estado.userbot.totalMensagensLidas += 1;
  estado.userbot.ultimaMensagemLidaEm = new Date();
}

export function registrarMensagemIgnorada(motivo: string) {
  estado.userbot.totalMensagensIgnoradas += 1;
  estado.userbot.ultimaMensagemIgnoradaEm = new Date();
  estado.userbot.ultimoMotivoIgnorada = motivo;
}

export function atualizarBotTelegram(patch: Partial<EstadoBotTelegram>) {
  Object.assign(estado.botTelegram, patch);
}

export function obterEstadoRuntime(): EstadoRuntime {
  return estado;
}
