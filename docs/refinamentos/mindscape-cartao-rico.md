---
tema: mindscape-cartao-rico
data: 2026-11-03
plano: docs/planos/mindscape-openrig.pda.md · item 04
taskdex: []  # sem card: ferramenta pessoal, por decisão do dono
status: fechado
participantes: ["Alexandre Lentz"]
fechado-por: Claude por delegação de Alexandre Lentz, 2026-11-03 ("pode dar início em TUDO")
---

# Refinamento — Cartão rico e estado em três eixos (item 04)

Vem depois do [lugar com papel](mindscape-lugar-papel.md) (12a/12b). Rascunho de um agente anterior,
revisto contra o código de 03/11.

## O que já existia (medido)

| Dado | Fonte | Alcance |
|---|---|---|
| Modelo | statusline do CLI, senão o transcript, senão o alias do launch (`resolveSessionMeter`) | aba viva |
| Provedor | `tab.providerId` + lista de provedores (011) | aba com provedor |
| Contexto e tokens | `resolveSessionMeter` (a mesma conta do rodapé) | aba com leitura |
| Semáforo | `working · waiting · permission · done · error` | aba aberta |
| Início otimista | o semáforo nasce `working` antes de qualquer hook | chute |
| Falha do turno | `StopFailure` com código; o semáforo o fundia em `Stop` | só o main via |
| Tipo de pendência | o chat sabe (`question · permission · plan`); o semáforo só via "tem pendência" | só o chat via |

## Regras fechadas

1. **Selo do motor**: rótulo curto do modelo lido (`opus 5.5`), mais ` · <provedor>` quando a aba usa
   um. Sem leitura de modelo, sem selo (o alias pedido no launch não conta como leitura). Nunca a
   palavra "Claude".
2. **Contexto**: `38% · 152k`, na cor da zona (ok · atenção · passou), mesma conta do rodapé. Sem
   leitura, não aparece (nunca `0%` inventado).
3. **Três eixos, por uma função pura** (`src/shared/mindscape/sessionAxes.ts`):
   - **Processo**: `aberta` · `fechada` (aba fechada, ou o processo saiu: semáforo `done`/`error`).
     "Hibernada" não entra: não existe (B32).
   - **Atividade**: `trabalhando` · `parada` · `desconhecido`. Desconhecido enquanto nenhum hook
     chegou (o `working` do nascimento é chute). Processo fechado e pendência aberta são `parada`.
   - **Retomabilidade**: `viva` (processo aberto) · `retomável` (a conversa está na pasta do projeto,
     onde o `-r` procura) · `sem retomada` (não está) · `desconhecido` (a pasta ainda não foi lida).
4. **"Precisa de você" é contagem + motivo**, nunca estado: `permissão`, `pergunta`, `plano` (pelas
   pendências abertas do chat; sem o tipo, `permissão`), `limite de uso` (último turno terminou em
   `StopFailure rate_limit`), `erro` (outro `StopFailure`, ou o processo saiu com erro). O motivo do
   turno some no próximo pedido ou ferramenta. No cartão: `! 2 · permissão, pergunta`, em vermelho.
5. **Anel em volta do glifo**: precisa de você (vermelho) · trabalhando (azul) · parada (borda) ·
   desconhecido (tracejado, com `?`).
6. **Organizar ganha "parada com pendência"** como primeira coluna (parada + ao menos um motivo).
   Depois: terminou e você não viu · trabalhando · em espera (inclui desconhecido) · fechadas (inclui
   aba aberta com processo encerrado sem pendência). Lugar que ainda não começou vai para "em espera".
7. **"⟳ N em segundo plano"** (PR #164) continua na linha de estado, uma vez só.
8. **O semáforo leva três campos opcionais** ao renderer: `unconfirmed`, `pendingKinds` e
   `turnFailure`. Quem não os lê vê o mesmo de antes.

## Divergência do rascunho

- O rascunho travava o duplo clique no cartão "sem retomada". Ficou liberado: uma sessão aberta em
  worktree grava a conversa sob a worktree, e o rótulo pode dizer "sem retomada" sem ser verdade.
  O `-r` que falha só mostra o aviso do CLI na aba nova. Revisitar quando a lista de sessões souber
  das worktrees.

## Fora

- Hibernar e "fechar o dia" (B32, item 09).
- Contagem agregada de "precisa de você" na barra do quadro (a faixa do A, protótipo 14).
- Selo do motor e contexto no cartão adormecido: não há leitura viva, seria chute.

## Verificação

`npm run typecheck` + `npm test`. Teste novo (`tests/mindscape-session-axes.test.ts`): a derivação dos
três eixos e do "precisa de você", que mentiria calada.
