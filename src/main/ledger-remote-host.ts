// Oráculo na VPS (docs/planos/oraculo-na-vps.md) — the app's side of remote mode: which place holds the ledger
// (`<userData>/oraculo-remoto.json`, kept OUT of config.json so an older channel's sanitize never drops it), the
// handshake through the place's own ssh, the events stream that keeps the PC's snapshot fresh, and the two
// gestures of Preferências. The ledger service the rest of the app holds is a switchable one: the move and the way
// back swap what is behind it without restarting the app (the owner's sessions stay up).

import { createHash, randomBytes } from 'node:crypto';
import { join } from 'node:path';
import type { LedgerSnapshot } from '../shared/ledger/channels';
import type { LedgerRemoteResult, LedgerRemoteState } from '../shared/ledger/remote';
import type { ConfigIoDeps } from './config-store';
import { bringLedgerBack, createRemoteLedgerService, fetchOracleHttp, MOVING_REASON, moveLedgerToRemote, readRemoteMarker, type OracleHttp, type RemoteLedgerService, type RemoteMarker } from './ledger-remote';
import type { LedgerProofFs, LedgerService } from './ledger-store';
import type { LedgerDeliveredTo } from '../shared/ledger/contract';
import type { CelularPairResult, CelularState } from '../shared/celular';
import type { CelularRemote } from './celular/service';
import type { OwnerMessage } from './ledger-card-writer';

export const REMOTE_CONFIG_FILE = 'oraculo-remoto.json';
/**
 * The night's version (Líder único, 08/11): on the first open the app takes the ledger to the VPS by itself. This
 * file says it already went once, so it never runs again — not even after the owner brought it back by hand. Kept
 * only after a move that worked: a failed one tries again on the next open.
 */
export const AUTO_MOVE_FILE = 'oraculo-ida-automatica.json';
/** What the probe answers on a place where the daemon is installed (`scripts/oraculo-vps.sh instalar`). */
export const ORACLE_INSTALLED = 'oraculo-instalado';

/** Reads only: is the daemon installed there? (The handshake would leave a token hash on a place without it.) */
export function oracleProbeScript(): string {
  return `test -f "$HOME/.donel/oraculo/url" && echo ${ORACLE_INSTALLED} || echo sem-oraculo\n`;
}

export interface RemoteOracleHostDeps {
  readonly userDataDir: string;
  readonly ledgerFile: string;
  readonly io: ConfigIoDeps;
  readonly proofFs: LedgerProofFs;
  /** `accounts.remotes`, read at each use. */
  readonly remotes: () => readonly { readonly id: string; readonly label: string; readonly sshTarget: string }[];
  readonly runScript: (sshTarget: string, script: string, timeoutMs: number) => Promise<{ code: number | null; stdout: string; stderr: string }>;
  /** A local ledger over `ledgerFile` (the mode of today). */
  readonly localService: () => LedgerService;
  /** Puts a service behind the one the app holds. */
  readonly setService: (service: LedgerService) => void;
  /** Freezes (reason) or thaws (`null`) the app's writes around the move and the way back; ends when none is in flight. */
  readonly freeze: (reason: string | null) => Promise<void>;
  readonly onChange: (snapshot: LedgerSnapshot) => void;
  readonly fetchImpl?: typeof fetch;
  /** Today's send driver (the board bridge; `null` before it is up): delivers what waits in the VPS's relay. */
  readonly deliver?: () => ((message: OwnerMessage) => Promise<LedgerDeliveredTo>) | null;
  /** The phone was on, on this PC (`celular.json`): the automatic move turns it on at the VPS too. */
  readonly celularWanted?: () => boolean;
}

