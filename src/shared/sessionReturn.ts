// Sessão durável (t-fb11c6cd) — after "Atualizar", whether each session that was open came back on the same
// conversation, and the one line the Líder reads about its board. Pure: the bridge passes what it sees of each tab.

/** Past this without a sign of life (the `SessionStart` of the resume), the session counts as not back. */
export const RETURN_TIMEOUT_MS = 3 * 60_000;

/** What the app sees now of a session expected back. */
export interface ReturnProbe {
  /** It lives on a remote place: it reattaches to its running process, no new start to wait for. */
  readonly remote: boolean;
  /** The tab exists (local: the one reopened; remote: one attached to the same conversation). */
  readonly tabFound: boolean;
  /** The process of the local tab left. */
  readonly exited: boolean;
  /** The conversation the tab is on now, once the spawn answered. */
  readonly sessionId?: string;
  /** A hook came from it (the resume's `SessionStart`) or it took a message. */
  readonly confirmed: boolean;
  /**
   * It came back with `--session-id` (no message yet, nothing to resume): its start is a `startup`, which leaves no
   * sign until a first message. Alive on the expected id is back.
   */
  readonly fresh?: boolean;
  /** Why it is not answering, read from its process and screen (`startTrouble`), if anything. */
  readonly trouble?: string | null;
  readonly elapsedMs: number;
}

export type ReturnVerdict = { readonly kind: 'voltou' } | { readonly kind: 'nao-voltou'; readonly reason: string } | { readonly kind: 'pendente' };

export function returnVerdict(expectedSessionId: string, probe: ReturnProbe): ReturnVerdict {
  const late = probe.elapsedMs >= RETURN_TIMEOUT_MS;
  if (probe.remote) {
    if (probe.tabFound) return { kind: 'voltou' };
    return late ? { kind: 'nao-voltou', reason: 'a sessão não estava mais viva na máquina remota' } : { kind: 'pendente' };
  }
  // A tab added a moment ago reaches the list only on a later render.
  if (!probe.tabFound) return late ? { kind: 'nao-voltou', reason: 'a aba não reabriu' } : { kind: 'pendente' };
  if (probe.exited) return { kind: 'nao-voltou', reason: 'o Claude saiu antes de retomar a conversa' };
  if (probe.sessionId !== undefined && probe.sessionId !== expectedSessionId) return { kind: 'nao-voltou', reason: 'abriu em outra conversa' };
  if ((probe.confirmed || probe.fresh === true) && probe.sessionId === expectedSessionId) return { kind: 'voltou' };
  if (!late) return { kind: 'pendente' };
  return { kind: 'nao-voltou', reason: `não deu sinal em ${RETURN_TIMEOUT_MS / 60_000} min${probe.trouble ? ` (${probe.trouble})` : ''}` };
}

export interface ReturnLine {
  /** "Dev (place:2d9cadaa)". */
  readonly who: string;
  readonly verdict: Exclude<ReturnVerdict, { readonly kind: 'pendente' }>;
}

/** The message to the Líder about one board. `boardName` goes in when the reader is the Líder único (many boards). */
export function returnReport(lines: readonly ReturnLine[], boardName?: string): string {
  const back = lines.filter((line) => line.verdict.kind === 'voltou').map((line) => line.who);
  const notBack = lines.flatMap((line) => (line.verdict.kind === 'nao-voltou' ? [`${line.who}: ${line.verdict.reason}`] : []));
  const where = boardName ? ` do quadro ${boardName}` : '';
  const text = [
    `◆ O app reiniciou para se atualizar. O time${where} voltou assim:`,
    `Voltaram na mesma conversa (${back.length}): ${back.length > 0 ? back.join(', ') : 'nenhum'}`,
    `Não voltaram (${notBack.length}): ${notBack.length > 0 ? notBack.join('; ') : 'nenhum'}`,
  ];
  if (notBack.length > 0) text.push('Quem não voltou está fechado no quadro: retome com sessao_retomar se ainda precisar dele.');
  return text.join('\n');
}
