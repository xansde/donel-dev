// Proxy da vez (specs/018-proxy-da-vez, ADR 0008) — the registry, the keys in the vault, what each machine uses now,
// the switch and the health probe. The only module besides `src/main/accounts/` that touches a secret: the proxy key,
// kept in the vault under `proxy:<proxyId>:<machineId>`. It leaves the vault only inside the program sent to the
// machine (stdin of node/ssh), never towards the renderer, a log or an error message.

import {
  normalizeBaseUrl,
  type MachineId,
  type MachineView,
  type ProxiesConfig,
  type ProxiesViewDto,
  type ProxyEntry,
  type ProxyHealth,
  type ProxyId,
  type ProxyKeyResult,
  type ProxySwitchOutcome,
  type UpsertProxyInput,
  type UpsertProxyResult,
} from '../../shared/proxies';
import { buildMachineProgram, parseExportOutput, parseReadOutput, parseSwitchOutput, PROXY_KEY_PATTERN, type MachineProgramInput } from './machine-program';
import { PROXY_ID_PATTERN, PROXY_LABEL_MAX, proxyIdFromLabel } from './proxies-config';
import { CLI_USER_AGENT, type ProbeResult } from './proxy-probe';

export const PROXY_PROBE_INTERVAL_MS = 60_000;
export const MACHINE_READ_INTERVAL_MS = 5 * 60_000;
const FIRST_ROUND_DELAY_MS = 10_000;
const SWITCH_CHECK_TIMEOUT_SEC = 12;

export interface ProxyMachine {
  readonly id: MachineId;
  readonly label: string;
  /** `null` = this computer. */
  readonly sshTarget: string | null;
}

export interface ProxyVault {
  available(): boolean;
  read(key: string): string | null;
  /** `false` = vault unavailable (never falls back to plain text). */
  write(key: string, value: string): boolean;
  delete(key: string): void;
}

export interface ProxyDown {
  readonly proxy: ProxyEntry;
  readonly machines: readonly string[];
  /** First registered proxy that is up and ready for all those machines, if any. */
  readonly suggestion: ProxyEntry | null;
}

export interface ProxyServiceDeps {
  readonly getConfig: () => ProxiesConfig;
  readonly setConfig: (next: ProxiesConfig) => void;
  readonly machines: () => readonly ProxyMachine[];
  /** Runs the program on the machine; `null` = could not reach it. */
  readonly run: (machine: ProxyMachine, program: string) => Promise<string | null>;
  readonly vault: ProxyVault;
  readonly probe: (baseUrl: string) => Promise<ProbeResult>;
  /** `~/.claude` override of this computer (`accounts.claudeHome`); remote places always use their own `~/.claude`. */
  readonly localClaudeDir: () => string | null;
  readonly onChanged: (view: ProxiesViewDto) => void;
  readonly onProxyDown: (down: ProxyDown) => void;
  readonly now?: () => number;
}

export interface ProxyService {
  start(): void;
  stop(): void;
  view(): ProxiesViewDto;
  refresh(): Promise<ProxiesViewDto>;
  upsert(input: UpsertProxyInput): UpsertProxyResult;
  remove(id: ProxyId): ProxiesViewDto;
  setKey(id: ProxyId, machineId: MachineId, value: string | null): ProxyKeyResult;
  importKey(id: ProxyId, machineId: MachineId): Promise<ProxyKeyResult>;
  switchMachine(machineId: MachineId, id: ProxyId): Promise<ProxySwitchOutcome>;
  switchAll(id: ProxyId): Promise<readonly ProxySwitchOutcome[]>;
}

export const proxyVaultKey = (proxyId: ProxyId, machineId: MachineId): string => `proxy:${proxyId}:${machineId}`;

interface MachineState {
  readonly reach: 'ok' | 'unreachable';
  readonly readAt: number;
  readonly baseUrl: string | null;
}

const PENDING: ProxyHealth = { status: 'pending', checkedAt: null, latencyMs: null, httpStatus: null, lastError: null, lastErrorAt: null, downSince: null };
const UNCONFIGURED: ProxyHealth = { ...PENDING, status: 'unconfigured' };

