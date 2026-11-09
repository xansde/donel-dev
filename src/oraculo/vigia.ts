// Vigia de travas no daemon do Oráculo (t-ffbf8e7d; docs/planos/vigia-travas.md, "Fase 2"). The daemon watches the
// place it runs on — the vault (only with the optional adapter) and the sessions in a loop — with the same rules and
// the same service as the PC (`src/main/vigia/vigia-service.ts`), so the owner gets the urgent card (and the phone's
// push, which lives here too) with the PC off. The PC leaves this place's vault and sessions to the daemon and still
// tells when the place falls or asks for a login: nobody can see their own death.
//
// What the daemon does not know by itself comes from the PC at each handshake, in `<dir>/vigia.json`: the id and name
// the PC gives this place (the keys must match the PC's), where cards are filed, the vault adapter. Without the file
// the daemon watches nothing. `<dir>/vigia.ativo` tells the PC that this daemon watches.

import { spawn } from 'node:child_process';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { LedgerService } from '../main/ledger-store';
import { createVigiaService, type VigiaService } from '../main/vigia/vigia-service';
import { buildRemoteHealthScript, parseRemoteHealthOutput, type RemoteHealthReport } from '../shared/health/remote';
import { sanitizeVigiaPrefs, type VigiaCofrePrefs } from '../shared/vigia/config';
import { VIGIA_ROUND_MS } from '../shared/vigia/travas';

export const VIGIA_CONFIG_FILE = 'vigia.json';
export const VIGIA_ON_FILE = 'vigia.ativo';
const VIGIA_STATE_FILE = 'vigia-travas.json';
const HEALTH_TIMEOUT_MS = 30_000;
/** The first round waits for the sessions to settle after a restart. */
const FIRST_DELAY_MS = 60_000;

export interface DaemonVigiaConfig {
  readonly placeId: string;
  readonly label: string;
  readonly projectPath: string;
  readonly cofre: VigiaCofrePrefs | null;
}

/** `null` = no usable setup (missing, unreadable, or without the place or the board): nothing is watched. */
export function parseDaemonVigiaConfig(text: string | null): DaemonVigiaConfig | null {
  if (text === null) return null;
  try {
    const raw = JSON.parse(text) as Record<string, unknown>;
    const ok = (value: unknown, max: number): value is string => typeof value === 'string' && value.trim() !== '' && value.length <= max;
    if (!ok(raw.placeId, 128) || !ok(raw.label, 128) || !ok(raw.projectPath, 1024)) return null;
    return { placeId: raw.placeId, label: raw.label, projectPath: raw.projectPath, cofre: sanitizeVigiaPrefs({ cofre: raw.cofre }).cofre };
  } catch {
    return null;
  }
}

type RunResult = { code: number | null; stdout: string; stderr: string; timedOut: boolean };

/** Runs a script with `bash -s` on this place (the PC runs the same scripts through ssh). */
export function runLocalScript(script: string, timeoutMs: number): Promise<RunResult> {
  return new Promise((resolve) => {
    const child = spawn('bash', ['-s'], { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => (stdout += chunk));
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => (stderr = (stderr + chunk).slice(-4096)));
    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({ code: null, stdout, stderr: stderr || error.message, timedOut });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut });
    });
    child.stdin.end(script);
  });
}

export interface DaemonVigiaDeps {
  readonly dir: string;
  readonly ledger: () => LedgerService;
  readonly run?: (script: string, timeoutMs: number) => Promise<RunResult>;
  readonly now?: () => number;
  readonly log?: (line: string) => void;
}

export interface DaemonVigia {
  /** Reads the PC's setup and this place's sessions, then one round of the vigia. */
  round(): Promise<void>;
  start(): void;
  stop(): void;
}

export function createDaemonVigia(deps: DaemonVigiaDeps): DaemonVigia {
  const run = deps.run ?? runLocalScript;
  const now = deps.now ?? Date.now;
  let config: DaemonVigiaConfig | null = null;
  let report: RemoteHealthReport | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const readConfig = (): DaemonVigiaConfig | null => {
    try {
      return parseDaemonVigiaConfig(readFileSync(join(deps.dir, VIGIA_CONFIG_FILE), 'utf8'));
    } catch {
      return null;
    }
  };

  const service: VigiaService = createVigiaService({
    places: () => (config ? [{ id: config.placeId, label: config.label, sshTarget: 'local' }] : []),
    run: (_here, script, timeoutMs) => run(script, timeoutMs),
    reports: () => (report ? [report] : []),
    apply: async (actor, op) => {
      const result = await deps.ledger().apply(actor, op);
      return result.ok ? { ok: true, task: { id: result.task.id } } : { ok: false, reason: result.reason };
    },
    projectPath: () => config?.projectPath ?? null,
    cofre: () => config?.cofre ?? null,
    // No screen here: the card's push to the phone is the warning. A card that cannot be made is logged.
    notify: (title, body) => deps.log?.(`[vigia] ${title}: ${body}`),
    statePath: join(deps.dir, VIGIA_STATE_FILE),
    now,
    ...(deps.log ? { log: deps.log } : {}),
  });

  async function round(): Promise<void> {
    config = readConfig();
    if (!config) return;
    const health = await run(buildRemoteHealthScript(), HEALTH_TIMEOUT_MS);
    const reading = parseRemoteHealthOutput(health.stdout);
    const at = now();
    report = reading
      ? { id: config.placeId, label: config.label, status: 'ok', checkedAt: at, lastOkAt: at, reading, severity: 'ok' }
      : null;
    await service.round();
  }

  function schedule(ms: number): void {
    timer = setTimeout(() => {
      void round()
        .catch((error) => deps.log?.(`[vigia] rodada falhou: ${error instanceof Error ? error.message : String(error)}`))
        .finally(() => schedule(VIGIA_ROUND_MS));
    }, ms);
    timer.unref?.();
  }

  return {
    round,
    start() {
      if (timer !== null) return;
      writeFileSync(join(deps.dir, VIGIA_ON_FILE), `${new Date(now()).toISOString()}\n`, { mode: 0o600 });
      schedule(FIRST_DELAY_MS);
    },
    stop() {
      if (timer !== null) clearTimeout(timer);
      timer = null;
      rmSync(join(deps.dir, VIGIA_ON_FILE), { force: true });
    },
  };
}
