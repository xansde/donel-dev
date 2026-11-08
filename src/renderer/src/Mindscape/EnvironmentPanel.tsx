// Gargalos do ambiente (t-dda3571f, docs/refinamentos/mindscape-gargalos.md) — the panel over the Mindscape that
// shows, for the whole environment (every board, the PC and the remote places): what each session is REALLY doing,
// the bottlenecks (stuck sessions by cause, accounts out of quota, machines short of RAM, who waits for whom) and the
// sessions that can be closed, with one gesture to close the marked ones. The judgement is pure and tested
// (src/shared/mindscape/bottlenecks.ts); this file only gathers the readings and draws.

import { useEffect, useMemo, useRef, useState } from 'react';
import { overallLoad, type AccountsViewDto } from '../../../shared/accounts';
import { formatBytes } from '../../../shared/format-bytes';
import type { RemoteHealthReport } from '../../../shared/health/remote';
import type { RemoteSessionReading } from '../../../shared/health/remoteSessions';
import type { HealthReport } from '../../../shared/health/types';
import {
  buildEnvPanel,
  cpuPercent,
  PULSE_LABEL,
  pulseOfLocal,
  pulseOfRemote,
  type EnvAccount,
  type EnvLink,
  type EnvMachine,
  type EnvPanel,
  type EnvSession,
  type PulseState,
} from '../../../shared/mindscape/bottlenecks';
import { placeOfSession, type MindscapeDoc } from '../../../shared/mindscape/model';
import type { MindscapeLiveSession } from './MindscapeScreen';
import styles from './EnvironmentPanel.module.css';

export const PC_MACHINE = 'pc';

interface Environment {
  readonly pc: HealthReport | null;
  readonly remotes: readonly RemoteHealthReport[];
  readonly accounts: AccountsViewDto | null;
  /** CPU % per `place:sid`, between the last two reads of each place. */
  readonly cpu: Readonly<Record<string, number | null>>;
}

/** The live readings the panel and the cards need: PC health, remote places, accounts. */
export function useEnvironment(): Environment & { refresh: () => void } {
  const [pc, setPc] = useState<HealthReport | null>(null);
  const [remotes, setRemotes] = useState<readonly RemoteHealthReport[]>([]);
  const [accounts, setAccounts] = useState<AccountsViewDto | null>(null);
  const [cpu, setCpu] = useState<Record<string, number | null>>({});
  const previous = useRef(new Map<string, { ticks: number; at: number }>());

  useEffect(() => {
    const api = window.donel;
    let alive = true;
    const takeRemotes = (reports: readonly RemoteHealthReport[]): void => {
      if (!alive) return;
      const next: Record<string, number | null> = {};
      for (const report of reports) {
        const reading = report.reading;
        if (!reading?.sessionDetails || reading.readAt === null) continue;
        for (const detail of reading.sessionDetails) {
          const key = `${report.id}:${detail.sid}`;
          const before = previous.current.get(key);
          next[key] = before && before.at === reading.readAt ? null : cpuPercent(before, detail.cpuTicks, reading.readAt, detail.clkTck);
          if (!before || before.at !== reading.readAt) previous.current.set(key, { ticks: detail.cpuTicks, at: reading.readAt });
        }
      }
      setCpu((current) => {
        const merged: Record<string, number | null> = {};
        for (const [key, value] of Object.entries(next)) merged[key] = value ?? current[key] ?? null;
        return merged;
      });
      setRemotes(reports);
    };
    void api?.health?.get().then((report) => alive && setPc(report));
    const offPc = api?.health?.onChanged((report) => setPc(report));
    void api?.health?.remoteGet?.().then(takeRemotes);
    const offRemote = api?.health?.onRemoteChanged?.(takeRemotes);
    void api?.accounts?.list().then((view) => alive && setAccounts(view)).catch(() => undefined);
    const offAccounts = api?.accounts?.onChanged((view) => setAccounts(view));
    return () => {
      alive = false;
      offPc?.();
      offRemote?.();
      offAccounts?.();
    };
  }, []);

  const refresh = (): void => {
    void window.donel?.health?.remoteRefresh?.();
    void window.donel?.health?.refresh();
  };
  return { pc, remotes, accounts, cpu, refresh };
}

function machineKind(label: string): EnvMachine['kind'] {
  return /homolog/i.test(label) ? 'homologacao' : 'vps';
}

