import { cardFromDrafts, cardFromResult, codesOf, resultDoc } from './helpers/esteiraResultCard';
import { describe, expect, it } from 'vitest';
import { parseEsteiraResult, parseEsteiraResultText, type EsteiraResult } from '../src/shared/esteira/contract/resultContract';
import { resultToEvents, ingestFailureEvent, ingestRecoveryEvent } from '../src/shared/esteira/ingest/resultToEvents';
import { reduceEvents } from '../src/shared/esteira/store/reducer';
import { cardView, gateLines, reviewChecklist, reviewChecklistTitle, deliveryLine, verificationLines } from '../src/renderer/src/Esteira/esteiraView';
import type { StoreEvent } from '../src/shared/esteira/store/storeFormat';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('Fatos humanos (A9, A18, A4, A13, A22)', () => {
  // Spec 010 — os fatos que dependem de GENTE: gate confirmado (A9), decisão
  // tomada (A18), revisão humana (A10) e gesto humano esperado (A19).
  //
  // O que eles têm em comum, e por que moram no mesmo arquivo: nenhum deles é
  // dedutível do repo. Enquanto viviam como texto (blockquote no `tasks.md`,
  // frase no `summary`), o app tinha duas opções ruins — adivinhar ou calar. Os
  // dois vícios que a spec 010 existe para extinguir.

  const resultWith = (facts: unknown[], run: Record<string, unknown> = {}) => resultDoc(facts, { run });

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
        declaredFacts: [],
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
});

