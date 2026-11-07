import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createSystemConfigIoDeps } from '../src/main/config-store';
import { createLedgerService, nodeLedgerProofFs } from '../src/main/ledger-store';
import { createHillClimbService, type HillClimbCaller } from '../src/main/hill-climb-store';
import { HILL_CLIMB_SCHEMA_VERSION, type BlindJudgeInput } from '../src/shared/hillClimb/contract';
import { MISSING_KEY_REASON, type JudgeProvider } from '../src/shared/hillClimb/council';
import { parseHillClimbToolCall, type HillClimbToolCall, type HillClimbToolName } from '../src/shared/hillClimb/tools';

// Hill climbing — what would break without the owner noticing: the missions file a channel could erase, a
// mission that runs without the owner's yes, a judge that sees the target or other scores, the shape of the
// first rodada (inventory, 3 directions, then climb the best) and the closing rules (cut, stall, rounds, extra
// rodadas). Real ledger and real files, fake judges: no paid API.

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** Judges whose scores come from a script: one number per call, the same for every criterion. */
function scriptedJudges(script: number[][], seen: BlindJudgeInput[] = []): JudgeProvider[] {
  return [0, 1, 2].map((j) => {
    let call = 0;
    return {
      label: `Juiz ${j + 1}`,
      model: `falso-${j}`,
      judge: async (input: BlindJudgeInput) => {
        seen.push(input);
        const score = script[call]?.[j] ?? script[script.length - 1]![j]!;
        call += 1;
        return { scores: Object.fromEntries(input.criteria.map((c) => [c, score])), comment: 'ok' };
      },
    };
  });
}

function setup(judges: JudgeProvider[] | null) {
  const dir = mkdtempSync(join(tmpdir(), 'hill-climb-'));
  dirs.push(dir);
  let clock = Date.UTC(2026, 10, 5, 12);
  const now = () => (clock += 60_000);
  const io = createSystemConfigIoDeps();
  const ledger = createLedgerService({ filePath: join(dir, 'ledger.json'), io, proofFs: nodeLedgerProofFs, now });
  const told: string[] = [];
  const file = join(dir, 'hill-climb.json');
  const service = createHillClimbService({ filePath: file, io, council: () => judges, now, notify: (message) => told.push(message.text) });
  return { dir, file, ledger, service, told };
}

function call(name: HillClimbToolName, args: unknown): HillClimbToolCall {
  const parsed = parseHillClimbToolCall(name, args);
  if (!parsed.ok) throw new Error(parsed.reason);
  return parsed.call;
}

const escalador: HillClimbCaller = { projectPath: 'C:/p', placeId: 'place:escalador' };
const proposal = {
  titulo: 'Tela de entrada',
  pedido: 'Quero a tela de entrada nota 9',
  alvo: 'Uma tela de entrada clara em cinco segundos',
  leitor: 'o dono, no celular',
  criterios: ['clareza', 'beleza'],
};

async function proposeAndAccept(env: ReturnType<typeof setup>): Promise<string> {
  const proposed = await env.service.runTool(escalador, call('hillclimb_propor', proposal), env.ledger);
  expect(proposed.ok).toBe(true);
  const id = Object.keys(env.service.load().doc.missions)[0]!;
  const card = env.service.load().doc.missions[id]!.ledgerTaskId;
  const accepted = env.ledger.apply({ kind: 'dono' }, { op: 'aceitar', id: card, option: 'Rodar' });
  expect(accepted.ok).toBe(true);
  env.service.syncLedger(env.ledger.load().doc);
  return id;
}

const send = (env: ReturnType<typeof setup>, missao: string, versao: string, extra: Record<string, unknown> = {}) =>
  env.service.runTool(escalador, call('hillclimb_versao', { missao, versao, ...extra }), env.ledger);

/** The first versions: the inventory with the first one, each opening a direction from scratch. */
async function openDirections(env: ReturnType<typeof setup>, missao: string, names = ['A', 'B', 'C']): Promise<void> {
  for (const [i, direcao] of names.entries()) {
    const sent = await send(env, missao, `versão ${direcao}`, { direcao, ...(i === 0 ? { inventario: ['o cabeçalho de hoje'] } : {}) });
    expect(sent.ok, sent.text).toBe(true);
  }
}

