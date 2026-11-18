import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createLedgerService, nodeLedgerProofFs } from '../src/main/ledger-store';
import { createSystemConfigIoDeps } from '../src/main/config-store';
import { createSupabaseLedgerStore, readSupabaseLedger, type SupabaseLedgerDeps } from '../src/oraculo/ledger-supabase';

// t-89279f84 — o Supabase como FONTE do ledger: a op só responde ok depois que o Supabase guardou; o que ele recusa
// não vale; um daemon que reinicia lê do Supabase exatamente o que estava; duas ops ao mesmo tempo não se apagam.

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** PostgREST de mentira, só o que o store usa: GET paginado por Range, upsert por POST, DELETE por id=in.(...). */
function fakeSupabase() {
  const tasks = new Map<string, unknown>();
  let meta: { schema_version: number; started_at: number | null } | null = null;
  let down = false;
  const fetch: typeof globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? 'GET';
    if ((init?.headers as Record<string, string>).apikey !== 'chave') return new Response('{"message":"chave"}', { status: 401 });
    if (down) return new Response('fora', { status: 503 });
    const table = url.pathname.split('/').pop();
    if (method === 'GET' && table === 'ledger_meta') return Response.json(meta ? [meta] : []);
    if (method === 'GET' && table === 'ledger_tarefas') {
      const [from, to] = String((init?.headers as Record<string, string>).Range).split('-').map(Number);
      const rows = [...tasks.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([id, doc]) => ({ id, doc }));
      return Response.json(rows.slice(from, to! + 1));
    }
    if (method === 'POST' && table === 'ledger_tarefas') {
      for (const row of JSON.parse(String(init?.body)) as Array<{ id: string; doc: unknown }>) tasks.set(row.id, JSON.parse(JSON.stringify(row.doc)));
      return new Response(null, { status: 201 });
    }
    if (method === 'POST' && table === 'ledger_meta') {
      const [row] = JSON.parse(String(init?.body)) as Array<{ schema_version: number; started_at: number | null }>;
      meta = { schema_version: row!.schema_version, started_at: row!.started_at };
      return new Response(null, { status: 201 });
    }
    if (method === 'DELETE' && table === 'ledger_tarefas') {
      for (const id of /^in\.\((.*)\)$/.exec(url.searchParams.get('id') ?? '')![1]!.split(',')) tasks.delete(id.replace(/"/g, ''));
      return new Response(null, { status: 204 });
    }
    return new Response('rota', { status: 404 });
  }) as typeof globalThis.fetch;
  return { tasks, meta: () => meta, setDown: (value: boolean) => (down = value), fetch };
}

const criar = (n: number) => ({ op: 'criar' as const, projectPath: 'C:/p', request: `pedido ${n}`, doneWhen: 'feito', due: '2026-11-20', ownerPlaceId: 'place:dev', risk: 'baixo' as const });

async function open(fake: ReturnType<typeof fakeSupabase>, ids: string[] = []) {
  const dir = mkdtempSync(join(tmpdir(), 'ledger-sb-'));
  dirs.push(dir);
  const deps: SupabaseLedgerDeps = { url: 'https://x.supabase.co', key: () => 'chave', fetch: fake.fetch };
  const store = createSupabaseLedgerStore(deps, await readSupabaseLedger(deps));
  let n = 0;
  const service = createLedgerService({ filePath: join(dir, 'ledger.json'), io: createSystemConfigIoDeps(), proofFs: nodeLedgerProofFs, store, newId: () => ids[n++] ?? `t-${String(n).padStart(8, '0')}` });
  return { service, store, deps };
}

describe('ledger com o Supabase como fonte', () => {
  it('a op grava no Supabase antes de responder, e um daemon novo lê de lá o mesmo registro', async () => {
    const fake = fakeSupabase();
    const { service, deps } = await open(fake);
    const created = await service.apply({ kind: 'dono' }, criar(1));
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(fake.tasks.has(created.task.id)).toBe(true);
    expect(fake.meta()?.schema_version).toBe(service.load().doc.schemaVersion);
    const again = await service.apply({ kind: 'lugar', placeId: 'place:dev' }, { op: 'assumir', id: created.task.id });
    expect(again.ok).toBe(true);

    const restarted = createLedgerService({ filePath: '/nunca/lido.json', io: createSystemConfigIoDeps(), proofFs: nodeLedgerProofFs, store: createSupabaseLedgerStore(deps, await readSupabaseLedger(deps)) });
    expect(restarted.load().doc).toEqual(service.load().doc);
  });

  it('o Supabase fora recusa a op e nada muda; quando volta, a op seguinte grava', async () => {
    const fake = fakeSupabase();
    const { service } = await open(fake);
    expect((await service.apply({ kind: 'dono' }, criar(1))).ok).toBe(true);
    fake.setDown(true);
    const refused = await service.apply({ kind: 'dono' }, criar(2));
    expect(refused.ok).toBe(false);
    expect(Object.keys(service.load().doc.tasks)).toHaveLength(1);
    fake.setDown(false);
    expect((await service.apply({ kind: 'dono' }, criar(3))).ok).toBe(true);
    expect(fake.tasks.size).toBe(2);
    expect(Object.keys(service.load().doc.tasks)).toHaveLength(2);
  });

  it('duas ops ao mesmo tempo ficam as duas, e mais de uma página (1000) volta inteira', async () => {
    const fake = fakeSupabase();
    const { service, deps } = await open(fake);
    const results = await Promise.all(Array.from({ length: 1005 }, (_, i) => service.apply({ kind: 'dono' }, criar(i))));
    expect(results.every((result) => result.ok)).toBe(true);
    expect(fake.tasks.size).toBe(1005);
    expect(Object.keys(service.load().doc.tasks)).toHaveLength(1005);
    const read = await readSupabaseLedger(deps);
    expect(Object.keys(read.tasks)).toHaveLength(1005);
  });
});