describe('Revisão humana (A10, A19)', () => {
  // Spec 010 (A10 + A19) — o que sobrou para VOCÊ.
  //
  // A10: a lista viajava como texto no `summary` — uma frase corrida com três
  // coisas dentro, que ninguém lê como lista e ninguém marca como feita. E no
  // `summary` não cabe a distinção que importa: "confira o que eu fiz" e "faça o
  // que eu não podia fazer" são pedidos diferentes.
  //
  // A19: esperar por gente NÃO é falha da fase. Falha é o que a fase deveria ter
  // feito e não fez; pintar espera de vermelho ensina a ignorar o vermelho.

  const WI = { entity: 'work_item', id: 'wi-1' } as const;

  const resultWith = (facts: unknown[], run: Record<string, unknown> = {}) =>
    resultDoc(facts, { phase: 'validar', workItemId: 'wi-1', run });

  const confira = (item: string, state = 'pending', detail: string | null = null) => ({ item, kind: 'review', state, detail });
  const faca = (item: string, state = 'pending', detail: string | null = null) => ({ item, kind: 'action', state, detail });

  const review = (checklist: unknown[], phase = 'validar'): Record<string, unknown> => ({
    type: 'human_review.recorded',
    subject: WI,
    phase,
    checklist,
  });

  const validado = (facts: unknown[]): Record<string, unknown> =>
    resultWith([
      { type: 'verification.recorded', subject: WI, verification_kind: 'review', state: 'passed', ref: 'sem bloqueio' },
      ...facts,
      { type: 'phase.completed', subject: WI, phase: 'validar', outcome: 'done', summary: null },
    ]);

  const cardComEventos = cardFromDrafts;

  describe('A10 — revisão humana é lista estruturada, não frase no summary', () => {
    it('o parser aceita a lista com as duas naturezas', () => {
      const parsed = parseEsteiraResult(validado([review([confira('o teste cobre lote vazio'), faca('aprovar o PR')])]));
      if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues, null, 2));
      const fact = parsed.result.facts.find((entry) => entry.type === 'human_review.recorded');
      expect(fact?.type === 'human_review.recorded' && fact.checklist.map((entry) => entry.kind)).toEqual(['review', 'action']);
    });

    it('lista vazia é recusada — "tem coisa para você" sem dizer o que é não ajuda ninguém', () => {
      expect(codesOf(validado([review([])]))).toContain('empty_facts');
    });

    it('item sem natureza declarada é recusado — confira e faça são pedidos diferentes', () => {
      expect(codesOf(validado([review([{ item: 'algo', state: 'pending', detail: null }])]))).toContain('missing_field');
    });

    it('redeclarar a lista SUBSTITUI: metade respondida não convive com a versão inteira', () => {
      const parsed = parseEsteiraResult(validado([review([confira('o teste cobre lote vazio'), faca('aprovar o PR')])]));
      if (!parsed.ok) throw new Error('fixture inválida');
      const primeiro = resultToEvents(parsed.result, { resultPath: 'C:/a.json' }).find(
        (draft) => draft.type === 'human_review.recorded',
      )!;

      const events: StoreEvent[] = [
        { seq: 1, event_id: 'e1', at: primeiro.at, type: primeiro.type, source: { kind: 'app' }, dedupe_key: null, payload: primeiro.payload },
        {
          seq: 2,
          event_id: 'e2',
          at: '2026-08-05T12:00:00.000Z',
          type: 'human_review.recorded',
          source: { kind: 'app' },
          dedupe_key: null,
          payload: {
            subject: WI,
            phase: 'validar',
            checklist: [{ item: 'o teste cobre lote vazio', kind: 'review', state: 'done', detail: 'conferido, cobre' }],
          },
        },
      ];

      const snapshot = reduceEvents(events, { builtAt: '2026-08-05T13:00:00.000Z' });
      expect(snapshot.humanReviews).toHaveLength(1);
      expect(snapshot.humanReviews[0].checklist).toHaveLength(1);
      expect(snapshot.humanReviews[0].checklist[0].state).toBe('done');
    });

    it('o card mostra verbo, item e estado — e o título conta o que falta', () => {
      const card = cardComEventos([
        {
          type: 'human_review.recorded',
          at: '2026-08-04T12:30:00.000Z',
          dedupe_key: null,
          payload: {
            subject: WI,
            phase: 'validar',
            checklist: [
              { item: 'o teste cobre lote vazio', kind: 'review', state: 'pending', detail: 'tests/fila.test.ts' },
              { item: 'aprovar o PR', kind: 'action', state: 'done', detail: null },
            ],
          },
        },
      ]);

      const lines = reviewChecklist(card);
      expect(lines.map((line) => line.text)).toEqual([
        'Confira: o teste cobre lote vazio — aguardando você',
        'Você precisa: aprovar o PR — respondido',
      ]);
      expect(lines[0].detail).toBe('tests/fila.test.ts');
      expect(reviewChecklistTitle(lines)).toBe('Revisão da fase (1 item aguardando você)');
    });
  });

  describe('A19 — esperar por gente não é falha da fase', () => {
    const comGestoPendente = (): Record<string, unknown> =>
      resultWith(
        [
          { type: 'verification.recorded', subject: WI, verification_kind: 'check', state: 'passed', ref: 'npm test' },
          review([faca('abrir o PR contra staging')], 'implementar'),
          { type: 'phase.completed', subject: WI, phase: 'implementar', outcome: 'done', summary: 'Falta só o PR, que é gesto seu.' },
        ],
        { phase: 'implementar' },
      );

    it('a fase sai CONCLUÍDA com o gesto humano pendente, e o run é success', () => {
      const parsed = parseEsteiraResult(comGestoPendente());
      if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues, null, 2));
      expect(parsed.result.run.status).toBe('success');
    });

    it('a pendência humana vai NOMEADA, com tom de "há algo a fazer" — nunca de erro', () => {
      const parsed = parseEsteiraResult(comGestoPendente());
      if (!parsed.ok) throw new Error('fixture inválida');

      const card = cardComEventos(resultToEvents(parsed.result, { resultPath: 'C:/x.json' }));
      const aguardando = reviewChecklist(card).filter((line) => line.state === 'pending');
      expect(aguardando.map((line) => line.text)).toEqual(['Você precisa: abrir o PR contra staging — aguardando você']);
      expect(aguardando[0].tone).toBe('attention');
      expect(aguardando.every((line) => line.tone !== 'error')).toBe(true);

      // E a fase segue concluída: a espera não a rebaixa, e o card não ganha
      // sinal de erro por causa dela.
      expect(card.phases.find((phase) => phase.phase === 'implementar')?.outcome).toBe('done');
      expect(card.signals.every((signal) => signal.tone !== 'error')).toBe(true);
    });
  });
});

