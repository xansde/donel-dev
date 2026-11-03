// Navegador integrado — who drives the browser of a session: the agent or the owner. Pure (timers injected).
//
// Two owners with a generation (docs/design/navegador-interno.md, D11/D12):
// - "Assumir" (the owner's gesture) or `navegador_pedir_humano` (the agent asking) hands the browser to the
//   owner under a NEW generation.
// - "Devolver" only gives it back if it carries the CURRENT generation: a late Devolver of an old Assumir is
//   ignored.
// - While the owner drives, every agent tool waits for its turn, up to a ceiling.

export type BrowserOwner = 'agent' | 'human';

export interface BrowserControlSnapshot {
  readonly owner: BrowserOwner;
  readonly generation: number;
  /** Why the agent asked for the owner (`navegador_pedir_humano`); `null` when the owner took it himself. */
  readonly reason: string | null;
  readonly requestedByAgent: boolean;
}

export interface ControlTimers {
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export type AgentTurnResult = 'ok' | 'timeout' | 'disposed';

/** How long an agent tool waits while the owner drives (D11). */
export const OWNER_WAIT_MS = 10 * 60_000;
/** How long `navegador_pedir_humano` waits for the owner to give it back (D12). */
export const HELP_WAIT_MS = 30 * 60_000;

const defaultTimers: ControlTimers = {
  setTimeout: (callback, ms) => setTimeout(callback, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

interface Waiter {
  resolve(result: AgentTurnResult): void;
  timer: unknown;
}

export class BrowserControl {
  private state: BrowserControlSnapshot = { owner: 'agent', generation: 0, reason: null, requestedByAgent: false };
  private readonly listeners = new Set<(snapshot: BrowserControlSnapshot) => void>();
  private readonly waiters = new Set<Waiter>();
  private disposed = false;

  constructor(private readonly timers: ControlTimers = defaultTimers) {}

  snapshot(): BrowserControlSnapshot {
    return this.state;
  }

  onChange(listener: (snapshot: BrowserControlSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** The owner's "Assumir". Returns the new generation (the one his "Devolver" must carry). */
  takeOver(): number {
    return this.handToHuman(null, false);
  }

  /** `navegador_pedir_humano`: an Assumir made by the agent, with the reason shown to the owner. */
  requestHuman(reason: string): number {
    return this.handToHuman(reason, true);
  }

  /** The owner's "Devolver". Ignored (returns `false`) unless `generation` is the current one and the owner drives. */
  handBack(generation: number): boolean {
    if (this.disposed || this.state.owner !== 'human' || generation !== this.state.generation) return false;
    this.set({ owner: 'agent', generation: this.state.generation, reason: null, requestedByAgent: false });
    for (const waiter of [...this.waiters]) this.settle(waiter, 'ok');
    return true;
  }

  /** Resolves `'ok'` as soon as the agent may drive; `'timeout'` after `timeoutMs` with the owner still driving. */
  waitForAgentTurn(timeoutMs: number): Promise<AgentTurnResult> {
    if (this.disposed) return Promise.resolve('disposed');
    if (this.state.owner === 'agent') return Promise.resolve('ok');
    return new Promise<AgentTurnResult>((resolve) => {
      const waiter: Waiter = { resolve, timer: null };
      waiter.timer = this.timers.setTimeout(() => this.settle(waiter, 'timeout'), timeoutMs);
      this.waiters.add(waiter);
    });
  }

  /**
   * `navegador_pedir_humano` end to end: hands the browser to the owner and waits for "Devolver". When the
   * ceiling passes and the request is still the one open (the owner never touched it), it is withdrawn so the
   * agent is not stuck forever; an Assumir the owner made in between stays his.
   */
  async askHuman(reason: string, timeoutMs: number): Promise<AgentTurnResult> {
    const generation = this.requestHuman(reason);
    const result = await this.waitForAgentTurn(timeoutMs);
    if (result === 'timeout' && this.state.generation === generation && this.state.requestedByAgent) this.handBack(generation);
    return result;
  }

  /** The session left: every waiting tool returns `'disposed'`. */
  dispose(): void {
    this.disposed = true;
    for (const waiter of [...this.waiters]) this.settle(waiter, 'disposed');
    this.listeners.clear();
  }

  private handToHuman(reason: string | null, requestedByAgent: boolean): number {
    if (this.disposed) return this.state.generation;
    this.set({ owner: 'human', generation: this.state.generation + 1, reason, requestedByAgent });
    return this.state.generation;
  }

  private settle(waiter: Waiter, result: AgentTurnResult): void {
    if (!this.waiters.delete(waiter)) return;
    this.timers.clearTimeout(waiter.timer);
    waiter.resolve(result);
  }

  private set(next: BrowserControlSnapshot): void {
    this.state = next;
    for (const listener of [...this.listeners]) listener(next);
  }
}
