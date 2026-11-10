// Proxy da vez (specs/018-proxy-da-vez) — the way out to the Anthropic API that each machine's sessions use:
// `env.ANTHROPIC_BASE_URL` + `apiKeyHelper` in that machine's `~/.claude/settings.json`. Types and channels only, no
// I/O. No field here carries a key: keys live in the app vault (src/main/proxies/), one per proxy and machine, and
// never cross the preload.

/** Slug: `^[a-z0-9][a-z0-9-]{0,31}$`. */
export type ProxyId = string;

/** `gateway` = the accounts gateway running on one of the owner's computers; `portal` = an API portal. */
export type ProxyKind = 'gateway' | 'portal';

/** `local` = the computer the app runs on; any other value is the id of a remote place (`accounts.remotes`). */
export type MachineId = string;
export const LOCAL_MACHINE_ID: MachineId = 'local';

export interface ProxyEntry {
  readonly id: ProxyId;
  readonly label: string;
  readonly kind: ProxyKind;
  /** Base URL without trailing slash (`https://host` or `http://host:port`); `null` = slot not configured yet. */
  readonly baseUrl: string | null;
  /** Machines allowed to use it; empty = all. */
  readonly machines: readonly MachineId[];
}

export interface ProxiesConfig {
  readonly version: 1;
  readonly entries: readonly ProxyEntry[];
  /** The empty "Outro PC" slot was offered once; removing it must not bring it back. */
  readonly seeded: boolean;
}

export function defaultProxiesConfig(): ProxiesConfig {
  return { version: 1, entries: [], seeded: false };
}

export type ProxyHealthStatus = 'pending' | 'up' | 'down' | 'unconfigured';

export interface ProxyHealth {
  readonly status: ProxyHealthStatus;
  readonly checkedAt: number | null;
  readonly latencyMs: number | null;
  /** HTTP status of the last answer, when there was one. */
  readonly httpStatus: number | null;
  /** Short human text of the last failure (`timeout`, `HTTP 502`, `sem rede`), kept after it comes back. */
  readonly lastError: string | null;
  readonly lastErrorAt: number | null;
  /** When it went down, while it is down. */
  readonly downSince: number | null;
}

export interface ProxyView {
  readonly entry: ProxyEntry;
  readonly health: ProxyHealth;
  /** Machines that have a key for this proxy in the vault. */
  readonly keyFor: readonly MachineId[];
}

export type MachineReach = 'unknown' | 'ok' | 'unreachable';

export interface MachineView {
  readonly id: MachineId;
  readonly label: string;
  readonly reach: MachineReach;
  readonly readAt: number | null;
  /** `ANTHROPIC_BASE_URL` read on the machine; `null` = none (the CLI goes straight to the Anthropic API). */
  readonly baseUrl: string | null;
  /** Entry whose base URL matches, or `null` when the machine points at something not registered. */
  readonly currentProxyId: ProxyId | null;
  /** Proxies this machine can switch to now: base URL, key for this machine and allowed here. */
  readonly choices: readonly ProxyId[];
}

export interface ProxiesViewDto {
  readonly proxies: readonly ProxyView[];
  readonly machines: readonly MachineView[];
  readonly vaultAvailable: boolean;
}

export interface UpsertProxyInput {
  /** Absent = create. */
  readonly id?: ProxyId;
  readonly label: string;
  readonly kind: ProxyKind;
  readonly baseUrl: string | null;
  readonly machines?: readonly MachineId[];
}

export type UpsertProxyResult =
  | { readonly kind: 'ok'; readonly id: ProxyId }
  | { readonly kind: 'invalid'; readonly field: 'label' | 'kind' | 'baseUrl' | 'id' | 'machines' };

export type ProxyKeyResult =
  | { readonly kind: 'ok' }
  | { readonly kind: 'vault-unavailable' }
  /** Empty, too short, or with spaces or control characters. */
  | { readonly kind: 'invalid-key' }
  | { readonly kind: 'unknown-proxy' }
  | { readonly kind: 'unknown-machine' }
  /** Import only: the machine is not on this proxy now, or its `apiKeyHelper` printed nothing. */
  | { readonly kind: 'not-found' }
  | { readonly kind: 'unreachable' };

export type ProxySwitchFailure =
  | 'unknown-proxy'
  | 'unknown-machine'
  | 'not-allowed'
  | 'no-key'
  | 'vault-unavailable'
  | 'unreachable'
  /** The machine could not reach the proxy with the key before writing: nothing changed. */
  | 'precheck-failed'
  /** Written, the check through the new `apiKeyHelper` failed, the previous settings came back. */
  | 'rolled-back'
  | 'io';

export type ProxySwitchOutcome =
  | { readonly kind: 'switched'; readonly machineId: MachineId; readonly from: string | null; readonly to: ProxyId }
  | { readonly kind: 'already'; readonly machineId: MachineId }
  | { readonly kind: 'failed'; readonly machineId: MachineId; readonly reason: ProxySwitchFailure; readonly httpStatus?: number | null };

/** Base URL normalized for comparison and storage: trimmed, no trailing slash, lower-case scheme and host. */
export function normalizeBaseUrl(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (url.username || url.password || url.search || url.hash) return null;
  const path = url.pathname.replace(/\/+$/, '');
  return `${url.protocol}//${url.host}${path}`;
}

export const PROXY_CHANNELS = {
  view: 'proxies:view',
  refresh: 'proxies:refresh',
  upsert: 'proxies:upsert',
  remove: 'proxies:remove',
  setKey: 'proxies:setKey',
  importKey: 'proxies:importKey',
  switch: 'proxies:switch',
  switchAll: 'proxies:switchAll',
  changed: 'proxies:changed',
} as const;

/** `window.donel.proxies`. Keys go in (`setKey`) and never come back. */
export interface DonelProxiesApi {
  view(): Promise<ProxiesViewDto>;
  /** Reads every machine and probes every proxy now. */
  refresh(): Promise<ProxiesViewDto>;
  upsert(input: UpsertProxyInput): Promise<UpsertProxyResult>;
  remove(id: ProxyId): Promise<ProxiesViewDto>;
  /** `value: null` forgets the key of that machine. */
  setKey(id: ProxyId, machineId: MachineId, value: string | null): Promise<ProxyKeyResult>;
  /** Copies into the vault the key the machine uses now for this proxy (its `apiKeyHelper` output). */
  importKey(id: ProxyId, machineId: MachineId): Promise<ProxyKeyResult>;
  switch(machineId: MachineId, id: ProxyId): Promise<ProxySwitchOutcome>;
  switchAll(id: ProxyId): Promise<readonly ProxySwitchOutcome[]>;
  onChanged(listener: (view: ProxiesViewDto) => void): () => void;
}