describe('Canal da entrega (A15)', () => {
  // Spec 010 (A15) — o CANAL da entrega.
  //
  // Num repo com escada alfa→beta→stable, "concluído" sem destino se lê como
  // "está na main". O card precisa dizer ONDE a coisa chegou — e não pode
  // deduzir: o apelido do canal é vocabulário do repo, não do contrato.

  const WI = { entity: 'work_item', id: 'wi-1' } as const;

  const concluir = (facts: unknown[]) => resultDoc(facts, { phase: 'concluir', workItemId: 'wi-1' });

  const pr = (base: string | null, state: 'passed' | 'pending' | 'failed' = 'passed'): Record<string, unknown> => ({
    type: 'verification.recorded',
    subject: WI,
    verification_kind: 'pull-request',
    state,
    ref: 'https://github.com/exemplo/atlas/pull/128',
    base,
  });

  const fechada = (channel: string | null): Record<string, unknown> => ({
    type: 'phase.completed',
    subject: WI,
    phase: 'concluir',
    outcome: 'done',
    summary: null,
    channel,
  });

  const cardDo = cardFromResult;

  describe('A15 — o canal da entrega', () => {
    it('base e canal declarados: o card diz os dois', () => {
      expect(deliveryLine(cardDo(concluir([pr('staging'), fechada('alfa')])))).toBe('Entregue em staging (alfa).');
    });

    it('só a base: o card diz a base e NÃO inventa o canal', () => {
      expect(deliveryLine(cardDo(concluir([pr('staging'), fechada(null)])))).toBe('Entregue em staging.');
    });

    it('só o canal: o card diz o canal', () => {
      expect(deliveryLine(cardDo(concluir([pr(null), fechada('beta')])))).toBe('Entregue no canal beta.');
    });

    it('nenhum dos dois: o card não afirma nada sobre destino', () => {
      expect(deliveryLine(cardDo(concluir([pr(null), fechada(null)])))).toBeNull();
    });

    it('a base sobrevive ao store — é parte do desfecho, não decoração', () => {
      const card = cardDo(concluir([pr('staging'), fechada('alfa')]));
      expect(card.verifications[0].base).toBe('staging');
      expect(card.phases[0].channel).toBe('alfa');
    });

    it('PR ainda pending com base declarada NÃO é "entregue" — achado da captura tutorial-e2e (batch n1, 2026-08-05)', () => {
      // O fallback antigo aceitava `base` de QUALQUER estado, então um PR
      // 'pending' já produzia "Entregue em staging." lado a lado com "PR
      // aberto, ainda não verificado" — a mesma tela se contradizendo. O check
      // passado (de outra verificação, ex.: npm test numa fase anterior) só
      // cumpre o D-4 do run de exemplo; quem decide `deliveryLine` é o PR.
      const check = { type: 'verification.recorded', subject: WI, verification_kind: 'check', state: 'passed', ref: 'npm test' };
      expect(deliveryLine(cardDo(concluir([check, pr('staging', 'pending'), fechada(null)])))).toBeNull();
    });

    it('base fora de um PR é recusada — check e revisão não têm branch de destino', () => {
      const doc = concluir([
        { type: 'verification.recorded', subject: WI, verification_kind: 'check', state: 'passed', ref: 'npm test', base: 'staging' },
        fechada(null),
      ]);
      // O parser aceita a forma; quem cobra a coerência é o emissor da skill
      // (o app nunca recusa o que consegue ler sem ambiguidade). O que importa
      // aqui é que o campo não vaza para a frase do canal.
      expect(codesOf(doc)).toEqual([]);
      expect(deliveryLine(cardDo(doc))).toBeNull();
    });
  });
});

