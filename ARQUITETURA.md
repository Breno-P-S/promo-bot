# Arquitetura do Promo Bot para escala

## Fluxo principal

```text
Telegram fonte
  -> deduplicação do evento
  -> triagem barata de links suportados
  -> BullMQ
  -> conversão Mercado Livre / Amazon
  -> regras de texto
  -> extração + template determinístico
  -> confiança de extração
  -> classificação N:N de categorias
  -> confiança de categoria
  -> painel/revisão
  -> roteamento categoria -> Telegram destino
  -> réplica para WhatsApp vinculado
```

## Responsabilidades

- `collectors/`: captura e normalização dos eventos.
- `queue/`: concorrência, retry e idempotência de jobs.
- `processor/triagem-promocao.ts`: rejeita cedo o que não é ML/Amazon.
- `processor/formatar-promocao.ts`: extrai produto/preço/cupom/frete/link e gera o padrão fixo.
- `processor/classificar-categorias.ts`: classificador determinístico, multi-categoria e explicável.
- `processor/roteamento-categorias.ts`: decide os destinos, sem misturar essa regra com os publishers.
- `publishers/`: apenas entrega por plataforma.
- `admin/`: operação, revisão, categorias, destinos e métricas.
- `domain/`: regras compartilhadas de negócio.
- `prisma/`: estado persistente e histórico.

## Categorias

Uma mensagem pode ter várias categorias (`MensagemCategoria`). Cada classificação guarda:

- confiança da categoria de 0 a 100;
- se é a categoria principal;
- origem `AUTOMATICA` ou `MANUAL`;
- motivos da classificação.

A confiança de categoria é separada da confiança de extração. Assim, por exemplo, o sistema pode ter 100% de confiança no preço/link e ainda ter dúvida se o produto é `Casa` ou `Mães`.

As palavras-chave, limiar, estado ativo e destinos das categorias são configuráveis no painel. O classificador não depende de IA nem de chamadas externas.

## Roteamento

`CategoriaDestino` liga uma categoria a um ou mais grupos Telegram do tipo `DESTINO`.

- Se ainda não existir nenhum mapeamento de categoria no sistema, o bot mantém o comportamento legado e publica nos destinos Telegram ativos.
- A partir do primeiro mapeamento configurado, o roteamento por categoria passa a valer.
- Se uma mensagem não tiver categoria com destino configurado, a publicação é bloqueada/retida para revisão em vez de ir ao grupo errado.
- WhatsApp continua sendo replicado a partir dos vínculos do Telegram destino já existentes.

## Painel

As abas da fila são dinâmicas e vêm do banco:

- Todas;
- uma aba por categoria ativa;
- Sem categoria;
- Ignoradas.

No card da mensagem é possível revisar texto, ver confiança, corrigir categorias e publicar. No bloco de configuração é possível cadastrar/ativar destinos Telegram e WhatsApp, manter os vínculos Telegram -> WhatsApp, criar categorias, alterar palavras-chave/limiar e selecionar os destinos de cada categoria.

## Métricas iniciais

O dashboard mostra, entre outras coisas:

- fila de revisão;
- mensagens de baixa confiança;
- mensagens sem categoria;
- quantidade de rotas categoria -> destino;
- quantidade de correções manuais de categoria;
- taxa de correção entre as categorias que foram explicitamente revisadas;
- falhas e erros de log.

As correções manuais também são registradas em `logs` (`categoria_manual`), o que cria uma base para medir a taxa de erro e melhorar as regras depois.
