# Promo Bot

Central de promoções em TypeScript: Telegram fonte -> triagem -> BullMQ -> conversão de afiliado -> formatação -> classificação -> revisão -> roteamento por categoria -> Telegram/WhatsApp.

## Fluxo

```text
Telegram userbot
  -> deduplicação + triagem barata
  -> BullMQ
  -> Mercado Livre / Amazon
  -> regras por fonte
  -> formatador determinístico
  -> confiança de extração
  -> classificador de categorias
  -> confiança de categoria
  -> painel/revisão
  -> categoria -> destino Telegram
  -> réplica WhatsApp vinculada
```

A triagem aceita hoje Mercado Livre e Amazon. Promoções de outras lojas são registradas em `mensagens_ignoradas` antes do pipeline caro.

## Confiança

Existem duas notas independentes:

- **confiança da promoção**: qualidade da extração de produto, preço e link;
- **confiança de categoria**: força das evidências usadas para classificar a promoção.

Por padrão:

```env
CONFIANCA_MINIMA_SEM_REVISAO=95
CONFIANCA_CATEGORIA_MINIMA=70
```

Com `REVISAO_MANUAL_ATIVA=true`, todas as promoções continuam passando pelo painel.

## Categorias e destinos

O banco começa com categorias de exemplo como Tecnologia, Pais, Mães, Casa, Moda e Crianças. No painel você pode:

- criar novas categorias;
- alterar palavras-chave e limiar;
- ativar/desativar;
- cadastrar/ativar/desativar grupos destino Telegram e WhatsApp;
- vincular cada destino Telegram aos grupos WhatsApp que devem receber a réplica;
- mapear uma categoria para um ou mais destinos Telegram;
- corrigir manualmente a categoria de uma mensagem;
- reclassificar a fila existente.

Uma mensagem pode pertencer a várias categorias. O WhatsApp continua seguindo os vínculos já existentes do destino Telegram.

Enquanto não houver nenhum mapeamento categoria -> destino, o comportamento antigo de publicação é preservado. Depois que você configurar o primeiro mapeamento, mensagens sem rota válida ficam retidas para evitar envio ao grupo errado.

## Atualização

Preserve seu `.env` e `sessions/`. O ZIP não contém credenciais nem sessões.

```bash
npm install
npx prisma format
npx prisma generate
npx prisma migrate dev
npm run build
npm test
npm run dev
```

Depois da migration, use **Reclassificar fila** no painel para categorizar mensagens antigas que ainda estejam aguardando revisão.

## Escala

`WORKER_CONCURRENCY` controla a concorrência do worker e `TELEGRAM_POLL_INTERVAL_MS` controla o polling de segurança. O roteamento fica fora dos publishers, então adicionar novas categorias/destinos não exige duplicar código de Telegram ou WhatsApp.

Veja `ARQUITETURA.md`, `MUDANCAS-REFATORACAO-ESCALA.md` e `MUDANCAS-CATEGORIAS-ROTEAMENTO.md`.