describe('Gate e2e manual (A16)', () => {
  // Spec 010 (A16) — o roteiro e2e MANUAL como check de verdade.
  //
  // O defeito: o gate de e2e conferia a EXISTENCIA do arquivo de roteiro na
  // branch. "Escrito" e "rodado" viraram a mesma coisa, e uma fase fechou verde
  // sem ninguém ter validado. Agora o roteiro é uma verificação de tipo próprio
  // (`e2e-manual`), cujo `state` só sai de `pending` com resultado colhido do
  // dono — e o aval humano não sai junto de um e2e que ninguém rodou.

  const WI = { entity: 'work_item', id: 'wi-1' } as const;

  const validar = (facts: unknown[]) => resultDoc(facts, { phase: 'validar', workItemId: 'wi-1' });

  const verificacao = (kind: string, state: string, ref: string | null = null): Record<string, unknown> => ({
    type: 'verification.recorded',
    subject: WI,
    verification_kind: kind,
    state,
    ref,
  });

  const e2e = (state: string): Record<string, unknown> =>
    verificacao('e2e-manual', state, '.claude/skills/tutorial-e2e/roteiros/fila.spec.ts');

  const fechada = (risk: string | null): Record<string, unknown> => ({
    type: 'phase.completed',
    subject: WI,
    phase: 'validar',
    outcome: 'done',
    summary: null,
    risk,
    channel: null,
  });

  const gate = (): Record<string, unknown> => ({
    type: 'gate.confirmed',
    subject: WI,
    condition: 'pode seguir para concluir',
    confirmed_by: 'dono do repo',
    confirmed_at: null,
  });

  describe('A16 — o roteiro e2e manual é um check, não um arquivo na branch', () => {
    it('validar SENSÍVEL sem declarar o e2e é recusada', () => {
      expect(codesOf(validar([verificacao('review', 'passed'), fechada('sensivel')]))).toContain('sensitive_without_e2e');
    });

    it('validar sensível com o e2e ainda PENDENTE é aceita — esperar você rodar é legítimo (A19)', () => {
      expect(parseEsteiraResult(validar([verificacao('pull-request', 'pending'), e2e('pending'), fechada('sensivel')])).ok).toBe(true);
    });

    it('aprovação humana com o e2e pendente é recusada — era assim que a fase fechava verde', () => {
      const comReview = validar([verificacao('review', 'passed', 'aprovado por 1 revisor'), e2e('pending'), fechada('sensivel')]);
      expect(codesOf(comReview)).toContain('approval_before_e2e');

      const comGate = validar([verificacao('pull-request', 'pending'), e2e('pending'), gate(), fechada('sensivel')]);
      expect(codesOf(comGate)).toContain('approval_before_e2e');
    });

    it('com o e2e PASSADO, a aprovação humana é aceita', () => {
      const doc = validar([verificacao('review', 'passed', 'aprovado por 1 revisor'), e2e('passed'), fechada('sensivel')]);
      expect(parseEsteiraResult(doc).ok).toBe(true);
    });

    it('com o e2e que FALHOU, a aprovação também é aceita — o dono viu e decidiu, que é o ponto', () => {
      const doc = validar([verificacao('review', 'passed', 'aprovado mesmo assim'), e2e('failed'), fechada('sensivel')]);
      expect(parseEsteiraResult(doc).ok).toBe(true);
    });

    it('risco TRIVIAL não liga o gate — a régua é por risco, não por fase', () => {
      expect(parseEsteiraResult(validar([verificacao('review', 'passed'), fechada('trivial')])).ok).toBe(true);
    });

    it('fase que não classificou o risco não é cobrada — o app não classifica por ela', () => {
      expect(parseEsteiraResult(validar([verificacao('review', 'passed'), fechada(null)])).ok).toBe(true);
    });

    it('risco fora do contrato é recusado', () => {
      expect(codesOf(validar([verificacao('review', 'passed'), fechada('meio-sensivel')]))).toContain('not_in_enum');
    });

    it('o risco chega ao store, e o card distingue "escrito" de "rodado por você"', () => {
      const parsed = parseEsteiraResult(validar([verificacao('pull-request', 'pending'), e2e('pending'), fechada('sensivel')]));
      if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues, null, 2));

      const drafts = resultToEvents(parsed.result, { resultPath: 'C:/x.json' });
      const events: StoreEvent[] = [
        {
          seq: 1,
          event_id: 'e1',
          at: '2026-08-04T11:00:00.000Z',
          type: 'discovery.created',
          source: { kind: 'app' },
          dedupe_key: null,
          payload: { id: 'dsc-1', title: 'Fila trava sem sinal' },
        },
        {
          seq: 2,
          event_id: 'e2',
          at: '2026-08-04T11:00:00.000Z',
          type: 'work_item.created',
          source: { kind: 'app' },
          dedupe_key: null,
          payload: { id: 'wi-1', discoveryId: 'dsc-1', itemType: 'issue', title: 'Expor estado', targetRepo: 'atlas' },
        },
        ...drafts.map((draft, index) => ({
          seq: index + 3,
          event_id: `e${index + 3}`,
          at: draft.at,
          type: draft.type,
          source: { kind: 'app' } as const,
          dedupe_key: draft.dedupe_key,
          payload: draft.payload,
        })),
      ];

      const card = cardView(reduceEvents(events, { builtAt: '2026-08-04T13:00:00.000Z' }), 'dsc-1')!;
      expect(card.phases.find((phase) => phase.phase === 'validar')?.risk).toBe('sensivel');
      const linhas = verificationLines(card).map((line) => line.text);
      expect(linhas).toContain('roteiro e2e escrito, esperando você rodar');
    });
  });
});