describe('hill climbing — the missions file', () => {
  it('reads a missing file as empty and never writes over an unreadable one', async () => {
    const env = setup(scriptedJudges([[5, 5, 5]]));
    expect(env.service.load()).toMatchObject({ readOnly: false, warning: null });

    writeFileSync(env.file, '{ isto não é json');
    expect(env.service.load().readOnly).toBe(true);
    expect((await env.service.runTool(escalador, call('hillclimb_propor', proposal), env.ledger)).ok).toBe(false);
    expect(readFileSync(env.file, 'utf8')).toBe('{ isto não é json');
  });

  // The real case: a newer channel adds a field to a mission this one still reads. Every mission parses and
  // the count matches, so only the schemaVersion check keeps this channel from dropping the field on write.
  it('never writes over a newer file whose missions it can read', async () => {
    const env = setup(scriptedJudges([[5, 5, 5]]));
    const id = await proposeAndAccept(env);
    const doc = JSON.parse(readFileSync(env.file, 'utf8')) as { schemaVersion: number; missions: Record<string, Record<string, unknown>> };
    doc.schemaVersion = HILL_CLIMB_SCHEMA_VERSION + 1;
    doc.missions[id]!.campoNovo = 'de um canal mais novo';
    const newer = JSON.stringify(doc);
    writeFileSync(env.file, newer);

    const loaded = env.service.load();
    expect(Object.keys(loaded.doc.missions)).toEqual([id]);
    expect(loaded.readOnly).toBe(true);
    const sent = await send(env, id, 'versão A', { direcao: 'A', inventario: ['o cabeçalho de hoje'] });
    expect(sent.ok).toBe(false);
    expect(readFileSync(env.file, 'utf8')).toBe(newer);
  });

  it('says the LLM key is missing and refuses to judge, without breaking', async () => {
    const env = setup(null);
    expect(env.service.load().council).toEqual({ ready: false, reason: MISSING_KEY_REASON });
    const id = await proposeAndAccept(env);
    const sent = await send(env, id, 'versão 1', { direcao: 'A', inventario: ['o que existe'] });
    expect(sent).toEqual({ ok: false, text: MISSING_KEY_REASON });
    expect(env.service.load().doc.missions[id]!.rounds).toHaveLength(0);
  });
});

describe('hill climbing — never starts by itself', () => {
  it('proposes as a high-risk card in the Oráculo, refuses versions until the owner accepts, and ends on a rejection', async () => {
    const env = setup(scriptedJudges([[5, 5, 5]]));
    await env.service.runTool(escalador, call('hillclimb_propor', proposal), env.ledger);
    const mission = Object.values(env.service.load().doc.missions)[0]!;
    expect(mission.state).toBe('proposta');
    const card = env.ledger.load().doc.tasks[mission.ledgerTaskId]!;
    expect(card).toMatchObject({ risk: 'alto', state: 'entregue' });

    const early = await send(env, mission.id, 'versão 0');
    expect(early.ok).toBe(false);
    expect(early.text).toContain('proposta');

    env.ledger.apply({ kind: 'dono' }, { op: 'rejeitar', id: card.id, reason: '', option: 'Não rodar' });
    env.service.syncLedger(env.ledger.load().doc);
    expect(env.service.load().doc.missions[mission.id]!.state).toBe('recusada');
    expect((await send(env, mission.id, 'versão 1')).ok).toBe(false);
  });

  it('runs after the owner accepts, and only for the Escalador that proposed', async () => {
    const env = setup(scriptedJudges([[5, 5, 5]]));
    const id = await proposeAndAccept(env);
    expect(env.service.load().doc.missions[id]!.state).toBe('rodando');
    expect(env.told.at(-1)).toContain('aceitou');
    const intruder = await env.service.runTool({ ...escalador, placeId: 'place:outro' }, call('hillclimb_versao', { missao: id, versao: 'x' }), env.ledger);
    expect(intruder.ok).toBe(false);
    expect((await send(env, id, 'versão 1', { direcao: 'A', inventario: ['o que existe'] })).ok).toBe(true);
  });
});

