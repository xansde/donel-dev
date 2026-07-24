# Spec — 004 Nomear sessões

**Status:** CLARIFICADA (2026-07-24) — C1..C5 decididas pelo Alexandre; `plan.md`
e `tasks.md` gerados. Aguarda OK dele para implementar (gate de execução).
**Prioridade:** a definir pelo Alexandre (fila atual: 002-quota → 003-modo-dev)
**Origem:** entrevista aberta com o Alexandre em 2026-07-24 (lição
`feedback_entrevistar_uso_antes_de_spec`). Relaciona com B5 do `backlog.md`
(favoritos com sub-itens de sessões), mas é feature independente.

> **Legenda de proveniência:** `[D]` = veio do discovery com o Alexandre (é
> requisito, não inventar além disto). `[T]` = achado técnico no código, com
> `path:linha`. `[C]` = decisão em aberto para o `/clarify`.

## Problema

1. **[D]** O Alexandre usa `/rename` no CLI **constantemente** para dois fins:
   (a) reachar sessões-chave de dias/semanas atrás sem precisar fixá-las (não
   poluir os fixados); (b) no calor do trabalho, bater o olho e saber qual aba
   é qual.
2. **[D]** O Donel **ignora** o `/rename`: a lista da sidebar e a aba de topo
   mostram "ou o nome do projeto, ou o proposto pela IA".
3. **[T]** Sidebar e aba de topo usam o **mesmo campo** `tab.name`
   (`App.tsx:768-771` popula `SidebarSession.name` a partir de `tab.name`;
   aba de topo em `App.tsx:1010-1022` via `<TerminalTab name={tab.name}>`).
   `tab.name` é preenchido em dois caminhos:
   - sessão nova de um projeto → `App.tsx:410` `addTab({ name: project.name })`
     (nome do projeto, literal);
   - sessão reaberta de "Sessões anteriores" → `App.tsx:462/482`
     `name: sessionTabName(session)`, que é só a **primeira mensagem do
     usuário truncada** (`sessionTabName` em `shared/sessions.ts:49-53` sobre
     o `preview` do `SessionIndexer`). **Não existe "nome proposto pela IA"
     de fato** — é a 1ª mensagem literal do usuário.
4. **[T]** O `/rename` do CLI grava no próprio `.jsonl` do transcript o
   registro (schema confirmado inspecionando transcritos reais do donel-dev):
   ```json
   {"type":"custom-title","customTitle":"<nome>","sessionId":"<id>"}
   ```
   Pode aparecer **múltiplas vezes** no arquivo (um por `/rename`) — **o
   último vence**. O `SessionIndexer` (`session-indexer.ts`) lê só `preview` e
   `lastActivity` e **descarta** ativamente esse registro (o comentário
   `session-indexer.ts:16-19` até menciona o `type: custom-title`, mas o
   código nunca lê o payload).
5. **[T]** Não há como renomear pela UI hoje: `tab.name` só vive em memória
   (`useState` em `App.tsx:128`), **sem persistência**, **sem store global**
   (não há zustand/redux/context), **sem IPC de escrita de sessão** (o único
   canal é `SESSION_CHANNELS.list`, read-only, `index.ts:344`). Não existe
   `renameTab`/`setTabName`.

## User stories (todas do discovery)

- **US-A — refletir o `/rename`:** como usuário, quando dou `/rename` numa
  sessão (agora ou no passado), o Donel passa a mostrar **esse nome** na
  sidebar e na aba, no lugar do nome do projeto / 1ª mensagem.
- **US-B — renomear pela UI:** como usuário, consigo renomear **direto na
  interface** — clicando na aba de topo (ou na linha da sidebar) e editando o
  nome ali mesmo — sem precisar digitar `/rename` no terminal.
- **US-C — atualização ao vivo:** como usuário, quando rodo `/rename` **no
  meio da sessão ativa**, a **aba atualiza sozinha**, sem eu ter que reabrir.
- **US-D — convergência:** os dois caminhos (UI e `/rename`) resultam no
  **mesmo nome**; não há dois nomes concorrentes competindo.

## Critérios de aceite

- **CA-1 (reflexo):** ao listar/abrir uma sessão que tem registro
  `custom-title`, o Donel usa o `customTitle` (o último, se houver vários)
  como nome na sidebar e na aba — sobrepondo o nome do projeto e o `preview`.
- **CA-2 (fallback):** sessão **sem** `custom-title` mantém o comportamento
  atual (nome do projeto para sessão nova; `preview` para reaberta). Nada
  regride.
- **CA-3 (rename pela UI):** duplo-clique na aba (ou F2) abre input inline;
  Enter/blur grava, Esc cancela; o label da aba **e** da sidebar atualizam
  imediatamente. Vazio apaga o nome e volta ao fallback (C5).
- **CA-4 (ao vivo):** um `/rename` disparado na sessão viva reflete na
  aba/sidebar em **menos de 1 s**, sem reabrir a sessão nem reiniciar o app
  (C3).
- **CA-5 (convergência):** o nome exibido é resultado de **uma única função
  pura de resolução** por sessão, com precedência por dirty-check (C2): nome
  da UI vence enquanto o `custom-title` não mudar; se mudou, o `/rename` vence
  e o storage é reconciliado. Nunca dois nomes concorrentes.
