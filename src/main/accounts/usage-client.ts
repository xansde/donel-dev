// T1113 (011-contas-e-provedores, etapa 1) — cliente do endpoint OAuth de
// usage (mod local, contracts/backends-http.md §B: `GET
// api.anthropic.com/api/oauth/usage`). HTTP injetável (mesmo espírito de
// quota-headroom.ts); timeout curto (10s, contracts/backends-http.md); nunca
// lança — falha vira `null`. Token só é lido daqui para o header
// `Authorization`, nunca ecoado em log/erro.

const USAGE_ENDPOINT = 'https://api.anthropic.com/api/oauth/usage';
const DEFAULT_TIMEOUT_MS = 10_000;

export interface HttpResponseLike {
  readonly status: number;
  json(): Promise<unknown>;
}

export interface HttpRequestInit {
  readonly method?: string;
  readonly headers?: Record<string, string>;
  readonly body?: string;
  readonly signal?: AbortSignal;
}

export type HttpFetchLike = (url: string, init?: HttpRequestInit) => Promise<HttpResponseLike>;

export interface UsageWindows {
  readonly fiveHour: number | null;
  readonly sevenDay: number | null;
}

const EMPTY_WINDOWS: UsageWindows = { fiveHour: null, sevenDay: null };

function extractUtilization(value: unknown): number | null {
  if (typeof value !== 'object' || value === null) return null;
  const utilization = (value as { utilization?: unknown }).utilization;
  return typeof utilization === 'number' && Number.isFinite(utilization) ? utilization : null;
}

/** Puro — payload malformado/ausente devolve as duas janelas `null` (sucesso parcial preserva a janela boa). */
export function parseUsagePayload(payload: unknown): UsageWindows {
  if (typeof payload !== 'object' || payload === null) return EMPTY_WINDOWS;
  const candidate = payload as { five_hour?: unknown; seven_day?: unknown };
  return {
    fiveHour: extractUtilization(candidate.five_hour),
    sevenDay: extractUtilization(candidate.seven_day),
  };
}

export interface ReadAccountUsageOptions {
  readonly fetchImpl?: HttpFetchLike;
  readonly timeoutMs?: number;
}

/**
 * Lê a carga (5h/7d) da conta dona de `accessToken`. Nunca lança: timeout,
 * erro de rede, HTTP não-2xx ou JSON inválido viram `null` (o motor trata
 * isso como carga desconhecida — C9, nunca destino de auto-switch).
 */
export async function readAccountUsage(accessToken: string, options: ReadAccountUsageOptions = {}): Promise<UsageWindows | null> {
  const fetchImpl = options.fetchImpl ?? (globalThis.fetch as unknown as HttpFetchLike);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const controller = typeof AbortController !== 'undefined' ? new AbortController() : undefined;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;

  try {
    const response = await fetchImpl(USAGE_ENDPOINT, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: controller?.signal,
    });
    if (response.status < 200 || response.status >= 300) return null;

    const body = await response.json();
    return parseUsagePayload(body);
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
