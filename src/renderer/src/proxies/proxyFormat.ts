// Proxy da vez — the texts of the bar and the panel. Pure, no I/O.

import type { MachineView, ProxiesViewDto, ProxyKeyResult, ProxySwitchOutcome, ProxyView } from '../../../shared/proxies';

export function formatClock(at: number): string {
  return new Date(at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

export function healthText(proxy: ProxyView): string {
  const h = proxy.health;
  switch (h.status) {
    case 'unconfigured':
      return 'não configurado';
    case 'pending':
      return 'lendo…';
    case 'up':
      return h.latencyMs !== null ? `de pé · ${h.latencyMs} ms` : 'de pé';
    case 'down':
      return `fora${h.downSince ? ` desde ${formatClock(h.downSince)}` : ''}${h.lastError ? ` · ${h.lastError}` : ''}`;
  }
}

/** The alert's line under "<proxy> está fora": `Desde 14:02 · HTTP 502.` */
export function downDetail(proxy: ProxyView): string {
  const h = proxy.health;
  const parts = [h.downSince ? `Desde ${formatClock(h.downSince)}` : null, h.lastError].filter(Boolean);
  return parts.length > 0 ? `${parts.join(' · ')}.` : '';
}

export function proxyOf(view: ProxiesViewDto, id: string | null): ProxyView | undefined {
  return id ? view.proxies.find((proxy) => proxy.entry.id === id) : undefined;
}

/** What the bar says for this computer: `Proxy · Portal IA · 320 ms`. */
export function formatProxyIndicator(view: ProxiesViewDto | null): string {
  if (!view) return 'Proxy';
  const local = view.machines.find((machine) => machine.id === 'local');
  if (!local || local.reach === 'unknown') return 'Proxy · lendo…';
  const current = proxyOf(view, local.currentProxyId);
  if (!current) return local.baseUrl ? 'Proxy · fora do cadastro' : 'Proxy · direto';
  const h = current.health;
  if (h.status === 'down') return `Proxy · ${current.entry.label} fora`;
  if (h.status === 'up' && h.latencyMs !== null) return `Proxy · ${current.entry.label} · ${h.latencyMs} ms`;
  return `Proxy · ${current.entry.label}`;
}

export type IndicatorTone = 'ok' | 'warn' | 'critical' | 'unknown';

/** The worst state among the proxies the machines use now. */
export function indicatorTone(view: ProxiesViewDto | null): IndicatorTone {
  if (!view) return 'unknown';
  let tone: IndicatorTone = 'unknown';
  for (const machine of view.machines) {
    const current = proxyOf(view, machine.currentProxyId);
    if (current?.health.status === 'down') return 'critical';
    if (current?.health.status === 'up') tone = 'ok';
    else if (machine.reach === 'ok' && machine.baseUrl && !current && tone !== 'ok') tone = 'warn';
  }
  return tone;
}

export interface DownAlert {
  readonly machine: MachineView;
  readonly current: ProxyView;
  readonly suggestion: ProxyView | null;
}

/** Machines whose proxy is down, each with the first proxy that is up and ready there. */
export function downAlerts(view: ProxiesViewDto): DownAlert[] {
  const alerts: DownAlert[] = [];
  for (const machine of view.machines) {
    const current = proxyOf(view, machine.currentProxyId);
    if (current?.health.status !== 'down') continue;
    const suggestion = machine.choices.map((id) => proxyOf(view, id)).find((proxy) => proxy && proxy.entry.id !== current.entry.id && proxy.health.status === 'up') ?? null;
    alerts.push({ machine, current, suggestion });
  }
  return alerts;
}

export function switchOutcomeText(outcome: ProxySwitchOutcome, view: ProxiesViewDto | null, machineLabel: string): string {
  if (outcome.kind === 'switched') {
    const to = view ? (proxyOf(view, outcome.to)?.entry.label ?? outcome.to) : outcome.to;
    return `${machineLabel}: trocado para ${to}. As sessões novas já saem por ele; as que estão abertas seguem como estão.`;
  }
  if (outcome.kind === 'already') return `${machineLabel}: já estava nesse proxy (chave atualizada).`;
  const status = outcome.httpStatus ? ` (HTTP ${outcome.httpStatus})` : '';
  switch (outcome.reason) {
    case 'precheck-failed':
      return `${machineLabel}: o proxy novo não respondeu com a chave desta máquina${status}. Nada mudou.`;
    case 'rolled-back':
      return `${machineLabel}: gravei, mas o proxy novo parou de responder${status}. Voltei o caminho de antes.`;
    case 'unreachable':
      return `${machineLabel}: não consegui falar com a máquina por ssh. Nada mudou.`;
    case 'no-key':
      return `${machineLabel}: falta a chave deste proxy para esta máquina.`;
    case 'not-allowed':
      return `${machineLabel}: este proxy não está liberado para esta máquina.`;
    case 'vault-unavailable':
      return `${machineLabel}: o cofre do app não está disponível nesta máquina.`;
    default:
      return `${machineLabel}: a troca não terminou. Nada mudou; tente de novo.`;
  }
}

export function keyResultText(result: ProxyKeyResult): string | null {
  switch (result.kind) {
    case 'ok':
      return null;
    case 'invalid-key':
      return 'Essa chave não parece válida (curta demais, ou com espaço).';
    case 'not-found':
      return 'A máquina não está neste proxy agora, ou o comando da chave dela não devolveu nada.';
    case 'unreachable':
      return 'Não consegui falar com a máquina por ssh.';
    case 'vault-unavailable':
      return 'O cofre do app não está disponível.';
    default:
      return 'Não deu certo; tente de novo.';
  }
}

/** A label for an address found on a machine and not registered yet. */
export function guessLabel(baseUrl: string, machineLabel: string): { label: string; kind: 'gateway' | 'portal' } {
  let host = baseUrl;
  let explicitPort = false;
  try {
    const url = new URL(baseUrl);
    host = url.hostname;
    explicitPort = url.port !== '';
  } catch {
    // keep the raw text
  }
  const looksLikePortal = baseUrl.startsWith('https://') && !explicitPort;
  return looksLikePortal ? { label: host, kind: 'portal' } : { label: `Gateway (${host.split('.')[0] || machineLabel})`, kind: 'gateway' };
}
