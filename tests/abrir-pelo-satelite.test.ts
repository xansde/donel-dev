// t-d461e003 (19/11, ~13h40) — com o PC desligado, o Líder único da VPS pessoal pediu um Revisor no quadro Homologação
// (que vive na Homologações) e ouviu "conheço só os quadros do último retrato (teamzone, BizOps, Donel Dev)". Aqui: o
// pedido vai à fila daquela máquina no Oráculo da VPS pessoal, o satélite de lá o busca, abre a sessão lá com o
// abrir-local de lá (pasta tirada das sessões de lá, nunca do kit da VPS pessoal) e a resposta volta na repetição. O que
// quebraria sem o dono ver: duas sessões para um pedido, uma sessão aberta na pasta errada, e alguém que não é o Líder
// único (nem o Líder daquele quadro, no quadro dele) abrindo sessão em outra máquina.
//
// O preparo do satélite roda o script de verdade (bash) numa HOME temporária, com `claude` e `tmux` falsos no PATH, e o
// satélite fala com a API de verdade do Oráculo (as rotas do portão), sem rede.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createSystemConfigIoDeps } from '../src/main/config-store';
import { createLedgerService, nodeLedgerProofFs } from '../src/main/ledger-store';
import { OPEN_KIT_FILE, type OpenKit, type OpenKitRole } from '../src/main/open-kit';
import { buildClaudeArgs } from '../src/shared/commandBuilder';
import type { MindscapeBoard, MindscapeCard } from '../src/shared/mindscape/model';
import { createOpenLocal, NOT_THE_LEADER, readOpenKit, type ScriptRun } from '../src/oraculo/abrir-local';
import { createRemoteOpenClient, createRemoteOpenings, createSatelliteOpenings, readRemoteKit } from '../src/oraculo/abrir-satelite';
import { createOracleApiHandler, type OracleRequest } from '../src/oraculo/api';
import { mergePicture, type BoardPicture } from '../src/oraculo/portao';
import { createGateToolRoutes, GATE_OPEN_PATH, isLocalGate, readGateHashes } from '../src/oraculo/portoes';
import { compactPicture, createRemotePictures } from '../src/oraculo/retrato-satelite';
import type { SatellitePost } from '../src/oraculo/satelite';

const io = createSystemConfigIoDeps();
const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
const tempDir = (prefix: string): string => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
};

const T0 = Date.parse('2026-11-19T16:40:00Z');
const hash = (token: string): string => createHash('sha256').update(token).digest('hex');
const LOCAL_GATE = 'l'.repeat(64);
const SAT_GATE = 's'.repeat(64);
const PC = 'p'.repeat(64);
const PEDIDO = 'Revise as 2 entregas paradas do Homologação.\nCritério: veredito nas duas.';

// The personal VPS: the Líder único and a Dev of the board atlas.
const ATLAS = '/home/dono/seazone/atlas';
const SID_LIDER = '77777777-2222-4333-8444-555555555555';
const SID_DEV = '11111111-2222-4333-8444-555555555555';
// The Homologações: the board Homologação (its key is the PC's folder), a Dev and the board Líder the owner put there.
const HOMOLOG = 'C:\\Users\\dono\\seazone\\Homologação';
const HDEV = 'place:hdev';
const LIDER_H = 'place:lider-homolog';
const SID_HDEV = '22222222-2222-4333-8444-555555555555';
const SID_LIDER_H = '33333333-2222-4333-8444-555555555555';
const NEW_SID = 'aaaaaaaa-2222-4333-8444-555555555555';

const card = (id: string, roleId: string, by?: 'session'): MindscapeCard => ({ kind: 'session', id, roleId, previous: [], x: 0, y: 0, ...(by ? { by } : {}) });
const HOMOLOG_BOARD: MindscapeBoard = { projectPath: HOMOLOG, pan: { x: 0, y: 0 }, zoom: 1, cards: { [HDEV]: card(HDEV, 'dev', 'session'), [LIDER_H]: card(LIDER_H, 'lider') }, links: [], drawings: [] };
const HOMOLOG_LISTAR = [
  { id: HDEV, papel: 'dev', estado: 'trabalhando' },
  { id: LIDER_H, papel: 'lider', estado: 'trabalhando' },
];
const ATLAS_BOARD: MindscapeBoard = { projectPath: ATLAS, pan: { x: 0, y: 0 }, zoom: 1, cards: { 'place:dev': card('place:dev', 'dev') }, links: [], drawings: [] };

