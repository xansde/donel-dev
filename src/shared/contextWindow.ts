// T601–T604 (006-contexto-consumido, Fatia 0) — núcleo puro do indicador de
// contexto consumido: tabela de janelas por modelo, soma da `usage` e o `%`
// exibido na toolbar da sessão.
//
// Módulo isolado de propósito: sem Electron, sem fs, sem React. É o ÚNICO
// arquivo a revisitar quando a Anthropic mudar tamanhos de janela — daí a
// tabela viver aqui e não espalhada por quem exibe o número.

import type { ModelAlias } from './commandBuilder';

/**
 * Janela de contexto (`max_input_tokens`) de cada `ModelAlias`.
 *
 * ⚠️ CONFERIDA na skill `claude-api` em **2026-07-24** — não editar de memória.
 * Proveniência e os model IDs correspondentes em
 * `specs/006-contexto-consumido/spec.md` §"[S1/C2] Tabela … FIXADA".
 *
 * `Record<ModelAlias, number>` (não `Partial`) de propósito: o typecheck é o
 * que garante que um alias novo em `commandBuilder.ts` não passe sem janela.
 */
export const MODEL_CONTEXT_WINDOWS: Record<ModelAlias, number> = {
  fable: 1_000_000, // claude-fable-5
  opus: 1_000_000, // claude-opus-5
  sonnet: 1_000_000, // claude-sonnet-5
  haiku: 200_000, // claude-haiku-4-5
};

/**
 * Zona de trabalho efetiva — decisão do Alexandre em 2026-07-24, e o
 * DENOMINADOR do `%` exibido.
 *
 * NÃO é limite de API e NÃO é o gatilho de auto-compact do Claude Code: é a
 * régua dele de "até aqui a sessão rende bem". Com a janela bruta de 1M, 135k
 * apareceriam como 13% — tecnicamente certo e praticamente inútil; com a zona,
 * 45%, e a faixa 0–100% cobre o intervalo em que ele decide "continuo ou abro
 * sessão nova". Se ele recalibrar, é esta linha (constante no código, não
 * configuração — decisão de 24/07 para não inflar o escopo).
 */
export const SMART_ZONE_TOKENS = 300_000;

const KNOWN_ALIASES = Object.keys(MODEL_CONTEXT_WINDOWS) as ModelAlias[];

/**
 * `min(smart zone, janela do modelo)`.
 *
 * O `min` não é decoração: uma zona de 300k num modelo de janela 200k seria
 * mentira — a sessão morre na janela antes de chegar ao fim da zona. Em `haiku`
 * a régua é a janela real (200k).
 */
export function effectiveContextZone(model: ModelAlias): number {
  return Math.min(SMART_ZONE_TOKENS, MODEL_CONTEXT_WINDOWS[model]);
}

/**
 * Normaliza um alias vindo de argv/config (que pode ter sido editado à mão)
 * para um `ModelAlias`, ou `null` se não for reconhecível.
 *
 * Faz strip de sufixo de deployment entre colchetes (`opus[1m]` → `opus`):
 * `[1m]` nunca foi model ID público — era o marcador de "contexto de 1M" de
 * quando o default era 200k, e hoje é redundante porque em opus/sonnet/fable 1M
 * já é default *e* máximo. Alias desconhecido devolve `null` em vez de um
 * palpite: quem chama exibe `—`, nunca uma janela chutada.
 */
export function normalizeModelAlias(raw: string): ModelAlias | null {
  if (typeof raw !== 'string') return null;

  const candidate = raw
    .trim()
    .toLowerCase()
    .replace(/\[[^\]]*\]$/, '')
    .trim();

  return (KNOWN_ALIASES as readonly string[]).includes(candidate) ? (candidate as ModelAlias) : null;
}

