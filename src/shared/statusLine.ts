// Ponte da statusline — o JSON oficial que o Claude Code entrega ao comando de
// `statusLine` (https://code.claude.com/docs/en/statusline, conferido no CLI
// 2.1.314 em 2026-10-30), recebido por sessão pela ponte HTTP dos hooks.
//
// Módulo puro (sem Electron, fs nem React): valida o payload e guarda SÓ
// números e nomes — nada de credencial, nada de texto de conversa. Campo
// ausente, `null` ou de tipo errado vira `null`, nunca um palpite: quem
// consome decide o fallback (o número inferido que já existia).
//
// O CLI só manda o que tem: `rate_limits` aparece só para assinantes
// claude.ai (Pro/Max) ou atrás de gateway com limite de gasto, e só depois da
// primeira resposta da API; cada janela pode faltar sozinha. `context_window.
// current_usage` é `null` antes da primeira chamada e de novo logo depois de um
// `/compact`.

import type { ModelAlias } from './commandBuilder';
import { SMART_ZONE_TOKENS } from './contextWindow';
import { resolveSessionModel, type SessionModelView } from './sessionModel';

export const STATUS_LINE_CHANNELS = {
  /** main → renderer: `{ ptyId, snapshot }`; `snapshot: null` quando a aba sai. */
  changed: 'statusline:changed',
  /** renderer → main (invoke): todas as leituras vivas, para quem monta depois do primeiro push. */
  getAll: 'statusline:get-all',
} as const;

export interface StatusLineRateWindow {
  /** % consumido da janela, 0–100. */
  readonly usedPercentage: number;
  /** Epoch em SEGUNDOS (como o CLI manda) da virada da janela; `null` se não veio. */
  readonly resetsAt: number | null;
}

export interface StatusLineSpendLimit extends StatusLineRateWindow {
  readonly usedUsd: number | null;
  readonly limitUsd: number | null;
  readonly period: string | null;
}

export interface StatusLineSnapshot {
  /** Epoch ms em que o app recebeu esta leitura. */
  readonly receivedAt: number;
  /**
   * Epoch ms da última leitura em que houve resposta NOVA da API (o
   * `cost.total_api_duration_ms` mudou). `rate_limits` vem dos cabeçalhos da
   * resposta, então a cota é tão velha quanto isto — é o que separa "cota da
   * conta nova" de "cota da conta de antes da troca" (preenchido pelo store).
   */
  readonly apiActivityAt: number;
  readonly sessionId: string | null;
  readonly sessionName: string | null;
  readonly version: string | null;
  readonly model: { readonly id: string; readonly displayName: string | null } | null;
  readonly contextWindow: {
    /** `input + cache_creation + cache_read` da última resposta — mesma regra do medidor do app. */
    readonly totalInputTokens: number | null;
    readonly totalOutputTokens: number | null;
    /** Janela do modelo em tokens (200k ou 1M), dita pelo próprio CLI. */
    readonly windowSize: number | null;
    readonly usedPercentage: number | null;
    readonly remainingPercentage: number | null;
    /** `false` antes da primeira chamada e logo depois de `/compact` (`current_usage: null`). */
    readonly hasCurrentUsage: boolean;
  } | null;
  readonly cost: {
    readonly totalCostUsd: number | null;
    readonly totalDurationMs: number | null;
    readonly totalApiDurationMs: number | null;
    readonly linesAdded: number | null;
    readonly linesRemoved: number | null;
  } | null;
  readonly rateLimits: {
    readonly fiveHour: StatusLineRateWindow | null;
    readonly sevenDay: StatusLineRateWindow | null;
    readonly spendLimit: StatusLineSpendLimit | null;
  } | null;
  readonly effortLevel: string | null;
  readonly fastMode: boolean | null;
  readonly thinkingEnabled: boolean | null;
  readonly exceeds200kTokens: boolean | null;
  readonly agentName: string | null;
  readonly outputStyle: string | null;
  readonly gitWorktree: string | null;
  readonly repo: { readonly host: string | null; readonly owner: string | null; readonly name: string | null } | null;
  readonly worktree: {
    readonly name: string | null;
    readonly path: string | null;
    readonly branch: string | null;
    readonly originalBranch: string | null;
  } | null;
  readonly pr: {
    readonly number: number;
    readonly url: string | null;
    readonly reviewState: string | null;
    readonly kind: string | null;
  } | null;
  readonly promptCache: { readonly warm: boolean | null; readonly hitRatio: number | null; readonly expiresAt: number | null } | null;
}

export interface StatusLineChangedPayload {
  readonly ptyId: string;
  readonly snapshot: StatusLineSnapshot | null;
}