function accountLabel(accounts: AccountsViewDto | null, id: string | null | undefined): string | null {
  if (!id) return null;
  return accounts?.accounts.find((account) => account.id === id)?.label ?? null;
}

function gatewayLabel(gateway: { host: string; port: number | null }): string {
  return `gateway ${gateway.host.split('.')[0]}${gateway.port ? `:${gateway.port}` : ''}`;
}

export interface EnvView {
  readonly panel: EnvPanel;
  readonly machines: readonly EnvMachine[];
  readonly sessions: readonly EnvSession[];
  /** The pulse of each session, by conversation id (the cards read it). */
  readonly bySession: ReadonlyMap<string, EnvSession>;
  /** Clock of the oldest reading shown (the "lido às" of the head). */
  readonly readAt: number | null;
}

export function useEnvView(env: Environment, live: readonly MindscapeLiveSession[], doc: MindscapeDoc, projectNames: Readonly<Record<string, string>>, now: number): EnvView {
  return useMemo(() => {
    const remoteById = new Map(env.remotes.map((report) => [report.id, report]));
    const accountOfPlace = new Map(env.accounts?.remotes.map((place) => [place.id, place.activeAccountId]) ?? []);

    const machines: EnvMachine[] = [];
    const pcAccount = accountLabel(env.accounts, env.accounts?.activeAccountId);
    machines.push({
      id: PC_MACHINE,
      label: 'PC',
      kind: 'pc',
      reachable: true,
      ramUsedRatio: env.pc ? 1 - env.pc.ram.freeBytes / env.pc.ram.totalBytes : null,
      swapUsedRatio: null,
      loadPerCpu: null,
      account: pcAccount,
    });
    for (const report of env.remotes) {
      const reading = report.reading;
      machines.push({
        id: report.id,
        label: report.label,
        kind: machineKind(report.label),
        reachable: report.status !== 'unreachable',
        ramUsedRatio: reading?.ram ? 1 - reading.ram.freeBytes / reading.ram.totalBytes : null,
        swapUsedRatio: reading?.swap ? 1 - reading.swap.freeBytes / reading.swap.totalBytes : null,
        loadPerCpu: reading?.load && reading.cpus ? reading.load.one / reading.cpus : null,
        account: reading?.gateway ? gatewayLabel(reading.gateway) : accountLabel(env.accounts, accountOfPlace.get(report.id)),
      });
    }
    const machineById = new Map(machines.map((machine) => [machine.id, machine]));

    /** What each place read about its sessions, by conversation id. */
    const detailOf = new Map<string, { placeId: string; detail: RemoteSessionReading; readAt: number }>();
    for (const report of env.remotes) {
      const reading = report.reading;
      if (!reading?.sessionDetails || reading.readAt === null) continue;
      for (const detail of reading.sessionDetails) detailOf.set(detail.sid, { placeId: report.id, detail, readAt: reading.readAt });
    }

    /** The role of a session comes from its place on the Mindscape, never from the tab or the remote meta. */
    const placeRole = (sessionId: string): { roleKnown: boolean; roleId?: string } => {
      for (const board of Object.values(doc.boards)) {
        const place = placeOfSession(board, sessionId);
        if (place) return { roleKnown: true, ...(place.roleId ? { roleId: place.roleId } : {}) };
      }
      return { roleKnown: false };
    };

    const sessions: EnvSession[] = [];
    const seen = new Set<string>();
    for (const session of live) {
      const machineId = session.machineId ?? PC_MACHINE;
      const found = machineId !== PC_MACHINE ? detailOf.get(session.sessionId) : undefined;
      seen.add(session.sessionId);
      const remote = found ? pulseOfRemote(found.detail, found.readAt) : null;
      // A background task the app heard of (hooks) also keeps a remote session working.
      const pulse = remote && !((session.background ?? 0) > 0 && remote.state !== 'trabalhando' && remote.state !== 'precisa-dono') ? remote : pulseOfLocal(session, now);
      sessions.push({
        sessionId: session.sessionId,
        name: session.name,
        tabId: session.tabId,
        projectName: projectNames[session.projectPath] ?? session.projectPath.split(/[\\/]/).filter(Boolean).pop(),
        ...placeRole(session.sessionId),
        machineId,
        pulse,
        account: machineById.get(machineId)?.account ?? null,
        ...(found ? { rssBytes: found.detail.rssBytes, cpuPct: env.cpu[`${found.placeId}:${found.detail.sid}`] ?? null } : {}),
      });
    }
    // Sessions alive on a place that have no tab here: listed (they weigh on the machine), never closed from here.
    for (const [sid, found] of detailOf) {
      if (seen.has(sid)) continue;
      sessions.push({
        sessionId: sid,
        name: found.detail.name || sid.slice(0, 8),
        projectName: 'sem aba no app',
        ...placeRole(sid),
        machineId: found.placeId,
        pulse: pulseOfRemote(found.detail, found.readAt),
        account: machineById.get(found.placeId)?.account ?? null,
        rssBytes: found.detail.rssBytes,
        cpuPct: env.cpu[`${found.placeId}:${sid}`] ?? null,
      });
    }

    const accounts: EnvAccount[] = (env.accounts?.accounts ?? []).map((account) => ({
      label: account.label,
      loadPct: overallLoad(account.load),
      available: account.available,
      needsReconnect: account.needsReconnect === true,
      activeOn: [
        ...(env.accounts?.activeAccountId === account.id ? ['PC'] : []),
        ...(env.accounts?.remotes ?? []).filter((place) => place.activeAccountId === account.id && !remoteById.get(place.id)?.reading?.gateway).map((place) => place.label),
      ],
    }));

    // Arrows mother → daughter between sessions, on every board.
    const links: EnvLink[] = [];
    for (const board of Object.values(doc.boards)) {
      for (const link of board.links) {
        if (!link.arrow) continue;
        const from = board.cards[link.from];
        const to = board.cards[link.to];
        if (from?.kind === 'session' && to?.kind === 'session' && from.sessionId && to.sessionId) links.push({ from: from.sessionId, to: to.sessionId });
      }
    }

    const readAts = env.remotes.map((report) => report.reading?.readAt ?? null).filter((at): at is number => at !== null);
    return {
      panel: buildEnvPanel({ sessions, machines, accounts, links }),
      machines,
      sessions,
      bySession: new Map(sessions.map((session) => [session.sessionId, session])),
      readAt: readAts.length > 0 ? Math.min(...readAts) : null,
    };
  }, [env, live, doc, projectNames, now]);
}

