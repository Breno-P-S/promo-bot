import { Queue, Worker, Job } from "bullmq";
import IORedis from "ioredis";
import { env } from "../config/env";
import { prisma } from "../db/client";
import { MensagemNormalizada } from "../utils/types";
import { processarMensagem } from "../processor/pipeline";
import { publicarNosDestinos } from "../publishers/publicar-nos-destinos";
import { obterRoteamentoMensagem } from "../processor/roteamento-categorias";
import { childLogger } from "../utils/logger";

const log = childLogger("fila-mensagens");

export const conexaoRedis = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });

const NOME_FILA = "mensagens-promocao";

export const filaMensagens = new Queue<MensagemNormalizada>(NOME_FILA, {
  connection: conexaoRedis,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 5000 },
    removeOnComplete: { count: 500 },
    removeOnFail: false,
  },
});

export async function enfileirarMensagem(msg: MensagemNormalizada) {
  const jobId = `tg_${msg.grupoFonteId}_${msg.idExternoOriginal}`.replace(/[^A-Za-z0-9_-]/g, "_");
  await filaMensagens.add("processar", msg, { jobId });
}

export function iniciarWorkerMensagens() {
  const worker = new Worker<MensagemNormalizada>(
    NOME_FILA,
    async (job: Job<MensagemNormalizada>) => {
      const mensagemProcessada = await processarMensagem(job.data);
      if (!mensagemProcessada) return; // somente duplicata real

      // Falha de conversão de afiliado sempre exige decisão humana, mesmo
      // quando a revisão manual global está desligada. Isso evita publicar
      // silenciosamente o link original de outra pessoa.
      if (mensagemProcessada.status === "AGUARDANDO_REVISAO") {
        log.warn({ mensagemId: mensagemProcessada.id }, "mensagem retida no painel por falha de conversão de link");
        return;
      }

      if (env.REVISAO_MANUAL_ATIVA) {
        if (mensagemProcessada.status === "PROCESSADA") {
          await prisma.mensagem.update({
            where: { id: mensagemProcessada.id },
            data: { status: "AGUARDANDO_REVISAO" },
          });
        }
        log.info({ mensagemId: mensagemProcessada.id }, "mensagem aguardando revisão manual no painel");
        return;
      }

      // Se o mesmo job foi retomado após uma falha de publicação, não
      // republica se já houve sucesso no Telegram.
      if (mensagemProcessada.status === "PUBLICADA_TELEGRAM" || mensagemProcessada.status === "PUBLICADA_WHATSAPP") {
        return;
      }

      const roteamento = await obterRoteamentoMensagem(mensagemProcessada.id);
      if (roteamento.modo === "sem-destino") {
        await prisma.mensagem.update({
          where: { id: mensagemProcessada.id },
          data: { status: "AGUARDANDO_REVISAO" },
        });
        log.warn({ mensagemId: mensagemProcessada.id, roteamento }, "mensagem sem destino para a categoria; retida para revisão");
        return;
      }

      const resultado = await publicarNosDestinos(
        mensagemProcessada,
        roteamento.modo === "categorias" ? { destinosTelegramIds: roteamento.destinosTelegramIds } : {}
      );

      if (resultado.telegram.enviados === 0) {
        // Nenhum destino recebeu a mensagem; relança para o BullMQ aplicar
        // attempts/backoff. Como processarMensagem reconhece o mesmo evento,
        // a tentativa seguinte reaproveita o conteúdo já processado.
        throw new Error(
          `Falha de publicação: 0/${resultado.telegram.total} destinos Telegram receberam a mensagem`
        );
      }

      if (resultado.parcial) {
        log.warn({ mensagemId: mensagemProcessada.id, resultado }, "publicação concluída parcialmente");
      }
    },
    { connection: conexaoRedis, concurrency: env.WORKER_CONCURRENCY }
  );

  worker.on("failed", (job, erro) => {
    log.error({ jobId: job?.id, erro: erro.message }, "job falhou após tentativa");
  });

  worker.on("completed", (job) => {
    log.info({ jobId: job.id }, "job concluído");
  });

  return worker;
}
