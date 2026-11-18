// src/oraculo/gate-abrir.ts — the contract between the MCP gate (portao.ts) and the opening of a session on this
// machine while the PC is off (abrir-local.ts; t-1a3f7150, docs/adr/0009).
import type { BrowserToolOutcome } from '../shared/browser/mcp';
import type { BoardToolCall } from '../shared/mindscape/agent-tools';
import type { PictureSession } from './portao';

export type OpenCall = Extract<BoardToolCall, { tool: 'sessao_abrir' }>;

export interface GateAbrir {
  /**
   * `sessao_abrir` of session `sid` (its picture `mine`) when nothing listens on its tunnel (the PC is off): the gate
   * calls this only then, never with the PC silent or on (the call may be running there).
   */
  abrir(sid: string, mine: PictureSession, call: OpenCall): Promise<BrowserToolOutcome>;
}