const ROLE_ARGS = buildClaudeArgs({ model: 'opus', effort: 'high', permissionMode: 'acceptEdits' });
const role = (id: string, name: string): OpenKitRole => ({ id, name, anyPlace: false, promptText: `# ${name}\n`, model: 'opus', effort: 'high', permissionMode: 'acceptEdits', launcherArgs: ROLE_ARGS, scopeSettings: null, scopeNeedsInventory: false });
const KIT: OpenKit = {
  version: 1,
  at: new Date(T0 - 3_600_000).toISOString(),
  place: { id: 'vps-pessoal', label: 'VPS pessoal' },
  openCap: null,
  roles: [role('dev', 'Dev'), role('revisor', 'Revisor')],
  boards: [
    { localCwd: ATLAS, name: 'atlas', homeRelativeDir: 'seazone/atlas', repoUrl: null, branch: null },
    // The folder the PC made for the personal VPS: never used on the Homologações.
    { localCwd: HOMOLOG, name: 'Homologação', homeRelativeDir: 'seazone/Homologação-da-VPS-pessoal', repoUrl: null, branch: null },
  ],
};

/** A temp HOME with fake `claude` and `tmux`, and the bash that runs the setup and the tmux as that user. */
function home(prefix: string) {
  const root = tempDir(prefix);
  const bin = join(root, 'bin');
  mkdirSync(bin);
  writeFileSync(join(bin, 'claude'), '#!/usr/bin/env bash\nexit 0\n', { mode: 0o755 });
  writeFileSync(join(bin, 'tmux'), '#!/usr/bin/env bash\necho "$*" >> "$HOME/tmux.log"\nexit 0\n', { mode: 0o755 });
  const env = { ...process.env, HOME: root, PATH: `${bin}:${process.env.PATH ?? ''}` };
  const run = (script: string): Promise<ScriptRun> =>
    new Promise((resolve) => {
      const child = spawn('bash', ['-s'], { env });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString('utf8')));
      child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString('utf8')));
      child.on('close', (code) => resolve({ code, stdout, stderr }));
      child.stdin.end(script);
    });
  const tmuxStarts = (): number => (existsSync(join(root, 'tmux.log')) ? readFileSync(join(root, 'tmux.log'), 'utf8').split('\n').filter((line) => line.includes('new-session')).length : 0);
  return { root, run, tmuxStarts, sessionsDir: join(root, '.donel', 's'), oraculoDir: join(root, '.donel', 'oraculo') };
}

interface Options {
  /** The Homologação's sessions there have no `dir` (no folder known there). */
  readonly noFolder?: boolean;
  /** The board Líder's session alive on the Homologações. */
  readonly boardLeader?: boolean;
}