describe('Ingestão de resultado (D-10)', () => {
  // Spec 010 (D-10) — a TRADUCAO fato → evento, a parte pura da ingestao. O que
  // ela promete:
  //
  // - cada fato declarado no `result.json` vira UM evento, com `dedupe_key`
  //   derivada de `run_id` + tipo + chave natural: reingerir o mesmo arquivo nao
  //   duplica nada;
  // - o que a skill NAO declarou nao vira evento — o app nao inventa;
  // - documento fora do contrato vira `ingest.failed` com os issues do parser,
  //   NUNCA silencio (foi silencio que virou "fase nao realizada" em 03/08).

  const EXAMPLES_DIR = join(__dirname, '..', 'docs', 'esteira-dev', 'contract', 'v1', 'examples');

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
      // A decisao esta la porque A18 a exige de uma discovery concluida — e ela
      // e justamente o oposto de lacuna preenchida: e o que a fase declarou.
      // `run.ingested` abre a lista: e o livro dos runs (A4), nao um fato.
      expect(events.map((event) => event.type)).toEqual(['run.ingested', 'discovery.created', 'decision.recorded', 'phase.completed']);
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
        // `phase.failed` fala do run inteiro; `run.ingested` e o LIVRO dos runs
        // (A4). Nenhum dos dois nasce de um fato declarado — os fatos e que
        // precisam sair inteiros do outro lado.
        const factEvents = events.filter((event) => event.type !== 'phase.failed' && event.type !== 'run.ingested');
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
        declaredFacts: [],
      });

      expect(draft.type).toBe('ingest.failed');
      expect(draft.payload.resultPath).toBe('C:/outbox/run-9.json');
      expect(Array.isArray(draft.payload.issues)).toBe(true);
      expect((draft.payload.issues as unknown[]).length).toBeGreaterThan(0);
    });

    it('o mesmo arquivo quebrado, reprocessado, nao empilha erro repetido', () => {
      const draft = ingestFailureEvent({
        resultPath: 'C:/outbox/run-9.json',
        issues: [],
        subject: null,
        at: '2026-08-03T12:00:00.000Z',
        declaredFacts: [],
      });
      const other = ingestFailureEvent({
        resultPath: 'C:/outbox/run-9.json',
        issues: [],
        subject: null,
        at: '2026-08-03T13:00:00.000Z',
        declaredFacts: [],
      });

      expect(draft.dedupe_key).toBe(other.dedupe_key);
      expect(draft.dedupe_key).not.toBeNull();
    });

    // A5 — o CUSTO: o payload carrega o que o documento declararia, para o card
    // dizer "sem este arquivo não existe X" em vez de só o campo que quebrou.
    it('carrega os fatos declarados no payload, para o card dizer o CUSTO (A5)', () => {
      const draft = ingestFailureEvent({
        resultPath: 'C:/outbox/run-9.json',
        issues: [],
        subject: { entity: 'plan', id: 'pln-1' },
        at: '2026-08-03T12:00:00.000Z',
        declaredFacts: [{ factType: 'work_item.recorded', entity: 'work_item', id: 'wi-1', title: 'Instrumentar a fila' }],
      });

      expect(draft.payload.declaredFacts).toEqual([{ factType: 'work_item.recorded', entity: 'work_item', id: 'wi-1', title: 'Instrumentar a fila' }]);
    });
  });

  // A6 — a recuperação: um `result.json` recusado que passou a ser legível é um
  // FATO próprio, ancorado no MESMO `resultPath` do erro que ela supera.
  describe('ingestRecoveryEvent — a recuperação é um fato, não o apagamento do erro (A6)', () => {
    it('carrega o path, os códigos sanados e COMO — nunca inventa quem consertou', () => {
      const draft = ingestRecoveryEvent({
        resultPath: 'C:/outbox/run-9.json',
        at: '2026-08-05T12:00:00.000Z',
        runId: 'run-9',
        subject: { entity: 'discovery', id: 'dsc-1' },
        recoveredCodes: ['unknown_field'],
        how: 'o documento agora passa no contrato',
      });

      expect(draft.type).toBe('ingest.recovered');
      expect(draft.payload).toMatchObject({
        resultPath: 'C:/outbox/run-9.json',
        runId: 'run-9',
        subject: { entity: 'discovery', id: 'dsc-1' },
        recoveredCodes: ['unknown_field'],
        how: 'o documento agora passa no contrato',
      });
    });

    it('a dedupe_key é o PATH, sem timestamp — uma recuperação por path, uma vez recuperado não volta a ser revalidado', () => {
      const first = ingestRecoveryEvent({
        resultPath: 'C:/outbox/run-9.json',
        at: '2026-08-05T12:00:00.000Z',
        runId: null,
        subject: null,
        recoveredCodes: [],
        how: 'x',
      });
      const second = ingestRecoveryEvent({
        resultPath: 'C:/outbox/run-9.json',
        at: '2026-08-05T13:00:00.000Z',
        runId: null,
        subject: null,
        recoveredCodes: [],
        how: 'y',
      });

      expect(first.dedupe_key).toBe(second.dedupe_key);
      expect(first.dedupe_key).toBe('ingest.recovered:C:/outbox/run-9.json');
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
});
