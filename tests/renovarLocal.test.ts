// t-49dee38d — renovar sessão no limite de contexto SEM o app do PC (VPS pessoal). O que quebraria sem o dono ver:
// a sessão velha morta antes de a nova existir (trabalho perdido), uma renovação no meio de um turno, a sessão nova
// nascendo noutro lugar, papel ou worktree, uma renovação com a chave desligada, com o PC presente (o app renovaria
// em dobro) ou do Líder único, e uma passagem que não veio terminando em sessão morta.
//
// O detector roda com tmux, transcript e abertura falsos; a abertura da sucessora roda o script de verdade (bash) numa
// HOME temporária, com `claude` e `tmux` falsos no PATH (como abrir-sessao-sem-pc.test.ts).
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { OPEN_KIT_FILE, type OpenKit } from '../src/main/open-kit';
import { buildClaudeArgs } from '../src/shared/commandBuilder';
import { createOpenLocal, type ScriptRun } from '../src/oraculo/abrir-local';
import { createLocalRenewal, readLocalRenewalConfig, RENEW_CONFIG_FILE, RENEW_MARK, type LocalRenewalDeps, type SuccessorOutcome } from '../src/oraculo/renovar-local';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const OLD = '11111111-2222-4333-8444-555555555555';
const NEW = 'aaaaaaaa-2222-4333-8444-555555555555';
const T0 = Date.parse('2026-11-20T15:00:00Z');
const PROJECT = '/home/dono/seazone/atlas';

const assistant = (tokens: number, stop: string, content: unknown[] = [{ type: 'text', text: 'feito' }]): string =>
  JSON.stringify({ type: 'assistant', message: { role: 'assistant', model: 'claude-opus', stop_reason: stop, content, usage: { input_tokens: 10, cache_read_input_tokens: tokens - 10, cache_creation_input_tokens: 0, output_tokens: 5 } } });
const ENDED = `${JSON.stringify({ type: 'user', message: { role: 'user', content: 'oi' } })}\n${assistant(300_000, 'end_turn')}\n`;
const TOOL_PENDING = `${assistant(300_000, 'tool_use', [{ type: 'tool_use', id: 'x', name: 'Bash', input: {} }])}\n`;
const RULE = '─'.repeat(40);
const QUIET_SCREEN = `● feito\n\n${RULE}\n❯ \n${RULE}\n  ⏵⏵ bypass permissions on\n`;
const BUSY_SCREEN = `✻ Pensando… (12s · ↓ 58 tokens)\n\n${RULE}\n❯ \n${RULE}\n  esc to interrupt\n`;

interface FakeOptions {
  readonly enabled?: boolean;
  readonly pcAway?: boolean;
  readonly leader?: string | null;
  readonly leaderOfAll?: boolean;
  readonly createdMinAgo?: number;
  readonly tail?: string;
  readonly quietFor?: number;
  readonly screen?: string;
  /** What the session writes as its handoff when asked; `null` = it never writes. */
  readonly handoff?: string | null;
  /** The successor's tmux shows up in the live list. */
  readonly successorAlive?: boolean;
  readonly openOutcome?: SuccessorOutcome;
  /** The rest of the switch (default: only OLD, only the role `dev`). */
  readonly config?: Record<string, unknown>;
  readonly roleId?: string;
  readonly placeId?: string;
  readonly placeOf?: string;
  /** The successor's transcript (default: it answered its first message); `null` = none yet. */
  readonly newTail?: string | null;
}

const ANSWERED = `${JSON.stringify({ type: 'user', message: { role: 'user', content: 'Leia primeiro a passagem' } })}\n${assistant(40_000, 'end_turn', [{ type: 'text', text: 'Li a passagem; prioridade: X.' }])}\n`;