export const PULSE_TONE: Readonly<Record<PulseState, 'ok' | 'wait' | 'bad' | 'idle' | 'close' | 'unknown'>> = {
  trabalhando: 'ok',
  'esperando-api': 'wait',
  travada: 'bad',
  'precisa-dono': 'bad',
  ociosa: 'idle',
  'pode-fechar': 'close',
  desconhecido: 'unknown',
};

export function EnvironmentButton({ open, onToggle, view }: { open: boolean; onToggle: () => void; view: EnvView }): React.JSX.Element {
  const stuck = view.panel.counts.travada + view.panel.counts['precisa-dono'];
  const closable = view.panel.counts['pode-fechar'];
  return (
    <button type="button" className={styles.openButton} aria-pressed={open} onClick={onToggle} data-testid="env-panel-open" title="Gargalos do ambiente e sessões para fechar">
      Gargalos
      {stuck > 0 ? <span className={`${styles.count} ${styles.tone_bad}`}>{stuck} travadas</span> : null}
      {closable > 0 ? <span className={`${styles.count} ${styles.tone_close}`}>{closable} para fechar</span> : null}
    </button>
  );
}

const ORDER: readonly PulseState[] = ['trabalhando', 'esperando-api', 'precisa-dono', 'travada', 'ociosa', 'pode-fechar', 'desconhecido'];

function pct(ratio: number | null): string {
  return ratio === null ? '—' : `${Math.round(ratio * 100)}%`;
}

