CREATE TYPE "OrigemClassificacaoCategoria" AS ENUM ('AUTOMATICA', 'MANUAL');

CREATE TABLE "categorias" (
  "id" TEXT NOT NULL,
  "chave" TEXT NOT NULL,
  "nome" TEXT NOT NULL,
  "descricao" TEXT,
  "ativo" BOOLEAN NOT NULL DEFAULT true,
  "prioridade" INTEGER NOT NULL DEFAULT 0,
  "limiar_confianca" INTEGER NOT NULL DEFAULT 60,
  "palavras_chave" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "palavras_exclusao" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "atualizado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "categorias_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "categorias_chave_key" ON "categorias"("chave");

CREATE TABLE "mensagens_categorias" (
  "mensagem_id" TEXT NOT NULL,
  "categoria_id" TEXT NOT NULL,
  "confianca" INTEGER NOT NULL,
  "principal" BOOLEAN NOT NULL DEFAULT false,
  "origem" "OrigemClassificacaoCategoria" NOT NULL DEFAULT 'AUTOMATICA',
  "motivos" JSONB,
  "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "atualizado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "mensagens_categorias_pkey" PRIMARY KEY ("mensagem_id", "categoria_id")
);

CREATE INDEX "mensagens_categorias_categoria_id_confianca_idx" ON "mensagens_categorias"("categoria_id", "confianca");
ALTER TABLE "mensagens_categorias" ADD CONSTRAINT "mensagens_categorias_mensagem_id_fkey" FOREIGN KEY ("mensagem_id") REFERENCES "mensagens"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "mensagens_categorias" ADD CONSTRAINT "mensagens_categorias_categoria_id_fkey" FOREIGN KEY ("categoria_id") REFERENCES "categorias"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "mensagens_categorias" ADD CONSTRAINT "mensagens_categorias_confianca_check" CHECK ("confianca" >= 0 AND "confianca" <= 100);

CREATE TABLE "categorias_destinos" (
  "categoria_id" TEXT NOT NULL,
  "grupo_destino_id" TEXT NOT NULL,
  "ativo" BOOLEAN NOT NULL DEFAULT true,
  "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "categorias_destinos_pkey" PRIMARY KEY ("categoria_id", "grupo_destino_id")
);

CREATE INDEX "categorias_destinos_grupo_destino_id_idx" ON "categorias_destinos"("grupo_destino_id");
ALTER TABLE "categorias_destinos" ADD CONSTRAINT "categorias_destinos_categoria_id_fkey" FOREIGN KEY ("categoria_id") REFERENCES "categorias"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "categorias_destinos" ADD CONSTRAINT "categorias_destinos_grupo_destino_id_fkey" FOREIGN KEY ("grupo_destino_id") REFERENCES "grupos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Categorias iniciais. Podem ser editadas/desativadas no painel sem alterar código.
INSERT INTO "categorias" ("id", "chave", "nome", "descricao", "prioridade", "limiar_confianca", "palavras_chave", "palavras_exclusao") VALUES
  (gen_random_uuid()::text, 'tecnologia', 'Tecnologia', 'Eletrônicos, informática, celulares, games e acessórios', 100, 55, ARRAY['notebook','laptop','computador','pc gamer','monitor','teclado','mouse','ssd','hd externo','memória ram','ram','processador','placa de vídeo','gpu','celular','smartphone','iphone','galaxy','tablet','smartwatch','fone','headset','caixa de som','roteador','wifi','wi-fi','impressora','console','playstation','xbox','nintendo','controle gamer','carregador','power bank','câmera','camera'], ARRAY[]::TEXT[]),
  (gen_random_uuid()::text, 'pais', 'Pais', 'Itens com forte afinidade ao grupo de promoções para pais', 70, 60, ARRAY['furadeira','parafusadeira','chave de impacto','maleta de ferramentas','jogo de ferramentas','caixa de ferramentas','compressor','lavadora de alta pressão','churrasqueira','kit churrasco','faca churrasco','máquina de cortar cabelo','maquina de cortar cabelo','barbeador','aparador de barba','carro','automotivo','pneu','capacete','moto','pesca','vara de pesca'], ARRAY[]::TEXT[]),
  (gen_random_uuid()::text, 'maes', 'Mães', 'Itens com forte afinidade ao grupo de promoções para mães', 70, 60, ARRAY['secador','chapinha','modelador de cachos','escova secadora','escova rotativa','aspirador','robô aspirador','robo aspirador','organizador','kit organizador','panela','jogo de panelas','air fryer','cafeteira','liquidificador','batedeira','mixer','perfume feminino','bolsa feminina'], ARRAY[]::TEXT[]),
  (gen_random_uuid()::text, 'casa', 'Casa', 'Casa, cozinha, organização, decoração e eletrodomésticos', 60, 55, ARRAY['panela','jogo de panelas','air fryer','cafeteira','liquidificador','batedeira','mixer','micro-ondas','microondas','geladeira','freezer','fogão','fogao','cooktop','aspirador','robô aspirador','robo aspirador','ventilador','ar condicionado','cama','colchão','colchao','travesseiro','toalha','lençol','lencol','organizador','prateleira','estante','mesa','cadeira','sofá','sofa','luminária','luminaria'], ARRAY[]::TEXT[]),
  (gen_random_uuid()::text, 'moda', 'Moda', 'Roupas, calçados e acessórios', 50, 55, ARRAY['camiseta','camisa','short','shorts','bermuda','calça','calca','vestido','blusa','jaqueta','moletom','tênis','tenis','sapato','chinelo','sandália','sandalia','boné','bone','bolsa','mochila','cueca','meia','relógio','relogio'], ARRAY[]::TEXT[]),
  (gen_random_uuid()::text, 'criancas', 'Crianças', 'Brinquedos, infantil e itens para crianças', 55, 60, ARRAY['brinquedo','lego','boneca','carrinho infantil','bebê','bebe','fralda','mamadeira','chupeta','cadeirinha','berço','berco','infantil','criança','crianca','kids'], ARRAY[]::TEXT[])
ON CONFLICT ("chave") DO NOTHING;
