import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { shouldPoll, type PullRequestStatus } from '../../shared/pullRequestStatus';

// B3 — PR aberto da branch de cada pasta visível na sidebar. Sob demanda:
// lê quando a lista de pastas (ou a branch de alguma) muda — abrir/trocar de
// projeto — e quando a janela volta ao foco. Polling só para PR com check
// rodando, a cada 90 s, e nunca com a janela minimizada/oculta. O main ainda
// guarda cada resposta por 30 s (pull-request-status.ts).

export const PR_POLL_INTERVAL_MS = 90_000;

export interface PullRequestsInfo {
  /** pasta → PR aberto; ausente/`null` = nada a mostrar. */
  readonly pullRequests: Readonly<Record<string, PullRequestStatus | null>>;
  /** Releitura com as conversas não resolvidas (o painel pede ao abrir). */
  readonly loadDetails: (path: string) => Promise<PullRequestStatus | null>;
}

export function usePullRequests(paths: readonly string[], branches: Readonly<Record<string, string | null>>): PullRequestsInfo {
  const [pullRequests, setPullRequests] = useState<Readonly<Record<string, PullRequestStatus | null>>>({});
  const current = useRef(pullRequests);
  current.current = pullRequests;

  // Só pastas com branch conhecida; a branch entra na chave para reler quando ela muda.
  const key = useMemo(
    () =>
      [...new Set(paths)]
        .filter((path) => typeof branches[path] === 'string')
        .sort()
        .map((path) => `${path}\t${branches[path]}`)
        .join('\n'),
    [paths, branches],
  );

  const store = useCallback((path: string, pr: PullRequestStatus | null): void => {
    // Mesma resposta → mesmo estado (o foco da janela relê tudo; não re-renderiza a sidebar à toa).
    setPullRequests((prev) => (JSON.stringify(prev[path] ?? null) === JSON.stringify(pr) ? prev : { ...prev, [path]: pr }));
  }, []);

  useEffect(() => {
    const tracked = key === '' ? [] : key.split('\n').map((line) => line.split('\t')[0]);
    let cancelled = false;

    const read = (path: string): void => {
      void window.donel.workspace
        .pullRequest(path)
        .then(({ pr }) => {
          if (!cancelled) store(path, pr);
        })
        .catch(() => undefined);
    };

    const refreshAll = (): void => tracked.forEach(read);
    refreshAll();
    window.addEventListener('focus', refreshAll);
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'hidden') return;
      for (const path of tracked) if (shouldPoll(current.current[path] ?? null)) read(path);
    }, PR_POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.removeEventListener('focus', refreshAll);
      window.clearInterval(timer);
    };
  }, [key, store]);

  const loadDetails = useCallback(
    async (path: string): Promise<PullRequestStatus | null> => {
      try {
        const { pr } = await window.donel.workspace.pullRequest(path, { details: true });
        // O indicador acompanha o que o painel viu (sem as conversas, que só o painel mostra).
        store(path, pr ? { ...pr, unresolvedThreads: null } : null);
        return pr;
      } catch {
        return null;
      }
    },
    [store],
  );

  return { pullRequests, loadDetails };
}
