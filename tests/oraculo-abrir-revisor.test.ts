// t-3b258224 — o reconciliador abre sozinho o Revisor elástico do quadro (ordem permanente do Líder único, r-0b7e4683)
// pela rota de serviço `abrir-revisor` do Oráculo. Entra pela regra dos testes enxutos porque abre sessão e gasta vaga:
// o que quebraria sem o dono ver é outro serviço (ou um corpo que escolhe o papel) abrindo sessão, e dois Revisores no
// mesmo quadro (um vivo, ou esperando vaga no limitador, e outro novo; ou duas chamadas próximas).
//
// O preparo roda o script de verdade (bash) numa HOME temporária, com `claude` e `tmux` falsos no PATH.
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createSystemConfigIoDeps } from '../src/main/config-store';
import { createLedgerService, nodeLedgerProofFs } from '../src/main/ledger-store';
import { OPEN_KIT_FILE, type OpenKit } from '../src/main/open-kit';
import { buildClaudeArgs } from '../src/shared/commandBuilder';
import { createOpenLocal, type ScriptRun } from '../src/oraculo/abrir-local';
import { createOracleApiHandler, type OracleRequest } from '../src/oraculo/api';
import type { BoardPicture } from '../src/oraculo/portao';
import { SERVICE_PATH } from '../src/oraculo/servicos';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const PROJECT = '/home/dono/seazone/atlas';
const SID_LIDER = '77777777-2222-4333-8444-555555555555';
const SID_DEV = '11111111-2222-4333-8444-555555555555';
const SID_REVISOR = '33333333-2222-4333-8444-555555555555';
const T0 = Date.parse('2026-11-20T03:00:00Z');
const PC = 'p'.repeat(64);
const RECONCILIADOR = 'r'.repeat(64);
const MENCOES = 'm'.repeat(64);
const hash = (token: string): string => createHash('sha256').update(token).digest('hex');

function kit(): OpenKit {
  const role = (id: string, name: string) => ({
    id,
    name,
    anyPlace: false,
    promptText: `# ${name}\n`,
    model: 'opus',
    effort: 'high',
    permissionMode: 'acceptEdits',
    launcherArgs: buildClaudeArgs({ model: 'opus', effort: 'high', permissionMode: 'acceptEdits' }),
    scopeSettings: null,
    scopeNeedsInventory: false,
  });
  return {
    version: 1,
    at: new Date(T0).toISOString(),
    place: { id: 'vps-pessoal', label: 'VPS pessoal' },
    // The real kit's cap is null: nothing but the Revisor rule limits it.
    openCap: null,
    roles: [role('dev', 'Dev'), role('revisor', 'Revisor')],
    boards: [{ localCwd: PROJECT, name: 'atlas', homeRelativeDir: 'seazone/atlas', repoUrl: null, branch: null }],
  } as OpenKit;
}

