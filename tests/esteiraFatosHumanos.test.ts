import { describe, expect, it } from 'vitest';
import { CONTRACT_VERSION, parseEsteiraResult, type ContractIssueCode } from '../src/shared/esteira/contract/resultContract';
import { resultToEvents } from '../src/shared/esteira/ingest/resultToEvents';
import { reduceEvents } from '../src/shared/esteira/store/reducer';
import { cardView, gateLines } from '../src/renderer/src/Esteira/esteiraView';
import type { StoreEvent } from '../src/shared/esteira/store/storeFormat';

// Spec 010 — os fatos que dependem de GENTE: gate confirmado (A9), decisão
// tomada (A18), revisão humana (A10) e gesto humano esperado (A19).
//
// O que eles têm em comum, e por que moram no mesmo arquivo: nenhum deles é
// dedutível do repo. Enquanto viviam como texto (blockquote no `tasks.md`,
// frase no `summary`), o app tinha duas opções ruins — adivinhar ou calar. Os
// dois vícios que a spec 010 existe para extinguir.

const RUN = {
  run_id: 'run-1',
  phase: 'discovery',
  status: 'success',
  started_at: '2026-08-04T12:00:00.000Z',
  finished_at: '2026-08-04T12:30:00.000Z',
  failure: null,
};

export function resultWith(facts: unknown[], run: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    contract_version: CONTRACT_VERSION,
    kind: 'esteira.result',
    run: { ...RUN, ...run },
    actor: { tool: 'esteira-donel', tool_version: '3.0.0', executor: null, model: null, effort: null, cli_session_id: null },
    subject: { discovery_id: 'dsc-1', plan_id: null, work_item_id: null },
    workspace: null,
    facts,
  };
}

export function codesOf(input: unknown): ContractIssueCode[] {
  const parsed = parseEsteiraResult(input);
  return parsed.ok ? [] : parsed.issues.map((issue) => issue.code);
}

const DSC = { entity: 'discovery', id: 'dsc-1' } as const;

const gate = (condition: string, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  type: 'gate.confirmed',
  subject: DSC,
  condition,
  confirmed_by: 'dono do repo',
  confirmed_at: null,
  ...extra,
});

const completedDiscovery = (outcome = 'done'): Record<string, unknown> => ({
  type: 'phase.completed',
  subject: DSC,
  phase: 'discovery',
  outcome,
  summary: null,
});

const discoveryRecorded = (): Record<string, unknown> => ({
  type: 'discovery.recorded',
  discovery_id: 'dsc-1',
  title: 'Fila trava sem sinal',
  problem: null,
  tracker: null,
  target_repo: null,
  scope_repos: [],
});

// ---------------------------------------------------------------------------
// A9 — gate.confirmed
// ---------------------------------------------------------------------------

