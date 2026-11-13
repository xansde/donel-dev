// t-1293c818 (3) — dono, 09/11: "precisa do meu clique uma ova". The two doors of `sessao_permissao` (agentBridge.ts):
// reading the permission request open on a tab and answering it, without the owner entering the tab. Two ways a request
// exists, and the held hook goes first because answering it also clears the CLI's dialog:
// - `chat`: the PermissionRequest hook the app holds (main/hook-bridge.ts), answered through `chat:answer`;
// - `tela`: only the dialog drawn by the CLI (no hook came back: a remote place, the chat off), answered with a key —
//   Esc refuses, the digit of "Yes" allows once. Never another option ("don't ask again" is the owner's choice).
// An answer names the request it answers (`askId`): when what is open now is another one, nothing is answered. On the
// screen the id covers the WHOLE dialog, never the cut text (Revisor, #377), and a reading that is not all the request
// (cut, or the dialog's top scrolled off) only refuses.

import { permissionDialog, tmuxCopyMode, type LineInput } from '../../../shared/chat/screen';
import type { ChatOpenPermission } from '../../../shared/chat/ipc';
import type { PermissionAnswer, PermissionAsk } from './agentBridge';

const CHAT_PREFIX = 'chat:';
const SCREEN_PREFIX = 'tela:';
const ESC = '\x1b';
/** What a held request shows; past this it is cut, out loud, and only refused. */
const WHAT_MAX = 20_000;
/** What the hook says to the CLI when the Líder refuses (it reads it as the reason). */
export const LEADER_DENY_REASON = 'Recusado pelo Líder, que responde por esta sessão.';

export interface PermissionPortDeps {
  /** The permission requests the app holds for that tab, oldest first (`[]` = none, or no chat). */
  held(tabId: string): Promise<readonly ChatOpenPermission[]>;
  answerHeld(tabId: string, pendingId: string, answer: 'allow' | 'deny'): Promise<{ readonly ok: boolean }>;
  /** The tab's screen as rendered; `undefined` = no terminal. */
  screen(tabId: string): readonly LineInput[] | undefined;
  /** Whether the tab runs on a remote place (inside tmux there): only then can its screen be tmux's copy mode. */
  remote(tabId: string): boolean;
  /** Raw bytes to the tab's PTY; false = no live process. */
  write(tabId: string, data: string): boolean;
}

/**
 * Why a screen that shows tmux's copy mode does not count: what is drawn is the scrolled history, and a key would go to
 * tmux. The session's hook state is not read here on purpose (3ª rodada do #414): it lies both ways ("working" with a
 * dialog open while sub-agents run in parallel, "waiting" stale on a remote tab without hooks), and the last-block rule
 * read on the live bottom already drops an answered dialog.
 */
const COPY_MODE = 'a aba está rolada (modo de cópia do tmux); volte ao fim para responder';

