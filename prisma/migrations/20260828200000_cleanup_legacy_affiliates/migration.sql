-- Remove o sistema genérico de Loja/LinkAfiliado, não usado pelo pipeline atual.
DROP TABLE IF EXISTS "links_afiliados";
DROP TABLE IF EXISTS "lojas";

ALTER TABLE "mensagens" DROP COLUMN IF EXISTS "loja_detectada_id";

-- hash_unico já possui índice UNIQUE; este índice adicional era redundante.
DROP INDEX IF EXISTS "mensagens_hash_unico_idx";

-- Identidade do evento e deduplicação de conteúdo são conceitos diferentes.
DROP INDEX IF EXISTS "mensagens_hash_unico_key";
CREATE UNIQUE INDEX IF NOT EXISTS "mensagens_grupo_fonte_id_id_externo_original_key"
  ON "mensagens"("grupo_fonte_id", "id_externo_original");
CREATE INDEX IF NOT EXISTS "mensagens_hash_unico_idx" ON "mensagens"("hash_unico");

ALTER TYPE "StatusMensagem" ADD VALUE IF NOT EXISTS 'PUBLICANDO';