/** A VPS with one session past the limit, the clock and the tmux in memory. `state` changes mid-renewal. */
function fake(options: FakeOptions = {}) {
  const home = mkdtempSync(join(tmpdir(), 'renovar-local-'));
  dirs.push(home);
  const sessionsDir = join(home, '.donel', 's');
  const handoffsDir = join(home, '.donel', 'handoffs');
  mkdirSync(join(sessionsDir, OLD), { recursive: true });
  writeFileSync(
    join(sessionsDir, OLD, 'meta.json'),
    JSON.stringify({
      sid: OLD,
      localCwd: PROJECT,
      projectName: 'atlas',
      name: 'Dev · atlas',
      roleId: options.roleId ?? 'dev',
      ...(options.placeId ? { placeId: options.placeId } : {}),
      createdAt: new Date(T0 - (options.createdMinAgo ?? 120) * 60_000).toISOString(),
      ...(options.leaderOfAll ? { leaderOfAll: true } : {}),
    }),
  );
  let clock = T0;
  const events: string[] = [];
  const lines: string[] = [];
  const live = new Set([OLD]);
  const state = {
    config: { enabled: options.enabled ?? true, limitTokens: 250_000, somente: [OLD], papeis: ['dev'], liberarLideres: false, ...options.config } as Record<string, unknown>,
    pcAway: options.pcAway ?? true,
    oldScreen: (): string => options.screen ?? QUIET_SCREEN,
    oldTail: options.tail ?? ENDED,
    oldMtime: T0 - (options.quietFor ?? 120) * 1000,
    newTail: options.newTail === undefined ? ANSWERED : options.newTail,
    /** When set, the successor's transcript now (overrides `newTail`). */
    newTailFn: null as null | (() => string | null),
    screenReads: 0,
    /** Live reads after the successor opened. */
    liveReadsAfterOpen: 0,
    opened: false,
    /** The successor leaves the tmux after this many live reads (default never). */
    successorLeavesAfter: Number.POSITIVE_INFINITY,
    onType: null as null | (() => void),
    onOpen: null as null | (() => void),
  };
  const deps: LocalRenewalDeps = {
    sessionsDir,
    handoffsDir,
    config: () => state.config as unknown as ReturnType<LocalRenewalDeps['config']>,
    pcAway: () => state.pcAway,
    leader: async () => (options.leader ? { sid: options.leader } : null),
    liveSessions: async () => {
      if (state.opened) {
        state.liveReadsAfterOpen += 1;
        if (state.liveReadsAfterOpen > state.successorLeavesAfter) live.delete(NEW);
      }
      return new Set(live);
    },
    transcriptOf: async (sid) => (sid === OLD ? '/fake/old.jsonl' : sid === NEW ? '/fake/new.jsonl' : undefined),
    readTail: async (path) => {
      if (path === '/fake/new.jsonl') {
        const text = state.newTailFn ? state.newTailFn() : state.newTail;
        return text === null ? null : { text, mtimeMs: clock };
      }
      return { text: state.oldTail, mtimeMs: state.oldMtime };
    },
    screen: async (sid) => {
      if (sid === NEW) return { inMode: false, text: QUIET_SCREEN };
      state.screenReads += 1;
      return { inMode: false, text: state.oldScreen() };
    },
    type: async (sid, text) => {
      events.push(`pediu:${sid.slice(0, 4)}`);
      const instructions = /(\S+\.instrucoes\.md)/.exec(text)?.[1];
      const handoff = options.handoff === undefined ? `---\ndonel-passagem: 1\nsessao-anterior: ${OLD}\ntrabalho-vivo: nenhum\n---\n# Passagem\n` : options.handoff;
      if (instructions && handoff !== null) writeFileSync(instructions.replace(/\.instrucoes\.md$/, '.md'), handoff);
      state.onType?.();
      return true;
    },
    kill: async (sid) => {
      events.push(`matou:${sid.slice(0, 4)}`);
      live.delete(sid);
      return true;
    },
    openSuccessor: async (call) => {
      events.push(`abriu:${call.de.slice(0, 4)}`);
      const outcome = options.openOutcome ?? { kind: 'aberta', sid: NEW };
      if (outcome.kind === 'aberta' && options.successorAlive !== false) live.add(outcome.sid);
      state.opened = true;
      state.onOpen?.();
      return outcome;
    },
    ...(options.placeOf ? { placeOf: () => options.placeOf } : {}),
    now: () => clock,
    sleep: async (ms) => {
      clock += ms;
    },
    log: (line) => lines.push(line),
  };
  return {
    home,
    sessionsDir,
    handoffsDir,
    deps,
    events,
    lines,
    live,
    state,
    advance: (ms: number) => {
      clock += ms;
    },
    clock: () => clock,
    markOf: () => JSON.parse(readFileSync(join(sessionsDir, OLD, RENEW_MARK), 'utf8')) as Record<string, unknown>,
    renewal: createLocalRenewal(deps),
  };
}