function hhmm(at: number): string {
  return new Date(at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

interface PanelProps {
  readonly view: EnvView;
  readonly onClose: () => void;
  readonly onRefresh: () => void;
  /** Closes these tabs (same path as `sessao_fechar`: the remote session ends with its tab). */
  readonly onCloseSessions?: (tabIds: readonly string[]) => void;
  readonly onGoTo?: (tabId: string) => void;
}

export function EnvironmentPanel({ view, onClose, onRefresh, onCloseSessions, onGoTo }: PanelProps): React.JSX.Element {
  const { panel } = view;
  // Until the owner touches a box, the marks follow the reading ("pode fechar" pre-marked); after, they are his.
  const [manual, setManual] = useState<ReadonlySet<string> | null>(null);
  const marked = manual ?? new Set(panel.closable.filter((entry) => entry.premarked).map((entry) => entry.session.sessionId));
  const [confirming, setConfirming] = useState(false);
  const [filter, setFilter] = useState<PulseState | null>(null);

  useEffect(() => {
    onRefresh();
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const closableIds = new Set(panel.closable.filter((entry) => entry.canClose).map((entry) => entry.session.sessionId));
  const markedNow = [...marked].filter((id) => closableIds.has(id));
  const toggle = (id: string): void => {
    const next = new Set(marked);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setManual(next);
  };
  const closeMarked = (): void => {
    const tabIds = panel.closable.filter((entry) => entry.canClose && marked.has(entry.session.sessionId)).flatMap((entry) => (entry.session.tabId ? [entry.session.tabId] : []));
    if (tabIds.length > 0) onCloseSessions?.(tabIds);
    setManual(new Set());
    setConfirming(false);
  };
  const machineLabel = (id: string): string => view.machines.find((machine) => machine.id === id)?.label ?? id;
  const listed = view.sessions
    .filter((session) => filter === null || session.pulse.state === filter)
    .slice()
    .sort((a, b) => ORDER.indexOf(a.pulse.state) - ORDER.indexOf(b.pulse.state) || a.machineId.localeCompare(b.machineId) || a.name.localeCompare(b.name));

  return (
    <section className={styles.panel} aria-label="Gargalos do ambiente" data-testid="env-panel">
      <header className={styles.head}>
        <div className={styles.title}>
          <b>Gargalos do ambiente</b>
          <span>
            {panel.total} sessões em {view.machines.length} máquinas · lido na própria máquina{view.readAt ? ` às ${hhmm(view.readAt)}` : ''}, repete a cada minuto
          </span>
        </div>
        <div className={styles.tally} role="group" aria-label="Filtrar por estado">
          {ORDER.map((state) => (
            <button
              key={state}
              type="button"
              className={`${styles.tallyItem} ${styles[`tone_${PULSE_TONE[state]}`]}`}
              aria-pressed={filter === state}
              onClick={() => setFilter((current) => (current === state ? null : state))}
              disabled={panel.counts[state] === 0}
            >
              <b>{panel.counts[state]}</b> {PULSE_LABEL[state]}
            </button>
          ))}
        </div>
        <button type="button" className={styles.close} onClick={onClose} aria-label="Fechar o painel">
          ×
        </button>
      </header>

      <div className={styles.body}>
        <div className={styles.columns}>
          <div className={styles.col}>
            <h3 className={styles.h}>Gargalos</h3>
            {panel.bottlenecks.length === 0 ? <p className={styles.muted}>Nenhum gargalo agora.</p> : null}
            <ul className={styles.list}>
              {panel.bottlenecks.map((item) => (
                <li key={item.id} className={`${styles.bottleneck} ${item.severity === 'alta' ? styles.sev_alta : styles.sev_media}`}>
                  <b>{item.title}</b>
                  <span>{item.detail}</span>
                </li>
              ))}
            </ul>

            <h3 className={styles.h}>Máquinas</h3>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Máquina</th>
                  <th>RAM</th>
                  <th>Carga/CPU</th>
                  <th>Sessões</th>
                  <th>Memória delas</th>
                  <th>Conta</th>
                </tr>
              </thead>
              <tbody>
                {panel.perMachine.map(({ machine, counts, total, rssBytes }) => (
                  <tr key={machine.id}>
                    <td>
                      {machine.label}
                      {machine.reachable ? null : <em className={styles.down}> sem sinal</em>}
                    </td>
                    <td className={machine.ramUsedRatio !== null && machine.ramUsedRatio >= 0.85 ? styles.hot : undefined}>{pct(machine.ramUsedRatio)}</td>
                    <td>{machine.loadPerCpu === null ? '—' : machine.loadPerCpu.toFixed(2).replace('.', ',')}</td>
                    <td>
                      {total} · <span className={styles.tone_ok}>{counts.trabalhando + counts['esperando-api']} andando</span>
                    </td>
                    <td>{rssBytes > 0 ? formatBytes(rssBytes) : '—'}</td>
                    <td>{machine.account ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <h3 className={styles.h}>Quem espera quem</h3>
            {panel.waits.length === 0 ? <p className={styles.muted}>Nenhuma espera entre mãe e filha agora.</p> : null}
            <ul className={styles.list}>
              {panel.waits.map((wait) => (
                <li key={`${wait.waiting}>${wait.on}`} className={wait.blocked ? styles.waitBlocked : styles.wait}>
                  {wait.kind === 'mae-espera-filha' ? 'mãe → filha' : 'filha → mãe'} · {wait.text}
                </li>
              ))}
            </ul>
          </div>

          <div className={styles.col}>
            <div className={styles.closeHead}>
              <h3 className={styles.h}>Pode fechar</h3>
              {onCloseSessions ? (
                confirming ? (
                  <span className={styles.confirm}>
                    Fechar {markedNow.length} {markedNow.length === 1 ? 'sessão' : 'sessões'}? A conversa fica guardada e dá para retomar.
                    <button type="button" className={styles.danger} onClick={closeMarked} data-testid="env-close-confirm">
                      Fechar
                    </button>
                    <button type="button" onClick={() => setConfirming(false)}>
                      Cancelar
                    </button>
                  </span>
                ) : (
                  <button type="button" className={styles.danger} disabled={markedNow.length === 0} onClick={() => setConfirming(true)} data-testid="env-close-marked">
                    Fechar {markedNow.length} {markedNow.length === 1 ? 'marcada' : 'marcadas'}
                  </button>
                )
              ) : null}
            </div>
            {panel.closable.length === 0 ? <p className={styles.muted}>Nada para fechar: toda sessão aberta está andando ou espera você.</p> : null}
            {panel.closable.some((entry) => !entry.canClose) ? (
              <p className={styles.muted}>As sem caixa não têm aba neste app: feche pelo app que as abriu.</p>
            ) : null}
            <ul className={styles.list}>
              {panel.closable.map(({ session, canClose }) => (
                <li key={session.sessionId} className={styles.closeRow}>
                  <label title={canClose ? undefined : 'Sem aba neste app: feche pelo app que a abriu.'}>
                    <input type="checkbox" disabled={!canClose} checked={canClose && marked.has(session.sessionId)} onChange={() => toggle(session.sessionId)} />
                    <span className={`${styles.chip} ${styles[`tone_${PULSE_TONE[session.pulse.state]}`]}`}>{PULSE_LABEL[session.pulse.state]}</span>
                    <b>{session.name}</b>
                  </label>
                  <span className={styles.muted}>
                    {session.pulse.reason} · {machineLabel(session.machineId)}
                    {session.rssBytes ? ` · ${formatBytes(session.rssBytes)}` : ''}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <h3 className={styles.h}>Todas as sessões{filter ? ` · ${PULSE_LABEL[filter]}` : ''}</h3>
        <table className={styles.table} data-testid="env-sessions">
          <thead>
            <tr>
              <th>Estado real</th>
              <th>Sessão</th>
              <th>Por quê</th>
              <th>Onde</th>
              <th>Conta</th>
              <th>RAM</th>
              <th>CPU</th>
            </tr>
          </thead>
          <tbody>
            {listed.map((session) => (
              <tr key={session.sessionId}>
                <td>
                  <span className={`${styles.chip} ${styles[`tone_${PULSE_TONE[session.pulse.state]}`]}`} title={session.pulse.source === 'lugar' ? 'lido na própria máquina' : 'pelos sinais que chegaram ao app'}>
                    {PULSE_LABEL[session.pulse.state]}
                  </span>
                </td>
                <td>
                  {session.tabId && onGoTo ? (
                    <button type="button" className={styles.link} onClick={() => onGoTo(session.tabId as string)}>
                      {session.name}
                    </button>
                  ) : (
                    session.name
                  )}
                  {session.projectName ? <span className={styles.muted}> · {session.projectName}</span> : null}
                </td>
                <td>{session.pulse.reason}</td>
                <td>{machineLabel(session.machineId)}</td>
                <td>{session.account ?? '—'}</td>
                <td>{session.rssBytes ? formatBytes(session.rssBytes) : '—'}</td>
                <td>{session.cpuPct === undefined || session.cpuPct === null ? '—' : `${session.cpuPct}%`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/** The short line under a card: "travada · gateway fora do ar há 2 h". */
export function pulseLine(session: EnvSession): string {
  return `${PULSE_LABEL[session.pulse.state]} · ${session.pulse.reason}`;
}