export interface RemoteOracleHost {
  /** The service to start with (local, or remote when the config says so; it connects in the background). */
  boot(): LedgerService;
  state(): LedgerRemoteState;
  move(lugar: string): Promise<LedgerRemoteResult>;
  /**
   * The first open of the night's version: the move without a click, to the first remote place with the Oráculo
   * installed. Not again once it went (`AUTO_MOVE_FILE`), nor when the ledger is already remote. A failure leaves (or
   * brings back) the ledger on this PC and tries again on the next open.
   */
  autoMove(): Promise<LedgerRemoteResult>;
  back(): Promise<LedgerRemoteResult>;
  dispose(): void;
  /** Remote mode: the phone that lives on the VPS (Preferences → Celular forward to it). `null` = local mode. */
  celular(): CelularRemote | null;
  /** Delivers what waits in the VPS's relay (also on each `fila` event and once a minute). */
  drain(): Promise<void>;
  /** Fatia 4: the picture of the VPS's sessions on the board, for the daemon's MCP gate. `false` = not sent. */
  pushPicture(picture: { readonly at: number; readonly sessoes: Readonly<Record<string, unknown>> }): Promise<boolean>;
}

/** The script that leaves the token's hash on the place and answers where the daemon listens. */
export function handshakeScript(tokenHash: string): string {
  if (!/^[0-9a-f]{64}$/.test(tokenHash)) throw new Error('hash inválido');
  return [
    'set -e',
    'd="$HOME/.donel/oraculo"',
    'umask 077',
    'mkdir -p "$d"',
    `printf '%s\\n' '${tokenHash}' > "$d/pc.token.sha256.tmp"`,
    'mv "$d/pc.token.sha256.tmp" "$d/pc.token.sha256"',
    'test -f "$d/url" || { echo "sem-daemon"; exit 3; }',
    'cat "$d/url"',
    '',
  ].join('\n');
}

export function parseHandshakeUrl(stdout: string): string | null {
  const line = stdout.trim().split('\n').pop()?.trim() ?? '';
  return /^http:\/\/(?:\d{1,3}(?:\.\d{1,3}){3}|\[[0-9a-f:]+\]):\d{2,5}$/i.test(line) ? line : null;
}

const STREAM_IDLE_MS = 70_000;
const RETRY_MS = [5_000, 15_000, 30_000, 60_000];

