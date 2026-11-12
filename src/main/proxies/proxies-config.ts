// Proxy da vez — chave `proxies` do `config.json`. Same spirit as `providers-config.ts`: never throws, a bad entry is
// dropped alone and the good ones survive. No key ever lives here (vault, `proxy-service.ts`).

import { defaultProxiesConfig, normalizeBaseUrl, type ProxiesConfig, type ProxyEntry, type ProxyKind } from '../../shared/proxies';

export const PROXY_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,31}$/;
const KINDS: readonly ProxyKind[] = ['gateway', 'portal'];
export const PROXY_LABEL_MAX = 60;

/** The empty slot the owner asked for ("o outro PC pessoal"): shows as not configured until it has address and key. */
export const OTHER_PC_SLOT: ProxyEntry = { id: 'outro-pc', label: 'Outro PC', kind: 'gateway', baseUrl: null, machines: [] };

function sanitizeEntry(value: unknown): ProxyEntry | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const c = value as Record<string, unknown>;
  if (typeof c.id !== 'string' || !PROXY_ID_PATTERN.test(c.id)) return null;
  if (typeof c.label !== 'string' || !c.label.trim() || c.label.length > PROXY_LABEL_MAX) return null;
  if (!(KINDS as readonly unknown[]).includes(c.kind)) return null;
  let baseUrl: string | null = null;
  if (c.baseUrl !== null && c.baseUrl !== undefined) {
    if (typeof c.baseUrl !== 'string') return null;
    baseUrl = normalizeBaseUrl(c.baseUrl);
    if (baseUrl === null) return null;
  }
  const machines = Array.isArray(c.machines) ? c.machines.filter((m): m is string => typeof m === 'string' && m.length > 0) : [];
  return { id: c.id, label: c.label.trim(), kind: c.kind as ProxyKind, baseUrl, machines: [...new Set(machines)] };
}

/**
 * Missing, corrupt or wrong-typed config becomes the empty registry. The first read (no `seeded`) brings the
 * "Outro PC" slot; after that, removing the slot keeps it removed.
 */
export function sanitizeProxiesConfig(parsed: unknown): ProxiesConfig {
  const defaults = defaultProxiesConfig();
  const candidate = typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  const entries: ProxyEntry[] = [];
  const seen = new Set<string>();
  for (const raw of Array.isArray(candidate.entries) ? candidate.entries : []) {
    const entry = sanitizeEntry(raw);
    if (!entry || seen.has(entry.id)) continue;
    seen.add(entry.id);
    entries.push(entry);
  }
  if (candidate.seeded !== true && !seen.has(OTHER_PC_SLOT.id)) entries.push(OTHER_PC_SLOT);
  return { ...defaults, entries, seeded: true };
}

/** Pure — a free id from the label (`Portal de API (time)` → `portal-de-api-time`, then `-2`, `-3`…). */
export function proxyIdFromLabel(label: string, taken: ReadonlySet<string>): string {
  const base =
    label
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 28) || 'proxy';
  if (!taken.has(base)) return base;
  for (let n = 2; ; n += 1) {
    const id = `${base}-${n}`;
    if (!taken.has(id)) return id;
  }
}
