import { describe, expect, it } from 'vitest';
import { createStatusLineStore } from '../src/main/statusline-store';
import type { StatusLineSnapshot } from '../src/shared/statusLine';

const reading = (apiMs: number, extra: Record<string, unknown> = {}) => ({
  session_id: 's1',
  cost: { total_cost_usd: 0.1, total_duration_ms: 1000, total_api_duration_ms: apiMs },
  rate_limits: { five_hour: { used_percentage: 10 } },
  ...extra,
});

function setup() {
  let clock = 1_000;
  const store = createStatusLineStore(() => clock);
  const seen: Array<[string, StatusLineSnapshot | null]> = [];
  store.onChange((ptyId, snapshot) => seen.push([ptyId, snapshot]));
  return { store, seen, tick: (ms: number) => (clock += ms) };
}

describe('createStatusLineStore', () => {
  it('guarda a leitura por aba e avisa', () => {
    const { store, seen } = setup();
    const snap = store.update('pty-1', reading(100));
    expect(snap?.sessionId).toBe('s1');
    expect(store.get('pty-1')).toBe(snap);
    expect(store.get('pty-2')).toBeNull();
    expect(seen).toEqual([['pty-1', snap]]);
    expect(store.all()).toEqual({ 'pty-1': snap });
  });

  it('leitura igual à anterior não reavisa', () => {
    const { store, seen, tick } = setup();
    store.update('pty-1', reading(100));
    tick(500);
    expect(store.update('pty-1', reading(100))).toBeNull();
    expect(seen).toHaveLength(1);
  });

  it('payload que não é objeto é descartado sem apagar a leitura', () => {
    const { store, seen } = setup();
    const snap = store.update('pty-1', reading(100));
    expect(store.update('pty-1', 'lixo')).toBeNull();
    expect(store.get('pty-1')).toBe(snap);
    expect(seen).toHaveLength(1);
  });

  it('apiActivityAt só anda quando houve resposta nova da API', () => {
    const { store, tick } = setup();
    store.update('pty-1', reading(100));
    tick(1_000);
    // statusline rodou de novo (troca de modo de permissão), sem chamada nova
    const same = store.update('pty-1', reading(100, { effort: { level: 'max' } }));
    expect(same?.receivedAt).toBe(2_000);
    expect(same?.apiActivityAt).toBe(1_000);
    tick(1_000);
    const moved = store.update('pty-1', reading(250));
    expect(moved?.apiActivityAt).toBe(3_000);
  });

  it('remove esquece e avisa com null; remover de novo é no-op', () => {
    const { store, seen } = setup();
    store.update('pty-1', reading(100));
    store.remove('pty-1');
    store.remove('pty-1');
    store.remove('pty-9');
    expect(store.get('pty-1')).toBeNull();
    expect(seen.map(([, s]) => s === null)).toEqual([false, true]);
  });

  it('ouvinte com defeito não impede os outros', () => {
    const { store, seen } = setup();
    store.onChange(() => {
      throw new Error('boom');
    });
    store.update('pty-1', reading(1));
    expect(seen).toHaveLength(1);
  });
});
