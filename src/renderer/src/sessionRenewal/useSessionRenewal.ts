// Sessão renovada em voo (B36) — the renderer plumbing. Per tab, a small machine:
//
//   idle ──(limit crossed at the end of a turn)──▶ preparing ──▶ asked ──(handoff written,
//   nothing alive, turn over)──▶ swapping ──(new session id resolved)──▶ idle
//
// `asked`: the session got the request and is writing the handoff. `swapping`: the old process was
// ended and the new one is starting in the same pane. Every judgement is pure
// (`shared/sessionRenewal.ts`); here only timers, IPC and the per-tab memory. "Agora não" moves
// the threshold by RENEWAL_SNOOZE_TOKENS and, mid-renewal, leaves the session as it is.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { SemaphoreState } from '../../../shared';
import {
  checkRenewal,
  decideSwap,
  renewalThreshold,
  snoozeMark,
  type RenewalPrepared,
  type SessionRenewalPrefs,
} from '../../../shared/sessionRenewal';

export interface RenewalTabInput {
  readonly tabId: string;
  readonly ptyId: string | null;
  readonly sessionId: string | null;
  /** A plain session tab with a live process (not a login tab, not an isolated worktree). */
  readonly eligible: boolean;
  readonly contextTokens: number | null;
  readonly turn: SemaphoreState | null;
  readonly stateEnteredAt: number;
  readonly backgroundAgents: boolean;
}

export interface RenewalPorts {
  /** One line to the session (the chat's send driver, or typed into the terminal). */
  send(tabId: string, text: string): void;
  /** Ends the process and opens the new conversation in the same pane; `false` without a pane. */
  renew(tabId: string, renewalId: string): boolean;
  toast(message: string): void;
}

export type RenewalBanner =
  | { readonly kind: 'near' | 'due'; readonly tokens: number; readonly threshold: number }
  | { readonly kind: 'asked' }
  | { readonly kind: 'live-work'; readonly liveWork: string }
  | { readonly kind: 'swapping' };

export interface RenewalCompletion {
  readonly previousSessionId: string;
  readonly handoffPath: string;
  readonly firstPrompt: string;
}

export interface SessionRenewalHandle {
  readonly banners: Readonly<Record<string, RenewalBanner>>;
  /** Tabs renewed in this run of the app (statusbar suffix). */
  readonly renewed: Readonly<Record<string, RenewalCompletion>>;
  /** "Agora não". */
  snooze(tabId: string): void;
  /** The pane of `tabId` resolved a session id: closes the renewal in flight, if this is its new session. */
  takeCompletion(tabId: string, sessionId: string | undefined): RenewalCompletion | null;
  forget(tabId: string): void;
}

type Machine =
  | { readonly phase: 'idle'; readonly sessionId: string | null; readonly snoozedUntil: number | null }
  | { readonly phase: 'preparing'; readonly sessionId: string | null; readonly snoozedUntil: number | null }
  | {
      readonly phase: 'asked';
      readonly sessionId: string | null;
      readonly snoozedUntil: number | null;
      readonly prepared: RenewalPrepared;
      readonly askedAt: number;
      lastCheckedEnteredAt: number;
      checking: boolean;
      missingChecks: number;
      liveWork: string | null;
    }
  | { readonly phase: 'swapping'; readonly sessionId: string | null; readonly snoozedUntil: number | null; readonly prepared: RenewalPrepared; readonly startedAt: number };

/** The new process must report its session id within this; otherwise the renewal is called off. */
const SWAP_TIMEOUT_MS = 60_000;

const BACKGROUND_WORK = 'agentes em segundo plano ainda rodando';

const idle = (sessionId: string | null, snoozedUntil: number | null = null): Machine => ({ phase: 'idle', sessionId, snoozedUntil });

function bannerOf(machine: Machine, input: RenewalTabInput, prefs: SessionRenewalPrefs): RenewalBanner | null {
  if (machine.phase === 'swapping') return { kind: 'swapping' };
  if (machine.phase === 'preparing') return { kind: 'asked' };
  if (machine.phase === 'asked') return machine.liveWork !== null ? { kind: 'live-work', liveWork: machine.liveWork } : { kind: 'asked' };
  const verdict = checkRenewal({
    prefs,
    contextTokens: input.contextTokens,
    turn: input.turn ?? 'working',
    backgroundAgents: input.backgroundAgents,
    snoozedUntilTokens: machine.snoozedUntil,
    eligible: input.eligible,
  });
  if (verdict === 'off' || input.contextTokens === null) return null;
  const threshold = renewalThreshold(prefs, machine.snoozedUntil);
  return { kind: verdict === 'near' ? 'near' : 'due', tokens: input.contextTokens, threshold };
}

