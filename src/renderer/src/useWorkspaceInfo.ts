import { useCallback, useEffect, useMemo, useState } from 'react';
import type { EditorStatus } from '../../shared/workspace';

// Sidebar — editor disponível (VS Code/Cursor) + branch atual de cada pasta
// mostrada. Sem polling apertado: relê quando a lista de pastas muda, quando a
// janela volta ao foco (o caso típico: trocou de branch no terminal ou no
// editor) e, no máximo, a cada minuto. O main ainda guarda a branch por 15 s.

const REFRESH_INTERVAL_MS = 60_000;

export interface WorkspaceInfo {
  readonly editor: EditorStatus;
  /** pasta → branch; ausente = ainda não lida; `null` = sem git/HEAD destacado. */
  readonly branches: Readonly<Record<string, string | null>>;
  readonly openInEditor: (path: string) => void;
}

export function useWorkspaceInfo(paths: readonly string[]): WorkspaceInfo {
  const [editor, setEditor] = useState<EditorStatus>({ available: false });
  const [branches, setBranches] = useState<Readonly<Record<string, string | null>>>({});
  const key = useMemo(() => [...new Set(paths)].sort().join('\n'), [paths]);

  useEffect(() => {
    const unique = key === '' ? [] : key.split('\n');
    let cancelled = false;

    const refresh = (): void => {
      void window.donel.workspace
        .editorStatus()
        .then((status) => {
          if (!cancelled) setEditor(status);
        })
        .catch(() => undefined);
      for (const path of unique) {
        void window.donel.workspace
          .gitBranch(path)
          .then(({ branch }) => {
            if (cancelled) return;
            setBranches((current) => (current[path] === branch ? current : { ...current, [path]: branch }));
          })
          .catch(() => undefined);
      }
    };

    refresh();
    const onFocus = (): void => refresh();
    window.addEventListener('focus', onFocus);
    const timer = window.setInterval(refresh, REFRESH_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.removeEventListener('focus', onFocus);
      window.clearInterval(timer);
    };
  }, [key]);

  const openInEditor = useCallback((path: string): void => {
    void window.donel.workspace
      .openInEditor(path)
      .then((result) => {
        // Editor desinstalado entre a leitura e o clique: o item volta a aparecer desabilitado.
        if (!result.ok && result.reason !== 'invalid-path') setEditor({ available: false });
      })
      .catch(() => undefined);
  }, []);

  return { editor, branches, openInEditor };
}
