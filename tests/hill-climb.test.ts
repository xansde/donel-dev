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
// mission that runs without the owner's yes, a judge that sees other scores, and the closing rules (cut,
// stall, rounds, extra rodadas). Real ledger and real files, fake judges: no paid API.

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
const proposal = { titulo: 'Tela de entrada', pedido: 'Quero a tela de entrada nota 9', alvo: 'Uma tela de entrada clara', criterios: ['clareza', 'beleza'] };

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

const send = (env: ReturnType<typeof setup>, missao: string, versao: string) => env.service.runTool(escalador, call('hillclimb_versao', { missao, versao }), env.ledger);

describe('hill climbing — the missions file', () => {
  it('reads a missing file as empty and never writes over an unreadable or newer one', async () => {
    const env = setup(scriptedJudges([[5, 5, 5]]));
    expect(env.service.load()).toMatchObject({ readOnly: false, warning: null });

    writeFileSync(env.file, '{ isto não é json');
    expect(env.service.load().readOnly).toBe(true);
    expect((await env.service.runTool(escalador, call('hillclimb_propor', proposal), env.ledger)).ok).toBe(false);
    expect(readFileSync(env.file, 'utf8')).toBe('{ isto não é json');

    const newer = JSON.stringify({ schemaVersion: HILL_CLIMB_SCHEMA_VERSION + 1, missions: { x: { futuro: true } } });
    writeFileSync(env.file, newer);
    expect(env.service.load().readOnly).toBe(true);
    expect(env.service.gesture('x', { kind: 'aceitar' }).ok).toBe(false);
    expect(readFileSync(env.file, 'utf8')).toBe(newer);
  });

  it('says the LLM key is missing and refuses to judge, without breaking', async () => {
    const env = setup(null);
    expect(env.service.load().council).toEqual({ ready: false, reason: MISSING_KEY_REASON });
    const id = await proposeAndAccept(env);
    const sent = await send(env, id, 'versão 1');
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
    expect((await send(env, id, 'versão 1')).ok).toBe(true);
  });
});

describe('hill climbing — the loop', () => {
  it('judges blind: every call carries only the target, the criteria and the current version', async () => {
    const seen: BlindJudgeInput[] = [];
    const env = setup(scriptedJudges([[5, 6, 7]], seen));
    const id = await proposeAndAccept(env);
    await send(env, id, 'versão 1');
    await send(env, id, 'versão 2');
    expect(seen).toHaveLength(6);
    for (const input of seen) expect(Object.keys(input).sort()).toEqual(['criteria', 'target', 'version']);
    expect(seen.slice(3).every((input) => input.version === 'versão 2')).toBe(true);
  });

  it('closes on the cut only when every judge gives ≥ 9 in every criterion', async () => {
    const env = setup(scriptedJudges([[9, 9, 8], [9, 10, 9]]));
    const id = await proposeAndAccept(env);
    await send(env, id, 'v1');
    expect(env.service.load().doc.missions[id]!.state).toBe('rodando');
    const second = await send(env, id, 'v2');
    expect(second.text).toContain('passou do corte');
    const mission = env.service.load().doc.missions[id]!;
    expect(mission.state).toBe('pausada');
    expect(mission.rodadas[0]!.closed?.reason).toBe('corte');
  });

  it('closes as "estacionou" after 2 rounds that do not raise the lowest score', async () => {
    const env = setup(scriptedJudges([[5, 6, 6], [5, 7, 7], [4, 8, 8]]));
    const id = await proposeAndAccept(env);
    for (const v of ['v1', 'v2', 'v3']) await send(env, id, v);
    const mission = env.service.load().doc.missions[id]!;
    expect(mission.rounds).toHaveLength(3);
    expect(mission.rodadas[0]!.closed?.reason).toBe('estacionou');
  });

  it('closes the first rodada at 5 rounds, refuses versions until a gesture, and allows only 2 extra rodadas of 3', async () => {
    const env = setup(scriptedJudges([[1, 1, 1], [2, 2, 2], [3, 3, 3], [4, 4, 4], [5, 5, 5], [6, 6, 6], [7, 7, 7], [8, 8, 8], [8.5, 8.5, 8.5], [8.6, 8.6, 8.6], [8.7, 8.7, 8.7], [8.8, 8.8, 8.8]]));
    const id = await proposeAndAccept(env);
    for (let i = 1; i <= 5; i += 1) await send(env, id, `v${i}`);
    expect(env.service.load().doc.missions[id]!.rodadas[0]!.closed?.reason).toBe('fim');
    expect((await send(env, id, 'v6')).ok).toBe(false);

    expect(env.service.gesture(id, { kind: 'mais-uma' }).ok).toBe(true);
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
