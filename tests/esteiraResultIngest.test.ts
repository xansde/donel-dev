import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseEsteiraResultText, type EsteiraResult } from '../src/shared/esteira/contract/resultContract';
import { ingestFailureEvent, resultToEvents } from '../src/shared/esteira/ingest/resultToEvents';
import { reduceEvents } from '../src/shared/esteira/store/reducer';
import type { StoreEvent } from '../src/shared/esteira/store/storeFormat';

// Spec 010 (D-10) — a TRADUCAO fato → evento, a parte pura da ingestao. O que
// ela promete:
//
// - cada fato declarado no `result.json` vira UM evento, com `dedupe_key`
//   derivada de `run_id` + tipo + chave natural: reingerir o mesmo arquivo nao
//   duplica nada;
// - o que a skill NAO declarou nao vira evento — o app nao inventa;
// - documento fora do contrato vira `ingest.failed` com os issues do parser,
//   NUNCA silencio (foi silencio que virou "fase nao realizada" em 03/08).

const EXAMPLES_DIR = join(__dirname, '..', 'src', 'shared', 'esteira', 'contract', 'v1', 'examples');

function loadExample(name: string): EsteiraResult {
  const parsed = parseEsteiraResultText(readFileSync(join(EXAMPLES_DIR, `${name}.json`), 'utf8'));
  if (!parsed.ok) throw new Error(`exemplo ${name} nao passa no parser: ${JSON.stringify(parsed.issues)}`);
  return parsed.result;
}

/** Os drafts viram eventos numerados exatamente como o writer faz — para fechar o ciclo ate o snapshot. */
function asEvents(result: EsteiraResult, resultPath = 'C:/outbox/run.json'): StoreEvent[] {
  return resultToEvents(result, { resultPath }).map((draft, index) => ({
    seq: index + 1,
    event_id: `evt-${index + 1}`,
    at: draft.at,
    type: draft.type,
    source: { kind: 'ingest' as const, run_id: result.run.run_id, result_path: resultPath },
    dedupe_key: draft.dedupe_key,
    payload: draft.payload,
  }));
}

describe('resultToEvents — cada fato vira um evento', () => {
  it('discovery.recorded vira discovery.created com o que a skill declarou', () => {
    const events = resultToEvents(loadExample('discovery-com-tracker'), { resultPath: 'C:/x.json' });
    const created = events.find((event) => event.type === 'discovery.created');

    expect(created).toBeDefined();
    expect(created?.payload.id).toBe('dsc-2026-08-03-a');
    // snake_case do contrato vira camelCase do store — a traducao acontece AQUI,
    // e em nenhum outro lugar.
    expect(created?.payload).toHaveProperty('targetRepo');
    expect(created?.payload).not.toHaveProperty('target_repo');
  });

  it('work_item.recorded carrega o discovery do subject do run — item sem plano ainda tem onde aparecer', () => {
    const events = resultToEvents(loadExample('plano-com-itens'), { resultPath: 'C:/x.json' });
    const items = events.filter((event) => event.type === 'work_item.created');

    expect(items).toHaveLength(3);
    for (const item of items) {
      expect(item.payload.discoveryId).toBe('dsc-2026-08-03-a');
      // D-16 — item nascido pela skill e descartavel num gesto; o app precisa saber a origem.
      expect(item.payload.createdBySkill).toBe(true);
    }
    expect(items[1].payload.targetRepo).toBe('atlas');
  });

  it('relacoes, artefatos e verificacoes viram seus eventos proprios', () => {
    const events = resultToEvents(loadExample('plano-com-itens'), { resultPath: 'C:/x.json' });

    expect(events.filter((event) => event.type === 'relation.added')).toHaveLength(2);
    expect(events.filter((event) => event.type === 'artifact.pinned')).toHaveLength(1);

    const validar = resultToEvents(loadExample('validar-com-pr'), { resultPath: 'C:/x.json' });
    expect(validar.some((event) => event.type === 'verification.updated')).toBe(true);
  });

  it('a dedupe_key amarra run + tipo do fato + chave natural', () => {
    const events = resultToEvents(loadExample('plano-com-itens'), { resultPath: 'C:/x.json' });
    const item = events.find((event) => event.type === 'work_item.created');

    expect(item?.dedupe_key).toBe('run-2026-08-03-1400:work_item.recorded:wi-2026-08-03-a1-01');
  });

  it('reingerir o MESMO arquivo nao duplica fato no snapshot', () => {
    const result = loadExample('plano-com-itens');
    const once = asEvents(result);
    const twice = [...once, ...once.map((event, index) => ({ ...event, seq: once.length + index + 1, event_id: `re-${index}` }))];

    expect(reduceEvents(twice).workItems).toHaveLength(reduceEvents(once).workItems.length);
    expect(reduceEvents(twice).relations).toHaveLength(reduceEvents(once).relations.length);
  });

  it('o que a skill nao declarou nao vira evento — o app nunca completa lacuna', () => {
    // O card F3 (evidencia 1): discovery concluido, ZERO plano declarado.
    const events = resultToEvents(loadExample('discovery-sem-repo-nem-tracker'), { resultPath: 'C:/x.json' });
    expect(events.some((event) => event.type === 'plan.created')).toBe(false);
    expect(events.map((event) => event.type)).toEqual(['discovery.created', 'phase.completed']);
  });

  it('run que falhou vira phase.failed com codigo e motivo — falha nunca vira silencio', () => {
    const result = loadExample('implementar-falhou');
    const events = resultToEvents(result, { resultPath: 'C:/x.json' });
    const failed = events.find((event) => event.type === 'phase.failed');

    expect(failed).toBeDefined();
    expect(failed?.payload.phase).toBe('implementar');
    expect(failed?.payload).toMatchObject({ failure: { code: 'worktree-dirty' } });
    // Os fatos que a skill declarou apesar da falha continuam valendo.
    expect(events.some((event) => event.type === 'note.added')).toBe(true);
    expect(events.some((event) => event.type === 'lock.released')).toBe(true);
  });

  it('run bem-sucedido NAO gera phase.failed', () => {
    const events = resultToEvents(loadExample('plano-com-itens'), { resultPath: 'C:/x.json' });
    expect(events.some((event) => event.type === 'phase.failed')).toBe(false);
  });

  it('todo exemplo do corpus e traduzivel — nenhum fato fica sem evento', () => {
    const examples = [
      'discovery-com-tracker',
      'discovery-sem-repo-nem-tracker',
      'plano-com-itens',
      'implementar-falhou',
      'spike-inconclusivo',
      'validar-com-pr',
    ];

    for (const name of examples) {
      const result = loadExample(name);
      const events = resultToEvents(result, { resultPath: 'C:/x.json' });
      const factEvents = events.filter((event) => event.type !== 'phase.failed');
      expect(factEvents.length, `${name}: fato sem evento correspondente`).toBe(result.facts.length);
    }
  });
});

