// t-1293c818, item 4 (`sessao_religar`) — the keys the CLI of each live session holds: the hook token (`X-Donel-Token`,
// hook bridge) and the bearer of the app's MCP `donel` (with the remote end of its tunnel, for a session on a remote
// place). The bridge and the MCP server forget a key when a PTY leaves; a key dropped while the session still lives
// (the old PTY of a reattach, a race on exit) left it with "Host not allowed" and 401 until the owner reopened the tab.
// This ring keeps what was issued, so the app can put it back on the same PTY without touching the process.
//
// Nothing secret leaves it: the keys are the app's own per-session tokens (not credentials), never logged or returned.

export interface SessionKey {
  readonly hookToken?: string;
  readonly mcp?: { readonly token: string; readonly tunnelPort?: number };
}

/** Whoever takes a key back: the hook bridge and the app's MCP server (or the browser service in front of it). */
export interface KeyHolders {
  readonly hooks: { registerSession(ptyId: string, token: string): unknown } | null;
  readonly mcp: { registerSession(ptyId: string, token: string, tunnelPort?: number): unknown } | null;
}

export class SessionKeyRing {
  private readonly keys = new Map<string, SessionKey>();

  /** The keys a session's CLI was given (merged: hooks and MCP are issued at different moments of the spawn). */
  remember(ptyId: string, key: SessionKey): void {
    this.keys.set(ptyId, { ...this.keys.get(ptyId), ...key });
  }

  /** The session ended for real: its keys must never come back. */
  forget(ptyId: string): void {
    this.keys.delete(ptyId);
  }

  /** Registers again the keys of `ptyId`; `null` = no live session with keys there. Which ones went back. */
  restore(ptyId: string, holders: KeyHolders): { hooks: boolean; mcp: boolean } | null {
    const key = this.keys.get(ptyId);
    if (!key) return null;
    const hooks = key.hookToken !== undefined && holders.hooks !== null;
    if (hooks) holders.hooks!.registerSession(ptyId, key.hookToken!);
    const mcp = key.mcp !== undefined && holders.mcp !== null;
    if (mcp) holders.mcp!.registerSession(ptyId, key.mcp!.token, key.mcp!.tunnelPort);
    return { hooks, mcp };
  }
}