describe('renovar-local: a ordem nunca mata antes da hora', () => {
  it('pede a passagem, abre a sucessora e só então encerra o tmux da velha (sem apagar a pasta)', async () => {
    const vps = fake();
    await vps.renewal.tick();
    expect(vps.events).toEqual([`pediu:${OLD.slice(0, 4)}`, `abriu:${OLD.slice(0, 4)}`, `matou:${OLD.slice(0, 4)}`]);
    expect(existsSync(join(vps.sessionsDir, OLD))).toBe(true);
    for (const step of ['detectou', 'pediu', 'pronta', 'abriu', 'fechou']) expect(vps.lines.some((line) => line.includes(`renovar-local: ${step}`))).toBe(true);
  });

  it('não mata a velha quando a sessão nova não aparece viva no tmux', async () => {
    const vps = fake({ successorAlive: false });
    await vps.renewal.tick();
    expect(vps.events).toContain(`abriu:${OLD.slice(0, 4)}`);
    expect(vps.events.some((event) => event.startsWith('matou'))).toBe(false);
    expect(vps.lines.some((line) => line.includes('renovar-local: desistiu'))).toBe(true);
  });

  it('não mata a velha quando a abertura da nova falha', async () => {
    const vps = fake({ openOutcome: { kind: 'erro', text: 'sem vaga' } });
    await vps.renewal.tick();
    expect(vps.events.some((event) => event.startsWith('matou'))).toBe(false);
  });

  it('a trava por sessão impede a segunda renovação da mesma sessão', async () => {
    const vps = fake({ successorAlive: false });
    await vps.renewal.tick();
    vps.events.length = 0;
    await vps.renewal.tick();
    expect(vps.events).toEqual([]);
  });
});

describe('renovar-local: só no fim do turno', () => {
  it('não renova com ferramenta pendente', async () => {
    const vps = fake({ tail: TOOL_PENDING });
    await vps.renewal.tick();
    expect(vps.events).toEqual([]);
  });

  it('não renova com a tela trabalhando', async () => {
    const vps = fake({ screen: BUSY_SCREEN });
    await vps.renewal.tick();
    expect(vps.events).toEqual([]);
  });

  it('não renova com trabalho em segundo plano na tela, mesmo com o turno encerrado', async () => {
    const vps = fake({ screen: `● feito\n\n✻ Waiting for 1 dynamic workflow to finish\n${RULE}\n❯ \n${RULE}\n` });
    await vps.renewal.tick();
    expect(vps.events).toEqual([]);
  });

  it('não renova com o transcript mexido há menos de 60 s', async () => {
    const vps = fake({ quietFor: 20 });
    await vps.renewal.tick();
    expect(vps.events).toEqual([]);
  });

  it('não renova abaixo do limite', async () => {
    const vps = fake({ tail: `${assistant(120_000, 'end_turn')}\n` });
    await vps.renewal.tick();
    expect(vps.events).toEqual([]);
  });
});