- **CA-6 (persistência):** para sessões `claude`, o nome sobrevive a
  fechar/reabrir a aba e a reiniciar o app (`ConfigStore`, C1). **Não se
  aplica a abas `shell`**, cujo nome é de memória por decisão (C4).

## Decisões do `/clarify` (2026-07-24, Alexandre)

Todas as cinco fechadas na recomendação. **São requisito agora, não sugestão.**

- **[C1 ✔] Storage próprio do app — a UI NUNCA escreve no `.jsonl`.** Um mapa
  `sessionId → { name, seenTitle, updatedAt }` no `ConfigStore` (escrita
  atômica temp+rename já existente). O `.jsonl` do Claude permanece
  **somente leitura** para o Donel: dele se lê o último `custom-title` para
  atender US-A. Descartadas: escrever no `.jsonl` (invasivo, concorre com o
  CLI escrevendo — risco de linha truncada) e injetar `/rename` no PTY
  (só funcionaria em sessão viva, e o caso de uso principal do Alexandre é
  justamente renomear sessão **antiga** na sidebar).
- **[C2 ✔] Precedência por *dirty-check*, não por timestamp.** Ao renomear
  pela UI, o storage guarda também o `custom-title` que existia naquele
  momento (`seenTitle`, pode ser `null`). Na leitura:
  - `custom-title` atual **igual** ao `seenTitle` → nada novo veio do CLI →
    **vence o nome da UI**;
  - `custom-title` atual **diferente** do `seenTitle` → houve `/rename` depois
    → **vence o CLI** (e o storage é reconciliado: `seenTitle` passa a ser o
    novo título, e a entrada de nome da UI é descartada).

    Determinístico e não depende de timestamp — o registro `custom-title` não
    tem um. Descartado comparar `mtime` do `.jsonl`: qualquer mensagem nova na
    sessão reverteria um rename recém-feito pela UI.
- **[C3 ✔] Reflexo ao vivo por `fs.watch` do `.jsonl`, latência alvo < 1 s.**
  Viável porque o app **já sabe** o `sessionId` de uma sessão viva:
  `src/main/session-correlation.ts` casa o `session_id` dos hooks com o
  `ptyId`. Watch com debounce (~300 ms) relendo só a cauda de 8 KB
  (`readLastActivity` já faz exatamente isso) para pescar o último
  `custom-title`, e push ao renderer por IPC. Descartado o polling no tick de
  5 s (latência de até 5 s numa troca de nome que o usuário acabou de digitar).
- **[C4 ✔] Aba shell é renomeável, só em memória.** Mesmo gesto de edição
  inline; o nome vive no `tab.name` e morre com a aba. Resolve "3 abas
  chamadas *Terminal*" sem inventar chave de persistência para algo que o app
  não restaura no restart (portanto **CA-6 não se aplica a abas shell** —
  ver CA-6).
- **[C5 ✔] Gesto e validação:** duplo-clique na aba (ou **F2** na aba em foco)
  abre input inline. **Enter** confirma, **Esc** cancela, **blur** confirma.
  `trim` automático; máximo **60 caracteres**; quebras de linha viram espaço.
  Salvar **vazio apaga** o nome custom — é a válvula de escape para voltar ao
  fallback (nome do projeto / 1ª mensagem).

## Fora de escopo

- **[D]** Qualquer sinal visual extra na aba além do nome (cor, ícone,
  indicador de estado) — o Alexandre disse explicitamente que **só o nome
  basta**.
- Busca/filtro de sessões por nome; agrupamento de favoritos com sub-itens
  (isso é B5, spec própria).
- Renomear projetos (é outra entidade).
- Auto-geração de nome por LLM (não pedido; hoje nem existe "nome da IA").

## Notas de realidade (não são bug)

- O que hoje parece "nome sugerido pela IA" é a 1ª mensagem do usuário
  truncada a 40 chars, não um resumo gerado — ver `[T]` item 3.
- O `.jsonl` do `/rename` pode ter vários `custom-title`; qualquer leitura
  tem de pegar o **último**, não o primeiro.
- **[T] O app não só sabe o `sessionId` da sessão — ele o IMPÕE no spawn**
  (fato descoberto no clarify, ausente do rascunho, e mais forte do que se
  supunha): `resolveClaudeCorrelation`
  (`src/main/session-correlation.ts:24-34`) anexa `--session-id <uuid>` ao
  argv de toda sessão nova, e reaproveita o id do `-r <id>` quando é retomada.
  O `main` já usa isso em `index.ts:212` e o entrega ao semáforo
  (`registerSession(ptyId, claudeSessionId)`, `session-semaphore-manager.ts:115`).
  Ou seja: o path do `.jsonl` é conhecido **desde antes de o CLI subir** —
  não depende de hook, de parsing de output, nem de heurística. O `fs.watch`
  do C3 é barato e imediato, **sem** janela cega no início da sessão.
- **[T] Gap real a preencher:** o `sessionId` **nunca chega ao renderer** hoje.
  O `SemaphoreUpdate` (`src/shared/index.ts:133-138`) só carrega
  `{ ptyId, state, stateEnteredAt }`, e o `getSnapshot` do semáforo é chamado
  só dentro do `main`. Nenhum canal expõe o id — é por isso que a Fatia 4 do
  plano precisa devolver o `correlationId` ao renderer (custo pequeno: o
  handler `PTY_CHANNELS.create` já o tem em mãos).
