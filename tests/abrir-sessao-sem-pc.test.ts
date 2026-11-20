// t-1a3f7150 (abrir sessão com o PC desligado), fatias 3 e 4 — com o PC desligado, o Líder único vivo no tmux da VPS
// chama `sessao_abrir` e o portão do Oráculo abre a sessão ali mesmo (docs/adr/0009). O que quebraria sem o dono ver:
// duas sessões para um pedido só, a sessão nascendo fora do bypass ou sem o pedido, um Líder aberto sem o PC, um pedido
// passando por cima do Líder do quadro, uma pasta pela metade que o PC acharia na volta, e o portão abrindo aqui uma
// sessão que o PC (ligado ou só lento) também abriria.
//
// O preparo roda o script de verdade (bash) numa HOME temporária, com `claude` e `tmux` falsos no PATH.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createSystemConfigIoDeps } from '../src/main/config-store';
import type { OwnerMessage } from '../src/main/ledger-card-writer';
import { createLedgerService, nodeLedgerProofFs } from '../src/main/ledger-store';
import { OPEN_KIT_FILE, type OpenKit } from '../src/main/open-kit';
import { appMcpAllowArgs, buildClaudeArgs } from '../src/shared/commandBuilder';
import { worktreeNameFor } from '../src/shared/sessionWorktree';
import type { MindscapeBoard, MindscapeCard } from '../src/shared/mindscape/model';
import { clearAdoptedMarks, CREATING_MARK, createOpenLocal, NO_KIT, NOT_THE_LEADER, sweepUnfinishedOpenings, type ScriptRun } from '../src/oraculo/abrir-local';
import { createGateHandler, mergePicture, type BoardPicture, type GateForward, type GateResponse } from '../src/oraculo/portao';
import { createProbe } from '../src/oraculo/sonda';

const io = createSystemConfigIoDeps();
const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const PROJECT = '/home/dono/seazone/atlas';
const SID_LIDER = '77777777-2222-4333-8444-555555555555';
const SID_DEV = '11111111-2222-4333-8444-555555555555';
const NEW_SID = 'aaaaaaaa-2222-4333-8444-555555555555';
const SID_LIDER_QUADRO = '99999999-2222-4333-8444-555555555555';
const DEV = 'place:dev';
const LIDER_DO_QUADRO = 'place:lider-atlas';
const TOKEN = 'token-do-lider';
const T0 = Date.parse('2026-11-18T15:00:00Z');
const PEDIDO = 'Corrija o bug do login.\nCritério: "npm test" verde e print da tela.';

const card = (id: string, roleId: string): MindscapeCard => ({ kind: 'session', id, roleId, previous: [], x: 0, y: 0 });

function boardOf(withLeader: boolean): { board: MindscapeBoard; listar: unknown[] } {
  const cards: Record<string, MindscapeCard> = { [DEV]: card(DEV, 'dev') };
  const listar: unknown[] = [{ id: DEV, papel: 'dev', estado: 'trabalhando', voce: true, podeMandar: false }];
  if (withLeader) {
    cards[LIDER_DO_QUADRO] = card(LIDER_DO_QUADRO, 'lider');
    listar.push({ id: LIDER_DO_QUADRO, papel: 'lider', estado: 'parada' });
  }
  return { board: { projectPath: PROJECT, pan: { x: 0, y: 0 }, zoom: 1, cards, links: [], drawings: [] }, listar };
}

const KIT_ROLE_ARGS = buildClaudeArgs({ model: 'opus', effort: 'high', permissionMode: 'acceptEdits' });

function kitOf(openCap: number | null): OpenKit {
  return {
    version: 1,
    at: new Date(T0).toISOString(),
    place: { id: 'vps-pessoal', label: 'VPS pessoal' },
    openCap,
    roles: [
      {
        id: 'dev',
        name: 'Dev',
        anyPlace: false,
        promptText: '# Dev\nVocê implementa.\n',
        model: 'opus',
        effort: 'high',
        permissionMode: 'acceptEdits',
        launcherArgs: KIT_ROLE_ARGS,
        scopeSettings: null,
        scopeNeedsInventory: false,
      },
    ],
    boards: [{ localCwd: PROJECT, name: 'atlas', homeRelativeDir: 'seazone/atlas', repoUrl: null, branch: null }],
  };
}