describe('renovar-local: quando não roda', () => {
  it.each([
    ['a chave desligada', { enabled: false }],
    ['o PC presente', { pcAway: false }],
    ['o Líder único (achado no tmux)', { leader: OLD }],
    ['o Líder único (marca no meta)', { leaderOfAll: true }],
    ['sessão com menos de 30 min', { createdMinAgo: 10 }],
  ] as const)('não renova com %s', async (_label, options) => {
    const vps = fake(options);
    await vps.renewal.tick();
    expect(vps.events).toEqual([]);
  });

  it('sem arquivo de configuração a chave nasce desligada', () => {
    const dir = mkdtempSync(join(tmpdir(), 'renovar-config-'));
    dirs.push(dir);
    expect(readLocalRenewalConfig(dir)).toMatchObject({ enabled: false, limitTokens: 250_000 });
    writeFileSync(join(dir, RENEW_CONFIG_FILE), JSON.stringify({ enabled: true, limitTokens: 60_000 }));
    expect(readLocalRenewalConfig(dir)).toMatchObject({ enabled: true, limitTokens: 60_000 });
  });
});

describe('renovar-local: a passagem que não vem', () => {
  it('desiste sem abrir nem matar quando a passagem não chega em 7 min', async () => {
    const vps = fake({ handoff: null });
    await vps.renewal.tick();
    expect(vps.events).toEqual([`pediu:${OLD.slice(0, 4)}`]);
    expect(vps.lines.some((line) => line.includes('renovar-local: desistiu'))).toBe(true);
  });

  it('desiste sem matar quando a passagem declara trabalho vivo até o prazo', async () => {
    const vps = fake({ handoff: `---\ndonel-passagem: 1\ntrabalho-vivo: agente de revisão rodando\n---\n` });
    await vps.renewal.tick();
    expect(vps.events).toEqual([`pediu:${OLD.slice(0, 4)}`]);
  });
});

// ---- rodada 2: as condições do Líder único e as sondas dos revisores --------------------------------------------------

const o4 = `pediu:${OLD.slice(0, 4)}`;
const KILL_OLD = `matou:${OLD.slice(0, 4)}`;
const KILL_NEW = `matou:${NEW.slice(0, 4)}`;
const DRAFT_SCREEN = `● feito\n\n${RULE}\n❯ rascunho do dono\n${RULE}\n  ⏵⏵ bypass permissions on\n`;
const MIN = 60_000;

describe('renovar-local: a lista de sessões e os papéis da configuração', () => {
  it.each([
    ['lista vazia (= ninguém), mesmo ligada', { somente: [] }],
    ['sem a lista', { somente: undefined }],
    ['a lista com outra sessão', { somente: [NEW] }],
    ['a lista com outro lugar', { somente: ['place:outro'] }],
  ] as const)('não renova com %s', async (_label, config) => {
    const vps = fake({ config: { ...config } });
    await vps.renewal.tick();
    expect(vps.events).toEqual([]);
  });

  it('a lista aceita o lugar (do meta ou do retrato)', async () => {
    const fromMeta = fake({ placeId: 'place:dev-1', config: { somente: ['place:dev-1'] } });
    await fromMeta.renewal.tick();
    expect(fromMeta.events).toContain(KILL_OLD);
    const fromPicture = fake({ placeOf: 'place:dev-2', config: { somente: ['place:dev-2'] } });
    await fromPicture.renewal.tick();
    expect(fromPicture.events).toContain(KILL_OLD);
  });

  it.each([
    ['o Theo', 'theo-west', {}],
    ['o Líder de quadro', 'lider', {}],
    ['o Líder de quadro listado sem liberarLideres', 'lider', { papeis: ['dev', 'lider'] }],
    ['o Theo com liberarLideres mas sem o papel listado', 'theo-west', { liberarLideres: true }],
    ['um papel fora da lista (padrão só dev)', 'revisor', { papeis: undefined }],
  ] as const)('não renova %s', async (_label, roleId, config) => {
    const vps = fake({ roleId, config: { ...config } });
    await vps.renewal.tick();
    expect(vps.events).toEqual([]);
  });

  it('o Líder de quadro só entra com o papel listado E liberarLideres', async () => {
    const vps = fake({ roleId: 'lider', config: { papeis: ['lider'], liberarLideres: true } });
    await vps.renewal.tick();
    expect(vps.events).toContain(KILL_OLD);
  });

  it('a configuração tem sanitize próprio: lista e papéis inválidos viram ninguém e só dev', () => {
    const dir = mkdtempSync(join(tmpdir(), 'renovar-config-'));
    dirs.push(dir);
    expect(readLocalRenewalConfig(dir)).toEqual({ enabled: false, limitTokens: 250_000, somente: [], papeis: ['dev'], liberarLideres: false });
    writeFileSync(join(dir, RENEW_CONFIG_FILE), JSON.stringify({ enabled: true, somente: 'tudo', papeis: [1, ''], liberarLideres: 'sim' }));
    expect(readLocalRenewalConfig(dir)).toEqual({ enabled: true, limitTokens: 250_000, somente: [], papeis: ['dev'], liberarLideres: false });
    writeFileSync(join(dir, RENEW_CONFIG_FILE), JSON.stringify({ enabled: true, somente: [OLD, 'place:abc', 'lixo com espaço', 7], papeis: ['dev', 'lider'], liberarLideres: true }));
    expect(readLocalRenewalConfig(dir)).toEqual({ enabled: true, limitTokens: 250_000, somente: [OLD, 'place:abc'], papeis: ['dev', 'lider'], liberarLideres: true });
  });
});

