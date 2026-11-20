// t-69eefa2c (20/11) — com o PC fora, o Líder único da VPS pessoal vê a tela de uma sessão que roda em outra máquina
// (o Dalton, na Homologações). There is no way from the personal VPS to the satellite: every channel is the satellite
// calling the registro. So the screen goes as an order in the openings exchange the satellite already makes every
// round (`POST /v1/portao/aberturas`, abrir-satelite.ts):
//
// - The Líder único's `sessao_ver_tela` (recados.ts `verTela`, reach checked there) of a place with no session in this
//   tmux asks `ask(pasta, lugar)`: the machine whose fresh picture has that place gets an order in memory, and the call
//   waits for its answer, at most `timeoutMs`. Apart, the entregador asks the registro through `POST /v1/portao/tela`
//   (`createRemoteScreenClient`, its local gate's token only).
// - The satellite reads the orders in its next exchange, captures each screen in its own tmux (recados.ts `screenOf`,
//   secrets masked there) and says them in the same round.
// - Only the machine an order was asked of answers it (`exchange(name, …)`); another machine's answer is ignored.
//
// Deadlines in cascade, under the CLI's 60 s cut of an MCP call: a satellite round every 10 s, the registro waits 25 s,
// the entregador's client 30 s. Nothing goes to disk; a screen is never logged. An old satellite never answers: the
// order runs out with a clear error. An old registro ignores the field: the entregador's client hears no screen.

import { randomUUID } from 'node:crypto';
import type { BrowserToolOutcome } from '../shared/browser/mcp';
import { GATE_SCREEN_PATH } from './portoes';
import type { RemotePictures, RemotePictureView } from './retrato-satelite';
import { postJson, type SatellitePost } from './satelite';

/** How long the registro waits for a satellite's screen (it asks every 10 s). */
export const SCREEN_WAIT_MS = 25_000;
/** How long the entregador apart waits for the registro's answer: past `SCREEN_WAIT_MS`, under the CLI's 60 s. */
const SCREEN_CLIENT_MS = 30_000;
/** Orders handed to one machine per exchange. */
export const MAX_SCREEN_ORDERS = 10;
/** A screen as the satellite says it: up to this (60 lines of a wide terminal fit with room). */
export const MAX_SCREEN_TEXT = 64 * 1024;

/** One order as it goes to the satellite. */
export interface ScreenOrder {
  readonly id: string;
  readonly pasta: string;
  readonly lugar: string;
}

/** One answer as the satellite says it. */
export interface ScreenAnswer {
  readonly id: string;
  readonly ok: boolean;
  readonly text: string;
}

export interface RemoteScreens {
  /** The screen of `lugar` on the board `pasta`, from the machine that runs it; `null` = no other machine runs it. */
  ask(pasta: string, lugar: string): Promise<{ readonly ok: boolean; readonly text: string } | null>;
  /** Machine `name` said `telas`: only the orders asked of it are settled. What still waits for it. */
  exchange(name: string, telas: readonly ScreenAnswer[]): ScreenOrder[];
}

interface Waiting {
  readonly order: ScreenOrder;
  readonly machine: string;
  readonly settle: (answer: { readonly ok: boolean; readonly text: string }) => void;
}

