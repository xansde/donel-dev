// src/oraculo/gate-recados.ts — the contract between the MCP gate (portao.ts) and the recados queue (recados.ts).
// Both PRs add this file with this exact content (t-e195b35c).
import type { BrowserToolOutcome } from '../shared/browser/mcp';
import type { BoardToolCall } from '../shared/mindscape/agent-tools';
import type { LedgerToolCall } from '../shared/ledger/tools';
import type { LedgerCaller } from '../main/ledger-store';
import type { PictureSession } from './portao';

export type SendCall = Extract<BoardToolCall, { tool: 'sessao_enviar' }>;

export interface GateHookResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}

export interface GateRecados {
  /** sessao_enviar of session `sid` (its picture `mine`): answered here, or 'repassar' (the target is not on this machine). */
  enviar(sid: string, mine: PictureSession, call: SendCall): Promise<BrowserToolOutcome | 'repassar'>;
  /** Before a tarefa_* answered here (item 13: a task of a closed place follows its successor). */
  antesDaTarefa(caller: LedgerCaller, mine: PictureSession, call: LedgerToolCall): Promise<void>;
  /** After a tarefa_* answered here: the notices the PC used to give (delivery, travada/precisa-do-dono, verdict). */
  depoisDaTarefa(sid: string, mine: PictureSession, caller: LedgerCaller, call: LedgerToolCall, answerText: string): void;
  /** POST /recados/<evento> from the VPS user-level hooks (loopback only, no MCP token). */
  hook(evento: string, headers: Readonly<Record<string, string>>, body: string): Promise<GateHookResponse>;
}