describe('renovar-local: a velha só morre depois de a nova responder', () => {
  it('sucessora viva no tmux sem resposta: não mata a velha, fecha só a nova e desiste', async () => {
    const vps = fake({ newTail: null });
    await vps.renewal.tick();
    expect(vps.events).toEqual([o4, `abriu:${OLD.slice(0, 4)}`, KILL_NEW]);
    expect(vps.lines.some((line) => line.includes('desistiu') && line.includes('a nova não respondeu'))).toBe(true);
  });

  it('sucessora com só a 1ª mensagem, sem resposta do assistente: não mata a velha', async () => {
    const vps = fake({ newTail: `${JSON.stringify({ type: 'user', message: { role: 'user', content: 'Leia primeiro a passagem' } })}\n` });
    await vps.renewal.tick();
    expect(vps.events).not.toContain(KILL_OLD);
  });

  it('sucessora que some do tmux logo depois de abrir: não mata a velha', async () => {
    const vps = fake();
    vps.state.successorLeavesAfter = 1;
    await vps.renewal.tick();
    expect(vps.events).not.toContain(KILL_OLD);
  });

  it('a resposta que chega em 2 min: mata a velha só depois dela', async () => {
    const vps = fake();
    let answerAt = Number.POSITIVE_INFINITY;
    vps.state.onOpen = () => {
      answerAt = vps.clock() + 2 * MIN;
    };
    vps.state.newTailFn = () => (vps.clock() >= answerAt ? ANSWERED : null);
    await vps.renewal.tick();
    expect(vps.events).toContain(KILL_OLD);
    expect(vps.clock()).toBeGreaterThanOrEqual(answerAt);
  });
});

describe('renovar-local: a velha precisa seguir parada até o kill', () => {
  it('a velha volta a trabalhar durante a abertura e não para: não mata, deixa as duas vivas e avisa', async () => {
    const vps = fake();
    vps.state.onOpen = () => {
      vps.state.oldScreen = () => BUSY_SCREEN;
    };
    await vps.renewal.tick();
    expect(vps.events).not.toContain(KILL_OLD);
    expect(vps.events).not.toContain(KILL_NEW);
    expect(vps.lines.some((line) => line.includes('duas vivas no lugar'))).toBe(true);
  });

  it('a velha recebe um recado depois de pronta: espera ela parar e só então mata', async () => {
    const vps = fake();
    let busyUntil = 0;
    let screenAtKill = '';
    vps.state.onOpen = () => {
      busyUntil = vps.clock() + 3 * MIN;
      vps.state.oldMtime = vps.clock();
      vps.state.oldTail = TOOL_PENDING;
      vps.state.oldScreen = () => {
        if (vps.clock() < busyUntil) return BUSY_SCREEN;
        vps.state.oldTail = ENDED;
        return QUIET_SCREEN;
      };
    };
    const kill = vps.deps.kill;
    (vps.deps as { kill: typeof kill }).kill = async (sid) => {
      if (sid === OLD) screenAtKill = vps.state.oldScreen();
      return kill(sid);
    };
    const renewal = createLocalRenewal(vps.deps);
    await renewal.tick();
    expect(vps.events).toContain(KILL_OLD);
    expect(screenAtKill).toBe(QUIET_SCREEN);
    expect(vps.clock()).toBeGreaterThanOrEqual(busyUntil);
  });
});

