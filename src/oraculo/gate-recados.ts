// src/oraculo/gate-recados.ts — the contract between the MCP gate (portao.ts) and the recados queue (recados.ts).
// Both PRs add this file with this exact content (t-e195b35c).
import type { BrowserToolOutcome } from '../shared/browser/mcp';
import type { BoardToolCall } from '../shared/mindscape/agent-tools';
import type { LedgerToolCall } from '../shared/ledger/tools';
import type { LedgerCaller } from '../main/ledger-store';
import type { PictureSession } from './portao';

export type SendCall = Extract<BoardToolCall, { tool: 'sessao_enviar' }>;
export type ScreenCall = Extract<BoardToolCall, { tool: 'sessao_ver_tela' }>;
export type CloseCall = Extract<BoardToolCall, { tool: 'sessao_fechar' }>;

export interface GateHookResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}

export interface GateRecados {
  /**
   * sessao_enviar of session `sid` (its picture `mine`): answered here, or 'repassar' (the PC decides). With the PC on
   * (`pc` 'ligado', the default) anything the picture alone cannot send goes on to it: a target off this machine, and a
   * place or an arrow the picture does not know yet (opened or drawn after it). With the PC off ('desligado') it never
   * passes on: the picture answers, and a target off this machine goes to the PC's relay.
   */
  enviar(sid: string, mine: PictureSession, call: SendCall, pc?: 'ligado' | 'desligado'): Promise<BrowserToolOutcome | 'repassar'>;
  /**
   * t-d461e003 — the Líder único's `sessao_ver_tela` with the PC off: the screen of a place he reaches that runs in this
   * machine's tmux (only reads). `sid` = the Líder's own session.
   */
  verTela?(sid: string, call: ScreenCall): Promise<BrowserToolOutcome>;
  /**
   * t-d461e003 — the Líder único's `sessao_fechar` with the PC off for sure (the gate checks it): ends the tmux of a
   * place he reaches that runs here, never mid-turn nor with a dialog on its screen. The folder stays: the PC's app
   * clears it when it comes back and finds the tmux gone.
   */
  fechar?(sid: string, call: CloseCall): Promise<BrowserToolOutcome>;
  /** Before a tarefa_* answered here (item 13: a task of a closed place follows its successor). */
  antesDaTarefa(caller: LedgerCaller, mine: PictureSession, call: LedgerToolCall): Promise<void>;
  /**
   * t-8406f473 — before a `card_move`/`card_justify` of a card that carries an Oráculo task (`taskId`, its `oraculo_id`):
   * the same renewal (a closed place's task follows its successor), since moving the card works the task.
   */
  antesDoCartao?(caller: LedgerCaller, mine: PictureSession, taskId: string): Promise<void>;
  /** After a tarefa_* answered here: the notices the PC used to give (delivery, travada/precisa-do-dono, verdict). */
  depoisDaTarefa(sid: string, mine: PictureSession, caller: LedgerCaller, call: LedgerToolCall, answerText: string): void;
  /** POST /recados/<evento> from the VPS user-level hooks (loopback only, no MCP token). */
  hook(evento: string, headers: Readonly<Record<string, string>>, body: string): Promise<GateHookResponse>;
}
