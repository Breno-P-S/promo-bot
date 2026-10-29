-- CreateTable
CREATE TABLE "links_afiliados_mercado_livre" (
    "id" TEXT NOT NULL,
    "codigo_original" TEXT NOT NULL,
    "product_id" TEXT,
    "url_canonica" TEXT,
    "link_gerado" TEXT NOT NULL,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "links_afiliados_mercado_livre_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "links_afiliados_mercado_livre_codigo_original_key" ON "links_afiliados_mercado_livre"("codigo_original");
