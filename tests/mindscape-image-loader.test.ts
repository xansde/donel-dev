import { describe, expect, it } from 'vitest';
import {
  MindscapeImageLoader,
  type MindscapeImageLoaderPorts,
  type MindscapeImageReadResult,
} from '../src/renderer/src/Mindscape/mindscapeImageLoader';

// Mindscape desenho, fatia 06 — o print que falhou uma vez não fica preso em "imagem não encontrada" enquanto a
// tela está montada: novas tentativas com espera, limitadas, sem loop de pedidos e sem vazar `blob:` URL.

const OK: MindscapeImageReadResult = { ok: true, bytes: new Uint8Array([1, 2, 3]), mediaType: 'image/png' };
const FAIL: MindscapeImageReadResult = { ok: false };

class Harness {
  t = 0;
  timers: { at: number; cb: () => void; id: number }[] = [];
  private nextId = 1;
  reads: string[] = [];
  /** Answers per imageId, consumed in order; the last one repeats. */
  answers = new Map<string, MindscapeImageReadResult[]>();
  pending: { imageId: string; resolve: (r: MindscapeImageReadResult) => void }[] = [];
  manual = false;
  created: string[] = [];
  revoked: string[] = [];
  changes = 0;
  readonly ports: MindscapeImageLoaderPorts = {
    read: (imageId) => {
      this.reads.push(imageId);
      if (this.manual) return new Promise((resolve) => this.pending.push({ imageId, resolve }));
      const queue = this.answers.get(imageId) ?? [FAIL];
      const answer = queue.length > 1 ? queue.shift()! : queue[0]!;
      return Promise.resolve(answer);
    },
    createUrl: () => {
      const url = `blob:${this.created.length + 1}`;
      this.created.push(url);
      return url;
    },
    revokeUrl: (url) => void this.revoked.push(url),
    setTimeout: (cb, ms) => {
      const id = this.nextId++;
      this.timers.push({ at: this.t + ms, cb, id });
      return id;
    },
    clearTimeout: (h) => {
      this.timers = this.timers.filter((x) => x.id !== h);
    },
  };
  loader = new MindscapeImageLoader(this.ports, () => void (this.changes += 1), [1_000, 3_000]);

  async flush(): Promise<void> {
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
  }
  async advance(ms: number): Promise<void> {
    const end = this.t + ms;
    for (;;) {
      await this.flush();
      const due = this.timers.filter((x) => x.at <= end).sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      this.timers = this.timers.filter((x) => x.id !== due.id);
      this.t = due.at;
      due.cb();
    }
    this.t = end;
    await this.flush();
  }
}

describe('MindscapeImageLoader', () => {
  it('lê cada print uma vez e guarda a URL enquanto vive', async () => {
    const h = new Harness();
    h.answers.set('a', [OK]);
    h.loader.want(['a']);
    expect(h.loader.entry('a')).toEqual({ status: 'loading' });
    await h.flush();
    expect(h.loader.entry('a')).toEqual({ status: 'ready', url: 'blob:1' });
    h.loader.want(['a']);
    h.loader.want([]);
    h.loader.want(['a']);
    await h.advance(60_000);
    expect(h.reads).toEqual(['a']);
    expect(h.created).toEqual(['blob:1']);
  });

  it('print que falhou mostra "missing" e tenta de novo depois da espera, até entrar', async () => {
    const h = new Harness();
    h.answers.set('a', [FAIL, OK]);
    h.loader.want(['a']);
    await h.flush();
    expect(h.loader.entry('a')).toEqual({ status: 'missing' });
    await h.advance(999);
    expect(h.reads).toEqual(['a']);
    await h.advance(1);
    expect(h.reads).toEqual(['a', 'a']);
    expect(h.loader.entry('a')).toEqual({ status: 'ready', url: 'blob:1' });
    expect(h.timers).toHaveLength(0);
  });

  it('as tentativas são limitadas: esgotadas, o print fica "missing" sem novos pedidos', async () => {
    const h = new Harness();
    h.loader.want(['a']);
    await h.advance(10 * 60_000);
    // 1 leitura + 2 novas tentativas (uma por espera configurada).
    expect(h.reads).toEqual(['a', 'a', 'a']);
    expect(h.loader.entry('a')).toEqual({ status: 'missing' });
    expect(h.timers).toHaveLength(0);
    // Re-render com o mesmo quadro não reabre o ciclo.
    h.loader.want(['a']);
    await h.advance(10 * 60_000);
    expect(h.reads).toHaveLength(3);
  });

  it('o print que sai do quadro e volta (apagado e desfeito) começa a contagem do zero', async () => {
    const h = new Harness();
    h.loader.want(['a']);
    await h.advance(10 * 60_000);
    expect(h.reads).toHaveLength(3);
    h.loader.want([]);
    h.answers.set('a', [OK]);
    h.loader.want(['a']);
    await h.flush();
    expect(h.reads).toHaveLength(4);
    expect(h.loader.entry('a')).toEqual({ status: 'ready', url: 'blob:1' });
  });

  it('sair do quadro cancela a nova tentativa pendente', async () => {
    const h = new Harness();
    h.loader.want(['a']);
    await h.flush();
    expect(h.timers).toHaveLength(1);
    h.loader.want([]);
    expect(h.timers).toHaveLength(0);
    await h.advance(60_000);
    expect(h.reads).toEqual(['a']);
  });

  it('nunca dois pedidos do mesmo print ao mesmo tempo', async () => {
    const h = new Harness();
    h.manual = true;
    h.loader.want(['a']);
    h.loader.want([]);
    h.loader.want(['a']);
    h.loader.want(['a', 'b']);
    expect(h.reads).toEqual(['a', 'b']);
    h.pending[0]!.resolve(OK);
    await h.flush();
    expect(h.loader.entry('a')).toEqual({ status: 'ready', url: 'blob:1' });
  });

  it('dispose revoga toda URL criada e uma resposta que chega depois não cria URL', async () => {
    const h = new Harness();
    h.answers.set('a', [OK]);
    h.loader.want(['a']);
    await h.flush();
    h.manual = true;
    h.loader.want(['a', 'b']);
    h.loader.dispose();
    expect(h.revoked).toEqual(['blob:1']);
    h.pending[0]!.resolve(OK);
    await h.flush();
    expect(h.created).toEqual(['blob:1']);
    expect(h.timers).toHaveLength(0);
  });

  it('dispose cancela a nova tentativa pendente', async () => {
    const h = new Harness();
    h.loader.want(['a']);
    await h.flush();
    expect(h.timers).toHaveLength(1);
    h.loader.dispose();
    expect(h.timers).toHaveLength(0);
  });

  it('erro na leitura (rejeição) conta como falha e também tenta de novo', async () => {
    const h = new Harness();
    let calls = 0;
    const loader = new MindscapeImageLoader(
      { ...h.ports, read: () => (++calls === 1 ? Promise.reject(new Error('ipc')) : Promise.resolve(OK)) },
      () => undefined,
      [1_000],
    );
    loader.want(['a']);
    await h.flush();
    expect(loader.entry('a')).toEqual({ status: 'missing' });
    await h.advance(1_000);
    expect(loader.entry('a')).toEqual({ status: 'ready', url: 'blob:1' });
  });
});