function machines(options: Options = {}) {
  const clock = { now: T0 };

  // ---- the Homologações (satellite): its project folder lives out of its HOME, as /opt/homologacao there.
  const sat = home('abrir-satelite-');
  const project = realpathSync(tempDir('homologacao-opt-'));
  mkdirSync(join(project, '.claude', 'worktrees', 'hdev'), { recursive: true });
  const slive = new Set<string>();
  const sfolder = (sid: string, meta: Record<string, unknown>): void => {
    mkdirSync(join(sat.sessionsDir, sid), { recursive: true });
    writeFileSync(join(sat.sessionsDir, sid, 'meta.json'), JSON.stringify({ sid, mcpToken: 'k', mcpPort: 25000 + slive.size, hookPort: 26000 + slive.size, ...meta }));
    if (!options.noFolder) writeFileSync(join(sat.sessionsDir, sid, 'dir'), `${join(project, '.claude', 'worktrees', 'hdev')}\n`);
    slive.add(sid);
  };
  mkdirSync(sat.oraculoDir, { recursive: true });
  sfolder(SID_HDEV, { localCwd: HOMOLOG, name: 'Dev · Homologação', roleId: 'dev', openedBy: LIDER_H });
  const seen = T0 - 10 * 60_000;
  const who = (lugar: string, papel: string) => ({ nome: papel, projeto: 'Homologação', pasta: HOMOLOG, lugar, papel, roda: 'Homologações' });
  let spicture: BoardPicture | null = {
    at: seen,
    sessoes: {
      [SID_HDEV]: { quemSou: who(HDEV, 'dev'), listar: HOMOLOG_LISTAR, board: HOMOLOG_BOARD, at: seen },
      ...(options.boardLeader ? { [SID_LIDER_H]: { quemSou: who(LIDER_H, 'lider'), listar: HOMOLOG_LISTAR, board: HOMOLOG_BOARD, at: seen } } : {}),
    },
  };
  if (options.boardLeader) sfolder(SID_LIDER_H, { localCwd: HOMOLOG, name: 'Líder · Homologação', roleId: 'lider' });
  const ids = [NEW_SID];
  let counter = 0;
  const delivered: unknown[] = [];
  const satOpen = createOpenLocal({
    sessionsDir: sat.sessionsDir,
    oraculoDir: sat.oraculoDir,
    picture: () => spicture,
    setSession: (sid, session) => {
      spicture = mergePicture(spicture, { at: spicture?.at ?? T0, sessoes: { [sid]: session } }, (folder) => existsSync(join(sat.sessionsDir, folder)));
    },
    leader: async () => null,
    liveSessions: async () => new Set(slive),
    deliver: async (message) => {
      delivered.push(message);
      return { placeId: message.placeId };
    },
    run: async (script) => {
      const done = await sat.run(script);
      if (script.includes('new-session -d') && done.code === 0) for (const folder of readdirSync(sat.sessionsDir)) slive.add(folder);
      return done;
    },
    room: () => null,
    portFree: async () => true,
    now: () => clock.now,
    newId: () => ids.shift() ?? `bbbbbbbb-2222-4333-8444-${String(++counter).padStart(12, '0')}`,
    log: () => undefined,
    kit: () => readRemoteKit(sat.oraculoDir)?.kit ?? null,
    folderFromSessions: sat.root,
  });

  // ---- the personal VPS: the registro's API (the gate routes) and the entregador's abrir-local, apart.
  const dir = tempDir('abrir-vps-');
  writeFileSync(join(dir, OPEN_KIT_FILE), JSON.stringify(KIT));
  mkdirSync(join(dir, 'portoes'));
  writeFileSync(join(dir, 'portoes', 'homologacoes.sha256'), `${hash(SAT_GATE)}\n`);
  writeFileSync(join(dir, 'portoes', 'vps-pessoal.sha256'), `${hash(LOCAL_GATE)}\n`);
  writeFileSync(join(dir, 'portoes', 'vps-pessoal.local'), '');
  const remotes = createRemotePictures({ dir, io, now: () => clock.now });
  // The satellite's picture of its sessions reached the personal VPS (retrato-satelite.ts).
  remotes.accept('homologacoes', compactPicture(spicture, seen, slive));
  const openings = createRemoteOpenings({ dir, pictures: remotes, kit: () => readOpenKit(dir), now: () => clock.now });
  const ledgerFile = join(dir, 'ledger.json');
  const ledger = createLedgerService({ filePath: ledgerFile, io, proofFs: nodeLedgerProofFs, now: () => clock.now });
  const api = createOracleApiHandler({
    ledger,
    ledgerFile,
    tokenHash: () => hash(PC),
    gates: () => readGateHashes(dir),
    gateRoutes: createGateToolRoutes({ ledger: () => ledger, pictures: remotes, openings: { queue: openings, isLocal: (name) => isLocalGate(dir, name) } }),
  });
  /** A POST straight into the API; `cut.answers` drops the next call that says answers before it reaches the registro. */
  const cut = { answers: false };
  const post = async (url: string, token: string, body: string): Promise<SatellitePost> => {
    if (cut.answers && body.includes('"respostas":[{')) {
      cut.answers = false;
      return 'caiu';
    }
    const answer = await api({ method: 'POST', url: new URL(url).pathname, body, authorization: `Bearer ${token}` } as OracleRequest);
    return { status: answer.status, body: answer.body as string };
  };
  const satRound = () => createSatelliteOpenings({ url: 'http://vps-pessoal:47816', token: () => SAT_GATE, post, dir: sat.oraculoDir, open: satOpen.openFor, log: () => undefined });

  const vps = home('abrir-vps-home-');
  for (const sid of [SID_LIDER, SID_DEV]) mkdirSync(join(vps.sessionsDir, sid), { recursive: true });
  const vpicture: BoardPicture = {
    at: seen,
    sessoes: {
      [SID_LIDER]: { quemSou: { nome: 'Líder', papel: 'lider', liderUnico: true, lugar: null }, listar: [] },
      [SID_DEV]: { quemSou: { nome: 'Dev · atlas', pasta: ATLAS, lugar: 'place:dev', papel: 'dev' }, listar: [{ id: 'place:dev', papel: 'dev', estado: 'trabalhando' }], board: ATLAS_BOARD },
    },
  };
  const vpsOpen = createOpenLocal({
    sessionsDir: vps.sessionsDir,
    oraculoDir: dir,
    picture: () => vpicture,
    setSession: () => undefined,
    leader: async () => ({ sid: SID_LIDER }),
    liveSessions: async () => new Set([SID_LIDER, SID_DEV]),
    deliver: async () => null,
    run: vps.run,
    room: () => null,
    portFree: async () => true,
    now: () => clock.now,
    log: () => undefined,
    remote: createRemoteOpenClient({ url: 'http://127.0.0.1:47816', token: () => LOCAL_GATE, post }),
  });
  const ask = (args: Record<string, unknown> = {}, sid = SID_LIDER) =>
    vpsOpen.abrir(sid, vpicture.sessoes[sid]!, { tool: 'sessao_abrir', papel: 'revisor', pedido: PEDIDO, quadro: 'Homologação', onde: 'Homologações', ...args } as never);
  const satFolders = (): string[] => readdirSync(sat.sessionsDir).filter((sid) => sid !== SID_HDEV && sid !== SID_LIDER_H);
  const metaOf = (sid: string): Record<string, unknown> => JSON.parse(readFileSync(join(sat.sessionsDir, sid, 'meta.json'), 'utf8')) as Record<string, unknown>;
  return { clock, dir, sat, vps, project, satOpen, satRound, ask, cut, post, satFolders, metaOf, slive, delivered, picture: () => spicture };
}

