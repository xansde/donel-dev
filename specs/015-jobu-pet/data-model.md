# Modelo de dados — 015 (pet do Jobu Donel)

Tudo o que decide vive em `src/shared/pet/` e é puro: recebe sinais e o
relógio, devolve o que a tela mostra. O main só coleta sinais, chama o núcleo e
entrega a vista à janela do pet. A janela do pet só desenha e devolve gestos.

## Entradas do núcleo

### `WatchedSession` — uma aba de sessão do Claude

| Campo | Tipo | Origem |
|---|---|---|
| `ptyId` | `string` | id da aba/PTY |
| `name` | `string` | nome atual da aba |
| `semaphore` | `'idle' \| 'working' \| 'waiting' \| 'permission' \| 'done'` | semáforo da aba; `idle` = registrada e ainda sem nenhum update de hook (R2); `error` chega como `done` |
| `blockedKind` | `'question' \| 'permission' \| 'plan' \| null` | pendência aberta, quando conhecida; `null` com `semaphore = 'permission'` vira `permission` |

Abas de terminal comum nunca entram na lista.

### `FocusSignal`

| Campo | Tipo | Significado |
|---|---|---|
| `activePtyId` | `string \| null` | aba ativa na janela do Donel |
| `donelFocused` | `boolean` | a janela do Donel tem o foco do sistema |

### Eventos avulsos

| Evento | Campos | Quando |
|---|---|---|
| `accountSwitched` | `label`, `at` | troca de conta, pelo painel ou automática |
| `sessionExited` | `ptyId`, `name`, `byUser`, `at` | a PTY saiu; `byUser = true` quando o dono fechou a aba |
| `silence` | `until \| null` | Silenciar por 1 hora / Retomar avisos |
| `tick` | — | relógio do main (1 s); o instante vai à parte, no argumento `now` de `reducePet` |

## Estado interno (`PetState`)

| Campo | Tipo | Regra |
|---|---|---|
| `sessions` | `Map<ptyId, TrackedSession>` | um registro por aba vigiada |
| `bubble` | `Bubble \| null` | o balão em exibição |
| `pendingBurst` | `BubbleEvent[]` | eventos de sessão do último segundo, ainda não publicados |
| `laughUntil` | `number \| null` | fim do riso de fila zerada |
| `sereneSince` | `number \| null` | início do período sereno atual |
| `waffleShown` | `boolean` | o waffle já apareceu neste período sereno |
| `waffleUntil` | `number \| null` | fim do waffle em exibição |
| `silencedUntil` | `number \| null` | fim do silêncio (só em memória) |

### `TrackedSession`

| Campo | Tipo | Regra |
|---|---|---|
| `name`, `semaphore`, `blockedKind` | — | último sinal recebido |
| `waitingSince` | `number \| null` | momento em que entrou em `waiting`/`permission`; `null` fora disso |
| `seen` | `boolean` | vista desde `waitingSince` |

**Transições que importam** (comparando o sinal novo com o anterior da mesma
aba):

| De → para | Efeito |
|---|---|
| qualquer outro estado → `waiting` / `permission` | `waitingSince = now`, `seen = vistaAgora(aba)`; se não vista, evento `finished` ou `blocked` (US2) |
| `waiting` ↔ `permission` | sem evento (R3): a sessão já estava contada, então `waitingSince` e `seen` se mantêm. Um tipo que chega depois (`blockedKind`, por `pendingOpened`) só refina o balão (US2); não conta de novo |
| o mesmo estado outra vez | nada muda (dedupe): nem `waitingSince`, nem `seen` |
| qualquer → `working` / `done` (ou `idle`) | `waitingSince = null`, `seen = false` |
| a aba aparece pela primeira vez já esperando (ex.: o pet foi ligado depois) | `waitingSince = now` e `seen = vistaAgora(aba)`, **sem evento**: ninguém a viu mudar. A idade da espera recomeça no momento em que o núcleo a conhece |
| sai da lista (aba fechada) | registro removido, sem evento |
| `sessionExited` com `byUser = false` | evento `ended` e registro removido (US2) |

