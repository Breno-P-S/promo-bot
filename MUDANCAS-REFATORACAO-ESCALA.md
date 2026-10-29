# Mudanças da refatoração para escala

## Removido

- documentação de patches antigos e arquivos da integração Gemini, que já não representavam o código atual;
- comentários/referências de IA no painel;
- duplicação de regras de domínio para validar links entre formatador e outros módulos.

As migrations antigas foram preservadas: migration já aplicada é histórico do banco e não deve ser apagada.

## Adicionado

- `domain/promocao.ts`: fonte única para links permitidos e Linktree oficial;
- `processor/triagem-promocao.ts`: filtra lojas não suportadas antes de navegador/painel;
- `processor/deduplicacao-evento.ts`: evita download de mídia e enfileiramento desnecessário no polling;
- `Mensagem.confianca` e `Mensagem.analise`;
- nota de confiança visível na fila de revisão;
- índice de banco por `status + criado_em` para consultas frequentes do painel;
- `WORKER_CONCURRENCY`, `TELEGRAM_POLL_INTERVAL_MS` e `CONFIANCA_MINIMA_SEM_REVISAO` configuráveis;
- jobId determinístico no BullMQ para reduzir jobs duplicados;
- opção de publicar apenas em destinos Telegram específicos, base para roteamento por categoria;
- `.gitignore` seguro.

## Mantido

- conversão Mercado Livre e Amazon;
- Chromium compartilhado;
- painel de revisão e botão de reescrita determinística;
- alerta de link inválido;
- publicação Telegram e réplica WhatsApp;
- mídia local e fallback para texto;
- regras globais/por fonte;
- deduplicação temporal e descarte manual.

## Evolução posterior

A etapa descrita neste arquivo preparou o publicador para categorias. A versão atual já implementa categorias N:N, confiança de categoria e roteamento por destino. Consulte `MUDANCAS-CATEGORIAS-ROTEAMENTO.md` para o estado mais recente.