export function createProxyService(deps: ProxyServiceDeps): ProxyService {
  const now = deps.now ?? Date.now;
  const health = new Map<ProxyId, ProxyHealth>();
  const machineState = new Map<MachineId, MachineState>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running = false;
  let lastMachineRead = 0;
  let inFlight: Promise<ProxiesViewDto> | null = null;

  const entries = (): readonly ProxyEntry[] => deps.getConfig().entries;
  const findEntry = (id: ProxyId): ProxyEntry | undefined => entries().find((entry) => entry.id === id);
  const findMachine = (id: MachineId): ProxyMachine | undefined => deps.machines().find((machine) => machine.id === id);
  const allowedOn = (entry: ProxyEntry, machineId: MachineId): boolean => entry.machines.length === 0 || entry.machines.includes(machineId);
  const hasKey = (entry: ProxyEntry, machineId: MachineId): boolean => deps.vault.available() && deps.vault.read(proxyVaultKey(entry.id, machineId)) !== null;
  const ready = (entry: ProxyEntry, machineId: MachineId): boolean => entry.baseUrl !== null && allowedOn(entry, machineId) && hasKey(entry, machineId);
  const matchEntry = (baseUrl: string | null): ProxyEntry | null => (baseUrl ? (entries().find((entry) => entry.baseUrl === baseUrl) ?? null) : null);

  function healthOf(entry: ProxyEntry): ProxyHealth {
    if (entry.baseUrl === null) return UNCONFIGURED;
    return health.get(entry.id) ?? PENDING;
  }

  function view(): ProxiesViewDto {
    const machines = deps.machines();
    const vaultAvailable = deps.vault.available();
    return {
      vaultAvailable,
      proxies: entries().map((entry) => ({
        entry,
        health: healthOf(entry),
        keyFor: machines.filter((machine) => hasKey(entry, machine.id)).map((machine) => machine.id),
      })),
      machines: machines.map((machine): MachineView => {
        const state = machineState.get(machine.id);
        const baseUrl = state?.baseUrl ?? null;
        return {
          id: machine.id,
          label: machine.label,
          reach: state?.reach ?? 'unknown',
          readAt: state?.readAt ?? null,
          baseUrl,
          currentProxyId: matchEntry(baseUrl)?.id ?? null,
          choices: entries()
            .filter((entry) => ready(entry, machine.id))
            .map((entry) => entry.id),
        };
      }),
    };
  }

  const emit = (): void => deps.onChanged(view());

  function inputFor(machine: ProxyMachine, rest: DistributiveOmit<MachineProgramInput, 'claudeDir'>): MachineProgramInput {
    return { ...rest, claudeDir: machine.sshTarget === null ? deps.localClaudeDir() : null } as MachineProgramInput;
  }

  async function readMachine(machine: ProxyMachine): Promise<void> {
    let stdout: string | null = null;
    try {
      stdout = await deps.run(machine, buildMachineProgram(inputFor(machine, { op: 'read' })));
    } catch {
      stdout = null;
    }
    const result = parseReadOutput(stdout);
    const previous = machineState.get(machine.id);
    machineState.set(
      machine.id,
      result.kind === 'ok'
        ? { reach: 'ok', readAt: now(), baseUrl: result.baseUrl ? normalizeBaseUrl(result.baseUrl) : null }
        : { reach: 'unreachable', readAt: now(), baseUrl: previous?.baseUrl ?? null },
    );
  }

  async function probeEntry(entry: ProxyEntry): Promise<void> {
    if (entry.baseUrl === null) return;
    let result: ProbeResult;
    try {
      result = await deps.probe(entry.baseUrl);
    } catch {
      result = { up: false, httpStatus: null, latencyMs: null, error: 'sem conexão' };
    }
    const at = now();
    const previous = health.get(entry.id) ?? PENDING;
    const next: ProxyHealth = result.up
      ? { status: 'up', checkedAt: at, latencyMs: result.latencyMs, httpStatus: result.httpStatus, lastError: previous.lastError, lastErrorAt: previous.lastErrorAt, downSince: null }
      : {
          status: 'down',
          checkedAt: at,
          latencyMs: null,
          httpStatus: result.httpStatus,
          lastError: result.error,
          lastErrorAt: at,
          downSince: previous.status === 'down' ? previous.downSince : at,
        };
    health.set(entry.id, next);
    if (next.status === 'down' && previous.status !== 'down') alertIfCurrent(entry);
  }

  function alertIfCurrent(entry: ProxyEntry): void {
    const machines = deps.machines().filter((machine) => machineState.get(machine.id)?.baseUrl === entry.baseUrl);
    if (machines.length === 0) return;
    const suggestion =
      entries().find((other) => other.id !== entry.id && health.get(other.id)?.status === 'up' && machines.every((machine) => ready(other, machine.id))) ?? null;
    deps.onProxyDown({ proxy: entry, machines: machines.map((machine) => machine.label), suggestion });
  }

  function round(readMachines: boolean): Promise<ProxiesViewDto> {
    if (inFlight) return inFlight;
    inFlight = (async () => {
      try {
        if (readMachines) {
          lastMachineRead = now();
          await Promise.all(deps.machines().map((machine) => readMachine(machine)));
        }
        await Promise.all(entries().map((entry) => probeEntry(entry)));
        const current = view();
        deps.onChanged(current);
        return current;
      } finally {
        inFlight = null;
      }
    })();
    return inFlight;
  }

  function schedule(ms: number): void {
    if (!running) return;
    timer = setTimeout(() => {
      timer = null;
      void round(now() - lastMachineRead >= MACHINE_READ_INTERVAL_MS).finally(() => schedule(PROXY_PROBE_INTERVAL_MS));
    }, ms);
    timer.unref?.();
  }

  async function switchMachine(machineId: MachineId, id: ProxyId): Promise<ProxySwitchOutcome> {
    const machine = findMachine(machineId);
    if (!machine) return { kind: 'failed', machineId, reason: 'unknown-machine' };
    const entry = findEntry(id);
    if (!entry || entry.baseUrl === null) return { kind: 'failed', machineId, reason: 'unknown-proxy' };
    if (!allowedOn(entry, machineId)) return { kind: 'failed', machineId, reason: 'not-allowed' };
    if (!deps.vault.available()) return { kind: 'failed', machineId, reason: 'vault-unavailable' };
    const key = deps.vault.read(proxyVaultKey(entry.id, machineId));
    if (key === null) return { kind: 'failed', machineId, reason: 'no-key' };

    let stdout: string | null = null;
    try {
      stdout = await deps.run(
        machine,
        buildMachineProgram(
          inputFor(machine, { op: 'switch', proxyId: entry.id, baseUrl: entry.baseUrl, key, userAgent: CLI_USER_AGENT, timeoutSec: SWITCH_CHECK_TIMEOUT_SEC }),
        ),
      );
    } catch {
      stdout = null;
    }
    const result = parseSwitchOutput(stdout);
    await readMachine(machine);
    emit();
    switch (result.kind) {
      case 'switched': {
        const from = result.from ? normalizeBaseUrl(result.from) : null;
        if (from === entry.baseUrl) return { kind: 'already', machineId };
        return { kind: 'switched', machineId, from: matchEntry(from)?.id ?? from, to: entry.id };
      }
      case 'precheck-failed':
        return { kind: 'failed', machineId, reason: 'precheck-failed', httpStatus: result.httpStatus };
      case 'rolled-back':
        return { kind: 'failed', machineId, reason: 'rolled-back', httpStatus: result.httpStatus };
      case 'unreachable':
        return { kind: 'failed', machineId, reason: 'unreachable' };
      default:
        return { kind: 'failed', machineId, reason: 'io' };
    }
  }

  return {
    start() {
      if (running) return;
      running = true;
      schedule(FIRST_ROUND_DELAY_MS);
    },
    stop() {
      running = false;
      if (timer !== null) clearTimeout(timer);
      timer = null;
    },
    view,
    refresh: () => round(true),
    upsert(input) {
      const config = deps.getConfig();
      const label = typeof input.label === 'string' ? input.label.trim() : '';
      if (!label || label.length > PROXY_LABEL_MAX) return { kind: 'invalid', field: 'label' };
      if (input.kind !== 'gateway' && input.kind !== 'portal') return { kind: 'invalid', field: 'kind' };
      let baseUrl: string | null = null;
      if (input.baseUrl !== null && input.baseUrl !== undefined && String(input.baseUrl).trim() !== '') {
        baseUrl = normalizeBaseUrl(String(input.baseUrl));
        if (baseUrl === null) return { kind: 'invalid', field: 'baseUrl' };
      }
      const machines = input.machines ?? [];
      if (!Array.isArray(machines) || machines.some((m) => typeof m !== 'string' || !m)) return { kind: 'invalid', field: 'machines' };
      const existing = input.id !== undefined ? config.entries.find((entry) => entry.id === input.id) : undefined;
      if (input.id !== undefined && (!PROXY_ID_PATTERN.test(input.id) || !existing)) return { kind: 'invalid', field: 'id' };
      const id = existing?.id ?? proxyIdFromLabel(label, new Set(config.entries.map((entry) => entry.id)));
      const next: ProxyEntry = { id, label, kind: input.kind, baseUrl, machines: [...new Set(machines)] };
      if (existing && existing.baseUrl !== baseUrl) health.delete(id);
      deps.setConfig({
        ...config,
        entries: existing ? config.entries.map((entry) => (entry.id === id ? next : entry)) : [...config.entries, next],
      });
      emit();
      if (baseUrl !== null && !existing?.baseUrl) void probeEntry(next).then(emit);
      return { kind: 'ok', id };
    },
    remove(id) {
      const config = deps.getConfig();
      if (!config.entries.some((entry) => entry.id === id)) return view();
      for (const machine of deps.machines()) deps.vault.delete(proxyVaultKey(id, machine.id));
      health.delete(id);
      deps.setConfig({ ...config, entries: config.entries.filter((entry) => entry.id !== id) });
      const current = view();
      deps.onChanged(current);
      return current;
    },
    setKey(id, machineId, value) {
      if (!findEntry(id)) return { kind: 'unknown-proxy' };
      if (!findMachine(machineId)) return { kind: 'unknown-machine' };
      if (value === null) {
        deps.vault.delete(proxyVaultKey(id, machineId));
        emit();
        return { kind: 'ok' };
      }
      const key = typeof value === 'string' ? value.trim() : '';
      if (!PROXY_KEY_PATTERN.test(key)) return { kind: 'invalid-key' };
      if (!deps.vault.available() || !deps.vault.write(proxyVaultKey(id, machineId), key)) return { kind: 'vault-unavailable' };
      emit();
      return { kind: 'ok' };
    },
    async importKey(id, machineId) {
      const entry = findEntry(id);
      if (!entry || entry.baseUrl === null) return { kind: 'unknown-proxy' };
      const machine = findMachine(machineId);
      if (!machine) return { kind: 'unknown-machine' };
      if (!deps.vault.available()) return { kind: 'vault-unavailable' };
      let stdout: string | null = null;
      try {
        stdout = await deps.run(machine, buildMachineProgram(inputFor(machine, { op: 'export-key', expectBaseUrl: entry.baseUrl })));
      } catch {
        stdout = null;
      }
      const result = parseExportOutput(stdout);
      if (result.kind === 'unreachable') return { kind: 'unreachable' };
      if (result.kind !== 'ok') return { kind: 'not-found' };
      if (!deps.vault.write(proxyVaultKey(id, machineId), result.key)) return { kind: 'vault-unavailable' };
      emit();
      return { kind: 'ok' };
    },
    switchMachine,
    async switchAll(id) {
      // One machine at a time: a failure is reported for that machine and the others still switch.
      const outcomes: ProxySwitchOutcome[] = [];
      for (const machine of deps.machines()) outcomes.push(await switchMachine(machine.id, id));
      return outcomes;
    },
  };
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