function sameBanner(a: RenewalBanner | undefined, b: RenewalBanner | null): boolean {
  if (a === undefined || b === null) return a === undefined && b === null;
  return JSON.stringify(a) === JSON.stringify(b);
}

export function useSessionRenewal(inputs: readonly RenewalTabInput[], prefs: SessionRenewalPrefs, ports: RenewalPorts): SessionRenewalHandle {
  const machines = useRef(new Map<string, Machine>());
  const inputsRef = useRef(new Map<string, RenewalTabInput>());
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;
  const portsRef = useRef(ports);
  portsRef.current = ports;
  const [banners, setBanners] = useState<Record<string, RenewalBanner>>({});
  const [renewed, setRenewed] = useState<Record<string, RenewalCompletion>>({});
  /** Bumped by async steps (IPC answers, timers) so the evaluation runs again with fresh inputs. */
  const [tick, setTick] = useState(0);
  const bump = useCallback(() => setTick((value) => value + 1), []);

  const evaluate = useCallback((input: RenewalTabInput): void => {
    const { tabId } = input;
    let machine = machines.current.get(tabId) ?? idle(input.sessionId);
    // `/clear`, `/resume`: another conversation in the tab — what was decided for the old one does not carry.
    if (machine.phase !== 'swapping' && machine.sessionId !== input.sessionId) machine = idle(input.sessionId);
    const current = prefsRef.current;

    if (machine.phase === 'idle') {
      const verdict = checkRenewal({
        prefs: current,
        contextTokens: input.contextTokens,
        turn: input.turn ?? 'working',
        backgroundAgents: input.backgroundAgents,
        snoozedUntilTokens: machine.snoozedUntil,
        eligible: input.eligible,
      });
      if (verdict === 'renew' && input.ptyId !== null && input.contextTokens !== null) {
        const preparing: Machine = { phase: 'preparing', sessionId: input.sessionId, snoozedUntil: machine.snoozedUntil };
        machine = preparing;
        const contextTokens = input.contextTokens;
        void window.donel.renewal
          .prepare({ ptyId: input.ptyId, contextTokens, limitTokens: current.limitTokens })
          .catch(() => null)
          .then((prepared) => {
            if (machines.current.get(tabId) !== preparing) return;
            if (prepared === null) {
              machines.current.set(tabId, idle(input.sessionId, snoozeMark(prefsRef.current, contextTokens)));
              portsRef.current.toast('Não consegui preparar a renovação desta sessão. Tento de novo mais adiante.');
            } else {
              machines.current.set(tabId, {
                phase: 'asked',
                sessionId: input.sessionId,
                snoozedUntil: preparing.snoozedUntil,
                prepared,
                askedAt: Date.now(),
                lastCheckedEnteredAt: 0,
                checking: false,
                missingChecks: 0,
                liveWork: null,
              });
              portsRef.current.send(tabId, prepared.requestPrompt);
            }
            bump();
          });
      }
    } else if (machine.phase === 'asked') {
      const asked = machine;
      if (input.turn === 'done' || input.turn === 'error' || !input.eligible) {
        // the process left on its own: nothing to swap
        machine = idle(input.sessionId, asked.snoozedUntil);
      } else if (input.turn === 'waiting' && input.stateEnteredAt > asked.askedAt && input.stateEnteredAt > asked.lastCheckedEnteredAt && !asked.checking) {
        asked.checking = true;
        asked.lastCheckedEnteredAt = input.stateEnteredAt;
        void window.donel.renewal
          .status(asked.prepared.renewalId)
          .catch(() => ({ kind: 'missing' }) as const)
          .then((handoff) => {
            asked.checking = false;
            if (machines.current.get(tabId) !== asked) return;
            const now = inputsRef.current.get(tabId);
            if (now === undefined) return;
            const verdict = decideSwap({
              handoff,
              turn: now.turn ?? 'working',
              backgroundAgents: now.backgroundAgents,
              turnEndedSinceAsk: now.stateEnteredAt > asked.askedAt,
            });
            if (verdict === 'swap') {
              if (portsRef.current.renew(tabId, asked.prepared.renewalId)) {
                machines.current.set(tabId, {
                  phase: 'swapping',
                  sessionId: asked.sessionId,
                  snoozedUntil: null,
                  prepared: asked.prepared,
                  startedAt: Date.now(),
                });
                setTimeout(bump, SWAP_TIMEOUT_MS + 100);
              } else {
                machines.current.set(tabId, idle(asked.sessionId, snoozeMark(prefsRef.current, now.contextTokens)));
              }
            } else if (verdict === 'wait-live-work') {
              asked.liveWork = handoff.kind === 'ready' && handoff.liveWork !== null ? handoff.liveWork : BACKGROUND_WORK;
            } else if (verdict === 'give-up') {
              // one turn may have been the owner's own message, ahead of the request: wait for one more
              if (handoff.kind === 'missing' && asked.missingChecks === 0 && now.turn === 'waiting') {
                asked.missingChecks = 1;
              } else {
                machines.current.set(tabId, idle(asked.sessionId, snoozeMark(prefsRef.current, now.contextTokens)));
                portsRef.current.toast('A sessão não escreveu a passagem de bastão, então segue como está. A renovação fica para mais adiante.');
              }
            }
            bump();
          });
      }
    } else if (machine.phase === 'swapping' && Date.now() - machine.startedAt > SWAP_TIMEOUT_MS) {
      machine = idle(input.sessionId);
      portsRef.current.toast('A sessão nova não respondeu a tempo. Confira a aba: a passagem de bastão ficou salva.');
    }
    machines.current.set(tabId, machine);
  }, [bump]);

  // Key of what the decisions read: re-evaluate only when it changes (or an async step bumps).
  const key = inputs
    .map((i) => `${i.tabId}|${i.ptyId}|${i.sessionId}|${i.eligible}|${i.contextTokens}|${i.turn}|${i.stateEnteredAt}|${i.backgroundAgents}`)
    .join(';');
  const prefsKey = `${prefs.enabled}|${prefs.limitTokens}`;

  useEffect(() => {
    const next = new Map<string, RenewalTabInput>();
    for (const input of inputs) next.set(input.tabId, input);
    inputsRef.current = next;
    for (const input of inputs) evaluate(input);
    setBanners((prev) => {
      const out: Record<string, RenewalBanner> = {};
      for (const input of inputs) {
        const machine = machines.current.get(input.tabId);
        const banner = machine ? bannerOf(machine, input, prefsRef.current) : null;
        if (banner !== null) out[input.tabId] = banner;
      }
      const changed =
        Object.keys(out).length !== Object.keys(prev).length || Object.entries(out).some(([tabId, banner]) => !sameBanner(prev[tabId], banner));
      return changed ? out : prev;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, prefsKey, tick, evaluate]);

  const snooze = useCallback(
    (tabId: string): void => {
      const machine = machines.current.get(tabId);
      const input = inputsRef.current.get(tabId);
      if (machine === undefined || input === undefined || machine.phase === 'swapping') return;
      machines.current.set(tabId, idle(input.sessionId, snoozeMark(prefsRef.current, input.contextTokens)));
      bump();
    },
    [bump],
  );

  const takeCompletion = useCallback(
    (tabId: string, sessionId: string | undefined): RenewalCompletion | null => {
      const machine = machines.current.get(tabId);
      if (machine === undefined || machine.phase !== 'swapping' || !sessionId || sessionId === machine.prepared.previousSessionId) return null;
      const completion: RenewalCompletion = {
        previousSessionId: machine.prepared.previousSessionId,
        handoffPath: machine.prepared.handoffPath,
        firstPrompt: machine.prepared.firstPrompt,
      };
      machines.current.set(tabId, idle(sessionId));
      setRenewed((prev) => ({ ...prev, [tabId]: completion }));
      bump();
      return completion;
    },
    [bump],
  );

  const forget = useCallback((tabId: string): void => {
    machines.current.delete(tabId);
    setRenewed((prev) => {
      if (!(tabId in prev)) return prev;
      const next = { ...prev };
      delete next[tabId];
      return next;
    });
  }, []);

  return { banners, renewed, snooze, takeCompletion, forget };
}
