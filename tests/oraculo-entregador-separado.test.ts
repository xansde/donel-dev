// Passo 9 da correção da estrutura (t-5358d400), PR 1: o donel-oraculo dividido em registro (o ledger) e entregador
// (portão das sessões, recados, retrato). Sem a marca `<dir>/entregador.separado` os dois rodam no mesmo processo, como
// hoje. Com ela, cada um é um processo e cada arquivo tem um escritor só: o registro nunca grava recados.json nem
// retrato.json (dois escritores = recado duplicado ou perdido), e o entregador nunca abre o ledger.sqlite (um segundo
// escritor do registro).
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createSystemConfigIoDeps } from '../src/main/config-store';
import { createLedgerService, nodeLedgerProofFs } from '../src/main/ledger-store';
import type { OracleApiHandler } from '../src/oraculo/api';
import { runEntregador } from '../src/oraculo/entregador';
import { openSqliteLedgerStore, seedSqliteLedger } from '../src/oraculo/ledger-sqlite';
import { ENTREGADOR_SEPARADO_FILE, oracleMode, RETRATO_PC_FILE } from '../src/oraculo/modo';
import { runRegistro } from '../src/oraculo/registro';

const io = createSystemConfigIoDeps();
const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
const tmp = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'oraculo-entregador-'));
  dirs.push(dir);
  return dir;
};

const TOKEN = 'pc-token-de-teste';
const SID = '11111111-2222-4333-8444-555555555555';
const RECADOS = '{"versao":1,"itens":[{"id":"r1","texto":"oi"}]}';
const RETRATO = '{"at":5,"sessoes":{}}';
const noTmux = { liveSessions: async () => new Set<string>(), liveNow: () => new Set<string>() };

/** An Oráculo dir with a seeded SQLite ledger, the PC's token hash, and a home with the session folder `SID`. */
async function place(options: { separado: boolean }) {
  const dir = tmp();
  const home = tmp();
  mkdirSync(join(home, '.donel', 's', SID), { recursive: true });
  const empty = createLedgerService({ filePath: join(dir, 'nada.json'), io, proofFs: nodeLedgerProofFs }).load().doc;
  await seedSqliteLedger(join(dir, 'ledger.sqlite'), empty);
  writeFileSync(join(dir, 'pc.token.sha256'), createHash('sha256').update(TOKEN).digest('hex'));
  if (options.separado) writeFileSync(join(dir, ENTREGADOR_SEPARADO_FILE), '');
  return { dir, home };
}

/** The registro with a stand-in for the Tailscale listener: the test calls its handler as the PC would. */
async function registro(dir: string, home: string, entregador: 'junto' | 'separado') {
  let handler: OracleApiHandler | null = null;
  const daemon = await runRegistro({
    dir,
    home,
    host: '100.64.0.1',
    port: 47816,
    gatePort: 0,
    entregador,
    ...noTmux,
    listen: async (options) => {
      handler = options.handler;
      return { url: 'http://100.64.0.1:47816', notify: () => undefined, close: async () => undefined };
    },
  });
  const call = async (path: string, body: unknown) => {
    const answer = await handler!({ method: 'POST', url: path, authorization: `Bearer ${TOKEN}`, body: JSON.stringify(body) });
    return { status: answer.status, body: JSON.parse(String(answer.body)) as Record<string, unknown> };
  };
  return { daemon, call };
}

const push = { at: 1_000, sessoes: { [SID]: { quemSou: { nome: 'Dev · atlas', pasta: '/p', lugar: 'place:dev', papel: 'dev' }, listar: [] } } };
const criar = { op: 'criar', projectPath: '/p', request: 'pedido', doneWhen: 'feito', due: '2026-11-20', ownerPlaceId: 'place:dev', risk: 'baixo' };

function tasksIn(dir: string): number {
  const store = openSqliteLedgerStore(join(dir, 'ledger.sqlite'));
  try {
    return Object.keys(createLedgerService({ filePath: join(dir, 'ledger.json'), io, proofFs: nodeLedgerProofFs, store }).load().doc.tasks).length;
  } finally {
    store.close();
  }
}

