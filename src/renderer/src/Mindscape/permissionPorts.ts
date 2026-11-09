// t-1293c818 (3) — dono, 09/11: "precisa do meu clique uma ova". The two doors of `sessao_permissao` (agentBridge.ts):
// reading the permission request open on a tab and answering it, without the owner entering the tab. Two ways a request
// exists, and the held hook goes first because answering it also clears the CLI's dialog:
// - `chat`: the PermissionRequest hook the app holds (main/hook-bridge.ts), answered through `chat:answer`;
// - `tela`: only the dialog drawn by the CLI (no hook came back: a remote place, the chat off), answered with a key —
//   Esc refuses, the digit of "Yes" allows once. Never another option ("don't ask again" is the owner's choice).
// An answer names the request it answers (`askId`): when what is open now is another one, nothing is answered.

import { permissionDialog, type LineInput } from '../../../shared/chat/screen';
import type { ChatOpenPermission } from '../../../shared/chat/ipc';
import type { PermissionAnswer, PermissionAsk } from './agentBridge';

const CHAT_PREFIX = 'chat:';
const SCREEN_PREFIX = 'tela:';
const ESC = '\x1b';
const WHAT_MAX = 1_500;
/** What the hook says to the CLI when the Líder refuses (it reads it as the reason). */
export const LEADER_DENY_REASON = 'Recusado pelo Líder, que responde por esta sessão.';

export interface PermissionPortDeps {
  /** The permission requests the app holds for that tab, oldest first (`[]` = none, or no chat). */
  held(tabId: string): Promise<readonly ChatOpenPermission[]>;
  answerHeld(tabId: string, pendingId: string, answer: 'allow' | 'deny'): Promise<{ readonly ok: boolean }>;
  /** The tab's screen as rendered; `undefined` = no terminal. */
  screen(tabId: string): readonly LineInput[] | undefined;
  /** Raw bytes to the tab's PTY; false = no live process. */
  write(tabId: string, data: string): boolean;
}

/** The input of a tool in one readable piece: the command, the file or the address, else the input itself. */
export function summarizeToolInput(input: Readonly<Record<string, unknown>>): string {
  for (const key of ['command', 'file_path', 'notebook_path', 'url', 'pattern', 'path', 'prompt']) {
    const value = input[key];
    if (typeof value === 'string' && value.trim() !== '') return cut(value);
  }
  return cut(JSON.stringify(input));
}

function cut(text: string): string {
  return text.length > WHAT_MAX ? `${text.slice(0, WHAT_MAX)}…` : text;
}

/** Same dialog text → same id; another request drawn → another id. */
function screenId(text: string): string {
  let hash = 5381;
  for (let i = 0; i < text.length; i += 1) hash = ((hash * 33) ^ text.charCodeAt(i)) >>> 0;
  return `${SCREEN_PREFIX}${hash.toString(16)}`;
}

export function permissionPorts(deps: PermissionPortDeps): {
  permissionAsk(tabId: string): Promise<PermissionAsk | null>;
  answerPermission(tabId: string, askId: string, answer: 'allow' | 'deny'): Promise<PermissionAnswer>;
} {
  const ask = async (tabId: string): Promise<PermissionAsk | null> => {
    const held = (await deps.held(tabId).catch(() => []))[0];
    if (held) return { id: `${CHAT_PREFIX}${held.id}`, source: 'chat', tool: held.toolName, what: summarizeToolInput(held.toolInput) };
    const lines = deps.screen(tabId);
    const dialog = lines ? permissionDialog(lines) : null;
    return dialog ? { id: screenId(dialog.text), source: 'tela', what: dialog.text } : null;
  };
  return {
    permissionAsk: ask,
    async answerPermission(tabId, askId, answer) {
      const open = await ask(tabId);
      if (open === null) return { ok: false, reason: 'o pedido já não está aberto' };
      if (open.id !== askId) return { ok: false, reason: 'o pedido aberto agora é outro' };
      if (open.source === 'chat') {
        const done = await deps.answerHeld(tabId, askId.slice(CHAT_PREFIX.length), answer).catch(() => ({ ok: false }));
        return done.ok ? { ok: true } : { ok: false, reason: 'o pedido já tinha sido respondido ou expirou' };
      }
      const lines = deps.screen(tabId);
      const key = answer === 'deny' ? ESC : lines ? permissionDialog(lines)?.yesKey : null;
      if (!key) return { ok: false, reason: 'a tela não mostra a opção "Yes" (só recusar é possível por aqui)' };
      return deps.write(tabId, key) ? { ok: true } : { ok: false, reason: 'o processo dela não está vivo' };
    },
  };
}