const parsed = (outcome: { kind: string; text?: string }): Record<string, unknown> => JSON.parse(outcome.text ?? '') as Record<string, unknown>;

describe('com o PC desligado, abrir sessão no quadro de outra máquina pelo satélite', () => {
  it('o pedido do Líder único vai à fila da Homologações, o satélite abre lá uma vez só e a resposta volta na repetição', async () => {
    const m = machines();
    const first = await m.ask();
    expect(first.kind).toBe('text');
    expect(parsed(first)).toMatchObject({ quadro: 'Homologação', papel: 'revisor', roda: 'Homologações', estado: 'pedido aceito' });
    // Nothing opened on the personal VPS.
    expect(m.vps.tmuxStarts()).toBe(0);

    // The satellite's round: it takes the kit and the order, opens there, and the call with the answer never arrives.
    m.cut.answers = true;
    await m.satRound().round();
    expect(m.satFolders()).toEqual([NEW_SID]);
    expect(m.sat.tmuxStarts()).toBe(1);
    expect(m.metaOf(NEW_SID)).toMatchObject({ openedBy: 'lider', localCwd: HOMOLOG, roleId: 'revisor', abertaSemPc: true });
    // The folder of the board there: the project its sessions use, never the personal VPS's kit folder.
    expect(readFileSync(join(m.sat.sessionsDir, NEW_SID, 'dir'), 'utf8').trim()).toBe(m.project);
    const kit = readRemoteKit(m.sat.oraculoDir)!.kit;
    expect(kit.place).toEqual({ id: 'homologacoes', label: 'Homologações' });
    expect(kit.boards.every((board) => board.homeRelativeDir === '')).toBe(true);

    // Still waiting: the answer did not reach the registro.
    expect(parsed(await m.ask())).toMatchObject({ estado: 'aguardando Homologações' });
    // A satellite restarted (no memory): the same order comes again and opens nothing new.
    await m.satRound().round();
    expect(m.sat.tmuxStarts()).toBe(1);
    expect(m.satFolders()).toEqual([NEW_SID]);

    const answer = await m.ask();
    expect(answer.kind).toBe('text');
    expect(parsed(answer)).toMatchObject({ lugar: `session:${NEW_SID}`, papel: 'revisor', quadro: 'Homologação', roda: 'Homologações' });
    expect(await m.ask()).toEqual(answer);
    await m.satRound().round();
    expect(m.sat.tmuxStarts()).toBe(1);

    // The new place is in the satellite's picture, which goes to the personal VPS.
    const compact = compactPicture(m.picture(), T0, m.slive);
    expect(compact.sessoes[NEW_SID]?.quemSou).toMatchObject({ lugar: `session:${NEW_SID}`, pasta: HOMOLOG, papel: 'revisor' });
  });

  it('quadro sem pasta conhecida na máquina: recusa clara, nada aberto, e a próxima repetição pede de novo', async () => {
    const m = machines({ noFolder: true });
    expect(parsed(await m.ask())).toMatchObject({ estado: 'pedido aceito' });
    await m.satRound().round();
    expect(m.satFolders()).toEqual([]);
    expect(m.sat.tmuxStarts()).toBe(0);
    const refused = await m.ask();
    expect(refused.kind).toBe('error');
    expect(refused.text).toContain('nenhuma sessão desta máquina (Homologações) mostra a pasta do quadro Homologação');
    expect(parsed(await m.ask())).toMatchObject({ estado: 'pedido aceito' });
  });

  it('o Líder do quadro vivo no satélite abre no próprio quadro, com a seta de abertura saindo dele', async () => {
    const m = machines({ boardLeader: true });
    // The kit of roles reaches the satellite with its first round.
    await m.satRound().round();
    const out = await m.satOpen.abrir(SID_LIDER_H, m.picture()!.sessoes[SID_LIDER_H]!, { tool: 'sessao_abrir', papel: 'revisor', pedido: PEDIDO });
    expect(out.kind).toBe('text');
    expect(parsed(out)).toMatchObject({ lugar: `session:${NEW_SID}`, quadro: 'Homologação', roda: 'Homologações' });
    expect(m.metaOf(NEW_SID)).toMatchObject({ openedBy: LIDER_H, localCwd: HOMOLOG });
    const compact = compactPicture(m.picture(), T0, m.slive);
    expect(compact.quadros[HOMOLOG]?.board?.links).toContainEqual(expect.objectContaining({ from: LIDER_H, to: `session:${NEW_SID}`, arrow: true, opened: true }));

    // The Líder único's request to that board goes to its live Líder there (12/11), never a session past him.
    const viaVps = await m.ask({ nome: 'Outro revisor' });
    expect(parsed(viaVps)).toMatchObject({ estado: 'pedido aceito' });
    await m.satRound().round();
    expect(m.delivered).toEqual([expect.objectContaining({ projectPath: HOMOLOG, placeId: LIDER_H })]);
    expect(m.satFolders()).toEqual([NEW_SID]);
    expect((await m.ask({ nome: 'Outro revisor' })).text).toContain('Entregue ao Líder do quadro Homologação');
  });

  it('nenhum outro abre: um Dev de qualquer das máquinas, e o portão do satélite pedindo abertura na VPS pessoal', async () => {
    const m = machines();
    await m.satRound().round();
    const devThere = await m.satOpen.abrir(SID_HDEV, m.picture()!.sessoes[SID_HDEV]!, { tool: 'sessao_abrir', papel: 'revisor', pedido: 'outro', quadro: 'Homologação' });
    expect(devThere).toEqual({ kind: 'error', text: NOT_THE_LEADER });
    const devHere = await m.ask({ pedido: 'pedido do Dev' }, SID_DEV);
    expect(devHere).toEqual({ kind: 'error', text: NOT_THE_LEADER });
    // The satellite's token on the opening route of the personal VPS: refused (only that machine's own gate asks).
    const bySatellite = await m.post(`http://vps-pessoal:47816${GATE_OPEN_PATH}`, SAT_GATE, JSON.stringify({ call: { quadro: 'Homologação', papel: 'revisor', pedido: 'furando' } }));
    expect(typeof bySatellite === 'object' ? bySatellite.status : bySatellite).toBe(403);
    await m.satRound().round();
    expect(m.satFolders()).toEqual([]);
    expect(m.sat.tmuxStarts()).toBe(0);
  });
});
