import { randomUUID } from 'node:crypto';
import type { BrowserWindow, IpcMain, WebContents } from 'electron';
import type { BrowserToolOutcome } from '../shared/browser/mcp';
import type { BoardToolCall } from '../shared/mindscape/agent-tools';
import type { LedgerDeliveredTo } from '../shared/ledger/contract';
import { MINDSCAPE_CHANNELS, type MindscapeBoardResponse, type MindscapeOwnerMessageResponse } from '../shared/mindscape/channels';
import type { OwnerMessage } from './ledger-card-writer';

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
/** What the owner wrote on a card: up to 40 s to the place, then up to 40 s to the Líder. */
const OWNER_MESSAGE_TIMEOUT_MS = 2 * SEND_TIMEOUT_MS;

export interface BoardBridgeDeps {
  readonly ipcMain: IpcMain;
  getWindow(): BrowserWindow | null;
  isMainSender(sender: WebContents): boolean;
}

export interface BoardBridge {
  execute(ptyId: string, call: BoardToolCall): Promise<BrowserToolOutcome>;
  /** Cartas forma A — delivers what the owner wrote on a card; where it went (`null` = nobody open, or no window). */
  deliverOwnerMessage(message: OwnerMessage): Promise<LedgerDeliveredTo>;
}

export function createBoardBridge(deps: BoardBridgeDeps): BoardBridge {
  const pending = new Map<string, { resolve: (outcome: BrowserToolOutcome) => void; timer: ReturnType<typeof setTimeout> }>();
  const ownerPending = new Map<string, { resolve: (to: LedgerDeliveredTo) => void; timer: ReturnType<typeof setTimeout> }>();

  deps.ipcMain.on(MINDSCAPE_CHANNELS.ownerMessageRespond, (event, raw: unknown) => {
    if (!deps.isMainSender(event.sender)) return;
    const response = raw as Partial<MindscapeOwnerMessageResponse> | null;
    if (!response || typeof response.requestId !== 'string') return;
    const entry = ownerPending.get(response.requestId);
    if (!entry) return;
    ownerPending.delete(response.requestId);
    clearTimeout(entry.timer);
    const to = response.deliveredTo;
    entry.resolve(to === 'lider' ? 'lider' : to && typeof to === 'object' && typeof to.placeId === 'string' ? { placeId: to.placeId } : null);
  });

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
    deliverOwnerMessage: (message) =>
      new Promise<LedgerDeliveredTo>((resolve) => {
        const window = deps.getWindow();
        if (!window || window.isDestroyed()) {
          resolve(null);
          return;
        }
        const requestId = randomUUID();
        // No answer in time: the send driver may still deliver it, but the card cannot say where; it says "guardado".
        const timer = setTimeout(() => {
          ownerPending.delete(requestId);
          resolve(null);
        }, OWNER_MESSAGE_TIMEOUT_MS);
        ownerPending.set(requestId, { resolve, timer });
        window.webContents.send(MINDSCAPE_CHANNELS.ownerMessage, { requestId, ...message });
      }),
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
          // 07/11 — a send keeps going after this: "tente de novo" made senders paste it twice. A resend of the same
          // text now answers for the first one (sendDriver `dedupe`), so repeating it is safe and tells where it is.
          resolve({
            kind: 'error',
            text:
              call.tool === 'sessao_enviar'
                ? 'O app não respondeu a tempo, mas a mensagem pode ter entrado. Mandar de novo o mesmo texto não duplica: responde onde ela está. Ou confira com sessao_ver_tela.'
                : 'O app não respondeu a tempo. Tente de novo.',
          });
        }, timeoutMs);
        pending.set(requestId, { resolve, timer });
        window.webContents.send(MINDSCAPE_CHANNELS.boardRequest, { requestId, ptyId, call });
      }),
  };
}