describe('hill climbing — the loop', () => {
  it('judges blind: every call carries only the reader, the criteria and the current version, never the target', async () => {
    const seen: BlindJudgeInput[] = [];
    const env = setup(scriptedJudges([[5, 6, 7]], seen));
    const id = await proposeAndAccept(env);
    await openDirections(env, id, ['A', 'B']);
    expect(seen).toHaveLength(6);
    for (const input of seen) {
      expect(Object.keys(input).sort()).toEqual(['criteria', 'reader', 'version']);
      expect(input.reader).toBe(proposal.leitor);
      expect(JSON.stringify(input)).not.toContain(proposal.alvo);
    }
    expect(seen.slice(3).every((input) => input.version === 'versão B')).toBe(true);
  });

  it('starts the first rodada with the inventory, opens 3 directions from scratch and then climbs the best one', async () => {
    const seen: BlindJudgeInput[] = [];
    const env = setup(scriptedJudges([[5, 5, 5], [7, 7, 7], [6, 6, 6], [7.5, 7.5, 7.5]], seen));
    const id = await proposeAndAccept(env);
    expect((await send(env, id, 'v', { direcao: 'A' })).text).toContain('inventário');
    expect((await send(env, id, 'v', { inventario: ['o cabeçalho de hoje'] })).text).toContain('direção 1 de 3');
    expect(seen).toHaveLength(0);

    expect((await send(env, id, 'versão A', { direcao: 'A', inventario: ['o cabeçalho de hoje'] })).ok).toBe(true);
    expect((await send(env, id, 'de novo', { direcao: 'a' })).text).toContain('já foi aberta');
    expect((await send(env, id, 'versão B', { direcao: 'B' })).ok).toBe(true);
    const third = await send(env, id, 'versão C', { direcao: 'C' });
    expect(third.text).toContain('«B»');

    expect((await send(env, id, 'versão D', { direcao: 'D' })).ok).toBe(false);
    expect((await send(env, id, 'B melhorada')).ok).toBe(true);
    const mission = env.service.load().doc.missions[id]!;
    expect(mission.inventory).toEqual(['o cabeçalho de hoje']);
    expect(mission.rounds.map((round) => round.direction)).toEqual(['A', 'B', 'C', 'B']);
    expect(seen).toHaveLength(12);
  });

  it('closes on the cut only when every judge gives ≥ 9 in every criterion', async () => {
    const env = setup(scriptedJudges([[9, 9, 8], [9, 10, 9]]));
    const id = await proposeAndAccept(env);
    await send(env, id, 'v1', { direcao: 'A', inventario: ['o que existe'] });
    expect(env.service.load().doc.missions[id]!.state).toBe('rodando');
    const second = await send(env, id, 'v2', { direcao: 'B' });
    expect(second.text).toContain('passou do corte');
    const mission = env.service.load().doc.missions[id]!;
    expect(mission.state).toBe('pausada');
    expect(mission.rodadas[0]!.closed?.reason).toBe('corte');
  });

  it('never calls the 3 opening directions a stall, and closes an extra rodada early as "estacionou" with a decision card', async () => {
    const env = setup(scriptedJudges([[6, 6, 6], [5, 5, 5], [4, 4, 4], [6.5, 7, 7], [7, 7, 7], [6, 6, 6], [7, 7, 7]]));
    const id = await proposeAndAccept(env);
    await openDirections(env, id);
    expect(env.service.load().doc.missions[id]!.state).toBe('rodando');
    await send(env, id, 'v4');
    await send(env, id, 'v5');
    expect(env.service.load().doc.missions[id]!.rodadas[0]!.closed?.reason).toBe('fim');

    expect(env.service.gesture(id, { kind: 'mais-uma' }).ok).toBe(true);
    await send(env, id, 'v6');
    const stalledAnswer = await send(env, id, 'v7');
    expect(stalledAnswer.text).toContain('estacionou');
    expect(stalledAnswer.text).toContain('carta de decisão');
    const mission = env.service.load().doc.missions[id]!;
    expect(mission.rounds).toHaveLength(7);
    expect(mission.rodadas[1]!.closed?.reason).toBe('estacionou');
    expect(mission.state).toBe('pausada');
  });

  it('closes the first rodada at 5 rounds, refuses versions until a gesture, and allows only 2 extra rodadas of 3', async () => {
    const env = setup(
      scriptedJudges([[1, 1, 1], [2, 2, 2], [3, 3, 3], [4, 4, 4], [5, 5, 5], [6, 6, 6], [7, 7, 7], [8, 8, 8], [8.5, 8.5, 8.5], [8.6, 8.6, 8.6], [8.7, 8.7, 8.7], [8.8, 8.8, 8.8]]),
    );
    const id = await proposeAndAccept(env);
    await openDirections(env, id);
    for (let i = 4; i <= 5; i += 1) await send(env, id, `v${i}`);
    expect(env.service.load().doc.missions[id]!.rodadas[0]!.closed?.reason).toBe('fim');
    expect((await send(env, id, 'v6')).ok).toBe(false);

    expect(env.service.gesture(id, { kind: 'mais-uma' }).ok).toBe(true);
    expect(env.told.at(-1)).toContain('«C»');
    for (let i = 6; i <= 8; i += 1) await send(env, id, `v${i}`);
    expect(env.service.gesture(id, { kind: 'redirecionar', text: 'Mais contraste no título' }).ok).toBe(true);
    expect(env.told.at(-1)).toContain('Mais contraste no título');
    for (let i = 9; i <= 11; i += 1) await send(env, id, `v${i}`);

    const mission = env.service.load().doc.missions[id]!;
    expect(mission.rodadas.map((r) => r.maxRounds)).toEqual([5, 3, 3]);
    expect(mission.state).toBe('pausada');
    expect(env.service.gesture(id, { kind: 'mais-uma' }).ok).toBe(false);
    expect(env.service.gesture(id, { kind: 'aceitar' }).ok).toBe(true);
    expect(env.service.load().doc.missions[id]!.state).toBe('aceita');
  });
});