/** This VPS with a Dev alive on board atlas; `reviewer` = a Revisor of atlas already alive (or still waiting) here. */
function machine(options: { reviewer?: 'alive' | 'closed' } = {}) {
  const home = mkdtempSync(join(tmpdir(), 'abrir-revisor-'));
  dirs.push(home);
  const bin = join(home, 'bin');
  mkdirSync(bin);
  writeFileSync(join(bin, 'claude'), '#!/usr/bin/env bash\nexit 0\n', { mode: 0o755 });
  writeFileSync(join(bin, 'tmux'), '#!/usr/bin/env bash\necho "$*" >> "$HOME/tmux.log"\nexit 0\n', { mode: 0o755 });
  const sessionsDir = join(home, '.donel', 's');
  const oraculoDir = join(home, '.donel', 'oraculo');
  mkdirSync(oraculoDir, { recursive: true });
  for (const sid of [SID_LIDER, SID_DEV]) mkdirSync(join(sessionsDir, sid), { recursive: true });
  writeFileSync(join(sessionsDir, SID_LIDER, 'meta.json'), JSON.stringify({ sid: SID_LIDER, leaderOfAll: true }));
  writeFileSync(join(sessionsDir, SID_DEV, 'meta.json'), JSON.stringify({ sid: SID_DEV, roleId: 'dev', localCwd: PROJECT }));
  if (options.reviewer) {
    mkdirSync(join(sessionsDir, SID_REVISOR), { recursive: true });
    writeFileSync(join(sessionsDir, SID_REVISOR, 'meta.json'), JSON.stringify({ sid: SID_REVISOR, roleId: 'revisor', localCwd: PROJECT, placeId: 'place:revisor-atlas' }));
  }
  writeFileSync(join(oraculoDir, OPEN_KIT_FILE), JSON.stringify(kit()));
  const env = { ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH ?? ''}` };
  const bash = (script: string): Promise<ScriptRun> =>
    new Promise((resolve) => {
      const child = spawn('bash', ['-s'], { env });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString('utf8')));
      child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString('utf8')));
      child.on('close', (code) => resolve({ code, stdout, stderr }));
      child.stdin.end(script);
    });
  const live = new Set([SID_LIDER, SID_DEV, ...(options.reviewer === 'alive' ? [SID_REVISOR] : [])]);
  const listar = [{ id: 'place:dev', papel: 'dev', estado: 'trabalhando' }];
  const picture: BoardPicture = {
    at: T0 - 60_000,
    sessoes: {
      [SID_LIDER]: { quemSou: { nome: 'Líder', papel: 'lider', liderUnico: true, lugar: null }, listar: [] },
      [SID_DEV]: { quemSou: { nome: 'Dev · atlas', pasta: PROJECT, lugar: 'place:dev', papel: 'dev' }, listar },
    },
  };
  let counter = 0;
  const openLocal = createOpenLocal({
    sessionsDir,
    oraculoDir,
    picture: () => picture,
    setSession: () => undefined,
    leader: async () => ({ sid: SID_LIDER }),
    liveSessions: async () => new Set(live),
    run: async (script) => {
      const done = await bash(script);
      if (script.includes('new-session -d') && done.code === 0) for (const folder of readdirSync(sessionsDir)) live.add(folder);
      return done;
    },
    room: () => null,
    portFree: async () => true,
    now: () => T0,
    newId: () => `aaaaaaaa-2222-4333-8444-${String(++counter).padStart(12, '0')}`,
    log: () => undefined,
  });
  const ledgerFile = join(home, 'ledger.json');
  const ledger = createLedgerService({ filePath: ledgerFile, io: createSystemConfigIoDeps(), proofFs: nodeLedgerProofFs });
  const handle = createOracleApiHandler({
    ledger,
    ledgerFile,
    tokenHash: () => hash(PC),
    services: () => new Map([
      ['reconciliador', hash(RECONCILIADOR)],
      ['mencoes', hash(MENCOES)],
    ]),
    abrirRevisor: (order) => openLocal.openReviewer(order),
    log: () => undefined,
  });
  const newFolders = (): string[] => readdirSync(sessionsDir).filter((sid) => ![SID_LIDER, SID_DEV, SID_REVISOR].includes(sid));
  return { handle, newFolders };
}

const PEDIDO = '[t-5358d400] Revisor elástico do quadro atlas: decidir as entregas paradas.\n- t-b03fdec8 (418 min) corrigir o login';
const ask = (token: string, op: Record<string, unknown>): OracleRequest => ({
  method: 'POST',
  url: SERVICE_PATH,
  body: JSON.stringify({ op: { op: 'abrir-revisor', quadro: 'atlas', pedido: PEDIDO, chave: 'atlas', ...op } }),
  authorization: `Bearer ${token}`,
});
const answerOf = async (response: Promise<{ status: number; body: unknown }>) => {
  const done = await response;
  return { status: done.status, body: JSON.parse(done.body as string) as Record<string, unknown> };
};

describe('abrir-revisor: o reconciliador abre o Revisor elástico do quadro', () => {
  it('só o reconciliador abre; outro serviço leva 403 e o corpo nunca escolhe papel, máquina nem nome', async () => {
    const m = machine();
    expect((await answerOf(m.handle(ask(MENCOES, {})))).status).toBe(403);
    for (const strange of [{ papel: 'dev' }, { onde: 'pc' }, { nome: 'Dev' }]) {
      const refused = await answerOf(m.handle(ask(RECONCILIADOR, strange)));
      expect(refused.status).toBe(400);
    }
    expect(m.newFolders()).toEqual([]);

    const opened = await answerOf(m.handle(ask(RECONCILIADOR, {})));
    expect(opened.status).toBe(200);
    expect(opened.body).toMatchObject({ ok: true, resultado: 'aberta' });
    const [sid] = m.newFolders();
    expect(opened.body.lugar).toBe(`session:${sid}`);
  });

  it('com um Revisor vivo (ou esperando vaga) no quadro responde ja-tem e não abre outro; fechado não conta', async () => {
    const alive = machine({ reviewer: 'alive' });
    expect((await answerOf(alive.handle(ask(RECONCILIADOR, {})))).body).toMatchObject({ resultado: 'ja-tem', lugar: 'place:revisor-atlas' });
    expect(alive.newFolders()).toEqual([]);

    const closed = machine({ reviewer: 'closed' });
    expect((await answerOf(closed.handle(ask(RECONCILIADOR, {})))).body).toMatchObject({ resultado: 'aberta' });
    expect(closed.newFolders()).toHaveLength(1);
  });

  it('dois pedidos seguidos ao mesmo quadro (mesmo com outra lista de entregas) abrem uma sessão só', async () => {
    const m = machine();
    const [first, second] = await Promise.all([answerOf(m.handle(ask(RECONCILIADOR, {}))), answerOf(m.handle(ask(RECONCILIADOR, { pedido: `${PEDIDO}\n- t-da9852e8 (60 min) outra` })))]);
    expect([first.body.resultado, second.body.resultado].sort()).toEqual(['aberta', 'ja-tem']);
    expect(m.newFolders()).toHaveLength(1);
    expect(second.body.lugar ?? first.body.lugar).toBe(`session:${m.newFolders()[0]}`);
  });
});
