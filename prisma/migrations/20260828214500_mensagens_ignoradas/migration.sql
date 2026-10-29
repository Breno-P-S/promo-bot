CREATE TABLE "mensagens_ignoradas" (
    "id" TEXT NOT NULL,
    "plataforma" TEXT NOT NULL DEFAULT 'telegram',
    "grupo_fonte_id" TEXT,
    "identificador_chat" TEXT,
    "id_externo_original" TEXT,
    "conteudo" TEXT,
    "motivo" TEXT NOT NULL,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "mensagens_ignoradas_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "mensagens_ignoradas_criado_em_idx" ON "mensagens_ignoradas"("criado_em");
CREATE UNIQUE INDEX "mensagens_ignoradas_grupo_fonte_id_id_externo_original_motivo_key"
ON "mensagens_ignoradas"("grupo_fonte_id", "id_externo_original", "motivo");

ALTER TABLE "mensagens_ignoradas"
ADD CONSTRAINT "mensagens_ignoradas_grupo_fonte_id_fkey"
FOREIGN KEY ("grupo_fonte_id") REFERENCES "grupos"("id") ON DELETE SET NULL ON UPDATE CASCADE;