interface MachineOptions {
  readonly leaderOnBoard?: boolean;
  /** The board Líder's session in the picture (its `quemSou.lugar` is his place): with its tmux alive here, or not. */
  readonly boardLeaderTmux?: 'alive' | 'gone';
  readonly openCap?: number | null;
  readonly kit?: boolean;
  readonly tmuxFails?: boolean;
}

/** This VPS: a temp HOME with the Líder único and a Dev alive, the kit the PC left, fake `claude` and `tmux`. */
function machine(options: MachineOptions = {}) {
  const home = mkdtempSync(join(tmpdir(), 'abrir-sem-pc-'));
  dirs.push(home);
  const bin = join(home, 'bin');
  mkdirSync(bin);
  writeFileSync(join(bin, 'claude'), '#!/usr/bin/env bash\nprintf \'%s\\0\' "$@" > "$HOME/argv"\n', { mode: 0o755 });
  writeFileSync(join(bin, 'tmux'), `#!/usr/bin/env bash\necho "$*" >> "$HOME/tmux.log"\n${options.tmuxFails ? 'case "$*" in *new-session*) exit 1;; esac\n' : ''}exit 0\n`, { mode: 0o755 });
  const sessionsDir = join(home, '.donel', 's');
  const oraculoDir = join(home, '.donel', 'oraculo');
  for (const sid of [SID_LIDER, SID_DEV, ...(options.boardLeaderTmux ? [SID_LIDER_QUADRO] : [])]) mkdirSync(join(sessionsDir, sid), { recursive: true });
  mkdirSync(oraculoDir, { recursive: true });
  writeFileSync(join(sessionsDir, SID_LIDER, 'meta.json'), JSON.stringify({ sid: SID_LIDER, mcpToken: TOKEN, mcpPort: 25711, hookPort: 25712, leaderOfAll: true }));
  if (options.kit !== false) writeFileSync(join(oraculoDir, OPEN_KIT_FILE), JSON.stringify(kitOf(options.openCap === undefined ? 2 : options.openCap)));
  const env = { ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH ?? ''}` };
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
  const exists = (folder: string): boolean => existsSync(join(sessionsDir, folder));
  const { board, listar } = boardOf(options.leaderOnBoard === true);
  let picture: BoardPicture | null = {
    at: T0 - 60_000,
    sessoes: {
      [SID_LIDER]: { quemSou: { nome: 'Líder', papel: 'lider', liderUnico: true, lugar: null }, listar: [] },
      [SID_DEV]: { quemSou: { nome: 'Dev · atlas', pasta: PROJECT, lugar: DEV, papel: 'dev' }, listar, board },
      ...(options.boardLeaderTmux ? { [SID_LIDER_QUADRO]: { quemSou: { nome: 'Líder · atlas', pasta: PROJECT, lugar: LIDER_DO_QUADRO, papel: 'lider' }, listar, board } } : {}),
    },
  };
  const live = new Set([SID_LIDER, SID_DEV, ...(options.boardLeaderTmux === 'alive' ? [SID_LIDER_QUADRO] : [])]);
  const delivered: OwnerMessage[] = [];
  /** What was on disk when the synthetic picture was kept. */
  const atPicture: Array<{ meta: boolean; tmux: boolean }> = [];
  const ids = [NEW_SID];
  let counter = 0;
  const abrir = createOpenLocal({
    sessionsDir,
    oraculoDir,
    picture: () => picture,
    setSession: (sid, session) => {
      atPicture.push({ meta: existsSync(join(sessionsDir, sid, 'meta.json')), tmux: existsSync(join(home, 'tmux.log')) });
      picture = mergePicture(picture, { at: picture?.at ?? T0, sessoes: { [sid]: session } }, exists);
    },
    forgetSession: (sid) => {
      if (!picture) return;
      const { [sid]: _gone, ...sessoes } = picture.sessoes;
      picture = { ...picture, sessoes };
    },
    leader: async () => ({ sid: SID_LIDER }),
    liveSessions: async () => new Set(live),
    deliver: async (message) => {
      delivered.push(message);
      return { placeId: message.placeId };
    },
    run: async (script) => {
      const done = await run(script);
      // The tmux came up: it is alive from now on.
      if (script.includes('new-session -d') && done.code === 0) for (const folder of readdirSync(sessionsDir)) live.add(folder);
      return done;
    },
    room: () => null,
    portFree: async () => true,
    now: () => T0,
    newId: () => ids.shift() ?? `bbbbbbbb-2222-4333-8444-${String(++counter).padStart(12, '0')}`,
    log: () => undefined,
  });
  const ask = (args: Record<string, unknown>) => abrir.abrir(SID_LIDER, picture!.sessoes[SID_LIDER]!, { tool: 'sessao_abrir', papel: 'dev', pedido: PEDIDO, quadro: 'atlas', ...args } as never);
  const folders = (): string[] => readdirSync(sessionsDir).filter((sid) => sid !== SID_LIDER && sid !== SID_DEV && sid !== SID_LIDER_QUADRO);
  const tmuxStarts = (): number => (existsSync(join(home, 'tmux.log')) ? readFileSync(join(home, 'tmux.log'), 'utf8').split('\n').filter((l) => l.includes('new-session')).length : 0);
  return { home, env, sessionsDir, oraculoDir, abrir, ask, delivered, atPicture, live, folders, tmuxStarts, picture: () => picture, setPicture: (next: BoardPicture) => (picture = mergePicture(picture, next, exists)) };
}

const metaOf = (m: ReturnType<typeof machine>, sid: string): Record<string, unknown> => JSON.parse(readFileSync(join(m.sessionsDir, sid, 'meta.json'), 'utf8')) as Record<string, unknown>;

describe('abrir sessão com o PC desligado (abrir-local)', () => {
  it('abre no tmux daqui: argv inteiro em bypass com --session-id e o pedido; meta com abertaSemPc; retrato antes dos arquivos e do tmux', async () => {
    const m = machine();
    const out = await m.ask({ nome: 'Dev login' });
    expect(out.kind).toBe('text');
    const answer = JSON.parse((out as { text: string }).text) as Record<string, unknown>;
    expect(answer).toMatchObject({ quadro: 'atlas', lugar: `session:${NEW_SID}`, nome: 'Dev login', papel: 'dev', roda: 'VPS pessoal' });

    const meta = metaOf(m, NEW_SID);
    expect(meta).toMatchObject({ sid: NEW_SID, abertaSemPc: true, openedBy: 'lider', roleId: 'dev', localCwd: PROJECT, projectName: 'atlas' });
    // t-49dee38d — its own place in the meta, so a renewal here keeps it (and the identity stays `session:<sid>`).
    expect(meta.placeId).toBe(`session:${NEW_SID}`);
    expect(JSON.stringify(meta)).not.toContain('Corrija');
    expect(meta.launchArgs).toEqual([...KIT_ROLE_ARGS, '-n', 'Dev login', '--worktree', worktreeNameFor('Dev login', new Date(T0))]);
    expect(existsSync(join(m.sessionsDir, NEW_SID, CREATING_MARK))).toBe(false);
    expect(m.atPicture).toEqual([{ meta: false, tmux: false }]);
    expect(m.picture()?.sessoes[NEW_SID]?.quemSou).toMatchObject({ lugar: `session:${NEW_SID}`, pasta: PROJECT, papel: 'dev' });
    expect(m.tmuxStarts()).toBe(1);

    // The claude.sh the tmux runs: the whole argv of the CLI, and the request read (and removed) from its file.
    expect(readFileSync(join(m.sessionsDir, NEW_SID, 'pedido'), 'utf8')).toBe(PEDIDO);
    const ran = spawnSync('bash', [join(m.sessionsDir, NEW_SID, 'claude.sh')], { env: m.env });
    expect(ran.status).toBe(0);
    const argv = readFileSync(join(m.home, 'argv'), 'utf8').split('\0').slice(0, -1);
    const S = join(m.sessionsDir, NEW_SID);
    expect(argv).toEqual([
      '--model',
      'opus',
      '--effort',
      'high',
      '--permission-mode',
      'bypassPermissions',
      '-n',
      'Dev login',
      '--session-id',
      NEW_SID,
      '--append-system-prompt-file',
      `${S}/role.md`,
      '--settings',
      `${S}/settings.json`,
      ...appMcpAllowArgs(),
      '--mcp-config',
      `${S}/mcp.json`,
      '--',
      PEDIDO,
    ]);
    expect(existsSync(join(S, 'pedido'))).toBe(false);
    expect(readFileSync(join(S, 'claude.sh'), 'utf8')).toContain('CLAUDE_CODE_EVEN_MORE_DANGEROUSLY_SKIP_PERMISSIONS=1');
  });

  it('duas chamadas iguais (seguidas ou ao mesmo tempo) abrem uma sessão só', async () => {
    const m = machine();
    const [a, b] = await Promise.all([m.ask({}), m.ask({})]);
    const c = await m.ask({});
    expect((a as { text: string }).text).toBe((b as { text: string }).text);
    expect((c as { text: string }).text).toBe((a as { text: string }).text);
    expect(m.folders()).toEqual([NEW_SID]);
    expect(m.tmuxStarts()).toBe(1);
  });

  it('não abre um Líder, nem a pedido de outra sessão que não o Líder único daqui', async () => {
    const m = machine();
    const lider = await m.ask({ papel: 'lider' });
    expect(lider.kind).toBe('error');
    const other = await m.abrir.abrir(SID_DEV, m.picture()!.sessoes[SID_DEV]!, { tool: 'sessao_abrir', papel: 'dev', pedido: PEDIDO, quadro: 'atlas' });
    expect(other).toEqual({ kind: 'error', text: NOT_THE_LEADER });
    expect(m.folders()).toEqual([]);
  });

  it('quadro com Líder vivo no tmux daqui: não abre e entrega o pedido ao Líder do quadro pela fila', async () => {
    const m = machine({ leaderOnBoard: true, boardLeaderTmux: 'alive' });
    const out = await m.ask({});
    expect(out.kind).toBe('text');
    expect((out as { text: string }).text).toContain('Entregue ao Líder do quadro atlas');
    expect(m.delivered).toHaveLength(1);
    expect(m.delivered[0]).toMatchObject({ projectPath: PROJECT, placeId: LIDER_DO_QUADRO });
    expect(m.delivered[0]!.text).toContain(PEDIDO);
    expect(m.folders()).toEqual([]);
  });

  it('Líder do quadro "parada" no retrato congelado, mas fora do tmux daqui (fechou ou mora no PC): abre direto e não entrega nada', async () => {
    for (const boardLeaderTmux of ['gone', undefined] as const) {
      const m = machine({ leaderOnBoard: true, boardLeaderTmux });
      const out = await m.ask({});
      expect(out.kind).toBe('text');
      expect(JSON.parse((out as { text: string }).text)).toMatchObject({ lugar: `session:${NEW_SID}`, papel: 'dev' });
      expect(m.delivered).toEqual([]);
      expect(m.folders()).toEqual([NEW_SID]);
    }
  });

  it('no limite do kit recusa dizendo o limite e quantas estão abertas', async () => {
    const m = machine({ openCap: 1 });
    mkdirSync(join(m.sessionsDir, 'cccccccc-2222-4333-8444-555555555555'));
    writeFileSync(join(m.sessionsDir, 'cccccccc-2222-4333-8444-555555555555', 'meta.json'), JSON.stringify({ sid: 'x', openedBy: 'lider', localCwd: PROJECT, hookPort: 1, mcpPort: 2, launchArgs: [] }));
    m.live.add('cccccccc-2222-4333-8444-555555555555');
    const out = await m.ask({});
    expect(out).toEqual({ kind: 'error', text: 'Não abri: limite 1, abertas 1 neste quadro; feche uma e tente de novo.' });
  });

  it('o tmux não subiu: a pasta sai, o retrato sintético sai, e a próxima chamada tenta de novo', async () => {
    const m = machine({ tmuxFails: true });
    const out = await m.ask({});
    expect(out.kind).toBe('error');
    expect(m.folders()).toEqual([]);
    expect(m.picture()?.sessoes[NEW_SID]).toBeUndefined();
    await m.ask({});
    expect(m.tmuxStarts()).toBe(2);
  });

  it('sem o kit do PC: erro claro', async () => {
    const m = machine({ kit: false });
    expect(await m.ask({})).toEqual({ kind: 'error', text: NO_KIT });
  });

  // t-d461e003 (19/11): o Líder único desviou o pedido ao Líder do quadro vivo aqui (#502), e o Líder do quadro recebia
  // NOT_THE_LEADER ao abrir: ninguém abria sessão no quadro com o PC desligado.
  const askAs = (m: ReturnType<typeof machine>, sid: string, args: Record<string, unknown>) =>
    m.abrir.abrir(sid, m.picture()!.sessoes[sid]!, { tool: 'sessao_abrir', papel: 'dev', pedido: PEDIDO, ...args } as never);

  it('o Líder do quadro com tmux vivo aqui abre no próprio quadro (sem dizer o quadro), com a seta de abertura saindo dele', async () => {
    const m = machine({ leaderOnBoard: true, boardLeaderTmux: 'alive', openCap: 1 });
    const out = await askAs(m, SID_LIDER_QUADRO, { nome: 'Revisor login' });
    expect(out.kind).toBe('text');
    expect(JSON.parse((out as { text: string }).text)).toMatchObject({ quadro: 'atlas', lugar: `session:${NEW_SID}`, papel: 'dev' });
    expect(m.delivered).toEqual([]);
    expect(m.folders()).toEqual([NEW_SID]);
    expect(m.tmuxStarts()).toBe(1);
    expect(metaOf(m, NEW_SID)).toMatchObject({ openedBy: LIDER_DO_QUADRO, localCwd: PROJECT, abertaSemPc: true });

    const opened = m.picture()!.sessoes[NEW_SID]!;
    expect(opened.listar).toContainEqual(expect.objectContaining({ id: `session:${NEW_SID}`, abertaPor: LIDER_DO_QUADRO }));
    expect(opened.board?.links).toContainEqual(expect.objectContaining({ from: LIDER_DO_QUADRO, to: `session:${NEW_SID}`, arrow: true, opened: true }));

    // O limite do kit conta as abertas por ele neste quadro: a segunda (outro nome) passa do limite 1.
    const second = await askAs(m, SID_LIDER_QUADRO, { nome: 'Outro', quadro: 'atlas' });
    expect(second).toEqual({ kind: 'error', text: 'Não abri: limite 1, abertas 1 neste quadro; feche uma e tente de novo.' });
  });

  it('o Líder do quadro pedindo outro quadro é recusado', async () => {
    const m = machine({ leaderOnBoard: true, boardLeaderTmux: 'alive' });
    const OTHER = '/home/dono/seazone/beacon';
    const kit = kitOf(2);
    writeFileSync(join(m.oraculoDir, OPEN_KIT_FILE), JSON.stringify({ ...kit, boards: [...kit.boards, { localCwd: OTHER, name: 'beacon', homeRelativeDir: 'seazone/beacon', repoUrl: null, branch: null }] }));
    m.setPicture({
      at: T0 - 60_000,
      sessoes: { 'ffffffff-2222-4333-8444-555555555555': { quemSou: { pasta: OTHER, lugar: 'place:dev-beacon', papel: 'dev' }, listar: [{ id: 'place:dev-beacon', papel: 'dev', estado: 'trabalhando' }], board: { projectPath: OTHER, pan: { x: 0, y: 0 }, zoom: 1, cards: { 'place:dev-beacon': card('place:dev-beacon', 'dev') }, links: [], drawings: [] } } },
    });
    const out = await askAs(m, SID_LIDER_QUADRO, { quadro: 'beacon' });
    expect(out.kind).toBe('error');
    expect((out as { text: string }).text).toContain('só no próprio quadro');
    expect(m.folders()).toEqual([]);
    expect(m.delivered).toEqual([]);
  });

  it('um Dev comum do quadro, ou o Líder do quadro fora do tmux daqui, recebe NOT_THE_LEADER', async () => {
    const m = machine({ leaderOnBoard: true, boardLeaderTmux: 'alive' });
    expect(await askAs(m, SID_DEV, {})).toEqual({ kind: 'error', text: NOT_THE_LEADER });
    expect(await askAs(m, SID_DEV, { quadro: 'atlas' })).toEqual({ kind: 'error', text: NOT_THE_LEADER });
    const gone = machine({ leaderOnBoard: true, boardLeaderTmux: 'gone' });
    expect(await askAs(gone, SID_LIDER_QUADRO, {})).toEqual({ kind: 'error', text: NOT_THE_LEADER });
    expect([...m.folders(), ...gone.folders()]).toEqual([]);
  });

  it('no boot, pasta ainda "criando" e sem tmux sai; com tmux vivo ou já pronta fica', () => {
    const m = machine();
    const half = 'dddddddd-2222-4333-8444-555555555555';
    const alive = 'eeeeeeee-2222-4333-8444-555555555555';
    for (const sid of [half, alive]) {
      mkdirSync(join(m.sessionsDir, sid));
      writeFileSync(join(m.sessionsDir, sid, CREATING_MARK), 'x');
    }
    expect(sweepUnfinishedOpenings(m.sessionsDir, new Set([alive, SID_LIDER]))).toEqual([half]);
    expect(existsSync(join(m.sessionsDir, half))).toBe(false);
    expect(existsSync(join(m.sessionsDir, alive))).toBe(true);
    expect(existsSync(join(m.sessionsDir, SID_DEV))).toBe(true);
  });
});

describe('portão e sonda com a sessão aberta sem o PC', () => {
  const rpc = (name: string, args: Record<string, unknown>) => JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } });
  const textOf = (res: GateResponse): { text: string; isError: boolean } => {
    const parsed = JSON.parse(res.body) as { result: { content: Array<{ text: string }>; isError?: boolean } };
    return { text: parsed.result.content[0]!.text, isError: parsed.result.isError === true };
  };

  function gate(m: ReturnType<typeof machine>, forward: GateForward) {
    const ledger = createLedgerService({ filePath: join(m.home, 'ledger.json'), io, proofFs: nodeLedgerProofFs, now: () => T0 });
    return createGateHandler({ sessionsDir: m.sessionsDir, ledger: () => ledger, picture: m.picture, forward, serverVersion: 'teste', abrir: m.abrir, log: () => undefined });
  }
  const askOpen = (handle: ReturnType<typeof gate>) =>
    handle({ method: 'POST', path: `/s/${SID_LIDER}/mcp`, authorization: `Bearer ${TOKEN}`, headers: {}, body: rpc('sessao_abrir', { papel: 'dev', pedido: PEDIDO, quadro: 'atlas' }) });

  it('só abre aqui com o túnel recusado (PC desligado); com o PC ligado ou tendo pego a chamada (502), nunca', async () => {
    const pcAnswer: GateResponse = { status: 200, headers: {}, body: JSON.stringify({ jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: '{"lugar":"place:x"}' }] } }) };
    const on = machine();
    await askOpen(gate(on, async () => pcAnswer));
    expect(on.folders()).toEqual([]);
    const tookIt = machine();
    await askOpen(gate(tookIt, async () => ({ status: 502, headers: {}, body: '' })));
    expect(tookIt.folders()).toEqual([]);

    const off = machine();
    const res = await askOpen(gate(off, async () => 'desligado'));
    expect(textOf(res).isError).toBe(false);
    expect(JSON.parse(textOf(res).text)).toMatchObject({ lugar: `session:${NEW_SID}` });
    expect(off.folders()).toEqual([NEW_SID]);
  });

  it('o Dev aberto sem o PC tem tarefa_criar e tarefa_andamento respondidas aqui, sem passar pelo túnel', async () => {
    const m = machine();
    let forwarded = 0;
    const handle = gate(m, async () => {
      forwarded += 1;
      return 'desligado';
    });
    await askOpen(handle);
    forwarded = 0;
    const devToken = metaOf(m, NEW_SID).mcpToken as string;
    const asDev = (name: string, args: Record<string, unknown>) => handle({ method: 'POST', path: `/s/${NEW_SID}/mcp`, authorization: `Bearer ${devToken}`, headers: {}, body: rpc(name, args) });
    const created = textOf(await asDev('tarefa_criar', { pedido: 'corrigir o login', criterio: 'teste verde', prazo: '2026-11-19', risco: 'baixo' }));
    expect(created.isError).toBe(false);
    const id = (JSON.parse(created.text) as { id: string }).id;
    const progress = textOf(await asDev('tarefa_andamento', { id, estado: 'trabalhando', proximo: 'abrir o PR' }));
    expect(progress.isError).toBe(false);
    expect(forwarded).toBe(0);
  });

  it('a sonda pula a sessão aberta sem o PC até um retrato do PC trazê-la; esse retrato tira a marca', async () => {
    const m = machine();
    await m.ask({});
    const asked: number[] = [];
    const probe = createProbe({
      sessionsDir: m.sessionsDir,
      liveSessions: async () => new Set([NEW_SID]),
      picture: m.picture,
      setSession: () => undefined,
      call: async (port) => {
        asked.push(port);
        return null;
      },
      staleMs: 0,
      gapMs: 0,
      now: () => T0 + 10 * 60_000,
      log: () => undefined,
    });
    await probe.round();
    expect(asked).toEqual([]);

    const pushed: BoardPicture = { at: T0 + 60_000, sessoes: { [NEW_SID]: { quemSou: { lugar: `session:${NEW_SID}`, pasta: PROJECT, papel: 'dev' }, listar: [] } } };
    m.setPicture(pushed);
    expect(clearAdoptedMarks(m.sessionsDir, pushed)).toEqual([NEW_SID]);
    expect(metaOf(m, NEW_SID).abertaSemPc).toBeUndefined();
    await probe.round();
    expect(asked).toHaveLength(1);
  });
});
