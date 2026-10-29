-- CreateEnum
CREATE TYPE "TipoGrupo" AS ENUM ('FONTE', 'DESTINO');

-- CreateEnum
CREATE TYPE "TipoRegra" AS ENUM ('REMOVER_TEXTO', 'ADICIONAR_TEXTO', 'REMOVER_LINK', 'ASSINATURA', 'SUBSTITUIR_TEXTO');

-- CreateEnum
CREATE TYPE "StatusMensagem" AS ENUM ('RECEBIDA', 'PROCESSANDO', 'PROCESSADA', 'PUBLICADA_TELEGRAM', 'PUBLICADA_WHATSAPP', 'FALHOU', 'DESCARTADA_DUPLICADA');

-- CreateEnum
CREATE TYPE "StatusLog" AS ENUM ('OK', 'ERRO');

-- CreateTable
CREATE TABLE "admins" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "senha_hash" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admins_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plataformas" (
    "id" TEXT NOT NULL,
    "chave" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "plataformas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "grupos" (
    "id" TEXT NOT NULL,
    "plataforma_id" TEXT NOT NULL,
    "tipo" "TipoGrupo" NOT NULL,
    "identificador_externo" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "grupos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vinculos_destino" (
    "id" TEXT NOT NULL,
    "origem_id" TEXT NOT NULL,
    "destino_id" TEXT NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "vinculos_destino_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lojas" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "dominios" TEXT[],
    "ativo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "lojas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "links_afiliados" (
    "id" TEXT NOT NULL,
    "loja_id" TEXT NOT NULL,
    "parametro" TEXT NOT NULL,
    "modo_aplicacao" TEXT NOT NULL DEFAULT 'query_param',
    "template_url" TEXT,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "links_afiliados_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "regras" (
    "id" TEXT NOT NULL,
    "grupo_fonte_id" TEXT,
    "tipo" "TipoRegra" NOT NULL,
    "padrao" TEXT NOT NULL,
    "valor" TEXT,
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "regras_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mensagens" (
    "id" TEXT NOT NULL,
    "grupo_fonte_id" TEXT NOT NULL,
    "hash_unico" TEXT NOT NULL,
    "id_externo_original" TEXT NOT NULL,
    "conteudo_original" TEXT NOT NULL,
    "conteudo_processado" TEXT,
    "midias" JSONB,
    "loja_detectada_id" TEXT,
    "status" "StatusMensagem" NOT NULL DEFAULT 'RECEBIDA',
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mensagens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "logs" (
    "id" TEXT NOT NULL,
    "mensagem_id" TEXT NOT NULL,
    "etapa" TEXT NOT NULL,
    "status" "StatusLog" NOT NULL,
    "detalhe" TEXT,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "status_integracoes" (
    "id" TEXT NOT NULL,
    "servico" TEXT NOT NULL,
    "conectado" BOOLEAN NOT NULL DEFAULT false,
    "ultima_checagem" TIMESTAMP(3) NOT NULL,
    "detalhe" TEXT,

    CONSTRAINT "status_integracoes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "admins_email_key" ON "admins"("email");

-- CreateIndex
CREATE UNIQUE INDEX "plataformas_chave_key" ON "plataformas"("chave");

-- CreateIndex
CREATE UNIQUE INDEX "grupos_plataforma_id_identificador_externo_key" ON "grupos"("plataforma_id", "identificador_externo");

-- CreateIndex
CREATE UNIQUE INDEX "vinculos_destino_origem_id_destino_id_key" ON "vinculos_destino"("origem_id", "destino_id");

-- CreateIndex
CREATE UNIQUE INDEX "mensagens_hash_unico_key" ON "mensagens"("hash_unico");

-- CreateIndex
CREATE INDEX "mensagens_hash_unico_idx" ON "mensagens"("hash_unico");

-- CreateIndex
CREATE UNIQUE INDEX "status_integracoes_servico_key" ON "status_integracoes"("servico");

-- AddForeignKey
ALTER TABLE "grupos" ADD CONSTRAINT "grupos_plataforma_id_fkey" FOREIGN KEY ("plataforma_id") REFERENCES "plataformas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vinculos_destino" ADD CONSTRAINT "vinculos_destino_origem_id_fkey" FOREIGN KEY ("origem_id") REFERENCES "grupos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vinculos_destino" ADD CONSTRAINT "vinculos_destino_destino_id_fkey" FOREIGN KEY ("destino_id") REFERENCES "grupos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "links_afiliados" ADD CONSTRAINT "links_afiliados_loja_id_fkey" FOREIGN KEY ("loja_id") REFERENCES "lojas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "regras" ADD CONSTRAINT "regras_grupo_fonte_id_fkey" FOREIGN KEY ("grupo_fonte_id") REFERENCES "grupos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mensagens" ADD CONSTRAINT "mensagens_grupo_fonte_id_fkey" FOREIGN KEY ("grupo_fonte_id") REFERENCES "grupos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "logs" ADD CONSTRAINT "logs_mensagem_id_fkey" FOREIGN KEY ("mensagem_id") REFERENCES "mensagens"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
