# Spec — 004 Nomear sessões

**Status:** rascunho pós-discovery (aguarda `/clarify` → `/plan`)
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
- **CA-3 (rename pela UI):** existe um gesto de edição inline na aba (e/ou na
  linha da sidebar) que grava o novo nome e atualiza o label imediatamente.
- **CA-4 (ao vivo):** um `/rename` disparado na sessão **em foco** reflete na
  aba/sidebar sem reabrir a sessão nem reiniciar o app (janela de atraso
  aceitável a definir no clarify — ver C3).
- **CA-5 (convergência):** o nome definido pela UI e o definido por `/rename`
  não divergem — há uma **única fonte de verdade** por sessão e uma regra de
  precedência determinística (ver C1/C2).
- **CA-6 (persistência):** o nome sobrevive a fechar/reabrir a aba e a
  reiniciar o app (hoje `tab.name` é só memória — precisa persistir).

## Decisões para o `/clarify`

- **[C1] Onde a UI grava o nome (decisão central):**
  - **Opção A — escrever no `.jsonl`:** a UI faz *append* de um registro
    `custom-title` no mesmo arquivo que o CLI usa. Prós: convergência
    automática (mesma fonte do `/rename`), última-linha-vence resolve tudo.
    Contras: viola o princípio "`SessionIndexer` é read-only / não reescrever
    `.jsonl`" (`shared/sessions.ts:1-17`); mexer no arquivo do Claude é
    invasivo e pode conflitar com o CLI escrevendo ao mesmo tempo.
  - **Opção B — storage próprio do app:** um mapa `sessionId → customName` no
    `ConfigStore` (`config-store.ts` já tem escrita atômica temp+rename), que
    **sobrepõe** o que vier do `.jsonl`. Prós: não toca o arquivo do Claude.
    Contras: precisa regra de precedência explícita com o `custom-title` do
    CLI (C2) e a convergência deixa de ser automática.
  - **Recomendação a debater:** Opção B (não invadir o `.jsonl`) + ler o
    `custom-title` do transcript para o reflexo (US-A), com precedência
    definida em C2.
- **[C2] Precedência** quando existem **os dois** (nome da UI no storage E
  `custom-title` no `.jsonl`): qual vence? Sugestão: o mais recente por
  timestamp — mas o registro da UI (Opção B) precisaria carimbar timestamp
  para comparar com o `custom-title` (que não tem timestamp próprio no schema).
- **[C3] Reflexo ao vivo (US-C):** file-watch do `.jsonl` da sessão em foco
  (o `readLastActivity` já lê só a cauda de 8KB — `session-indexer.ts:210-240`
  — dá pra estender para pescar o último `custom-title`) × polling periódico.
  Definir latência aceitável.
- **[C4] Sessões shell:** abas `sessionType: 'shell'` **não têm** `.jsonl`
  nem `sessionId` de Claude. Renomear aba shell é in-scope? Se sim, persiste
  onde (o storage da Opção B precisa de outra chave, ex.: id interno da aba)?
- **[C5] Validação:** nome vazio (rejeita? volta ao fallback?), tamanho
  máximo, caracteres — e o que a aba mostra enquanto o nome é editado.

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
