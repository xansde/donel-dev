// Segundo plano visível — "leve até a linha": the status bar (App) and the chat's own strip ask a tab's
// timeline to scroll to a row. Module-level bus by `ptyId`: every ChatView stays mounted, so the target always
// has a listener; the Timeline holds the request until its tab has layout again.

type Listener = (rowId: string) => void;

const listeners = new Map<string, Set<Listener>>();

export function onRevealRow(ptyId: string, listener: Listener): () => void {
  let set = listeners.get(ptyId);
  if (set === undefined) {
    set = new Set();
    listeners.set(ptyId, set);
  }
  set.add(listener);
  return () => {
    const current = listeners.get(ptyId);
    current?.delete(listener);
    if (current?.size === 0) listeners.delete(ptyId);
  };
}

export function revealRow(ptyId: string, rowId: string): void {
  for (const l of [...(listeners.get(ptyId) ?? [])]) l(rowId);
}
