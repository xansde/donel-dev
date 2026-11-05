import { parseStatusLinePayload, sameStatusLineReading, type StatusLineSnapshot } from '../shared/statusLine';

// Ponte da statusline — estado por aba (ptyId) no main. A ponte HTTP entrega
// o JSON cru (`BridgeEvent` `statusline`); aqui ele vira `StatusLineSnapshot`
// validado, e só uma leitura DIFERENTE da anterior é repassada ao renderer
// (o CLI roda a statusline a cada resposta, a cada troca de modo de
// permissão, na virada de janela de cota...). Nada é persistido nem logado.

export type StatusLineListener = (ptyId: string, snapshot: StatusLineSnapshot | null) => void;

export interface StatusLineStore {
  /** Lê o payload cru; devolve a leitura nova quando ela mudou (e avisa os ouvintes), ou `null`. */
  update(ptyId: string, payload: unknown): StatusLineSnapshot | null;
  get(ptyId: string): StatusLineSnapshot | null;
  all(): Record<string, StatusLineSnapshot>;
  /** A aba saiu: esquece a leitura e avisa com `null` (no-op se não havia leitura). */
  remove(ptyId: string): void;
  onChange(listener: StatusLineListener): () => void;
}

export function createStatusLineStore(now: () => number = Date.now): StatusLineStore {
  const byPty = new Map<string, StatusLineSnapshot>();
  const listeners = new Set<StatusLineListener>();

  function emit(ptyId: string, snapshot: StatusLineSnapshot | null): void {
    for (const listener of [...listeners]) {
      try {
        listener(ptyId, snapshot);
      } catch {
        // um ouvinte com defeito não derruba a ponte
      }
    }
  }

  return {
    update(ptyId, payload) {
      const parsed = parseStatusLinePayload(payload, now());
      if (!parsed) return null;
      const previous = byPty.get(ptyId);
      // A cota (`rate_limits`) vem dos cabeçalhos da resposta da API: ela só é
      // "nova" quando houve resposta nova — o tempo de API acumulado mudou.
      const apiMoved = !previous || previous.cost?.totalApiDurationMs !== parsed.cost?.totalApiDurationMs;
      const next: StatusLineSnapshot = apiMoved ? parsed : { ...parsed, apiActivityAt: previous.apiActivityAt };
      byPty.set(ptyId, next);
      if (previous && sameStatusLineReading(previous, next)) return null;
      emit(ptyId, next);
      return next;
    },

    get(ptyId) {
      return byPty.get(ptyId) ?? null;
    },

    all() {
      return Object.fromEntries(byPty);
    },

    remove(ptyId) {
      if (!byPty.delete(ptyId)) return;
      emit(ptyId, null);
    },

    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
