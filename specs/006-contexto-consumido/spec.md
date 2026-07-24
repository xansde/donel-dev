# Spec — 006 Acompanhamento do contexto consumido

**Status:** CLARIFICADA (2026-07-24) — `plan.md` + `tasks.md` escritos;
aguardando OK do Alexandre para implementar (gate de execução).
**Prioridade:** a definir pelo Alexandre (fila atual: 002-quota → 003-modo-dev)
**Origem:** entrevista aberta com o Alexandre em 2026-07-24 (surgiu no meio do
discovery). É uma **fatia mínima** do US-8 (tokens/smart zone na UI, P1),
reduzida ao que ele pediu.

> **Legenda:** `[D]` discovery (requisito) · `[T]` técnico (`path:linha`) ·
> `[C]` clarify · `[S]` spike.

## Problema

1. **[D]** O Alexandre **não tem visão** de quanto da janela de contexto da
   sessão atual já foi consumido.
2. **[D]** Ele quer ver **só o `%` da janela de contexto consumido**. Textual:
   *"Quanto da janela de contexto foi consumido mesmo. Só isso já basta."* —
   **sem** custo, nº de mensagens, ou distância até o auto-compact.
3. **[T]** Não existe **nada** de token/contexto na UI ou na lógica hoje
   (US-8 não implementado; grep por `token`/`context`/`compact`/`usage` só
   dá falsos positivos). O único `%` que o app mostra é **quota de
   rate-limit** (5h/7d/fable via `quota-axi`), que é **outra coisa**.
4. **[T]** O dado existe no transcript: cada mensagem `assistant` no `.jsonl`
   tem um bloco `usage` (schema confirmado em transcrito real):
   ```json
   "usage":{"input_tokens":290,"cache_creation_input_tokens":1505,
   "cache_read_input_tokens":132807,"output_tokens":1177, ...}
   ```
   O **tamanho do contexto** no último turn ≈
   `input_tokens + cache_read_input_tokens + cache_creation_input_tokens`
   da **última** mensagem assistant. O `SessionIndexer` **não** parseia
   `usage` hoje (só `preview` e `timestamp`), mas o `readLastActivity`
   (`session-indexer.ts:210-240`) já lê a **cauda** do arquivo — extensível.
5. **[T]** Não há tabela `modelo → tamanho de janela`. `ModelAlias` tem 4
   valores (`fable`/`opus`/`sonnet`/`haiku`, `commandBuilder.ts:15`) sem
   nenhum metadado de janela. O modelo ativo por sessão vive/edita em
   `SessionDetails.tsx:40` (`SegmentedControl`, troca via PTY).
6. **[T]** Local candidato para exibir: **`SessionDetails.tsx:136-138`** — a
   toolbar **por aba** que já mostra modelo/esforço da sessão ativa
   (semanticamente correto: contexto é por-sessão). O titlebar
   (`App.tsx:962-994`) é global/por-perfil — menos adequado.

## User stories (do discovery)

- **US-A:** como usuário, na **sessão em foco** eu vejo o **`%` da janela de
  contexto já consumido**, atualizado conforme a conversa avança.

## Critérios de aceite

- **CA-1:** a sessão em foco mostra o `%` do contexto consumido em relação à
  **smart zone**, derivado do transcript (última mensagem com `usage`).
- **CA-2:** `% = tokens_de_contexto / zona_efetiva`, arredondado para inteiro,
  onde `tokens_de_contexto` = `input_tokens + cache_read + cache_creation` da
  **última** usage (C1) e
  `zona_efetiva = min(SMART_ZONE_TOKENS, janela_do_modelo_ativo)` — ver
  §"Smart zone" e a tabela S1/C2 abaixo. **O denominador é a smart zone
  (300k), não a janela bruta do modelo.**
- **CA-3:** o valor **atualiza** ao longo da sessão via o observador único
  compartilhado com a 004 (C3), com latência ≤ ~1 s após o CLI escrever.
- **CA-4:** sessão recém-criada (sem `usage` ainda), aba **shell**, ou
  transcript ilegível mostram `—` (nunca `0%`, que seria enganoso).
- **CA-5:** aparece na toolbar por-sessão (`SessionDetails`), junto do modelo
  — não no titlebar global. Não conflita com o `%` de **quota** já existente
  (rótulos distintos: "contexto" × "cota").
