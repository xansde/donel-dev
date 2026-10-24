// 014-chat - Shift+Tab on the composer (and, through `forwardShortcut`, the other CLI shortcuts). In the CLI it cycles the permission mode (default -> accept edits ->
// plan -> ...); in the chat the browser would move the focus between buttons. The composer swallows the key and
// writes the back-tab sequence the xterm itself sends, through the same PTY handle the send driver uses (no new
// IPC). The mode is read back from the footer of the CLI screen so the hint under the box shows the effect.

import { useEffect, useState } from 'react';
import { blockingScreen, readPermissionMode } from '../../../shared/chat/screen';
import type { LineInput, PermissionMode } from '../../../shared/chat/screen';

/** Back-tab (CSI Z): what xterm.js sends for Shift+Tab. */
export const BACK_TAB = '\x1b[Z';

/** The slice of `TerminalPaneHandle` the mode cycle needs. */
export interface ModeTerminal {
  readScreen(): { readonly lines: readonly LineInput[] };
  write(data: string): boolean;
  onScreenUpdate?(listener: () => void): () => void;
}

const LABELS: Readonly<Record<PermissionMode, string>> = {
  default: 'padrão',
  acceptEdits: 'aceitar edições',
  plan: 'plano',
  bypass: 'bypass',
};

export function permissionModeLabel(mode: PermissionMode): string {
  return LABELS[mode];
}

/**
 * Writes a shortcut's bytes (Shift+Tab, Alt+O, Ctrl+T... - see `cliShortcuts.ts`) to the CLI. Not while a dialog or
 * box-less screen holds it: there the key would navigate the dialog instead of doing its job. Returns whether it
 * was written.
 */
export function forwardShortcut(terminal: ModeTerminal | null, bytes: string): boolean {
  if (terminal === null) return false;
  if (blockingScreen(terminal.readScreen().lines) !== null) return false;
  return terminal.write(bytes);
}

/**
 * Last permission mode the screen showed. Kept when the footer momentarily names none (a dialog, a redraw),
 * so the hint does not flicker; `null` until the first reading.
 */
export function useScreenPermissionMode(terminal: ModeTerminal | null): PermissionMode | null {
  const [mode, setMode] = useState<PermissionMode | null>(null);
  useEffect(() => {
    if (terminal === null || terminal.onScreenUpdate === undefined) return undefined;
    const read = (): void => {
      const next = readPermissionMode(terminal.readScreen().lines);
      if (next !== null) setMode(next);
    };
    read();
    return terminal.onScreenUpdate(read);
  }, [terminal]);
  return mode;
}