describe('ingestFailureEvent — o documento fora do contrato aparece no card', () => {
  it('vira ingest.failed com os issues do parser e o caminho do arquivo', () => {
    const parsed = parseEsteiraResultText('{"kind":"outra.coisa"}');
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;

    const draft = ingestFailureEvent({
      resultPath: 'C:/outbox/run-9.json',
      issues: parsed.issues,
      subject: { entity: 'discovery', id: 'dsc-1' },
      at: '2026-08-03T12:00:00.000Z',
    });

    expect(draft.type).toBe('ingest.failed');
    expect(draft.payload.resultPath).toBe('C:/outbox/run-9.json');
    expect(Array.isArray(draft.payload.issues)).toBe(true);
    expect((draft.payload.issues as unknown[]).length).toBeGreaterThan(0);
  });

  it('o mesmo arquivo quebrado, reprocessado, nao empilha erro repetido', () => {
    const draft = ingestFailureEvent({ resultPath: 'C:/outbox/run-9.json', issues: [], subject: null, at: '2026-08-03T12:00:00.000Z' });
    const other = ingestFailureEvent({ resultPath: 'C:/outbox/run-9.json', issues: [], subject: null, at: '2026-08-03T13:00:00.000Z' });

    expect(draft.dedupe_key).toBe(other.dedupe_key);
    expect(draft.dedupe_key).not.toBeNull();
  });
});

describe('ingestao ponta a ponta (puro): corpus → eventos → snapshot', () => {
  it('o card F3 aparece como discovery concluido SEM plano, nunca como "nao realizada"', () => {
    const snapshot = reduceEvents(asEvents(loadExample('discovery-sem-repo-nem-tracker')));

    expect(snapshot.discoveries).toHaveLength(1);
    expect(snapshot.discoveries[0].derivedStage).toBe('discovery');
    expect(snapshot.discoveries[0].stageSignals).toContain('completed-without-plan');
    expect(snapshot.phases[0].completedAt).not.toBeNull();
    expect(snapshot.phases[0].outcome).toBe('done');
  });

  it('discovery (que declara o plano) + fase plano (que declara os itens) dao a etapa planned', () => {
    // O `result.json` da fase plano NAO redeclara o plano — ele vem em
    // `subject.plan_id`, e quem o declarou foi o discovery. O card so fica
    // inteiro quando os dois runs entram no mesmo store: e a espinha da fatia.
    const discoveryEvents = asEvents(loadExample('discovery-com-tracker'));
    const planoEvents = asEvents(loadExample('plano-com-itens')).map((event, index) => ({
      ...event,
      seq: discoveryEvents.length + index + 1,
    }));

    const snapshot = reduceEvents([...discoveryEvents, ...planoEvents]);

    expect(snapshot.plans).toHaveLength(1);
    expect(snapshot.workItems).toHaveLength(3);
    expect(snapshot.discoveries[0].derivedStage).toBe('planned');
    expect(snapshot.discoveries[0].stageSignals).not.toContain('orphan-item');
    expect(snapshot.discoveries[0].tracker).toEqual({ provider: 'taskdex', cardId: 'card-4711' });
  });

  it('um item que entra em curso puxa o card para execution — e a etapa nunca foi digitada', () => {
    const events = [...asEvents(loadExample('discovery-com-tracker'))];
    const planoEvents = asEvents(loadExample('plano-com-itens')).map((event, index) => ({ ...event, seq: events.length + index + 1 }));
    const started: StoreEvent = {
      seq: events.length + planoEvents.length + 1,
      event_id: 'evt-start',
      at: '2026-08-04T10:00:00.000Z',
      type: 'work_item.updated',
      source: { kind: 'app' },
      dedupe_key: null,
      payload: { id: 'wi-2026-08-03-a1-02', state: 'in-progress' },
    };

    expect(reduceEvents([...events, ...planoEvents, started]).discoveries[0].derivedStage).toBe('execution');
  });

  it('a falha da fase implementar fica visivel no snapshot, com codigo', () => {
    const snapshot = reduceEvents(asEvents(loadExample('implementar-falhou')));
    const failed = snapshot.phases.find((phase) => phase.phase === 'implementar');

    expect(failed?.failure?.code).toBe('worktree-dirty');
    expect(failed?.completedAt).toBeNull();
    expect(snapshot.notes).toHaveLength(1);
  });
});
