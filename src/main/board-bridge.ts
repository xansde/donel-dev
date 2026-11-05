import { randomUUID } from 'node:crypto';
import type { BrowserWindow, IpcMain, WebContents } from 'electron';
import type { BrowserToolOutcome } from '../shared/browser/mcp';
import type { BoardToolCall } from '../shared/mindscape/agent-tools';
import { MINDSCAPE_CHANNELS, type MindscapeBoardResponse } from '../shared/mindscape/channels';

// Quadro por MCP — the main only relays (ADR 0004: the renderer owns the Mindscape document and the tabs).
// A board or session tool call of the MCP server `donel` goes to the main window's renderer with a request
// id; the answer comes back on `boardRespond`. No window, or no answer in time → a tool error the agent reads.

/** Most tools answer in milliseconds; this only catches a renderer that is not there. */
const DEFAULT_TIMEOUT_MS = 15_000;
/** `sessao_abrir` may wait for the owner to allow a 5th session ("Precisa de você"). */
const OWNER_DECISION_TIMEOUT_MS = 30 * 60_000;
/** `sessao_fechar` may wait up to 20 s for the destination's turn to end. */
const CLOSE_TIMEOUT_MS = 45_000;
/** `sessao_enviar` waits up to 40 s for the destination's CLI to take the message (`agentBridge.ts`). */
const SEND_TIMEOUT_MS = 50_000;

export interface BoardBridgeDeps {
  readonly ipcMain: IpcMain;
  getWindow(): BrowserWindow | null;
  isMainSender(sender: WebContents): boolean;
}

export interface BoardBridge {
  execute(ptyId: string, call: BoardToolCall): Promise<BrowserToolOutcome>;
}

export function createBoardBridge(deps: BoardBridgeDeps): BoardBridge {
  const pending = new Map<string, { resolve: (outcome: BrowserToolOutcome) => void; timer: ReturnType<typeof setTimeout> }>();

  deps.ipcMain.on(MINDSCAPE_CHANNELS.boardRespond, (event, raw: unknown) => {
    if (!deps.isMainSender(event.sender)) return;
    const response = raw as Partial<MindscapeBoardResponse> | null;
    if (!response || typeof response.requestId !== 'string' || typeof response.text !== 'string') return;
    const entry = pending.get(response.requestId);
    if (!entry) return;
    pending.delete(response.requestId);
    clearTimeout(entry.timer);
    entry.resolve(response.ok === true ? { kind: 'text', text: response.text } : { kind: 'error', text: response.text });
  });

  return {
    execute: (ptyId, call) =>
      new Promise<BrowserToolOutcome>((resolve) => {
        const window = deps.getWindow();
        if (!window || window.isDestroyed()) {
          resolve({ kind: 'error', text: 'A janela do Donel Dev não está aberta.' });
          return;
        }
        const requestId = randomUUID();
        const timeoutMs = call.tool === 'sessao_abrir' ? OWNER_DECISION_TIMEOUT_MS : call.tool === 'sessao_fechar' ? CLOSE_TIMEOUT_MS : call.tool === 'sessao_enviar' ? SEND_TIMEOUT_MS : DEFAULT_TIMEOUT_MS;
        const timer = setTimeout(() => {
          pending.delete(requestId);
          resolve({ kind: 'error', text: 'O app não respondeu a tempo. Tente de novo.' });
        }, timeoutMs);
        pending.set(requestId, { resolve, timer });
        window.webContents.send(MINDSCAPE_CHANNELS.boardRequest, { requestId, ptyId, call });
      }),
  };
}