describe('A9 — a confirmação de gate é fato, não blockquote', () => {
  it('o parser aceita a confirmação com condição e quem confirmou', () => {
    const parsed = parseEsteiraResult(
      resultWith([discoveryRecorded(), gate('o repo alvo é atlas', { confirmed_at: '2026-08-04T12:10:00.000Z' }), completedDiscovery()]),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const fact = parsed.result.facts.find((entry) => entry.type === 'gate.confirmed');
    expect(fact).toEqual({
      type: 'gate.confirmed',
      subject: { entity: 'discovery', id: 'dsc-1' },
      condition: 'o repo alvo é atlas',
      confirmed_by: 'dono do repo',
      confirmed_at: '2026-08-04T12:10:00.000Z',
    });
  });

  it('confirmação sem quem confirmou é recusada — aval sem gente é o app se dando o próprio aval', () => {
    const semGente = { ...gate('o repo alvo é atlas') };
    delete semGente.confirmed_by;
    expect(codesOf(resultWith([discoveryRecorded(), semGente, completedDiscovery()]))).toContain('missing_field');
  });

  it('gate COMPOSTO vira duas linhas no store — meia-confirmação passa a ser expressável', () => {
    const parsed = parseEsteiraResult(
      resultWith([discoveryRecorded(), gate('a spec está aprovada'), gate('o repo alvo é atlas'), completedDiscovery()]),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const drafts = resultToEvents(parsed.result, { resultPath: 'C:/tmp/result.json' });
    const gates = drafts.filter((draft) => draft.type === 'gate.confirmed');
    expect(gates).toHaveLength(2);
    // Chaves naturais distintas: uma condição confirmada não cobre a outra.
    expect(new Set(gates.map((draft) => draft.dedupe_key)).size).toBe(2);
  });

  it('o reducer guarda uma condição por registro e a reconfirmação atualiza quem confirmou', () => {
    const events: StoreEvent[] = [
      {
        seq: 1,
        event_id: 'evt-1',
        at: '2026-08-04T12:30:00.000Z',
        type: 'gate.confirmed',
        source: { kind: 'app' },
        dedupe_key: 'a',
        payload: { subject: DSC, condition: 'a spec está aprovada', confirmedBy: 'revisor', confirmedAt: '2026-08-04T12:05:00.000Z' },
      },
      {
        seq: 2,
        event_id: 'evt-2',
        at: '2026-08-05T12:30:00.000Z',
        type: 'gate.confirmed',
        source: { kind: 'app' },
        dedupe_key: 'b',
        payload: { subject: DSC, condition: 'a spec está aprovada', confirmedBy: 'dono do repo', confirmedAt: '2026-08-05T09:00:00.000Z' },
      },
      {
        seq: 3,
        event_id: 'evt-3',
        at: '2026-08-05T12:30:00.000Z',
        type: 'gate.confirmed',
        source: { kind: 'app' },
        dedupe_key: 'c',
        payload: { subject: DSC, condition: 'o repo alvo é atlas', confirmedBy: 'dono do repo' },
      },
    ];

    const snapshot = reduceEvents(events, { builtAt: '2026-08-05T13:00:00.000Z' });
    expect(snapshot.gates).toHaveLength(2);
    const aprovada = snapshot.gates.find((entry) => entry.condition === 'a spec está aprovada');
    expect(aprovada?.confirmedBy).toBe('dono do repo');
    // Sem `confirmedAt` declarado, a hora do evento — nunca uma hora inventada.
    expect(snapshot.gates.find((entry) => entry.condition === 'o repo alvo é atlas')?.confirmedAt).toBe('2026-08-05T12:30:00.000Z');
  });

  it('o card mostra uma linha por condição, com quem confirmou', () => {
    const events: StoreEvent[] = [
      {
        seq: 1,
        event_id: 'evt-1',
        at: '2026-08-04T12:30:00.000Z',
        type: 'discovery.created',
        source: { kind: 'app' },
        dedupe_key: null,
        payload: { id: 'dsc-1', title: 'Fila trava sem sinal' },
      },
      {
        seq: 2,
        event_id: 'evt-2',
        at: '2026-08-04T12:30:00.000Z',
        type: 'gate.confirmed',
        source: { kind: 'app' },
        dedupe_key: null,
        payload: { subject: DSC, condition: 'o repo alvo é atlas', confirmedBy: 'dono do repo', confirmedAt: '2026-08-04T12:10:00.000Z' },
      },
    ];

    const card = cardView(reduceEvents(events), 'dsc-1');
    expect(card).not.toBeNull();
    const lines = gateLines(card!);
    expect(lines).toHaveLength(1);
    expect(lines[0].text).toContain('«o repo alvo é atlas»');
    expect(lines[0].text).toContain('confirmado por dono do repo');
  });
});

// ---------------------------------------------------------------------------
// A18 — a fase de conversa fecha com o que uma pessoa disse
// ---------------------------------------------------------------------------

describe('A18 — decisão humana é o que fecha discovery e plano', () => {
  const decision = (text: string, rationale: string | null = null): Record<string, unknown> => ({
    type: 'decision.recorded',
    subject: DSC,
    decision: text,
    confirmed_by: 'dono do repo',
    rationale,
  });

  it('discovery CONCLUÍDA sem nenhum fato humano é recusada — ela não perguntou nada', () => {
    expect(codesOf(resultWith([discoveryRecorded(), completedDiscovery()]))).toContain('done_without_human_decision');
  });

  it('discovery concluída com um gate confirmado é aceita', () => {
    expect(parseEsteiraResult(resultWith([discoveryRecorded(), gate('o repo alvo é atlas'), completedDiscovery()])).ok).toBe(true);
  });

  it('discovery concluída com uma decisão registrada é aceita', () => {
    const doc = resultWith([discoveryRecorded(), decision('fila por lote, não por item'), completedDiscovery()]);
    expect(parseEsteiraResult(doc).ok).toBe(true);
  });

  it('discovery ABANDONADA não precisa de fato humano — desistir sem perguntar é legítimo', () => {
    expect(parseEsteiraResult(resultWith([discoveryRecorded(), completedDiscovery('abandoned')])).ok).toBe(true);
  });

  it('plano CONCLUÍDO sem fato humano é recusado, mesmo declarando itens', () => {
    const item = {
      type: 'work_item.recorded',
      work_item_id: 'wi-1',
      plan_id: null,
      item_type: 'spike',
      title: 'Medir onde o lote para',
      target_repo: null,
      scope_repos: [],
    };
    const doc = resultWith([item, { type: 'phase.completed', subject: DSC, phase: 'plano', outcome: 'done', summary: null }], {
      phase: 'plano',
    });
    expect(codesOf(doc)).toContain('done_without_human_decision');
  });

  it('decisão sem quem decidiu é recusada — decisão órfã é o app decidindo sozinho', () => {
    const orfa = { ...decision('fila por lote') };
    delete orfa.confirmed_by;
    expect(codesOf(resultWith([discoveryRecorded(), orfa, completedDiscovery()]))).toContain('missing_field');
  });

  it('o card mostra a decisão com o motivo na mesma frase, junto dos gates', async () => {
    const { decisionLines, humanDecisionLines } = await import('../src/renderer/src/Esteira/esteiraView');
    const events: StoreEvent[] = [
      {
        seq: 1,
        event_id: 'evt-1',
        at: '2026-08-04T12:30:00.000Z',
        type: 'discovery.created',
        source: { kind: 'app' },
        dedupe_key: null,
        payload: { id: 'dsc-1', title: 'Fila trava sem sinal' },
      },
      {
        seq: 2,
        event_id: 'evt-2',
        at: '2026-08-04T12:30:00.000Z',
        type: 'gate.confirmed',
        source: { kind: 'app' },
        dedupe_key: null,
        payload: { subject: DSC, condition: 'o repo alvo é atlas', confirmedBy: 'dono do repo' },
      },
      {
        seq: 3,
        event_id: 'evt-3',
        at: '2026-08-04T12:30:00.000Z',
        type: 'decision.recorded',
        source: { kind: 'app' },
        dedupe_key: null,
        payload: {
          subject: DSC,
          decision: 'fila por lote, não por item',
          confirmedBy: 'dono do repo',
          rationale: 'O painel só tem o que mostrar por lote.',
        },
      },
    ];

    const card = cardView(reduceEvents(events), 'dsc-1')!;
    expect(decisionLines(card)[0].text).toBe(
      '«fila por lote, não por item» — decidido por dono do repo. Motivo: O painel só tem o que mostrar por lote.',
    );
    // O bloco do card junta LINHAS prontas; nenhuma frase nasce aqui.
    expect(humanDecisionLines(card).map((line) => line.text)).toEqual([gateLines(card)[0].text, decisionLines(card)[0].text]);
  });
});

// ---------------------------------------------------------------------------
// A4 + A13 — complemento e revisão: um run não se reescreve
// ---------------------------------------------------------------------------
//
// O caso real: a fase Concluir regravou o MESMO `run_id` com o desfecho
// revisto. A segunda leitura casou com a `dedupe_key` da primeira — o mecanismo
// que torna a reingestão segura — e cada evento novo foi descartado como "já
// visto". O card continuou dizendo "terminou sem conclusão" enquanto o arquivo
// dizia o contrário, sem erro em lugar nenhum.

describe('A4 — complemento acrescenta fatos sem redeclarar a fase', () => {
  const nota = (): Record<string, unknown> => ({ type: 'note.recorded', subject: DSC, text: 'O relatório ficou pronto depois.' });

  const complemento = (run: Record<string, unknown> = {}, facts: unknown[] = [nota()]): Record<string, unknown> => {
    const doc = resultWith(facts, { run_id: 'run-1.c1', complements_run_id: 'run-1', ...run });
    doc.kind = 'esteira.result.complement';
    return doc;
  };

  it('o complemento é aceito sem phase.completed — a fase já respondeu no run ancorado', () => {
    expect(parseEsteiraResult(complemento()).ok).toBe(true);
  });

  it('complemento que redeclara a fase é recusado — a mesma execução contada duas vezes', () => {
    expect(codesOf(complemento({}, [nota(), completedDiscovery()]))).toContain('complement_redeclares_phase');
  });

  it('complemento sem dizer a que run se ancora é recusado', () => {
    const doc = complemento();
    delete (doc.run as Record<string, unknown>).complements_run_id;
    expect(codesOf(doc)).toContain('complement_without_anchor');
  });

  it('complemento cujo run_id não traz o sufixo do ancorado é recusado', () => {
    expect(codesOf(complemento({ run_id: 'run-outro' }))).toContain('lineage_suffix_mismatch');
  });

  it('result normal declarando complements_run_id é recusado — complemento sem se dizer complemento', () => {
    const doc = resultWith([discoveryRecorded(), gate('o repo é atlas'), completedDiscovery()], { complements_run_id: 'run-0' });
    expect(codesOf(doc)).toContain('complement_without_kind');
  });
});

describe('A13 — desfecho revisto é dado consultável, não sobrescrita', () => {
  const revisao = (run: Record<string, unknown> = {}): Record<string, unknown> =>
    resultWith([discoveryRecorded(), gate('o problema mudou'), completedDiscovery('abandoned')], {
      run_id: 'run-1.rev2',
      revises_run_id: 'run-1',
      ...run,
    });

  it('a revisão é aceita e o run revisado fica legível no documento', () => {
    const parsed = parseEsteiraResult(revisao());
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.result.run.revises_run_id).toBe('run-1');
  });

  it('revisão sem o sufixo combinado é recusada — o parentesco existiria só no campo', () => {
    expect(codesOf(revisao({ run_id: 'run-2' }))).toContain('lineage_suffix_mismatch');
  });

  it('rev1 é recusada — a primeira versão de um run é o próprio run', () => {
    expect(codesOf(revisao({ run_id: 'run-1.rev1' }))).toContain('lineage_suffix_mismatch');
  });

  it('um run não revisa a si mesmo — o anterior tem que continuar legível', () => {
    expect(codesOf(revisao({ run_id: 'run-1', revises_run_id: 'run-1' }))).toContain('lineage_suffix_mismatch');
  });
});

describe('A4 — o livro dos runs recusa run alterado depois de ingerido', () => {
  const doc = () => {
    const parsed = parseEsteiraResult(resultWith([discoveryRecorded(), gate('o repo é atlas'), completedDiscovery()]));
    if (!parsed.ok) throw new Error('fixture inválida');
    return parsed.result;
  };

  it('a digital NÃO muda com a ordem das chaves — ordem é detalhe de quem escreveu o arquivo', async () => {
    const { resultFingerprint } = await import('../src/shared/esteira/ingest/runLedger');
    const original = doc();
    const reordenado = { ...original, run: { ...original.run }, kind: original.kind } as typeof original;
    expect(resultFingerprint(reordenado)).toBe(resultFingerprint(original));
  });

  it('mesmo run, mesmo conteúdo: reingestão normal e silenciosa', async () => {
    const { checkReingest, resultFingerprint } = await import('../src/shared/esteira/ingest/runLedger');
    const result = doc();
    const hash = resultFingerprint(result);
    expect(checkReingest([{ runId: 'run-1', contentHash: hash }], result, hash).kind).toBe('already-ingested');
  });

  it('mesmo run, conteúdo DIFERENTE: recusa com erro visível e a saída escrita', async () => {
    const { checkReingest, resultFingerprint } = await import('../src/shared/esteira/ingest/runLedger');
    const result = doc();
    const verdict = checkReingest([{ runId: 'run-1', contentHash: 'outra-coisa' }], result, resultFingerprint(result));
    expect(verdict.kind).toBe('changed');
    if (verdict.kind !== 'changed') return;
    expect(verdict.issue.code).toBe('run_changed_after_ingest');
    expect(verdict.issue.message).toContain('complement');
    expect(verdict.issue.message).toContain('revision');
  });

  it('o card conta o que houve, com a saída — nunca só o código do erro', async () => {
    const { ingestErrorLine } = await import('../src/renderer/src/Esteira/esteiraView');
    const line = ingestErrorLine({
      resultPath: 'C:/outbox/run-1.json',
      at: '2026-08-05T12:00:00.000Z',
      subject: DSC,
      issues: [{ code: 'run_changed_after_ingest', path: 'run.run_id', message: 'x' }],
    });
    expect(line).toContain('já tinha sido ingerido com outro conteúdo');
    expect(line).toContain('complemento');
    expect(line).toContain('revisão');
  });
});

// ---------------------------------------------------------------------------
// A22 — um run que fecha N fases aparece como N fases fechadas
// ---------------------------------------------------------------------------
//
// Caso real: Validar, Documentar e Concluir foram feitas dentro da sessão de
// Implementar. O result declarou UMA `phase.completed` e o mapa ficou mudo
// sobre as outras três — trabalho feito, tela em branco. É pré-requisito do E5
// (fundir fases), que se constrói em cima disto.

describe('A22 — N fases fechadas num result', () => {
  const WI = { entity: 'work_item', id: 'wi-1' } as const;

  const closed = (phase: string, outcome = 'done'): Record<string, unknown> => ({
    type: 'phase.completed',
    subject: WI,
    phase,
    outcome,
    summary: null,
  });

  const check = (): Record<string, unknown> => ({
    type: 'verification.recorded',
    subject: WI,
    verification_kind: 'check',
    state: 'passed',
    ref: 'npm test',
  });

  const adr = (): Record<string, unknown> => ({
    type: 'artifact.recorded',
    owner: WI,
    artifact_kind: 'adr',
    location: 'repo',
    repo: 'atlas',
    path: 'docs/adr/0009.md',
  });

  const cicloCompleto = (): Record<string, unknown> =>
    resultWith([check(), adr(), closed('implementar'), closed('validar'), closed('documentar'), closed('concluir')], {
      phase: 'implementar',
    });

  it('o parser aceita as quatro fases fechadas no mesmo documento', () => {
    const parsed = parseEsteiraResult(cicloCompleto());
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues, null, 2));
    expect(parsed.result.facts.filter((fact) => fact.type === 'phase.completed')).toHaveLength(4);
  });

  it('cada fase fechada responde pelo SEU produto — documentar sem artefato derruba o documento inteiro', () => {
    const semArtefato = resultWith([check(), closed('implementar'), closed('documentar')], { phase: 'implementar' });
    expect(codesOf(semArtefato)).toContain('missing_required_fact');
  });

  it('o run que fecha as seguintes sem dizer o que houve com a dele é recusado', () => {
    const doc = resultWith([check(), closed('validar')], { phase: 'implementar' });
    expect(codesOf(doc)).toContain('phase_completed_missing_for_run');
  });

  it('a mesma fase fechada duas vezes é recusada — duas histórias sobre uma execução', () => {
    const doc = resultWith([check(), closed('implementar'), closed('implementar', 'abandoned')], { phase: 'implementar' });
    expect(codesOf(doc)).toContain('duplicate_phase_completed');
  });

  it('o reducer registra QUATRO passagens de fase, e o item fecha pela última', () => {
    const parsed = parseEsteiraResult(cicloCompleto());
    if (!parsed.ok) throw new Error('fixture inválida');

    const drafts = resultToEvents(parsed.result, { resultPath: 'C:/x.json' });
    const events: StoreEvent[] = [
      {
        seq: 0,
        event_id: 'evt-0',
        at: '2026-08-04T11:00:00.000Z',
        type: 'work_item.created',
        source: { kind: 'app' },
        dedupe_key: null,
        payload: { id: 'wi-1', discoveryId: 'dsc-1', itemType: 'issue', title: 'Expor estado da fila', targetRepo: 'atlas' },
      },
      ...drafts.map((draft, index) => ({
        seq: index + 1,
        event_id: `evt-${index + 1}`,
        at: draft.at,
        type: draft.type,
        source: { kind: 'app' } as const,
        dedupe_key: draft.dedupe_key,
        payload: draft.payload,
      })),
    ];

    const snapshot = reduceEvents(events, { builtAt: '2026-08-04T13:00:00.000Z' });
    expect(snapshot.phases.map((phase) => phase.phase).sort()).toEqual(['concluir', 'documentar', 'implementar', 'validar']);
    expect(snapshot.phases.every((phase) => phase.completedAt !== null)).toBe(true);
    // `concluir` com `done` fecha o item — as outras não o reabrem.
    expect(snapshot.workItems[0].state).toBe('done');
  });
});
