// Limite de handshakes ssh por lugar remoto (t-eb9a736a, 15/11). At 14:32Z the Homologações stalled for about a
// minute (load 50, memory pressure); every remote tab's ssh, and the shared mirror's, gave up on it at once. The app
// then asked every tab's tmux again (one ssh each), spawned every tab's ssh again (one each) and, when the shared
// mirror gave up 44 s later, one `tail -F` ssh per tab: ~140 logins in two minutes on a place that was barely
// answering, which kept it from answering (the mirror "did not come up in 20 s", the MCP tunnels came back late).
//
// Every ssh the app opens to a place for a session (setup and other scripts, the tab, the relink, the per-tab tail)
// first takes one of `SSH_HANDSHAKES_PER_PLACE` slots of that place. A slot is a login in progress: it is given back
// when the ssh shows life (its first byte), when it ends, or after `SSH_HANDSHAKE_HOLD_MS` at most (a silent
// `tail -F`, a long clone), so a long-lived ssh never holds the place. The rest wait in order. Nobody holds a slot
// while waiting for another, so the gate cannot deadlock.

export const SSH_HANDSHAKES_PER_PLACE = 6;
export const SSH_HANDSHAKE_HOLD_MS = 10_000;

/** Gives the slot back. Idempotent: the first byte, the exit and the hold timer may all call it. */
export type SshSlotRelease = () => void;

export interface SshGateTimers {
  setTimer(run: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
}

const realTimers: SshGateTimers = {
  setTimer: (run, ms) => setTimeout(run, ms),
  clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export class SshGate {
  private readonly busy = new Map<string, number>();
  private readonly waiting = new Map<string, Array<() => void>>();

  constructor(
    private readonly limit = SSH_HANDSHAKES_PER_PLACE,
    private readonly holdMs = SSH_HANDSHAKE_HOLD_MS,
    private readonly timers: SshGateTimers = realTimers,
  ) {}

  /** Logins in progress on a place (for tests and logs). */
  inFlight(sshTarget: string): number {
    return this.busy.get(sshTarget) ?? 0;
  }

  /** Waits for a slot of `sshTarget`; the slot frees itself after `holdMs` if nobody gives it back before. */
  acquire(sshTarget: string): Promise<SshSlotRelease> {
    return new Promise((resolve) => {
      const grant = (): void => {
        this.busy.set(sshTarget, this.inFlight(sshTarget) + 1);
        let done = false;
        const release = (): void => {
          if (done) return;
          done = true;
          this.timers.clearTimer(timer);
          this.free(sshTarget);
        };
        const timer = this.timers.setTimer(release, this.holdMs);
        resolve(release);
      };
      if (this.inFlight(sshTarget) < this.limit) grant();
      else {
        const queue = this.waiting.get(sshTarget) ?? [];
        queue.push(grant);
        this.waiting.set(sshTarget, queue);
      }
    });
  }

  private free(sshTarget: string): void {
    const queue = this.waiting.get(sshTarget);
    const next = queue?.shift();
    if (queue && queue.length === 0) this.waiting.delete(sshTarget);
    const left = this.inFlight(sshTarget) - 1;
    if (left <= 0) this.busy.delete(sshTarget);
    else this.busy.set(sshTarget, left);
    next?.();
  }
}

/** The app's one gate: every place's logins go through it. */
export const sshGate = new SshGate();
