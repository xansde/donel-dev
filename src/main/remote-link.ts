// Sessões remotas — "sem ligação". The PTY of a remote tab is only the ssh that shows the tmux session on the remote
// place, and that ssh carries the reverse tunnels of the hooks and of the MCP. When it drops (network between the
// computer and the place, sleep, a stalled link), the `claude` there keeps running in tmux. Treating that exit as the
// end of the session showed the place as "fechada" while its process went on working, and nothing brought the
// tunnels back (ECONNREFUSED in every hook and MCP call there) until the app restarted.
//
// This supervisor holds such an exit back: the tab stays alive, "sem ligação", and the app asks the place whether the
// tmux session still exists. Alive → the ssh is spawned again on the same ptyId (same tunnels, so hooks and MCP come
// back). Gone → the exit happens for real. Unreachable → it asks again later. Closing the tab in that state ends the
// remote session as a normal close would. Pure of Electron: everything it touches comes in through `deps`.

/** What the remote place answers about the tmux session of a tab. `unreachable` never means "gone". */
export type RemoteLinkProbe = 'alive' | 'gone' | 'unreachable';

export interface RemoteLinkDeps<Exit> {
  /** Asks the place whether the tmux session of `sid` is still there. */
  probe(sshTarget: string, sid: string): Promise<RemoteLinkProbe>;
  /** Spawns the ssh of the tab again, on the same ptyId; `false` when the spawn threw. */
  relink(ptyId: string): boolean;
  /** The exit that was held back happens now (teardown, "fechada"); `closedByOwner` ends the remote session too. */
  finalize(ptyId: string, exit: Exit, closedByOwner: boolean): void;
  /** The tab lost (`false`) or got back (`true`) its link. */
  notify(ptyId: string, linked: boolean): void;
  setTimer(run: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
  now(): number;
}

/** Waits between attempts; the last one repeats while the place stays unreachable. */
export const RELINK_DELAYS_MS: readonly number[] = [1_000, 3_000, 10_000, 30_000, 60_000];
/** A relinked ssh that drops again before this is the same outage: the waits go on growing instead of restarting. */
export const RELINK_STABLE_MS = 60_000;

interface Tracked {
  readonly sshTarget: string;
  readonly sid: string;
}

interface Lost<Exit> {
  attempt: number;
  timer: unknown;
  readonly exit: Exit;
  /** The tab was told it lost its link (a clean exit is not announced until the place fails to answer). */
  announced: boolean;
}

export class RemoteLinkSupervisor<Exit> {
  private readonly tracked = new Map<string, Tracked>();
  private readonly lost = new Map<string, Lost<Exit>>();
  private readonly relinkedAt = new Map<string, { readonly at: number; readonly attempt: number }>();
  private stopped = false;

  constructor(private readonly deps: RemoteLinkDeps<Exit>) {}

  /** A remote tab was spawned: `sid` names its tmux session (`donel-<sid>`). */
  track(ptyId: string, sshTarget: string, sid: string): void {
    this.tracked.set(ptyId, { sshTarget, sid });
  }

  isLost(ptyId: string): boolean {
    return this.lost.has(ptyId);
  }

  /**
   * The PTY of a tab exited. `true` = held back: the tab is "sem ligação" and the app relinks it (the caller does no
   * teardown). `false` = a real exit: not a remote tab, the owner closed it, or the app is quitting.
   * `clean` = the ssh left with 0: the command on the place ended (the session ended there, as a rule), the link did
   * not drop. The place is asked at once and the tab is not shown "sem ligação" unless the place fails to answer:
   * before, every normal end passed through "sem ligação" for a moment (Revisor, #317).
   */
  onPtyExit(ptyId: string, closedByOwner: boolean, exit: Exit, clean = false): boolean {
    const tracked = this.tracked.get(ptyId);
    if (!tracked || closedByOwner || this.stopped) {
      this.forget(ptyId);
      return false;
    }
    const previous = this.relinkedAt.get(ptyId);
    this.relinkedAt.delete(ptyId);
    const attempt = previous && this.deps.now() - previous.at < RELINK_STABLE_MS ? previous.attempt + 1 : 0;
    const entry: Lost<Exit> = { attempt, timer: null, exit, announced: !clean };
    this.lost.set(ptyId, entry);
    if (clean) {
      entry.timer = this.deps.setTimer(() => void this.tryRelink(ptyId, entry), 0);
      return true;
    }
    this.deps.notify(ptyId, false);
    this.schedule(ptyId, entry);
    return true;
  }

  /**
   * The owner (or `sessao_fechar`) closes a tab that is "sem ligação": there is no PTY to kill, so the held exit
   * happens now as a close by the owner, which ends the remote session. `false` = not lost; kill the PTY as usual.
   */
  kill(ptyId: string): boolean {
    const entry = this.lost.get(ptyId);
    if (!entry) return false;
    if (entry.timer !== null) this.deps.clearTimer(entry.timer);
    this.forget(ptyId);
    this.deps.finalize(ptyId, entry.exit, true);
    return true;
  }

  /** `sessao_religar` (t-1293c818) — a tab "sem ligação" tries its relink now instead of waiting its turn. `false` = not lost. */
  relinkNow(ptyId: string): boolean {
    const entry = this.lost.get(ptyId);
    if (!entry || this.stopped) return false;
    if (entry.timer !== null) this.deps.clearTimer(entry.timer);
    entry.timer = this.deps.setTimer(() => void this.tryRelink(ptyId, entry), 0);
    return true;
  }

  /** The app is quitting (or its window closed): no more relinking. */
  stopAll(): void {
    this.stopped = true;
    for (const entry of this.lost.values()) if (entry.timer !== null) this.deps.clearTimer(entry.timer);
    this.lost.clear();
  }

  private forget(ptyId: string): void {
    this.lost.delete(ptyId);
    this.tracked.delete(ptyId);
    this.relinkedAt.delete(ptyId);
  }

  private schedule(ptyId: string, entry: Lost<Exit>): void {
    const delay = RELINK_DELAYS_MS[Math.min(entry.attempt, RELINK_DELAYS_MS.length - 1)];
    entry.timer = this.deps.setTimer(() => void this.tryRelink(ptyId, entry), delay);
  }

  private async tryRelink(ptyId: string, entry: Lost<Exit>): Promise<void> {
    entry.timer = null;
    const tracked = this.tracked.get(ptyId);
    if (!tracked || this.lost.get(ptyId) !== entry) return;
    const answer = await this.deps.probe(tracked.sshTarget, tracked.sid).catch((): RemoteLinkProbe => 'unreachable');
    // Closed by the owner, or the app quit, while the place was being asked.
    if (this.stopped || this.lost.get(ptyId) !== entry) return;
    if (answer === 'gone') {
      this.forget(ptyId);
      this.deps.finalize(ptyId, entry.exit, false);
      return;
    }
    if (answer === 'alive' && this.deps.relink(ptyId)) {
      this.lost.delete(ptyId);
      this.relinkedAt.set(ptyId, { at: this.deps.now(), attempt: entry.attempt });
      if (entry.announced) this.deps.notify(ptyId, true);
      return;
    }
    if (!entry.announced) {
      entry.announced = true;
      this.deps.notify(ptyId, false);
      this.schedule(ptyId, entry); // the first wait of the normal ladder
      return;
    }
    entry.attempt += 1;
    this.schedule(ptyId, entry);
  }
}