export function createRemoteOracleHost(deps: RemoteOracleHostDeps): RemoteOracleHost {
  const { io, userDataDir, ledgerFile } = deps;
  const configFile = join(userDataDir, REMOTE_CONFIG_FILE);
  const fetchImpl = deps.fetchImpl ?? fetch;
  let remote: RemoteLedgerService | null = null;
  let link: { url: string; token: string } | null = null;
  let lugar: string | null = null;
  let erro: string | null = null;
  let disposed = false;
  let stream: AbortController | null = null;
  let generation = 0;

  function readConfig(): string | null {
    const text = io.readFileText(configFile);
    if (text === null) return null;
    try {
      const raw = JSON.parse(text) as { lugar?: unknown };
      return typeof raw.lugar === 'string' && raw.lugar.trim() ? raw.lugar : null;
    } catch {
      return null;
    }
  }

  function writeConfig(value: string | null): boolean {
    try {
      if (value === null) {
        if (io.existsSync(configFile)) io.unlinkFile(configFile);
        return !io.existsSync(configFile);
      }
      const tmp = `${configFile}.tmp-${process.pid}`;
      io.writeFileText(tmp, JSON.stringify({ lugar: value }, null, 2));
      io.renameFile(tmp, configFile);
      return true;
    } catch {
      return false;
    }
  }

  const placeOf = (id: string | null) => (id ? (deps.remotes().find((place) => place.id === id) ?? null) : null);

  async function handshake(id: string): Promise<{ url: string; token: string } | string> {
    const place = placeOf(id);
    if (!place) return `o lugar remoto "${id}" não está mais em Contas → Lugares remotos`;
    const token = randomBytes(32).toString('hex');
    const hash = createHash('sha256').update(token).digest('hex');
    const result = await deps.runScript(place.sshTarget, handshakeScript(hash), 20_000);
    if (result.stdout.includes('sem-daemon')) return `o Oráculo não está instalado em ${place.label} (scripts/oraculo-vps.sh instalar)`;
    const url = result.code === 0 ? parseHandshakeUrl(result.stdout) : null;
    if (!url) return `não consegui falar com ${place.label} pelo ssh${result.stderr.trim() ? ` (${result.stderr.trim().split('\n').pop()})` : ''}`;
    return { url, token };
  }

  const httpOf = (current: { url: string; token: string } | null): OracleHttp | null => (current ? fetchOracleHttp(current.url, current.token, fetchImpl) : null);

  async function connect(id: string, gen: number): Promise<boolean> {
    const linked = await handshake(id);
    if (gen !== generation) return false;
    if (typeof linked === 'string') {
      erro = linked;
      return false;
    }
    link = linked;
    erro = null;
    const ok = (await remote?.refresh()) ?? false;
    if (!ok) erro = 'o Oráculo da VPS não respondeu';
    return ok;
  }

  /** The events stream: one `ledger` event per write on the VPS → re-read. Reconnects (and re-handshakes) forever. */
  async function listen(id: string, gen: number): Promise<void> {
    let attempt = 0;
    while (!disposed && gen === generation) {
      if (!link) await connect(id, gen);
      if (link && gen === generation) {
        const controller = new AbortController();
        stream = controller;
        let idle: NodeJS.Timeout | null = null;
        const bump = (): void => {
          if (idle) clearTimeout(idle);
          idle = setTimeout(() => controller.abort(), STREAM_IDLE_MS);
        };
        try {
          bump();
          const response = await fetchImpl(`${link.url}/v1/eventos`, { headers: { Authorization: `Bearer ${link.token}` }, signal: controller.signal });
          if (response.status === 401) link = null; // another boot rewrote the hash: shake hands again
          else if (response.ok && response.body) {
            attempt = 0;
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';
            for (;;) {
              const { done, value } = await reader.read();
              if (done) break;
              bump();
              buffer += decoder.decode(value, { stream: true });
              let cut: number;
              while ((cut = buffer.indexOf('\n\n')) >= 0) {
                const block = buffer.slice(0, cut);
                buffer = buffer.slice(cut + 2);
                if (/^event: ledger$/m.test(block)) {
                  const ok = await remote?.refresh();
                  erro = ok ? null : 'o Oráculo da VPS não respondeu';
                }
                if (/^event: fila$/m.test(block)) void drain();
              }
            }
          }
        } catch {
          // dropped, or idle too long (a PC that slept): reconnect below
        } finally {
          if (idle) clearTimeout(idle);
        }
        // The stream ended: until it is back, the PC is read-only.
        if (gen === generation && !disposed) await remote?.refresh();
      }
      if (disposed || gen !== generation) return;
      await new Promise((resolve) => setTimeout(resolve, RETRY_MS[Math.min(attempt++, RETRY_MS.length - 1)]));
    }
  }

  let draining: Promise<void> | null = null;
  /** Each item: today's driver, then the ack. "Nobody open" (null) is not acked: it stays for the next drain. */
  function drain(): Promise<void> {
    if (draining) return draining;
    draining = (async () => {
      const http = httpOf(link);
      const deliver = deps.deliver?.();
      if (!http || !deliver || !remote) return;
      let items: { id: string; message: OwnerMessage }[] = [];
      try {
        const response = await http('GET', '/v1/fila');
        if (response.status !== 200) return;
        const body = JSON.parse(await response.text()) as { itens?: unknown };
        items = Array.isArray(body.itens) ? (body.itens as { id: string; message: OwnerMessage }[]) : [];
      } catch {
        return;
      }
      for (const item of items) {
        if (typeof item?.id !== 'string' || typeof item.message?.text !== 'string') continue;
        let to: LedgerDeliveredTo = null;
        try {
          to = await deliver(item.message);
        } catch {
          to = null;
        }
        if (to === null) continue;
        try {
          await http('POST', '/v1/fila/ack', JSON.stringify({ id: item.id, deliveredTo: to }));
        } catch {
          // delivered but not acked: the VPS asks again, and the driver's own dedup is the last guard
          return;
        }
      }
    })().finally(() => {
      draining = null;
    });
    return draining;
  }
  const drainTimer = setInterval(() => {
    if (remote && link) void drain();
  }, 60_000);
  drainTimer.unref?.();

  async function celularCall<T>(method: string, path: string, body: unknown, fallback: T): Promise<T> {
    const http = httpOf(link);
    if (!http) return fallback;
    try {
      const response = await http(method, path, body === undefined ? undefined : JSON.stringify(body));
      return response.status === 200 ? (JSON.parse(await response.text()) as T) : fallback;
    } catch {
      return fallback;
    }
  }
  const offline = (): CelularState => ({ enabled: false, status: 'error', url: null, error: `O celular agora fala com ${placeOf(lugar)?.label ?? 'a VPS'}, que não respondeu.`, devices: [] });
  const celularRemote: CelularRemote = {
    getState: () => celularCall('GET', '/v1/celular', undefined, offline()),
    setEnabled: (enabled) => celularCall('POST', '/v1/celular/ligar', { enabled }, offline()),
    pair: () => celularCall<CelularPairResult>('POST', '/v1/celular/parear', {}, { ok: false, reason: 'A VPS não respondeu.' }),
    revoke: (deviceId) => celularCall('POST', '/v1/celular/revogar', { deviceId }, offline()),
    linkPedido: (pedidoId, tarefa) => celularCall('POST', '/v1/celular/pedido-tarefa', { pedidoId, tarefa }, { ok: false }).then((answer) => answer.ok === true),
  };

  function startRemote(id: string, marker: RemoteMarker, linked: { url: string; token: string } | null = null): RemoteLedgerService {
    generation++;
    stream?.abort();
    link = linked;
    lugar = id;
    remote = createRemoteLedgerService({ http: () => httpOf(link), ledgerFile, io, proofFs: deps.proofFs, marker, onChange: deps.onChange });
    void listen(id, generation);
    return remote;
  }

  function stopRemote(): void {
    generation++;
    stream?.abort();
    remote = null;
    link = null;
    lugar = null;
  }

  function state(): LedgerRemoteState {
    const marker = readRemoteMarker(io, ledgerFile);
    const place = placeOf(lugar);
    return {
      mode: remote ? 'remoto' : 'local',
      lugar,
      lugarNome: place?.label ?? null,
      conectado: remote?.connected() ?? false,
      erro,
      espelhoSemModo: !remote && marker ? marker.lugar : null,
      lugares: deps.remotes().map((p) => ({ id: p.id, label: p.label })),
    };
  }

  const done = (reason?: string): LedgerRemoteResult => (reason ? { ok: false, reason, state: state() } : { ok: true, state: state() });

  const host: RemoteOracleHost = {
    boot() {
      const configured = readConfig();
      if (configured) {
        const marker = readRemoteMarker(io, ledgerFile);
        // A normal ledger here with the config still there (a way back by hand that forgot the file): the first
        // snapshot of the VPS would write over it. Stay on this PC and say why.
        if (!marker && io.readFileText(ledgerFile) !== null) {
          erro = `o oraculo-remoto.json aponta para ${placeOf(configured)?.label ?? configured}, mas o ledger.json deste PC é um registro normal: o app ficou neste PC e não gravou por cima. Apague o oraculo-remoto.json, ou leve o Oráculo de novo por esta tela.`;
          return deps.localService();
        }
        return startRemote(configured, marker ?? { lugar: configured, desde: new Date().toISOString() });
      }
      // No config: today's local ledger. A mirror left behind opens read-only by itself (version 1000); the
      // Preferences show `espelhoSemModo` and offer to bring it back from that place.
      return deps.localService();
    },
    state,
    async move(id) {
      if (remote) return done('o Oráculo já está numa VPS');
      const gen = ++generation;
      const linked = await handshake(id);
      if (gen !== generation) return done('outra troca começou');
      if (typeof linked === 'string') return done(linked);
      const marker: RemoteMarker = { lugar: id, desde: new Date().toISOString() };
      // One writer at a time: this app's writes are refused (never a false "ok") until the move ends either way.
      await deps.freeze(MOVING_REASON);
      try {
        const moved = await moveLedgerToRemote({ http: fetchOracleHttp(linked.url, linked.token, fetchImpl), ledgerFile, io, proofFs: deps.proofFs, marker });
        if (!moved.ok) return done(moved.reason);
        if (!writeConfig(id)) {
          // Without the file the next open would not know where the ledger is: it comes back to this PC now.
          const back = await bringLedgerBack({ http: fetchOracleHttp(linked.url, linked.token, fetchImpl), ledgerFile, io, proofFs: deps.proofFs });
          if (back.ok) {
            try {
              deps.onChange(deps.localService().load());
            } catch {
              // the next read says it
            }
          }
          return done(
            back.ok
              ? 'não consegui gravar o oraculo-remoto.json; o registro voltou para este PC, nada se perdeu'
              : `o registro está na VPS, mas não consegui gravar o oraculo-remoto.json nem trazê-lo de volta (${back.reason}); tente de novo`,
          );
        }
        const service = startRemote(id, marker, linked);
        await service.refresh();
        deps.setService(service);
        erro = null;
        return done();
      } finally {
        await deps.freeze(null);
      }
    },
    async autoMove() {
      if (remote || readConfig() !== null) return done('o Oráculo já está numa VPS');
      if (io.readFileText(join(userDataDir, AUTO_MOVE_FILE)) !== null) return done('o Oráculo já foi levado uma vez; daqui em diante só pelas Preferências');
      // A mirror left by a move cut in the middle: the way back of the Preferences, not a second move.
      if (readRemoteMarker(io, ledgerFile)) return done('há um espelho de uma troca anterior; resolva pelas Preferências');
      let target: string | null = null;
      for (const place of deps.remotes()) {
        const probe = await deps.runScript(place.sshTarget, oracleProbeScript(), 20_000).catch(() => null);
        if (probe?.code === 0 && probe.stdout.includes(ORACLE_INSTALLED)) {
          target = place.id;
          break;
        }
      }
      if (!target) return done('nenhum lugar remoto tem o Oráculo instalado');
      const moved = await host.move(target);
      if (!moved.ok) return moved;
      try {
        io.writeFileText(join(userDataDir, AUTO_MOVE_FILE), JSON.stringify({ lugar: target, em: new Date().toISOString() }, null, 2));
      } catch {
        // the next open finds the ledger remote and does nothing anyway
      }
      if (deps.celularWanted?.()) await celularRemote.setEnabled(true);
      return done();
    },
    async back() {
      const id = remote ? lugar : (readRemoteMarker(io, ledgerFile)?.lugar ?? null);
      if (!id) return done('o Oráculo já está neste PC');
      const linked = link ?? (await handshake(id));
      if (typeof linked === 'string') return done(`${linked}. Sem a VPS, use o caminho manual do plano (Volta atrás).`);
      await deps.freeze(MOVING_REASON);
      try {
        const back = await bringLedgerBack({ http: fetchOracleHttp(linked.url, linked.token, fetchImpl), ledgerFile, io, proofFs: deps.proofFs });
        if (!back.ok) return done(back.reason);
        stopRemote();
        writeConfig(null);
        erro = null;
        const local = deps.localService();
        deps.setService(local);
        try {
          deps.onChange(local.load());
        } catch {
          // the next read says it
        }
        return done();
      } finally {
        await deps.freeze(null);
      }
    },
    dispose() {
      disposed = true;
      clearInterval(drainTimer);
      stopRemote();
    },
    celular: () => (remote ? celularRemote : null),
    drain,
    async pushPicture(picture) {
      const http = remote ? httpOf(link) : null;
      if (!http) return false;
      try {
        return (await http('POST', '/v1/retrato', JSON.stringify(picture))).status === 200;
      } catch {
        return false;
      }
    },
  };
  return host;
}