/** The CLI's own tools, whose main field reads well alone. Any other tool (mcp__*, unknown) is shown whole. */
const NATIVE_TOOLS: ReadonlySet<string> = new Set(['Bash', 'Read', 'Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'Glob', 'Grep', 'WebFetch', 'WebSearch']);
/** Fields that only explain the call and decide nothing; left out of a native summary. */
const ASIDE_KEYS: ReadonlySet<string> = new Set(['description']);

/** A native tool's main reading and the fields it already covers. */
function nativeHeadline(input: Readonly<Record<string, unknown>>): { readonly text: string; readonly used: readonly string[] } | undefined {
  const text = (key: string): string | undefined => (typeof input[key] === 'string' && (input[key] as string) !== '' ? (input[key] as string) : undefined);
  const fileKey = text('file_path') !== undefined ? 'file_path' : text('notebook_path') !== undefined ? 'notebook_path' : undefined;
  if (fileKey !== undefined) {
    const file = text(fileKey) as string;
    // A write shows what it writes, not only where (Revisor, #377).
    if (text('content') !== undefined) return { text: `${file}\n${text('content')}`, used: [fileKey, 'content'] };
    if (text('old_string') !== undefined || text('new_string') !== undefined) {
      return { text: `${file}\n- ${text('old_string') ?? ''}\n+ ${text('new_string') ?? ''}`, used: [fileKey, 'old_string', 'new_string'] };
    }
  }
  const key = ['command', 'file_path', 'notebook_path', 'url', 'pattern', 'query', 'path', 'prompt'].find((k) => text(k)?.trim());
  return key === undefined ? undefined : { text: text(key) as string, used: [key] };
}

/** The input of a tool in one readable piece, and whether it is all of it (`complete: false` = cut). Nothing that
 *  decides is left out (Revisor, #377): a native tool shows its main field plus every other field it did not cover;
 *  any other tool shows the whole input, since its first known field (a path, "git") can hide what it does. */
function describeInput(toolName: string, input: Readonly<Record<string, unknown>>): { readonly what: string; readonly complete: boolean } {
  const head = NATIVE_TOOLS.has(toolName) ? nativeHeadline(input) : undefined;
  let what: string;
  if (head === undefined) what = JSON.stringify(input);
  else {
    const rest = Object.fromEntries(Object.entries(input).filter(([key]) => !head.used.includes(key) && !ASIDE_KEYS.has(key)));
    what = Object.keys(rest).length === 0 ? head.text : `${head.text}\n${JSON.stringify(rest)}`;
  }
  if (what.length <= WHAT_MAX) return { what, complete: true };
  return { what: `${what.slice(0, WHAT_MAX)}\n[cortado: ${WHAT_MAX} de ${what.length} letras]`, complete: false };
}

export function summarizeToolInput(toolName: string, input: Readonly<Record<string, unknown>>): string {
  return describeInput(toolName, input).what;
}

/** The whole dialog, never the cut text: a change in a part the reading cut is another id. */
function screenId(whole: string): string {
  let a = 5381;
  let b = 52711;
  for (let i = 0; i < whole.length; i += 1) {
    const code = whole.charCodeAt(i);
    a = ((a * 33) ^ code) >>> 0;
    b = (Math.imul(b, 31) + code) >>> 0;
  }
  return `${SCREEN_PREFIX}${a.toString(16)}${b.toString(16).padStart(8, '0')}`;
}

export function permissionPorts(deps: PermissionPortDeps): {
  permissionOnScreen(tabId: string): boolean;
  permissionAsk(tabId: string): Promise<PermissionAsk | null>;
  answerPermission(tabId: string, askId: string, answer: 'allow' | 'deny'): Promise<PermissionAnswer>;
} {
  /** A local tab has no tmux: a "[3/12]" there is output, never copy mode (4ª rodada do #414). */
  const copyMode = (tabId: string, lines: readonly LineInput[]) => deps.remote(tabId) && tmuxCopyMode(lines);
  const screenDialog = (tabId: string) => {
    const lines = deps.screen(tabId);
    return lines && !copyMode(tabId, lines) ? permissionDialog(lines) : null;
  };
  /** The open request, with the screen it was read from (the key that answers it comes from that same screen). */
  const read = async (tabId: string): Promise<{ readonly ask: PermissionAsk; readonly yesKey: string | null } | null> => {
    const held = (await deps.held(tabId).catch(() => []))[0];
    if (held) {
      const { what, complete } = describeInput(held.toolName, held.toolInput);
      return { ask: { id: `${CHAT_PREFIX}${held.id}`, source: 'chat', tool: held.toolName, what, ...(complete ? {} : { complete: false }) }, yesKey: null };
    }
    const dialog = screenDialog(tabId);
    if (!dialog) return null;
    return { ask: { id: screenId(dialog.whole), source: 'tela', what: dialog.text, ...(dialog.complete ? {} : { complete: false }) }, yesKey: dialog.yesKey };
  };
  return {
    // Also the lock of closing a session (sessao_fechar, the Faxineiro): a screen in tmux's copy mode shows scrolled
    // history, never the live bottom where an open request sits, so it cannot say "no request" and counts as a possible
    // one (5ª rodada do #414). Always, not only when the scrolled view happens to show a dialog: scrolled far up, the
    // view has none and the bottom still may. Only the doors that ACT (ask, answer) refuse it, with COPY_MODE.
    permissionOnScreen(tabId) {
      const lines = deps.screen(tabId);
      return lines !== undefined && (copyMode(tabId, lines) || permissionDialog(lines) !== null);
    },
    permissionAsk: async (tabId) => (await read(tabId))?.ask ?? null,
    async answerPermission(tabId, askId, answer) {
      const open = await read(tabId);
      if (open === null) {
        const screen = deps.screen(tabId);
        return { ok: false, reason: screen !== undefined && copyMode(tabId, screen) ? COPY_MODE : 'o pedido já não está aberto' };
      }
      if (open.ask.id !== askId) return { ok: false, reason: 'o pedido aberto agora é outro' };
      if (answer === 'allow' && open.ask.complete === false) return { ok: false, reason: 'a leitura do pedido está incompleta; só recusar' };
      if (open.ask.source === 'chat') {
        const done = await deps.answerHeld(tabId, askId.slice(CHAT_PREFIX.length), answer).catch(() => ({ ok: false }));
        return done.ok ? { ok: true } : { ok: false, reason: 'o pedido já tinha sido respondido ou expirou' };
      }
      const key = answer === 'deny' ? ESC : open.yesKey;
      if (!key) return { ok: false, reason: 'a tela não mostra a opção "Yes" (só recusar é possível por aqui)' };
      return deps.write(tabId, key) ? { ok: true } : { ok: false, reason: 'o processo dela não está vivo' };
    },
  };
}
