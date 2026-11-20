// Quadro de tarefas no SQLite da VPS (t-1e354d15, emenda de 20/11: docs/design/quadro-de-tarefas-sqlite.md). The
// SQLite is now where the rules count (it was `board.move_card` in Postgres). What breaks without the owner seeing it:
// a session that is not the Líder putting a card in "Esperando você" (it lands on his desk), a card parked in
// "Travado" with no link or deadline (nobody wakes it), two writers (daemon and cron) overwriting each other's move,
// a retried create making a second card, the seed duplicating cards or writing in the Oráculo's ledger.
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createSystemConfigIoDeps } from '../src/main/config-store';
import { createLedgerService, nodeLedgerProofFs } from '../src/main/ledger-store';
import { openSqliteLedgerStore } from '../src/oraculo/ledger-sqlite';
import { chooseBoard, createBoardSqlite, type BoardSqliteStore } from '../src/oraculo/board-sqlite';
import { planSeed, readLedgerReadOnly, runSeed, sessionResolver } from '../src/board-cron/semente';

const dirs: string[] = [];
const stores: BoardSqliteStore[] = [];
afterEach(() => {
  for (const store of stores.splice(0)) store.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const tmp = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'quadro-sqlite-'));
  dirs.push(dir);
  return dir;
};

const NOW = Date.parse('2026-11-20T12:00:00Z');
const DEV = 'place:dev';
const LEADER = 'place:lider';

function board(file = join(tmp(), 'board.sqlite')): BoardSqliteStore {
  const store = createBoardSqlite(file, { now: () => NOW });
  stores.push(store);
  return store;
}

async function doingCard(store: BoardSqliteStore) {
  await store.upsertProject({ id: 'atlas', name: 'atlas', aliases: ['/home/u/seazone/atlas'] });
  const card = await store.createCard({ p_project_id: 'atlas', p_title: 'Quadro', p_owner_request: 'pedido', p_requested_by: 'dono', p_actor: LEADER, p_stage: 'todo', p_as_leader: true });
  return store.moveCard({ p_card_id: card.id, p_to: 'doing', p_actor: DEV, p_expected_version: card.version });
}

describe('quadro no SQLite: as regras valem no banco', () => {
  it('"Esperando você" só pelo Líder e só com um motivo da lista', async () => {
    const store = board();
    const card = await doingCard(store);
    const ask = { p_card_id: card.id, p_to: 'waiting_owner' as const, p_expected_version: card.version };
    await expect(store.moveCard({ ...ask, p_actor: DEV, p_owner_reason: 'money' })).rejects.toThrow('só o Líder do quadro');
    await expect(store.moveCard({ ...ask, p_actor: LEADER, p_as_leader: true, p_owner_reason: 'parece importante' })).rejects.toThrow('"Esperando você" só por');
    const moved = await store.moveCard({ ...ask, p_actor: LEADER, p_as_leader: true, p_owner_reason: 'money' });
    expect(moved).toMatchObject({ stage: 'waiting_owner', owner_reason: 'money', version: card.version + 1 });
    expect((await store.ownerFeed(0)).map((row) => row.card_id)).toEqual([card.id]);
  });

  it('"Travado" exige link e prazo no futuro; a justificativa some ao sair da coluna', async () => {
    const store = board();
    const card = await doingCard(store);
    const ask = { p_card_id: card.id, p_to: 'blocked' as const, p_actor: DEV, p_expected_version: card.version, p_justification: 'esperando o Fazolin' };
    await expect(store.moveCard(ask)).rejects.toThrow('"Travado" exige justificativa');
    await expect(store.moveCard({ ...ask, p_justification_link: 'https://x.slack.com/p1', p_justification_due: new Date(NOW - 1).toISOString() })).rejects.toThrow('"Travado" exige');
    const blocked = await store.moveCard({ ...ask, p_justification_link: 'https://x.slack.com/p1', p_justification_due: new Date(NOW + 3600_000).toISOString() });
    expect(blocked).toMatchObject({ stage: 'blocked', justification: 'esperando o Fazolin', justification_link: 'https://x.slack.com/p1' });
    const back = await store.moveCard({ p_card_id: card.id, p_to: 'doing', p_actor: DEV, p_expected_version: blocked.version });
    expect(back).toMatchObject({ stage: 'doing', justification: null, justification_link: null, justification_due: null });
  });

  it('versão velha é recusada, também entre os dois processos que escrevem o arquivo', async () => {
    const file = join(tmp(), 'board.sqlite');
    const daemon = board(file);
    const cron = board(file);
    const card = await doingCard(daemon);
    expect((await cron.getCard(card.id))?.version).toBe(card.version);
    await daemon.moveCard({ p_card_id: card.id, p_to: 'doing', p_actor: DEV, p_expected_version: card.version, p_note: 'nota 1' });
    await expect(cron.moveCard({ p_card_id: card.id, p_to: 'done', p_actor: DEV, p_expected_version: card.version, p_done_summary: 'feito' })).rejects.toThrow('o cartão mudou desde a sua leitura');
    expect((await cron.getCard(card.id))?.note).toBe('nota 1');
    // the cron's marks never bump the version a session read
    await cron.markCron(card.id, 'charged');
    expect((await daemon.getCard(card.id))).toMatchObject({ version: card.version + 1, charge_count: 1 });
    expect(statSync(file).mode & 0o777).toBe(0o600);
  });

  it('create_card com o mesmo client_ref devolve o mesmo cartão; pasta desconhecida cai em sem-projeto', async () => {
    const store = board();
    const args = { p_project_id: 'nao-existe', p_title: 'x', p_owner_request: 'y', p_requested_by: 'dono', p_actor: DEV, p_client_ref: 'auto:1' };
    const first = await store.createCard(args);
    const again = await store.createCard({ ...args, p_title: 'outro título' });
    expect(again.id).toBe(first.id);
    expect(first).toMatchObject({ project_id: 'sem-projeto', stage: 'inbox' });
    await expect(store.createCard({ ...args, p_client_ref: 'auto:2', p_stage: 'todo' })).rejects.toThrow('só o Líder do quadro');
  });
});

