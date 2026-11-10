// Proxy da vez — the health probe: `GET <base>/v1/models` with the CLI's User-Agent and NO key (costs nothing, and no
// key leaves the vault for it). Any answer below 500 means the proxy is up (401 = up and asking for a key); 5xx,
// timeout or a network error means it is down.

export const PROXY_PROBE_TIMEOUT_MS = 8_000;
export const CLI_USER_AGENT = 'claude-cli/2.1.0 (external, cli)';

export interface ProbeResult {
  readonly up: boolean;
  readonly httpStatus: number | null;
  readonly latencyMs: number | null;
  /** Short human text when down. */
  readonly error: string | null;
}

/** Pure — what an HTTP status means for the probe. */
export function classifyProbeStatus(httpStatus: number): { up: boolean; error: string | null } {
  return httpStatus < 500 ? { up: true, error: null } : { up: false, error: `HTTP ${httpStatus}` };
}

export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; signal: AbortSignal; redirect: 'manual' }) => Promise<{ status: number }>;

export async function probeProxy(baseUrl: string, fetchImpl: FetchLike = fetch as unknown as FetchLike, now: () => number = Date.now): Promise<ProbeResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROXY_PROBE_TIMEOUT_MS);
  const started = now();
  try {
    const response = await fetchImpl(`${baseUrl}/v1/models`, {
      method: 'GET',
      headers: { 'user-agent': CLI_USER_AGENT, 'anthropic-version': '2023-06-01' },
      signal: controller.signal,
      redirect: 'manual',
    });
    const latencyMs = now() - started;
    const { up, error } = classifyProbeStatus(response.status);
    return { up, httpStatus: response.status, latencyMs, error };
  } catch {
    return { up: false, httpStatus: null, latencyMs: null, error: controller.signal.aborted ? 'sem resposta em 8 s' : 'sem conexão' };
  } finally {
    clearTimeout(timer);
  }
}
