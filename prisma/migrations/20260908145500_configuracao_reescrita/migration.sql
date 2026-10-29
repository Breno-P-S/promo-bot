CREATE TABLE "configuracoes_sistema" (
  "chave" TEXT NOT NULL,
  "valor" JSONB NOT NULL,
  "atualizado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "configuracoes_sistema_pkey" PRIMARY KEY ("chave")
);

INSERT INTO "configuracoes_sistema" ("chave", "valor")
VALUES ('processamento', '{"reescritaAutomaticaAtiva": true}'::jsonb)
ON CONFLICT ("chave") DO NOTHING;