/**
 * Issue #21 — janela do modelo pelo **id real** que o CLI grava no transcript
 * (`message.model`, ex. `claude-opus-5-5`, `claude-haiku-4-5-20251001`), não
 * pelo alias do launch. Um `/model` digitado no CLI muda o id sem mudar o
 * alias, e o alias `haiku` sozinho não diz se a sessão roda Haiku 4.5 (200k)
 * ou Haiku 5.5 (1M).
 *
 * ⚠️ Regra CONFERIDA na skill `claude-api` em **2026-10-30** (tabela de modelos
 * atuais + legados), não de memória: toda a família fable/mythos e toda geração
 * **4.6 em diante** têm janela de 1M; 4.5 e anteriores (Haiku 4.5, Sonnet/Opus
 * 4.5, 4.1, 4, e a nomenclatura `claude-3-*`) têm 200k. Regra por geração em vez
 * de lista fechada de ids para um modelo novo da mesma linha não cair em `null`.
 *
 * Tolera o que aparece em volta do id: sufixo de data (`-20251001`), `[1m]`,
 * prefixo de provedor (`us.anthropic.`), versão do Bedrock (`-v1:0`) e snapshot
 * do Vertex (`@20251101`). O próprio alias (`opus`) também é aceito.
 *
 * Desconhecido (modelo de provedor de terceiros, lixo) → `null`, nunca um
 * palpite: quem chama decide o fallback.
 */
export function contextWindowForModelId(modelId: string): number | null {
  if (typeof modelId !== 'string') return null;
  const alias = normalizeModelAlias(modelId);
  if (alias !== null) return MODEL_CONTEXT_WINDOWS[alias];

  const id = normalizeModelId(modelId);
  if (!id) return null;

  const modern = MODERN_MODEL_ID.exec(id);
  if (modern) {
    const [, family, major, minor] = modern;
    if (family === 'fable' || family === 'mythos') return ONE_MILLION;
    const version = Number(major) + Number(minor ?? 0) / 10;
    return version >= 4.6 ? ONE_MILLION : TWO_HUNDRED_K;
  }
  if (/^claude-(fable|mythos)-[a-z0-9-]+$/.test(id)) return ONE_MILLION; // ex. `claude-mythos-preview`
  if (LEGACY_MODEL_ID.test(id)) return TWO_HUNDRED_K;
  return null;
}

/** `min(smart zone, janela)` pelo id real; `null` quando o id é desconhecido. */
export function contextZoneForModelId(modelId: string): number | null {
  const window = contextWindowForModelId(modelId);
  return window === null ? null : Math.min(SMART_ZONE_TOKENS, window);
}

const ONE_MILLION = 1_000_000;
const TWO_HUNDRED_K = 200_000;
/** `claude-<família>-<major>[-<minor>]` — nomenclatura de 4.x em diante. */
export const MODERN_MODEL_ID = /^claude-(fable|mythos|opus|sonnet|haiku)-(\d+)(?:-(\d))?$/;
/** `claude-<major>[-<minor>]-<família>` — nomenclatura `claude-3-*`. */
export const LEGACY_MODEL_ID = /^claude-(\d+)(?:-(\d))?-(opus|sonnet|haiku)$/;

/** Tira o que cerca o id (provedor, data, `[1m]`, versão do Bedrock, snapshot do Vertex). */
export function normalizeModelId(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/\[[^\]]*\]$/, '')
    .replace(/^(?:[a-z]{2,4}\.)?anthropic\./, '')
    .replace(/-v\d+(?::\d+)?$/, '')
    .replace(/@\d{8}$/, '')
    .replace(/-\d{8}$/, '')
    .trim();
}

/** Os três campos da `usage` que compõem o contexto de ENTRADA do turn (C1). */
const CONTEXT_USAGE_FIELDS = [
  'input_tokens',
  'cache_read_input_tokens',
  'cache_creation_input_tokens',
] as const;

/**
 * Tamanho do contexto no turn (CA-2 / decisão C1): `input_tokens +
 * cache_read_input_tokens + cache_creation_input_tokens` da `usage`.
 *
 * `output_tokens` **não entra** — é geração, não contexto de entrada.
 *
 * Campo ausente conta 0, mas uma `usage` sem NENHUM dos três devolve `null`, e
 * não `0`: é a diferença entre "o contexto está vazio" e "não há leitura", e o
 * CA-4 exige que o segundo caso apareça como `—` na tela. A entrada é `unknown`
 * porque vem de `JSON.parse` — valida sem nunca lançar.
 */
export function contextTokensFromUsage(usage: unknown): number | null {
  if (typeof usage !== 'object' || usage === null || Array.isArray(usage)) return null;

  const record = usage as Record<string, unknown>;
  let total = 0;
  let sawAnyField = false;

  for (const field of CONTEXT_USAGE_FIELDS) {
    const value = record[field];
    // Tipo errado (string, null, objeto) é IGNORADO em vez de virar NaN e
    // contaminar a soma inteira — um campo corrompido não deve apagar os outros.
    if (typeof value !== 'number' || !Number.isFinite(value)) continue;
    total += value;
    sawAnyField = true;
  }

  return sawAnyField ? total : null;
}