- **CA-6 (C4):** ao trocar o modelo na toolbar, o `%` **recalcula** com a zona
  efetiva do modelo vigente. Na prática só muda em `haiku`, onde a janela
  (200k) é **menor** que a zona (300k) e portanto vence o `min`.
- **CA-7 (C5):** o número tem rótulo explícito `contexto` e um tooltip com
  `<tokens> / <zona> da smart zone · janela <modelo> <janela>`. Sem tooltip, um
  `%` solto repete o problema "não entendi o que esse número significa"
  (rodada 6).
- **CA-8 (REVISADO 24/07):** o `%` **não tem teto**. Passar da smart zone é
  legítimo e informativo — `380k / 300k` exibe **127%**, não `100%`. Travar em
  100% tornaria 305k e 700k indistinguíveis, matando exatamente a visibilidade
  que é o ponto da feature. **Piso em 0** (nunca negativo).
- **CA-9 (NOVO 24/07):** acima de **100%** o número muda para o tom de alerta
  do design-system (sinal de "fora da smart zone"); abaixo, cor normal. Só a
  cor do próprio número — sem barra, sem ícone, sem gradiente por faixa.

## Decisões resolvidas

### Smart zone = 300k (decisão do Alexandre, 2026-07-24) — o denominador real

Pedido literal dele, depois de ver a consequência de usar a janela bruta:
*"Podes considerar algo como mostrar o % da smart zone (Considere 300k tokens).
Assim terei uma ótima visibilidade."*

```ts
export const SMART_ZONE_TOKENS = 300_000;
// Zona de trabalho efetiva — decisão do Alexandre (2026-07-24).
// NÃO é limite de API, NÃO é o gatilho de auto-compact do Claude Code:
// é a régua DELE de "até aqui a sessão rende bem".
```

`zona_efetiva(model) = min(SMART_ZONE_TOKENS, MODEL_CONTEXT_WINDOWS[model])`

| Modelo | Janela | Zona efetiva | 135k tokens exibem |
|---|---|---|---|
| `opus` / `sonnet` / `fable` | 1.000.000 | **300.000** | **45%** |
| `haiku` | 200.000 | **200.000** (a janela vence) | **68%** |

**Por que o `min`:** uma zona de 300k num modelo de janela 200k seria mentira —
a sessão morre na janela antes de chegar ao fim da zona. Em `haiku` a régua é
a janela real.

**O que isso resolve:** a versão anterior (janela bruta) exibiria 135k como
**13%** — número tecnicamente correto e praticamente inútil. Com a zona, 135k
= **45%**, e a faixa 0–100% cobre o intervalo em que ele realmente decide
"continuo ou abro sessão nova". Isso **substitui** o alerta que estava
registrado no fim da seção S1 abaixo.

**Trade-off assumido:** 300k é heurística, não fato da API. Se ele recalibrar,
é uma linha num módulo (constante, não configuração — decisão de 24/07 para
não inflar o escopo). O tooltip sempre mostra a janela real do modelo ao lado,
para o número nunca esconder a verdade técnica.

### [S1 / C2] Tabela `modelo → janela de contexto` — FIXADA

Conferida na skill `claude-api` em 2026-07-24 (**não** de memória, conforme a
regra do ambiente). Os 4 valores de `ModelAlias` (`commandBuilder.ts:15`)
mapeiam assim:

| `ModelAlias` | Model ID atual | Janela (`max_input_tokens`) |
|---|---|---|
| `fable`  | `claude-fable-5`  | **1.000.000** |
| `opus`   | `claude-opus-5`   | **1.000.000** |
| `sonnet` | `claude-sonnet-5` | **1.000.000** |
| `haiku`  | `claude-haiku-4-5` | **200.000** |

**Variante `[1m]`:** não existe como model ID público — sufixos desse tipo
(`[1m]`, `-fast`, snapshots datados) são identificadores de
deployment/roteamento, não IDs de modelo. Era o marcador de "contexto de 1M"
de quando o default era 200k; **hoje é redundante**, porque em opus/sonnet/
fable 1M já é o default *e* o máximo. Regra de implementação: se um sufixo
`[1m]` aparecer num alias, normalizar (strip) e resolver 1M — nunca falhar.

