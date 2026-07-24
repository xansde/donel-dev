# Spec — 006 Acompanhamento do contexto consumido

**Status:** rascunho pós-discovery (aguarda `/clarify` → `/plan`)
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

- **CA-1:** a sessão em foco mostra um `%` de 0–100 do contexto consumido,
  derivado do transcript (última mensagem com `usage`).
- **CA-2:** `% = tokens_de_contexto / janela_do_modelo_ativo`, onde
  `tokens_de_contexto` = soma `input + cache_read + cache_creation` da última
  usage. A janela por modelo vem de uma tabela a fixar (**C2 / S1**).
- **CA-3:** o valor **atualiza** ao longo da sessão (mecanismo em C3).
- **CA-4:** sessão recém-criada (sem `usage` ainda) ou aba **shell** mostra
  `—` (não `0%` enganoso).
- **CA-5:** aparece na toolbar por-sessão (`SessionDetails`), junto do modelo
  — não no titlebar global. Não conflita com o `%` de **quota** já existente
  (rótulos distintos: "contexto" × "cota").

## Spikes e decisões

- **[S1 / C2] Tabela `modelo → janela de contexto` (validar, não chutar).**
  Regra do ambiente: quando envolve modelos Claude, **conferir via a skill
  `claude-api`** antes de afirmar números. Definir a janela de cada
  `ModelAlias` (ex.: variante `[1m]` = 1M tokens vs. 200k padrão) **lendo a
  referência**, não de memória. Este é o item que não pode ser inventado.
- **[C1] Definição de "consumido":** usar a **última** `usage`
  (representa o tamanho atual do contexto — recomendado) × algum acumulado.
  Recomendação: última usage.
- **[C3] Mecanismo de atualização:** file-watch/polling da cauda do `.jsonl`
  da sessão em foco. **Sinergia com a 004** (US-C também precisa observar o
  `.jsonl` ativo) — considerar um observador único compartilhado.
- **[C4] Troca de modelo no meio da sessão:** o `SessionDetails` permite
  trocar o modelo, o que muda a janela — recalcular o `%` com a janela do
  modelo vigente.
- **[C5] Fidelidade ao Claude Code:** o CC mostra "espaço até o auto-compact",
  não `%` consumido puro. O Alexandre pediu o `%` consumido simples — **manter
  simples**, não replicar a semântica de auto-compact.

## Fora de escopo

- **[D]** Custo em $, contagem de mensagens, distância até o auto-compact,
  barra de "smart zone" elaborada — ele disse "só isso basta".
- Histórico/gráfico de consumo ao longo do tempo.
- O restante do US-8 (medidor smart zone completo do Modo Dev) — fica no 003.

## Notas de realidade

- O `%` de contexto é **coisa diferente** do `%` de quota (rate-limit) que o
  app já exibe — a UI precisa deixar claro qual é qual para não repetir o
  problema "não entendi o que essa cota significa" (rodada 6).
- O dado de `usage` está no transcript e é confiável; o risco está só em
  (a) fixar a janela por modelo (S1) e (b) o custo de ler a cauda do `.jsonl`
  com frequência (compartilhar observador com a 004 mitiga).