/**
 * Uma linha do `.jsonl` → tokens de contexto daquele turn, ou `null` se a linha
 * não é um turno de assistant com `usage` utilizável.
 *
 * Existe separada de `contextTokensFromUsage` pela mesma razão que
 * `extractCustomTitleFromLine` existe em `sessionName.ts`: a varredura reversa
 * da cauda (`transcript-watcher.ts`) percorre linha a linha e não pode ter uma
 * segunda cópia da regra de parsing. É aqui que os nomes dos campos da `usage`
 * ficam confinados (antisséptico do T609).
 *
 * **A `usage` fica em `message.usage`**, não no topo da linha — conferido num
 * transcript real em 26/07 (`specs/006-contexto-consumido/medicao-t606.md`); o
 * fragmento `"usage":{…}` da spec é um recorte.
 *
 * `isSidechain: true` é descartado: turno de subagente tem contexto PRÓPRIO e
 * mostrá-lo como se fosse o da sessão faria o `%` despencar sem motivo. Zero
 * ocorrências em 319 transcripts desta máquina — o filtro é seguro contra uma
 * mudança futura do CLI, não conserto de um problema observado.
 *
 * Nunca lança: a cauda começa no meio de uma linha, então JSON inválido é o
 * caso NORMAL da primeira linha lida, não uma exceção.
 */
export function contextTokensFromLine(line: string): number | null {
  const raw = typeof line === 'string' ? line.trim() : '';
  if (!raw || raw[0] !== '{') return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (typeof parsed !== 'object' || parsed === null) return null;
  const record = parsed as { type?: unknown; isSidechain?: unknown; message?: unknown };
  if (record.type !== 'assistant') return null;
  if (record.isSidechain === true) return null;
  if (typeof record.message !== 'object' || record.message === null) return null;

  return contextTokensFromUsage((record.message as { usage?: unknown }).usage);
}

/**
 * `%` da smart zone consumido, arredondado para inteiro.
 *
 * ⚠️ **SEM TETO, por decisão explícita (CA-8, revisada em 24/07).** Não
 * transformar em `Math.min(100, …)`: travar em 100% tornaria 305k e 700k
 * indistinguíveis, que é exatamente a visibilidade que esta feature existe para
 * dar. Passar da zona é legítimo e informativo — 380k em opus mostra `127%`.
 * Há piso em 0 (nunca negativo).
 *
 * `tokens === null` → `null` (CA-4: `—`, nunca `0%`). Alias desconhecido →
 * `null` pela mesma razão de `normalizeModelAlias`.
 */
export function computeContextPercent(tokens: number | null, model: string): number | null {
  if (tokens === null || typeof tokens !== 'number' || !Number.isFinite(tokens)) return null;

  const alias = normalizeModelAlias(model);
  if (alias === null) return null;

  return Math.max(0, Math.round((tokens / effectiveContextZone(alias)) * 100));
}

/**
 * CA-9: o número muda para o tom de alerta quando passa da smart zone.
 *
 * O gatilho é **`> 100`**, não `>= 100`: exatamente 100% é o limite da zona
 * ainda cumprido, não um estouro. Sem leitura (`null`) não há alerta — `—` é
 * ausência de informação, não problema.
 */
export function isOverSmartZone(percent: number | null): boolean {
  return percent !== null && percent > 100;
}

/**
 * Tooltip do indicador (CA-7): mostra a zona usada como denominador **e** a
 * janela real do modelo ao lado — o número da zona nunca deve esconder a
 * verdade técnica ("300k" é régua dele, "1M" é o fato da API).
 *
 * Sem leitura (ou alias desconhecido) → string vazia, coerente com o `—`
 * exibido: melhor nenhum tooltip que um tooltip com números inventados.
 */
export function formatContextTooltip(tokens: number | null, model: string): string {
  if (tokens === null || typeof tokens !== 'number' || !Number.isFinite(tokens)) return '';

  const alias = normalizeModelAlias(model);
  if (alias === null) return '';

  const zone = effectiveContextZone(alias);
  const window = MODEL_CONTEXT_WINDOWS[alias];
  return `${ptBr(tokens)} / ${ptBr(zone)} tokens da smart zone · janela ${alias} ${ptBr(window)}`;
}

function ptBr(value: number): string {
  return value.toLocaleString('pt-BR');
}
