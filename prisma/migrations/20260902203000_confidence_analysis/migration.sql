ALTER TABLE "mensagens"
  ADD COLUMN "confianca" INTEGER,
  ADD COLUMN "analise" JSONB;

ALTER TABLE "mensagens"
  ADD CONSTRAINT "mensagens_confianca_check"
  CHECK ("confianca" IS NULL OR ("confianca" >= 0 AND "confianca" <= 100));

CREATE INDEX "mensagens_status_criado_em_idx" ON "mensagens"("status", "criado_em" DESC);