describe('qual quadro o daemon e o cron abrem', () => {
  it('sqlite.json válido vence; sem ele, supabase.json; sem nenhum, desligado', () => {
    const dir = tmp();
    const sqlite = join(dir, 'sqlite.json');
    const supabase = join(dir, 'supabase.json');
    expect(chooseBoard({ sqliteConfig: sqlite, supabaseConfig: supabase }).kind).toBe('off');
    writeFileSync(supabase, JSON.stringify({ url: 'https://ref.supabase.co', serviceKeyFile: join(dir, 'k') }));
    expect(chooseBoard({ sqliteConfig: sqlite, supabaseConfig: supabase }).kind).toBe('supabase');
    writeFileSync(sqlite, '{"file": ""}');
    expect(chooseBoard({ sqliteConfig: sqlite, supabaseConfig: supabase }).kind).toBe('invalid');
    writeFileSync(sqlite, JSON.stringify({ file: 'board.sqlite' }));
    expect(chooseBoard({ sqliteConfig: sqlite, supabaseConfig: supabase })).toMatchObject({ kind: 'sqlite', file: join(dir, 'board.sqlite') });
  });
});

describe('semente a partir do Oráculo', () => {
  it('um cartão por tarefa viva, idempotente, e o ledger do Oráculo não muda', async () => {
    const dir = tmp();
    const ledgerFile = join(dir, 'ledger.sqlite');
    const ledgerStore = openSqliteLedgerStore(ledgerFile);
    const ledger = createLedgerService({ filePath: join(dir, 'ledger.json'), io: createSystemConfigIoDeps(), proofFs: nodeLedgerProofFs, store: ledgerStore });
    const make = async (request: string) => {
      const made = await ledger.apply({ kind: 'dono' }, { op: 'criar', projectPath: 'C:\\Users\\dono\\seazone\\Donel Dev\\.claude\\worktrees\\x', request, doneWhen: 'pronto', due: '2026-11-30', ownerPlaceId: DEV, risk: 'baixo', frente: 'Quadro' });
      if (!made.ok) throw new Error(made.reason);
      return made.task.id;
    };
    const open = await make('aberta');
    const running = await make('em execução, travada');
    const owner = await make('precisa do dono');
    const gone = await make('cancelada');
    for (const id of [running, owner]) expect((await ledger.apply({ kind: 'lugar', placeId: DEV }, { op: 'assumir', id })).ok).toBe(true);
    expect((await ledger.apply({ kind: 'lugar', placeId: DEV }, { op: 'andamento', id: running, progress: { estado: 'travada', precisa: 'resposta do Fazolin' } })).ok).toBe(true);
    expect((await ledger.apply({ kind: 'lugar', placeId: DEV }, { op: 'andamento', id: owner, progress: { estado: 'precisa-do-dono', precisa: 'credencial' } })).ok).toBe(true);
    expect((await ledger.apply({ kind: 'dono' }, { op: 'cancelar', id: gone, reason: 'não vai sair' })).ok).toBe(true);
    ledgerStore.close();
    const hash = (): string => createHash('sha256').update(readFileSync(ledgerFile)).digest('hex');
    const before = hash();

    const plan = planSeed(readLedgerReadOnly(ledgerFile), { host: 'vps-pessoal', vpsHome: '/home/u' });
    expect(plan.projects).toEqual([
      expect.objectContaining({ id: 'donel-dev', name: 'Donel Dev', aliases: expect.arrayContaining(['C:\\Users\\dono\\seazone\\Donel Dev', '/home/u/seazone/Donel Dev']) }),
    ]);
    const store = board();
    const first = await runSeed(store, plan);
    const second = await runSeed(store, planSeed(readLedgerReadOnly(ledgerFile), { host: 'vps-pessoal', vpsHome: '/home/u' }));
    expect(first.created).toBe(3);
    expect(second).toMatchObject({ created: 0, existing: 3 });
    expect(hash()).toBe(before);

    const cards = await store.listCards('donel-dev', { includeDone: true });
    const byTask = new Map(cards.map((card) => [card.oraculo_id, card]));
    expect(cards).toHaveLength(3);
    expect(byTask.get(open)).toMatchObject({ stage: 'todo', place_id: DEV, front: 'Quadro' });
    // blocked would need a link and a deadline the Oráculo never had: doing, with the note asking for them
    expect(byTask.get(running)).toMatchObject({ stage: 'doing', place_id: DEV, justification: null });
    expect(byTask.get(running)?.note).toContain('travada');
    expect(byTask.get(owner)).toMatchObject({ stage: 'inbox' });
    expect(await store.projectOf('/home/u/seazone/Donel Dev/.claude/worktrees/y')).toBe('donel-dev');
  });

  it('o cartão leva a sessão do lugar (session:<uuid>, ou quem segura o lugar no retrato), também numa segunda rodada', async () => {
    const dir = tmp();
    const ledgerFile = join(dir, 'ledger.sqlite');
    const ledgerStore = openSqliteLedgerStore(ledgerFile);
    const ledger = createLedgerService({ filePath: join(dir, 'ledger.json'), io: createSystemConfigIoDeps(), proofFs: nodeLedgerProofFs, store: ledgerStore });
    const folder = 'C:\\Users\\dono\\seazone\\Donel Dev';
    const SID = 'd381c7ed-c788-469e-8e08-d4504d7efae8';
    const HOLDER = '9c10729a-bbdb-47d3-b820-12d1dcd8b118';
    const RENEWED = '11111111-2222-4333-8444-555555555555';
    const make = async (ownerPlaceId: string) => {
      const made = await ledger.apply({ kind: 'dono' }, { op: 'criar', projectPath: folder, request: ownerPlaceId, doneWhen: 'pronto', due: '2026-11-30', ownerPlaceId, risk: 'baixo' });
      if (!made.ok) throw new Error(made.reason);
      expect((await ledger.apply({ kind: 'lugar', placeId: ownerPlaceId }, { op: 'assumir', id: made.task.id })).ok).toBe(true);
      return made.task.id;
    };
    const bySession = await make(`session:${SID}`);
    const byPlace = await make('place:dev-quadro');
    const unknown = await make('place:sem-retrato');
    ledgerStore.close();
    const ledgerRead = readLedgerReadOnly(ledgerFile);
    const options = { host: 'vps-pessoal', vpsHome: '/home/u' };

    // without a picture only session:<uuid> resolves
    const store = board();
    const first = await runSeed(store, planSeed(ledgerRead, options));
    expect(first.sessions).toBe(1);
    const cards = async () => new Map((await store.listCards('donel-dev', {})).map((card) => [card.oraculo_id, card]));
    expect((await cards()).get(byPlace)?.session_id).toBeNull();
    const versions = new Map([...(await cards())].map(([id, card]) => [id, card.version]));

    // the picture says who holds place:dev-quadro now (a renewed holder hands over: its successor holds it)
    const picture = {
      at: NOW,
      sessoes: {
        [RENEWED]: { quemSou: { lugar: 'place:dev-quadro', pasta: folder }, listar: [], at: NOW, renovadaPara: HOLDER },
        [HOLDER]: { quemSou: { lugar: 'place:dev-quadro', pasta: `${folder}\\.claude\\worktrees\\x` }, listar: [], at: NOW - 60_000 },
      },
    };
    const second = await runSeed(store, planSeed(ledgerRead, { ...options, sessionOf: sessionResolver([picture]) }));
    expect(second).toMatchObject({ created: 0, existing: 3, sessions: 1 });
    const after = await cards();
    expect(after.get(bySession)?.session_id).toBe(SID);
    expect(after.get(byPlace)?.session_id).toBe(HOLDER);
    expect(after.get(unknown)?.session_id).toBeNull();
    // who to wake is not a step of the card: no version, no column change
    for (const [id, card] of after) expect(card).toMatchObject({ version: versions.get(id), stage: 'doing' });
    // the Líder gave the card to another place: the old place's session is not attached to it
    expect(await store.fillSession(after.get(unknown)!.id, 'place:outro', HOLDER)).toBe(false);
  });
});
