# Mudanças - categorias, roteamento e painel

## Banco

Adicionados:

- `Categoria`;
- `MensagemCategoria` (N:N, com confiança, principal e origem automática/manual);
- `CategoriaDestino` (N:N entre categoria e destino Telegram);
- enum `OrigemClassificacaoCategoria`.

A migration também cria categorias iniciais: Tecnologia, Pais, Mães, Casa, Moda e Crianças. Elas podem ser alteradas/desativadas no painel.

Também foi corrigida no `schema.prisma` a declaração do índice existente `status + criadoEm DESC`, para não gerar uma migration redundante tentando removê-lo.

## Processamento

Adicionados:

- classificador determinístico multi-categoria;
- confiança separada para classificação;
- retenção para revisão quando nenhuma categoria é encontrada ou quando a categoria fica abaixo do limiar configurado;
- log `classificacao_categoria`;
- reclassificação da fila existente pelo painel.

O classificador usa sinais fortes no nome do produto e sinais secundários no restante da mensagem. Não força uma categoria quando não encontra evidência suficiente.

## Publicação

O roteamento foi ativado de verdade:

- categoria -> um ou mais destinos Telegram;
- Telegram -> WhatsApp continua usando `VinculoDestino`;
- sem nenhum mapeamento configurado: comportamento legado preservado;
- depois que o primeiro mapeamento existir: mensagens sem rota são bloqueadas para evitar publicação no grupo errado.

A publicação automática e a publicação manual usam o mesmo serviço de roteamento.

## Painel

Adicionados:

- abas dinâmicas por categoria;
- aba `Sem categoria`;
- criação de categoria;
- edição de palavras-chave;
- edição do limiar da categoria;
- ativar/desativar categoria;
- cadastro e ativação/desativação de grupos destino Telegram e WhatsApp;
- configuração dos vínculos Telegram -> WhatsApp pelo painel;
- seleção dos destinos Telegram de cada categoria;
- chips de categoria/confiança dentro de cada mensagem;
- correção manual de uma ou várias categorias;
- botão `Reclassificar fila` para mensagens que já existiam antes da migration;
- ações em lote respeitam a aba atual;
- métricas de mensagens sem categoria, rotas configuradas, confirmações/correções manuais e taxa de correção na amostra revisada.

## Segurança operacional

Não foi criada nenhuma dependência de IA. As decisões são reproduzíveis e explicáveis.

A meta de erro de 5%-10% não pode ser garantida apenas por arquitetura. Agora, porém, o sistema registra correções manuais e separa confiança de texto de confiança de categoria, permitindo medir a taxa real e ajustar as regras com dados.

## Operação dos destinos

O painel agora centraliza também o cadastro dos grupos `DESTINO`. Para um destino Telegram, os grupos WhatsApp vinculados podem ser escolhidos por checkbox. A rota de atualização substitui os vínculos de forma idempotente, evitando vínculos duplicados quando o operador salva mais de uma vez.