> **Nota histórica (resolvida):** esta seção alertava que 1M de janela faria
> ~135k aparecer como **13%** — baixo e pouco útil. Foi exatamente esse alerta
> que levou o Alexandre a definir a smart zone de 300k (seção acima). A janela
> continua sendo o **teto** do `min` e aparece no tooltip; **ela não é mais o
> denominador**.

### Demais decisões (clarify de 2026-07-24)

- **[C1] "Consumido" = última usage.** `input + cache_read + cache_creation`
  da última mensagem `assistant` com bloco `usage`. Representa o tamanho
  **real** do contexto agora e cai corretamente após um `/compact`.
  Acumulado da sessão foi **rejeitado**: mede gasto total, não ocupação —
  cresceria para sempre e passaria de 100%.
- **[C3] Observador único compartilhado com a 004.** `fs.watch` no `.jsonl` →
  debounce → **uma** leitura de cauda → emite
  `{ sessionId, customTitle, contextTokens }` num único evento IPC. A 006
  consome `contextTokens`, a 004 consome `customTitle`. Evita dois leitores no
  mesmo arquivo com latências distintas.
  **A 004 já especificou esse watcher** (Fatia 3 dela, commit `fc65258`,
  ainda sem código) e a 006 **herda** as decisões dela: escopo = todas as abas
  `claude` **vivas** (não só a em foco — assim o `%` de uma aba em background
  não fica velho), debounce ~300 ms, ciclo de vida no `PTY_CHANNELS.create` /
  `PtyManager.onExit`. A 006 muda **uma** coisa no contrato: a 004 emitia só
  quando o `custom-title` mudava; passa a emitir quando **qualquer** dos dois
  campos muda, porque `contextTokens` muda a cada turn sem rename nenhum.
- **[C4] Recalcula com o modelo vigente** da toolbar (não congela a janela de
  nascimento da aba). O `%` salta ao trocar opus→haiku (13% → 67%) — isso é
  correto: o mesmo contexto realmente ocupa mais da janela menor.
- **[C5] `%` consumido puro + rótulo/tooltip** (CA-7). Não replicar a
  semântica de "espaço até o auto-compact" do Claude Code — ele pediu
  explicitamente o `%` simples.

## Fora de escopo

- **[D]** Custo em $, contagem de mensagens, distância até o auto-compact —
  ele disse "só isso basta".
- **Barra/medidor visual** de smart zone (gradiente, faixas, gauge). O `%` da
  smart zone (300k) **entrou** no escopo em 24/07, mas como **número + cor
  acima de 100%** (CA-9) — não como widget gráfico.
- Tornar os 300k editáveis por UI/config (decisão 24/07: constante no código).
- Histórico/gráfico de consumo ao longo do tempo.
- O restante do US-8 (medidor smart zone completo do Modo Dev) — fica no 003.

> **Revisão explícita de um "fora de escopo" anterior:** na entrevista o
> Alexandre disse "nada de cor/ícone/estado extra". Isso valia para a **aba**
> (feature 004). Em 24/07 ele decidiu que o **indicador de contexto** muda de
> cor acima de 100% — CA-9 substitui a restrição neste ponto específico.

## Notas de realidade

- O `%` de contexto é **coisa diferente** do `%` de quota (rate-limit) que o
  app já exibe — a UI precisa deixar claro qual é qual para não repetir o
  problema "não entendi o que essa cota significa" (rodada 6).
- O dado de `usage` está no transcript e é confiável; o risco está só em
  (a) fixar a janela por modelo (S1 — **resolvido**) e (b) o custo de ler a
  cauda do `.jsonl` com frequência (o observador único da 004 mitiga).
- **A tabela de janelas envelhece.** Está codificada porque o app não tem
  chave de API para consultar `GET /v1/models` (`max_input_tokens`) em runtime.
  Manter a tabela num módulo isolado e comentado, com a data da conferência,
  para que a revisão futura seja um arquivo só.
- **A ordem de entrega 004 → 006 importa.** O `transcript-watcher` nasce na
  004 (que precisa dele para US-C) e a 006 apenas assina o mesmo evento. Se a
  006 vier primeiro, ela cria o watcher e a 004 assina — o plano cobre os dois
  sentidos, mas construir o watcher duas vezes é o desperdício a evitar.