/** API tipada exposta pelo preload em `window.donel.statusLine`. */
export interface DonelStatusLineApi {
  getAll(): Promise<Record<string, StatusLineSnapshot>>;
  /** UMA assinatura (no App) para todas as abas. Devolve unsubscribe. */
  onChanged(listener: (payload: StatusLineChangedPayload) => void): () => void;
}

const MAX_STRING = 512;
const MAX_URL = 2048;

type Obj = Record<string, unknown>;

function obj(value: unknown): Obj | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Obj) : null;
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function nonNegative(value: unknown): number | null {
  const n = num(value);
  return n !== null && n >= 0 ? n : null;
}

function str(value: unknown, max = MAX_STRING): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= max ? trimmed : null;
}

function bool(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function rateWindow(value: unknown): StatusLineRateWindow | null {
  const o = obj(value);
  const used = o ? nonNegative(o.used_percentage) : null;
  if (!o || used === null) return null;
  return { usedPercentage: used, resetsAt: nonNegative(o.resets_at) };
}

function spendLimit(value: unknown): StatusLineSpendLimit | null {
  const base = rateWindow(value);
  if (!base) return null;
  const o = obj(value) as Obj;
  return { ...base, usedUsd: nonNegative(o.used_usd), limitUsd: nonNegative(o.limit_usd), period: str(o.period) };
}

function httpUrl(value: unknown): string | null {
  const url = str(value, MAX_URL);
  return url !== null && /^https?:\/\//i.test(url) ? url : null;
}

/**
 * Payload cru do stdin da statusline → leitura validada, ou `null` se não é um
 * objeto. Só os campos conhecidos atravessam (o resto é descartado, inclusive
 * `cwd`/`transcript_path`, que o app já conhece). `receivedAt` = agora;
 * `apiActivityAt` nasce igual — o store o corrige comparando com a anterior.
 */
export function parseStatusLinePayload(raw: unknown, receivedAt: number): StatusLineSnapshot | null {
  const root = obj(raw);
  if (!root) return null;

  const modelObj = obj(root.model);
  const modelId = modelObj ? str(modelObj.id) : null;

  const cw = obj(root.context_window);
  const costObj = obj(root.cost);
  const rl = obj(root.rate_limits);
  const fiveHour = rl ? rateWindow(rl.five_hour) : null;
  const sevenDay = rl ? rateWindow(rl.seven_day) : null;
  const spend = rl ? spendLimit(rl.spend_limit) : null;

  const workspace = obj(root.workspace);
  const repoObj = workspace ? obj(workspace.repo) : null;
  const wt = obj(root.worktree);
  const prObj = obj(root.pr);
  const prNumber = prObj ? num(prObj.number) : null;
  const cache = obj(root.prompt_cache);

  return {
    receivedAt,
    apiActivityAt: receivedAt,
    sessionId: str(root.session_id),
    sessionName: str(root.session_name),
    version: str(root.version),
    model: modelId ? { id: modelId, displayName: str(modelObj?.display_name) } : null,
    contextWindow: cw
      ? {
          totalInputTokens: nonNegative(cw.total_input_tokens),
          totalOutputTokens: nonNegative(cw.total_output_tokens),
          windowSize: num(cw.context_window_size) !== null && (cw.context_window_size as number) > 0 ? (cw.context_window_size as number) : null,
          usedPercentage: nonNegative(cw.used_percentage),
          remainingPercentage: nonNegative(cw.remaining_percentage),
          hasCurrentUsage: obj(cw.current_usage) !== null,
        }
      : null,
    cost: costObj
      ? {
          totalCostUsd: nonNegative(costObj.total_cost_usd),
          totalDurationMs: nonNegative(costObj.total_duration_ms),
          totalApiDurationMs: nonNegative(costObj.total_api_duration_ms),
          linesAdded: nonNegative(costObj.total_lines_added),
          linesRemoved: nonNegative(costObj.total_lines_removed),
        }
      : null,
    rateLimits: fiveHour || sevenDay || spend ? { fiveHour, sevenDay, spendLimit: spend } : null,
    effortLevel: str(obj(root.effort)?.level),
    fastMode: bool(root.fast_mode),
    thinkingEnabled: bool(obj(root.thinking)?.enabled),
    exceeds200kTokens: bool(root.exceeds_200k_tokens),
    agentName: str(obj(root.agent)?.name),
    outputStyle: str(obj(root.output_style)?.name),
    gitWorktree: workspace ? str(workspace.git_worktree) : null,
    repo: repoObj ? { host: str(repoObj.host), owner: str(repoObj.owner), name: str(repoObj.name) } : null,
    worktree: wt
      ? { name: str(wt.name), path: str(wt.path, MAX_URL), branch: str(wt.branch), originalBranch: str(wt.original_branch) }
      : null,
    pr:
      prObj && prNumber !== null && Number.isInteger(prNumber) && prNumber > 0
        ? { number: prNumber, url: httpUrl(prObj.url), reviewState: str(prObj.review_state), kind: str(prObj.kind) }
        : null,
    promptCache: cache ? { warm: bool(cache.warm), hitRatio: num(cache.hit_ratio), expiresAt: nonNegative(cache.expires_at) } : null,
  };
}

/** Igualdade por valor, ignorando os carimbos de tempo — o store só reemite quando algo mudou. */
export function sameStatusLineReading(a: StatusLineSnapshot | null | undefined, b: StatusLineSnapshot | null | undefined): boolean {
  if (!a || !b) return a === b;
  const strip = ({ receivedAt: _r, apiActivityAt: _a, ...rest }: StatusLineSnapshot): unknown => rest;
  return JSON.stringify(strip(a)) === JSON.stringify(strip(b));
}

/**
 * Contexto da sessão pela leitura oficial: tokens de entrada da última
 * resposta e a janela do modelo. `null` quando não há leitura utilizável
 * (antes da primeira chamada, logo depois de `/compact`) — aí vale o número
 * do transcript, como antes da ponte.
 */
export function statusLineContext(snapshot: StatusLineSnapshot | null | undefined): { usedTokens: number; windowSize: number | null } | null {
  const cw = snapshot?.contextWindow;
  if (!cw || !cw.hasCurrentUsage || cw.totalInputTokens === null) return null;
  return { usedTokens: cw.totalInputTokens, windowSize: cw.windowSize };
}

/**
 * % consumido das janelas de 5h e 7d, arredondado. Janela cujo `resets_at` já
 * passou some (o CLI faz o mesmo), e uma leitura sem nenhuma janela → `null`.
 */
export function statusLineRateLimitPercents(
  snapshot: StatusLineSnapshot | null | undefined,
  nowMs: number,
): { fiveHour: number | null; sevenDay: number | null } | null {
  const rl = snapshot?.rateLimits;
  if (!rl) return null;
  const pick = (w: StatusLineRateWindow | null): number | null =>
    w === null || (w.resetsAt !== null && w.resetsAt * 1000 <= nowMs) ? null : Math.round(w.usedPercentage);
  const fiveHour = pick(rl.fiveHour);
  const sevenDay = pick(rl.sevenDay);
  return fiveHour === null && sevenDay === null ? null : { fiveHour, sevenDay };
}

export interface SessionMeterInput {
  /** Id do modelo visto no transcript (`message.model`), se houver. */
  readonly transcriptModelId: string | null | undefined;
  /** Tokens de contexto lidos do transcript, se houver. */
  readonly transcriptTokens: number | null | undefined;
  readonly launchAlias: ModelAlias;
  /** Leitura da statusline da aba (já conferida contra a conversa da aba). */
  readonly statusLine: StatusLineSnapshot | null | undefined;
}

export interface SessionMeterView extends SessionModelView {
  /** Tokens do medidor; `null` = sem leitura (o rodapé esconde o medidor). */
  readonly usedTokens: number | null;
}

/**
 * Rodapé da sessão (rótulo do modelo + medidor de contexto) com a leitura
 * oficial na frente do que era inferido:
 * - modelo: `model.id` da statusline (segue `/model` na hora) > transcript > launch;
 * - tokens: `context_window` da statusline > transcript;
 * - régua: `min(smart zone, context_window_size)` quando o CLI diz a janela —
 *   vale para modelo de provedor de terceiros, que a tabela por id não conhece.
 */
export function resolveSessionMeter(input: SessionMeterInput): SessionMeterView {
  const official = statusLineContext(input.statusLine);
  const base = resolveSessionModel(input.statusLine?.model?.id ?? input.transcriptModelId ?? null, input.launchAlias);
  const contextZone = official?.windowSize ? Math.min(SMART_ZONE_TOKENS, official.windowSize) : base.contextZone;
  const usedTokens = official ? official.usedTokens : (input.transcriptTokens ?? null);
  return { label: base.label, contextZone, usedTokens };
}

/**
 * A leitura vale para a aba? Se a statusline diz de qual conversa é, tem de
 * ser a da aba — depois de um `/clear`, a leitura da conversa anterior (custo,
 * contexto) não pode aparecer como se fosse da nova.
 */
export function statusLineForSession(snapshot: StatusLineSnapshot | null | undefined, claudeSessionId: string | null | undefined): StatusLineSnapshot | null {
  if (!snapshot) return null;
  if (snapshot.sessionId && claudeSessionId && snapshot.sessionId !== claudeSessionId) return null;
  return snapshot;
}
