import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createLedgerService, nodeLedgerProofFs } from '../src/main/ledger-store';
import { createSystemConfigIoDeps } from '../src/main/config-store';
import { exportSqliteLedger, ledgerSourceOf, openSqliteLedgerStore, seedSqliteLedger } from '../src/oraculo/ledger-sqlite';

// O ledger do Oráculo num SQLite local da VPS (dono, 18/11: "Vamos trazer para um sqlite local mesmo"). O que não pode
// acontecer sem o dono ver: uma op que respondeu ok sumir num reinício; uma op recusada pelo disco valer na memória;
// duas ops ao mesmo tempo se apagarem; a semeadura perder ou trocar uma tarefa; o daemon subir vazio porque o banco
// sumiu.

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const tmp = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'ledger-sqlite-'));
  dirs.push(dir);
  return dir;
};

const criar = (n: number) => ({ op: 'criar' as const, projectPath: '/p', request: `pedido ${n}`, doneWhen: 'feito', due: '2026-11-20', ownerPlaceId: 'place:dev', risk: 'baixo' as const });

function service(dir: string, dbFile = join(dir, 'ledger.sqlite')) {
  const store = openSqliteLedgerStore(dbFile);
  return { store, ledger: createLedgerService({ filePath: join(dir, 'ledger.json'), io: createSystemConfigIoDeps(), proofFs: nodeLedgerProofFs, store }) };
}

describe('ledger em SQLite', () => {
  it('a op grava no SQLite antes de responder; um daemon novo lê dele o mesmo registro', async () => {
    const dir = tmp();
    const a = service(dir);
    const created = await a.ledger.apply({ kind: 'dono' }, criar(1));
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect((await a.ledger.apply({ kind: 'lugar', placeId: 'place:dev' }, { op: 'assumir', id: created.task.id })).ok).toBe(true);
    const doc = a.ledger.load().doc;
    a.store.close();
    const b = service(dir);
    expect(b.ledger.load().doc).toEqual(doc);
  });

  it('o disco que recusa a escrita recusa a op, e a memória fica como o disco', async () => {
    const dir = tmp();
    const a = service(dir);
    expect((await a.ledger.apply({ kind: 'dono' }, criar(1))).ok).toBe(true);
    a.store.close();
    const refused = await a.ledger.apply({ kind: 'dono' }, criar(2));
    expect(refused.ok).toBe(false);
    expect(Object.keys(a.ledger.load().doc.tasks)).toHaveLength(1);
    const b = service(dir);
    expect(Object.keys(b.ledger.load().doc.tasks)).toHaveLength(1);
  });

  it('1005 ops ao mesmo tempo ficam todas, também depois de reabrir', async () => {
    const dir = tmp();
    const a = service(dir);
    const results = await Promise.all(Array.from({ length: 1005 }, (_, i) => a.ledger.apply({ kind: 'dono' }, criar(i))));
    expect(results.every((r) => r.ok)).toBe(true);
    a.store.close();
    expect(Object.keys(service(dir).ledger.load().doc.tasks)).toHaveLength(1005);
  });

  it('semear do ledger.json: mesmas tarefas, mesmo JSON; recusa semear por cima; exportar devolve o mesmo', async () => {
    const dir = tmp();
    const file = createLedgerService({ filePath: join(dir, 'ledger.json'), io: createSystemConfigIoDeps(), proofFs: nodeLedgerProofFs });
    for (let i = 0; i < 30; i++) expect((await file.apply({ kind: 'dono' }, criar(i))).ok).toBe(true);
    const doc = file.load().doc;
    const db = join(dir, 'ledger.sqlite');
    const seeded = await seedSqliteLedger(db, doc);
    expect(seeded).toMatchObject({ tarefas: 30, diferentes: 0 });
    await expect(seedSqliteLedger(db, doc)).rejects.toThrow();
    const out = join(dir, 'volta.json');
    expect(exportSqliteLedger(db, out).tarefas).toBe(30);
    const back = createLedgerService({ filePath: out, io: createSystemConfigIoDeps(), proofFs: nodeLedgerProofFs }).load().doc;
    expect(back).toEqual(doc);
  });

  it('semear ao lado do -wal de um banco anterior é recusado: o WAL velho nunca se mistura ao banco novo', async () => {
    const dir = tmp();
    const db = join(dir, 'ledger.sqlite');
    writeFileSync(`${db}-wal`, 'restos');
    await expect(seedSqliteLedger(db, { schemaVersion: 4, startedAt: 1, tasks: {} } as never)).rejects.toThrow(/-wal/);
    expect(existsSync(db)).toBe(false);
  });

  it('a escrita que falha dentro da transação volta inteira (ROLLBACK) e a op é recusada', async () => {
    const dir = tmp();
    const a = service(dir);
    expect((await a.ledger.apply({ kind: 'dono' }, criar(1))).ok).toBe(true);
    const { DatabaseSync } = process.getBuiltinModule('node:sqlite') as typeof import('node:sqlite');
    const other = new DatabaseSync(join(dir, 'ledger.sqlite'));
    other.exec("CREATE TRIGGER barra BEFORE INSERT ON tarefas WHEN (SELECT count(*) FROM tarefas) >= 1 BEGIN SELECT RAISE(ABORT, 'disco cheio'); END;");
    other.close();
    expect((await a.ledger.apply({ kind: 'dono' }, criar(2))).ok).toBe(false);
    expect(Object.keys(a.ledger.load().doc.tasks)).toHaveLength(1);
    // Sem o ROLLBACK a transação ficaria aberta e toda op seguinte seria recusada: o daemon travaria.
    const fix = new DatabaseSync(join(dir, 'ledger.sqlite'));
    fix.exec('DROP TRIGGER barra;');
    fix.close();
    expect((await a.ledger.apply({ kind: 'dono' }, criar(3))).ok).toBe(true);
    a.store.close();
    expect(Object.keys(service(dir).ledger.load().doc.tasks)).toHaveLength(2);
  });

  it('a fonte: SQLite só semeado e com a marca; banco sem marca ou marca sem banco param o daemon, nunca sobe vazio', async () => {
    const dir = tmp();
    expect(ledgerSourceOf(dir)).toBe('arquivo');
    const db = join(dir, 'ledger.sqlite');
    // Um banco largado (exportar antes de semear, semeadura cortada) sem a marca não vira a fonte.
    expect(() => exportSqliteLedger(db, join(dir, 'x.json'))).toThrow();
    expect(existsSync(db)).toBe(false);
    writeFileSync(db, '');
    expect(() => ledgerSourceOf(dir)).toThrow(/marca/);
    rmSync(db);
    await seedSqliteLedger(db, { schemaVersion: 4, startedAt: 1, tasks: {} } as never);
    expect(ledgerSourceOf(dir)).toBe('sqlite');
    rmSync(db);
    expect(existsSync(join(dir, 'ledger.fonte'))).toBe(true);
    expect(() => ledgerSourceOf(dir)).toThrow(/ledger.sqlite/);
    writeFileSync(join(dir, 'ledger-supabase.json'), '{}');
    expect(() => ledgerSourceOf(dir)).toThrow(/ledger.sqlite/);
    // A marca presente e um banco vazio (arquivo de 0 byte, cópia errada): o daemon não abre um registro vazio.
    writeFileSync(db, '');
    expect(ledgerSourceOf(dir)).toBe('sqlite');
    expect(() => openSqliteLedgerStore(db, undefined, { requireSeeded: true })).toThrow(/cabeçalho/);
  });
});