describe('renovar-local: chave, lista e PC reconferidos em cada passo', () => {
  it.each([
    ['a chave desligada logo depois do pedido', (vps: ReturnType<typeof fake>) => (vps.state.onType = () => void (vps.state.config = { ...vps.state.config, enabled: false }))],
    ['o PC de volta logo depois do pedido', (vps: ReturnType<typeof fake>) => (vps.state.onType = () => void (vps.state.pcAway = false))],
    ['a sessão tirada da lista logo depois do pedido', (vps: ReturnType<typeof fake>) => (vps.state.onType = () => void (vps.state.config = { ...vps.state.config, somente: [] }))],
  ] as const)('com %s não abre a sucessora nem mata', async (_label, arrange) => {
    const vps = fake();
    arrange(vps);
    await vps.renewal.tick();
    expect(vps.events).toEqual([o4]);
  });

  it.each([
    ['a chave desligada', (vps: ReturnType<typeof fake>) => (vps.state.onOpen = () => void (vps.state.config = { ...vps.state.config, enabled: false }))],
    ['o PC de volta', (vps: ReturnType<typeof fake>) => (vps.state.onOpen = () => void (vps.state.pcAway = false))],
  ] as const)('com %s depois de abrir não mata a velha', async (_label, arrange) => {
    const vps = fake();
    arrange(vps);
    await vps.renewal.tick();
    expect(vps.events).not.toContain(KILL_OLD);
  });

  it('a chave desligada antes do pedido: nada é digitado', async () => {
    const vps = fake();
    let reads = 0;
    const config = vps.deps.config;
    (vps.deps as { config: typeof config }).config = () => {
      reads += 1;
      return reads > 1 ? { ...config(), enabled: false } : config();
    };
    await createLocalRenewal(vps.deps).tick();
    expect(vps.events).toEqual([]);
  });

  it('o campo ganha um rascunho entre a detecção e o pedido: nada é digitado', async () => {
    const vps = fake();
    vps.state.oldScreen = () => (vps.state.screenReads > 1 ? DRAFT_SCREEN : QUIET_SCREEN);
    await vps.renewal.tick();
    expect(vps.events).toEqual([]);
  });
});

describe('renovar-local: a marca expira na causa passageira e trava sem gravar', () => {
  it('a abertura falha por falta de vaga: a sessão volta a ser candidata depois do prazo', async () => {
    const vps = fake({ openOutcome: { kind: 'erro', text: 'sem vaga nesta máquina' } });
    await vps.renewal.tick();
    expect(vps.events).toEqual([o4, `abriu:${OLD.slice(0, 4)}`]);
    await vps.renewal.tick();
    expect(vps.events.filter((event) => event === o4)).toHaveLength(1);
    vps.advance(31 * MIN);
    await vps.renewal.tick();
    expect(vps.events.filter((event) => event === o4)).toHaveLength(2);
  });

  it('a nova que não respondeu também expira', async () => {
    const vps = fake({ newTail: null });
    await vps.renewal.tick();
    vps.advance(31 * MIN);
    await vps.renewal.tick();
    expect(vps.events.filter((event) => event === o4)).toHaveLength(2);
  });

  it('trabalho vivo declarado de novo: a marca fica permanente', async () => {
    const vps = fake({ handoff: `---\ndonel-passagem: 1\ntrabalho-vivo: agente rodando\n---\n` });
    await vps.renewal.tick();
    vps.advance(31 * MIN);
    await vps.renewal.tick();
    expect(vps.events.filter((event) => event === o4)).toHaveLength(2);
    vps.advance(120 * MIN);
    await vps.renewal.tick();
    expect(vps.events.filter((event) => event === o4)).toHaveLength(2);
  });

  it('duas vivas no lugar: a marca fica permanente', async () => {
    const vps = fake();
    vps.state.onOpen = () => {
      vps.state.oldScreen = () => BUSY_SCREEN;
    };
    await vps.renewal.tick();
    vps.state.oldScreen = () => QUIET_SCREEN;
    vps.advance(120 * MIN);
    await vps.renewal.tick();
    expect(vps.events.filter((event) => event === o4)).toHaveLength(1);
  });

  it.skipIf(process.getuid?.() === 0)('a marca que não grava: aborta sem digitar nada', async () => {
    const vps = fake();
    chmodSync(join(vps.sessionsDir, OLD), 0o500);
    try {
      await vps.renewal.tick();
    } finally {
      chmodSync(join(vps.sessionsDir, OLD), 0o700);
    }
    expect(vps.events).toEqual([]);
  });
});

