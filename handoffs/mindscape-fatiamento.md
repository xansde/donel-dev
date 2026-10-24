# Handoff — /fatiamento do Mindscape (V1)

- **Data**: 2026-10-24
- **Branch**: `feature/mindscape` (checkout principal, sem worktree)
- **Skill**: `esteira:fatiamento` 1.18.0, modo esteira
- **Entrada**: `docs/design/mindscape.md` (`status: aprovado`, check mecânico ok) +
  `docs/versoes/mindscape.md` (V1 é a versão corrente; V2 e V3 são hipóteses e não foram fatiadas)
- **TaskDex**: `taskdex: []` herdado do design. Sem card: ferramenta pessoal, esta execução não
  conta na adoção.
- **Saída**: `BACKLOG.md` na raiz, criado agora (não existia; nada a varrer para
  `docs/backlog-archive/`, nenhum worktree órfão).

## Corte

| # | Fatia | Histórias / regras | Depende de |
|---|---|---|---|
| 01 | Modo Mindscape com post-its de sessão vivos, por projeto | H1, H6; regras 7, 8, 9, 11 | — |
| 02 | Destaque da sessão e "Ir ao terminal" | H2, H7; regras 3, 4, 10 | 01 |
| 03 | Post-it escrito pela sessão a cada fim de turno | H3; regras 1, 2, 11 | 01 |
| 04 | Canvas livre: arrastar, mover a visão e post-its do dono | H4; regras 6, 7 | 01 |
| 05 | Ligações com seta, em traço à mão | H5; regra 5; ADR 0004 | 04 |

Os 8 passos do caminho feliz da V1 ficam cobertos: passos 1, 2 (sessões), 7 e 8 pela 01; passo 2
(post-it escrito) e 3 pela 03; passo 3 (destaque), 5 e 6 pela 02; passo 4 pela 04 + 05.

- **Persistência** (regra 7) não virou fatia própria: o store nasce na 01 com o quadro e as
  posições de grade, e cada fatia seguinte prova a persistência do que acrescenta (o smoke de cada
  uma relança o app). Assim nenhuma fatia é "setup do banco".
- **roughjs** entra só na 05: a 01 desenha o cartão em CSS com os tokens do `PostItCard`; o
  contorno à mão e as ligações chegam juntos. Decidido por delegação do dono, 2026-10-23: é o
  corte mais simples que respeita o ADR 0004 sem instalar dependência antes de usá-la.
- **Conflita com**: as 5 fatias pisam em `src/shared/mindscape/model.ts` e nos componentes de
  `src/renderer/src/Mindscape/`; todas declaradas em conflito par a par. Rodadas previstas:
  `01 | 02 | 03 | 04 | 05` (serial), o que casa com a instrução de trabalho sequencial.
- **Ordem**: 02 antes de 03 porque destaque e "ir ao terminal" são só renderer e dão feedback
  visual rápido (o dono quer ver resultado); 03 mexe no main (semáforo, transcript, IPC push).
  Decidido por delegação do dono, 2026-10-23.

## Gate

- Gatilhos: 1 (complexidade herdada) não, design `complexidade: —`, self-assessment `apto`;
  2 (volume) não, 5 fatias; 3 (dependências encadeadas) **sim**, 02..05 dependem de 01 e 05 de
  04; 4 (corte imperfeito) não, as 5 passam nos 4 critérios.
- Gate disparado pelo gatilho 3, aprovado por delegação: "aprovado por Claude por delegação de
  Alexandre Lentz em 2026-10-24". Por quê: a delegação de 2026-10-23 cobre os gates da esteira, e
  a ordem segue o caminho feliz da V1.

## Riscos que a /implementacao herda (do design)

- `last_assistant_message` é opcional e o payload do `StopFailure` não foi medido: a 03 tem o
  fallback da cauda do `.jsonl` e um roteiro do falso sem o campo para provar.
- `/clear` troca o id da sessão e deixa o post-it antigo órfão (aceito na V1; o dono arquiva).
- `App.tsx` tem 2.781 linhas: 01 e 02 mexem nele; manter a mudança no mínimo (`appMode`, hook,
  `seenAt`).
- Desempenho com muitas sessões não medido.

## Não verificado

- Que o claude falso (`tests/smoke/fixtures/fake-claude-chat`) aceita mandar campos extras no
  payload do `Stop` sem mudança: o roteiro padrão só tem `{ type: 'hook', event: 'Stop' }`. A 03
  inclui estender o falso, se preciso.

## Próxima etapa

`/implementacao` sobre `BACKLOG.md`, começando pela 01.