describe('donel-oraculo dividido em registro e entregador', () => {
  it('sem a marca, o modo é o de hoje; o entregador sozinho só sobe com a marca', () => {
    const dir = tmp();
    expect(oracleMode({}, dir)).toBe('junto');
    expect(() => oracleMode({ DONEL_ORACULO_MODO: 'entregador' }, dir)).toThrow(ENTREGADOR_SEPARADO_FILE);
    expect(() => oracleMode({ DONEL_ORACULO_MODO: 'entregadr' }, dir)).toThrow();
    writeFileSync(join(dir, ENTREGADOR_SEPARADO_FILE), '');
    expect(oracleMode({}, dir)).toBe('registro');
    expect(oracleMode({ DONEL_ORACULO_MODO: 'entregador' }, dir)).toBe('entregador');
    expect(oracleMode({ DONEL_PORTAO_SATELITE: 'http://100.64.0.1:47816' }, dir)).toBe('satelite');
  });

  it('separado: o registro grava a tarefa e o retrato do PC à parte, sem tocar recados.json nem retrato.json', async () => {
    const { dir, home } = await place({ separado: true });
    writeFileSync(join(dir, 'recados.json'), RECADOS);
    writeFileSync(join(dir, 'retrato.json'), RETRATO);
    const { daemon, call } = await registro(dir, home, 'separado');
    expect((await call('/v1/retrato', push)).status).toBe(200);
    expect((await call('/v1/apply', { actor: { kind: 'dono' }, op: criar, leve: true })).body.ok).toBe(true);
    await daemon.stop();
    expect(readFileSync(join(dir, 'recados.json'), 'utf8')).toBe(RECADOS);
    expect(readFileSync(join(dir, 'retrato.json'), 'utf8')).toBe(RETRATO);
    expect(JSON.parse(readFileSync(join(dir, RETRATO_PC_FILE), 'utf8'))).toMatchObject({ at: 1_000, sessoes: { [SID]: {} } });
    expect(existsSync(join(dir, 'portao'))).toBe(false);
    expect(tasksIn(dir)).toBe(1);
  });

  it('separado: o entregador junta o retrato do PC e sobe o portão sem abrir o ledger.sqlite', async () => {
    const { dir, home } = await place({ separado: true });
    writeFileSync(join(dir, 'url'), 'http://127.0.0.1:9\n');
    writeFileSync(join(dir, RETRATO_PC_FILE), JSON.stringify(push));
    const before = readFileSync(join(dir, 'ledger.sqlite'));
    const daemon = await runEntregador({ dir, home, gatePort: 0, ...noTmux });
    await daemon.stop();
    expect(readFileSync(join(dir, 'ledger.sqlite')).equals(before)).toBe(true);
    expect(existsSync(join(dir, 'ledger.sqlite-wal'))).toBe(false);
    expect(existsSync(join(dir, 'ledger.sqlite-shm'))).toBe(false);
    expect(existsSync(join(dir, 'portao'))).toBe(true);
    expect(JSON.parse(readFileSync(join(dir, 'retrato.json'), 'utf8'))).toMatchObject({ at: 1_000, sessoes: { [SID]: { pcAt: 1_000 } } });
  });

  it('sem a marca: um processo só, e o retrato do PC vai direto para o retrato.json, como hoje', async () => {
    const { dir, home } = await place({ separado: false });
    const { daemon, call } = await registro(dir, home, 'junto');
    expect((await call('/v1/retrato', push)).status).toBe(200);
    expect((await call('/v1/apply', { actor: { kind: 'dono' }, op: criar, leve: true })).body.ok).toBe(true);
    await daemon.stop();
    expect(JSON.parse(readFileSync(join(dir, 'retrato.json'), 'utf8'))).toMatchObject({ at: 1_000, sessoes: { [SID]: { pcAt: 1_000 } } });
    expect(existsSync(join(dir, RETRATO_PC_FILE))).toBe(false);
    expect(existsSync(join(dir, 'portao'))).toBe(true);
    expect(tasksIn(dir)).toBe(1);
  });
});