`vistaAgora(aba) = focus.donelFocused && focus.activePtyId === aba`. A cada
mudança de foco ou de sinal, toda sessão esperando e vista agora passa a
`seen = true`.

## Entradas do reducer

`reducePet(state, input, now)` é puro e não muta `state`. O instante vem sempre
no 3º argumento. As entradas:

| Entrada | Quando |
|---|---|
| `sessions` | a lista **inteira** das abas vigiadas, a cada mudança de abas ou de sinal do semáforo; o reducer a compara com a anterior (quem sumiu foi fechado) |
| `focus` | a aba ativa mudou ou o Donel ganhou/perdeu o foco |
| `tick` | o relógio de 1 s |
| `resume` | a janela do pet reabriu depois de um tempo sem relógio: riso, waffle, período sereno e balão recomeçam de agora; as esperas (com a idade real) ficam |
| eventos avulsos | `accountSwitched`, `sessionExited`, `pendingOpened`, `silence` (US2, US4 e US5) |

Depois de qualquer entrada, o reducer marca como vistas as esperas que o dono
está olhando, decide o riso e atualiza o período sereno e o waffle.

## Derivados

- **Esperando** = sessões com `waitingSince != null && !seen`.
- **Selo** = `null` se zero; `'1'`…`'9'`; `'9+'` acima de 9.
- **Mais antiga** = `now - min(waitingSince)` entre as esperando.
- **Viva** = sessão fora de `done`.

## Pose (`PoseName`)

Prioridade, da maior para a menor:

1. `bubble.pose`, enquanto houver balão;
2. `laughing`, enquanto `now < laughUntil`;
3. `very-impatient`, se a mais antiga espera há mais de 10 min;
4. `impatient`, se há alguma esperando;
5. `reading`, se alguma está `working`;
6. `waffle` enquanto `now < waffleUntil`, senão `incense`, se há sessão viva;
7. `sleeping`.

Poses lógicas: `neutral`, `talking`, `sleeping`, `skeptical`, `waffle`,
`incense`, `reading`, `mirror`, `laughing`, `sad`, `angry`, `surprised`,
`impatient`, `very-impatient`, `calling`. A arte resolve a pose lógica em
arquivo; enquanto a arte nova não existe, valem as provisórias (FR-029):
`impatient → skeptical`, `very-impatient → angry`, `calling → talking`.
Piscar usa `blink-neutral`/`blink-impatient` se existirem.

**Riso (FR-012):** quando a contagem de esperando cai de ≥ 1 para 0 **por
visita** (não por aba fechada), `laughUntil = now + 2,5 s`.

**Waffle (FR-013):** `sereneSince` marca a entrada na pose `incense`; aos 20
min, se `!waffleShown`, `waffleUntil = now + 8 s` e `waffleShown = true`. Sair
de `incense` zera os dois.

## Balão (`Bubble`)

| Campo | Tipo | Regra |
|---|---|---|
| `id` | `number` | cresce a cada balão novo (a tela usa para o pulinho) |
| `text` | `string` | ver tabela abaixo; nomes de aba com mais de 28 caracteres são cortados com `…` |
| `pose` | `PoseName` | pose de evento |
| `target` | `{ kind: 'session', ptyId } \| { kind: 'list' } \| { kind: 'donel' }` | o que o clique no balão faz |
| `until` | `number` | `now + 6 s` |