describe('renovar-local: reinício do entregador no meio', () => {
  it('marca em voo ao subir: só avisa o Líder, não retoma nem renova de novo', async () => {
    const vps = fake();
    writeFileSync(join(vps.sessionsDir, OLD, RENEW_MARK), `${JSON.stringify({ passo: 'abriu', em: new Date(T0).toISOString(), sucessora: NEW })}\n`);
    const found = await vps.renewal.recover();
    expect(found).toEqual([OLD]);
    expect(vps.lines.some((line) => line.includes('em voo') && line.includes(OLD.slice(0, 8)) && line.includes('abriu'))).toBe(true);
    vps.advance(24 * 60 * MIN);
    await vps.renewal.tick();
    expect(vps.events).toEqual([]);
  });
});

// ---- a sucessora (abrir-local.ts) -----------------------------------------------------------------------------------

const KIT_ROLE_ARGS = buildClaudeArgs({ model: 'opus', effort: 'high', permissionMode: 'acceptEdits' });
const WORKTREE = 'dev-atlas-1120-1300';

function kit(): OpenKit {
  return {
    version: 1,
    at: new Date(T0).toISOString(),
    place: { id: 'vps-pessoal', label: 'VPS pessoal' },
    openCap: 1,
    roles: [
      { id: 'dev', name: 'Dev', anyPlace: false, promptText: '# Dev\nVocê implementa.\n', model: 'opus', effort: 'high', permissionMode: 'acceptEdits', launcherArgs: KIT_ROLE_ARGS, scopeSettings: null, scopeNeedsInventory: false },
    ],
    boards: [{ localCwd: PROJECT, name: 'atlas', homeRelativeDir: 'seazone/atlas', repoUrl: null, branch: null }],
  };
}

function machine(meta: Record<string, unknown>) {
  const home = mkdtempSync(join(tmpdir(), 'renovar-sucessora-'));
  dirs.push(home);
  const bin = join(home, 'bin');
  mkdirSync(bin);
  writeFileSync(join(bin, 'claude'), '#!/usr/bin/env bash\nexit 0\n', { mode: 0o755 });
  writeFileSync(join(bin, 'tmux'), '#!/usr/bin/env bash\necho "$*" >> "$HOME/tmux.log"\nexit 0\n', { mode: 0o755 });
  const project = join(home, 'seazone', 'atlas');
  const worktreeDir = join(project, '.claude', 'worktrees', WORKTREE);
  mkdirSync(worktreeDir, { recursive: true });
  spawnSync('git', ['init', '-q', project]);
  const sessionsDir = join(home, '.donel', 's');
  const oraculoDir = join(home, '.donel', 'oraculo');
  mkdirSync(join(sessionsDir, OLD), { recursive: true });
  mkdirSync(oraculoDir, { recursive: true });
  writeFileSync(join(oraculoDir, OPEN_KIT_FILE), JSON.stringify(kit()));
  writeFileSync(join(sessionsDir, OLD, 'meta.json'), JSON.stringify({ sid: OLD, hookToken: 'segredo-hook', mcpToken: 'segredo-mcp', hookPort: 25001, mcpPort: 25002, ...meta }));
  writeFileSync(join(sessionsDir, OLD, 'dir'), `${worktreeDir}\n`);
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
  const logs: string[] = [];
  const openLocal = createOpenLocal({
    sessionsDir,
    oraculoDir,
    home,
    picture: () => null,
    setSession: () => undefined,
    leader: async () => null,
    liveSessions: async () => new Set([OLD]),
    deliver: async () => null,
    run,
    room: () => null,
    portFree: async () => true,
    now: () => T0,
    newId: () => NEW,
    log: (line) => logs.push(line),
  });
  return { home, sessionsDir, worktreeDir, openLocal, logs };
}