/** The registro's side (or the entregador's, with the registro in its process). Memory only. */
export function createRemoteScreens(deps: {
  readonly pictures: Pick<RemotePictures, 'machineOf' | 'labelOf'>;
  readonly timeoutMs?: number;
  readonly log?: (line: string) => void;
}): RemoteScreens {
  const timeoutMs = deps.timeoutMs ?? SCREEN_WAIT_MS;
  const log = deps.log ?? ((line: string) => console.error(`[oraculo] tela: ${line}`));
  const waiting = new Map<string, Waiting>();

  return {
    ask(pasta, lugar) {
      const machine = deps.pictures.machineOf(pasta, lugar);
      if (!machine) return Promise.resolve(null);
      const order: ScreenOrder = { id: randomUUID(), pasta, lugar };
      return new Promise((resolve) => {
        const timer = setTimeout(() => {
          if (!waiting.delete(order.id)) return;
          log(`pedido ${order.id} a ${machine} sem resposta em ${Math.ceil(timeoutMs / 1000)} s.`);
          resolve({ ok: false, text: `${deps.pictures.labelOf(machine)} não mandou a tela em ${Math.ceil(timeoutMs / 1000)} s (o satélite de lá chama a cada 10 s); tente de novo.` });
        }, timeoutMs);
        timer.unref?.();
        waiting.set(order.id, {
          order,
          machine,
          settle: (answer) => {
            clearTimeout(timer);
            resolve(answer);
          },
        });
      });
    },

    exchange(name, telas) {
      for (const answer of telas) {
        const entry = waiting.get(answer.id);
        if (!entry || entry.machine !== name) continue;
        waiting.delete(answer.id);
        entry.settle({ ok: answer.ok, text: answer.text });
      }
      return [...waiting.values()]
        .filter((entry) => entry.machine === name)
        .map((entry) => entry.order)
        .slice(0, MAX_SCREEN_ORDERS);
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The `telas` of a satellite's exchange: up to `MAX_SCREEN_ORDERS`, each text up to `MAX_SCREEN_TEXT`; `null` = bad. */
export function screenAnswersOf(value: unknown): ScreenAnswer[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_SCREEN_ORDERS) return null;
  const answers: ScreenAnswer[] = [];
  for (const item of value) {
    if (!isRecord(item) || typeof item.id !== 'string' || typeof item.ok !== 'boolean' || typeof item.text !== 'string' || item.text.length > MAX_SCREEN_TEXT) return null;
    answers.push({ id: item.id, ok: item.ok, text: item.text });
  }
  return answers;
}

/** The orders in a registro's answer to the satellite (a bad one is dropped). */
export function screenOrdersOf(value: unknown): ScreenOrder[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is Record<string, unknown> => isRecord(item) && typeof item.id === 'string' && !!item.id && typeof item.pasta === 'string' && !!item.pasta && typeof item.lugar === 'string' && !!item.lugar)
    .slice(0, MAX_SCREEN_ORDERS)
    .map((item) => ({ id: item.id as string, pasta: item.pasta as string, lugar: item.lugar as string }));
}

/**
 * The entregador apart: the screen of a place of another machine asked of the registro (its local gate's token), which
 * alone talks to the satellites. With `view`, asked only for a place a fresh picture has. `null` = no other machine
 * runs it (or the registro is older than this route).
 */
export function createRemoteScreenClient(deps: {
  readonly url: string;
  readonly token: () => string | null;
  readonly view?: Pick<RemotePictureView, 'machineOf'>;
  readonly timeoutMs?: number;
  readonly post?: (url: string, token: string, body: string, timeoutMs: number) => Promise<SatellitePost>;
}): (pasta: string, lugar: string) => Promise<BrowserToolOutcome | null> {
  const post = deps.post ?? postJson;
  const url = `${deps.url.replace(/\/+$/, '')}${GATE_SCREEN_PATH}`;
  return async (pasta, lugar) => {
    if (deps.view && !deps.view.machineOf(pasta, lugar)) return null;
    const token = deps.token();
    if (!token) return null;
    const result = await post(url, token, JSON.stringify({ pasta, lugar }), deps.timeoutMs ?? SCREEN_CLIENT_MS);
    if (typeof result !== 'object') return { kind: 'error', text: 'O registro do Oráculo nesta máquina não respondeu; tente de novo.' };
    if (result.status === 404) return null;
    try {
      const answer = JSON.parse(result.body) as { conhecido?: unknown; ok?: unknown; text?: unknown };
      if (answer.conhecido === false) return null;
      if (result.status === 200 && typeof answer.ok === 'boolean' && typeof answer.text === 'string') return { kind: answer.ok ? 'text' : 'error', text: answer.text };
    } catch {
      // below
    }
    return { kind: 'error', text: `O registro do Oráculo recusou o pedido da tela (HTTP ${result.status}).` };
  };
}