| Evento | Texto | Pose | Alvo |
|---|---|---|---|
| `finished` | `<aba> · terminou` | `calling` | a sessão |
| `blocked` (question) | `<aba> · tem uma pergunta` | `surprised` | a sessão |
| `blocked` (permission) | `<aba> · quer permissão` | `surprised` | a sessão |
| `blocked` (plan) | `<aba> · plano para aprovar` | `surprised` | a sessão |
| `ended` | `<aba> · encerrou` | `sad` | a sessão |
| `accountSwitched` | `Conta → <rótulo>` | `mirror` | o Donel |
| ≥ 2 `finished` no mesmo segundo | `N sessões terminaram` | `calling` | a lista |
| ≥ 2 de tipos mistos no mesmo segundo | `N sessões esperando você` | `surprised` | a lista |

Regras:

- Um balão por vez. Evento novo substitui o atual.
- Um evento de sessão que chega **até 1 s depois do nascimento** de um balão de
  sessão se junta a ele. O texto vira o agregado e o `id` não muda, então não há
  segundo pulinho. O `ended` entra na contagem como esperando.
- Um `pendingOpened` da mesma aba nessa janela só **refina o tipo** do evento
  `blocked` (o semáforo vira `permission` antes de o chat dizer se é pergunta ou
  plano).
- Troca de conta nunca se junta a evento de sessão.
- `waiting → permission` não gera evento (R3).
- Com `now < silencedUntil`, nenhum balão nasce, mas o estado segue mudando.

## Vista entregue à janela (`PetView`)

| Campo | Tipo |
|---|---|
| `pose` | `PoseName` (lógica) |
| `badge` | `string \| null` |
| `bubble` | `{ id, text, pose, target } \| null` |
| `waiting` | `{ ptyId, name, waitingLabel }[]`, a mais antiga primeiro (`agora`, `há 1 min`, `há 12 min`, `há 2 h`) |
| `docked` | `boolean` — sentado na borda da barra de tarefas |
| `align` | `'left' \| 'center' \| 'right'` — ancoragem do balão e da lista ao desenho, como um alinhamento CSS: `right` = colados à borda direita do desenho e crescendo para a esquerda (perto da borda direita da tela, o canto padrão); `left` = o espelho; `center` = centrados. Vale a borda mais próxima a até 160 px do ponto da base |
| `silenced` | `boolean` |

## Configuração (`config.json`)

| Chave | Tipo | Default | Notas |
|---|---|---|---|
| `pet.enabled` | `boolean` | `false` | interruptor das Preferências; Esconder grava `false` |
| `pet.placement` | `{ x: number, y: number } \| null` | `null` | a **âncora**: o ponto da base, no centro do desenho, em DIP. Não é o canto da janela: assim ela independe do tamanho (a janela cresce em volta dela, FR-033) e não precisa ser regravada ao redimensionar. `null` = posição padrão |
| `pet.size` | `number` | `140` | altura do desenho em DIP; presets 100 (Pequeno), 140 (Médio), 200 (Grande), 260 (Muito grande); Ctrl + roda em passos de 10, limitado a 80–320 (FR-033) |

**Tamanho e janela:** a janela do pet mede `largura = max(480, 3,4 × size)` ×
`altura = size + 200` DIP. Ao mudar o tamanho, o main recalcula os limites
mantendo o **ponto da base, no centro do desenho** (a âncora, que é também o
`pet.placement`), fixo na tela: ele cresce para cima e para os lados, sem sair
do lugar. O teste de clique usa o alfa do
desenho na escala atual, então o clique acompanha o tamanho.

O silêncio não é gravado (vale para a execução atual — dúvida Q3).

## Posição

- **Padrão:** a borda direita do desenho a 16 px da borda direita da área útil
  da tela principal; a base do desenho na base da área útil (com a barra de
  tarefas embaixo, é o topo dela).
- **`docked`:** a base do desenho está a até 4 px da base da área útil do seu
  monitor e a barra de tarefas está embaixo. Soltar a até 24 px dessa linha
  encaixa nela.
- **Validade:** posição lembrada cujo desenho não tenha ao menos metade da área
  dentro de alguma área útil volta ao padrão (FR-005).