const OLD_META = {
  localCwd: PROJECT,
  projectName: 'atlas',
  name: 'Dev · atlas',
  roleId: 'dev',
  placeId: 'place:dev',
  openedBy: 'place:lider-atlas',
  launchArgs: [...KIT_ROLE_ARGS, '-n', 'Dev · atlas', '--worktree', WORKTREE],
  createdAt: new Date(T0 - 3 * 3600_000).toISOString(),
};

describe('renovar-local: a sucessora herda o lugar', () => {
  it('nasce com o mesmo placeId, papel, worktree e nome, com renovaDe e a passagem como 1ª mensagem', async () => {
    const vps = machine(OLD_META);
    const first = 'Leia primeiro a passagem de bastão em /home/x/.donel/handoffs/a.md';
    const outcome = await vps.openLocal.openSuccessor({ de: OLD, firstPrompt: first });
    expect(outcome).toEqual({ kind: 'aberta', sid: NEW });
    const meta = JSON.parse(readFileSync(join(vps.sessionsDir, NEW, 'meta.json'), 'utf8')) as Record<string, unknown>;
    expect(meta.placeId).toBe('place:dev');
    expect(meta.roleId).toBe('dev');
    expect(meta.renovaDe).toBe(OLD);
    expect(meta.localCwd).toBe(PROJECT);
    expect(meta.openedBy).toBe('place:lider-atlas');
    expect(meta.launchArgs).toEqual(expect.arrayContaining(['--worktree', WORKTREE, '-n', 'Dev · atlas', '--model', 'opus']));
    expect(meta.hookToken).not.toBe('segredo-hook');
    expect(readFileSync(join(vps.sessionsDir, NEW, 'dir'), 'utf8').trim()).toBe(vps.worktreeDir);
    expect(readFileSync(join(vps.sessionsDir, NEW, 'role.md'), 'utf8')).toContain('Você implementa.');
    expect(readFileSync(join(vps.sessionsDir, NEW, 'pedido'), 'utf8')).toBe(first);
    expect(existsSync(join(vps.sessionsDir, OLD, 'meta.json'))).toBe(true);
    expect(vps.logs.join('\n')).not.toMatch(/segredo/);
  });

  it('o lugar vem do retrato quando o meta da velha não o traz', async () => {
    const { placeId: _placeId, ...withoutPlace } = OLD_META;
    const vps = machine(withoutPlace);
    expect(await vps.openLocal.openSuccessor({ de: OLD, firstPrompt: 'x', placeId: 'place:dev' })).toEqual({ kind: 'aberta', sid: NEW });
    expect((JSON.parse(readFileSync(join(vps.sessionsDir, NEW, 'meta.json'), 'utf8')) as { placeId?: string }).placeId).toBe('place:dev');
  });

  it('nunca abre sucessora do Líder único', async () => {
    const vps = machine({ ...OLD_META, leaderOfAll: true });
    const outcome = await vps.openLocal.openSuccessor({ de: OLD, firstPrompt: 'x' });
    expect(outcome.kind).toBe('erro');
    expect(existsSync(join(vps.sessionsDir, NEW))).toBe(false);
  });
});
