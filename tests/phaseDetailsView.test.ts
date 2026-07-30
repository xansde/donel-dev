import { describe, expect, it } from 'vitest';
import type { PhaseNode } from '../src/main/discovery-tree';
import type { EsteiraResultManifest } from '../src/main/esteira-reader';
import { buildPhaseDetailsView } from '../src/shared/phaseDetailsView';
import type { PhasePullRequestFacts } from '../src/shared/githubFacts';
import type { PhaseStatus } from '../src/shared/phaseState';

// Lote 8 (009-modo-dev-v3) — CA-18/CA-20: o painel direito (garantia, PR,
// artefatos, recibos) monta a partir de dados JÁ RESOLVIDOS (mesma
// disciplina C4/CA-6 do resto do repo: cada seção ausente vira `null`/`[]`,
// nunca erro/fabricação).

const ACTIVE_PROFILE = 'tech-1';

function manifest(outputs: Partial<EsteiraResultManifest['outputs']> = {}): EsteiraResultManifest {
  return {
    card_id: 'card-p1',
    fase: 'implementar',
    status: 'success',
    started_at: 'x',
    finished_at: 'x',
    executor: 'claude-code',
    model: 'sonnet',
    effort: 'medium',
    outputs,
  };
}

function phaseNode(
  status: PhaseStatus,
  result: EsteiraResultManifest | null = null,
  archivedSession: PhaseNode['archivedSession'] = null,
): PhaseNode {
  return {
    phase: 'implementar',
    status,
    artifacts: { ctxPath: 'x', resultPath: 'y', ctxExists: true, result, resultUnreadable: false, worktreePath: null, branch: 'esteira/x' },
    archivedSession,
  };
}

function pr(overrides: Partial<PhasePullRequestFacts> = {}): PhasePullRequestFacts {
  return {
    number: 42,
    url: 'https://github.com/o/r/pull/42',
    state: 'open',
    merged: false,
    mergedAt: null,
    baseRefName: 'staging',
    homologado: false,
    revertidoCiclo: false,
    ...overrides,
  };
}

const BASE = {
  discoveryCardId: 'd',
  planCardId: 'p',
  planCardTitle: 'p',
  faseGarantia: null,
  pr: null,
  branch: null,
  activeProfileSlug: ACTIVE_PROFILE,
} as const;

describe('buildPhaseDetailsView — breadcrumb e resumo', () => {
  it('monta o breadcrumb com discovery/plano/fase, sem depender de fonte alguma', () => {
    const view = buildPhaseDetailsView({
      ...BASE,
      discoveryCardId: 'PRJ-100',
      planCardId: 'PRJ-143',
      planCardTitle: 'Parcelamento de cotas',
      phase: 'implementar',
      faseNum: 2,
      node: phaseNode('running'),
    });

    expect(view.breadcrumb).toEqual({
      discoveryCardId: 'PRJ-100',
      planCardId: 'PRJ-143',
      planCardTitle: 'Parcelamento de cotas',
      phase: 'implementar',
      faseNum: 2,
    });
    expect(view.cardId).toBe('PRJ-143');
  });

  it('resumo muda por status — not-started/running/done/failed/stuck têm textos distintos', () => {
    const summaries = (['not-started', 'running', 'done', 'failed', 'stuck'] as const).map(
      (status) => buildPhaseDetailsView({ ...BASE, phase: 'implementar', faseNum: 1, node: phaseNode(status) }).summary,
    );
    expect(new Set(summaries).size).toBe(5); // 5 textos distintos, nenhum repetido
  });
});

describe('buildPhaseDetailsView — garantia (CA-20)', () => {
  it('sem faseGarantia (fora de implementar/validar, ou plano sem fatiar) → garantia null', () => {
    const view = buildPhaseDetailsView({ ...BASE, phase: 'documentar', faseNum: null, node: phaseNode('done') });
    expect(view.garantia).toBeNull();
  });

  it('com faseGarantia declarada pelo plano → tipo/descricao/roteiroPath repassados, status derivado da fase', () => {
    const view = buildPhaseDetailsView({
      ...BASE,
      phase: 'validar',
      faseNum: 1,
      node: phaseNode('done'),
      faseGarantia: { tipo: 'roteiro_e2e', descricao: 'Cobre o checkout', roteiroPath: 'specs/x/e2e-fase-1.md' },
    });
    expect(view.garantia).toEqual({
      tipo: 'roteiro_e2e',
      descricao: 'Cobre o checkout',
      roteiroPath: 'specs/x/e2e-fase-1.md',
      statusLabel: 'provada',
    });
  });

  it('fase ainda não done → statusLabel pendente', () => {
    const view = buildPhaseDetailsView({
      ...BASE,
      phase: 'implementar',
      faseNum: 1,
      node: phaseNode('running'),
      faseGarantia: { tipo: 'teste_api', descricao: null, roteiroPath: null },
    });
    expect(view.garantia?.statusLabel).toBe('pendente');
  });

  it('tipo ausente → "—", nunca string vazia', () => {
    const view = buildPhaseDetailsView({
      ...BASE,
      phase: 'implementar',
      faseNum: 1,
      node: phaseNode('done'),
      faseGarantia: { tipo: null, descricao: null, roteiroPath: null },
    });
    expect(view.garantia?.tipo).toBe('—');
  });
});

describe('buildPhaseDetailsView — PR (CA-20)', () => {
  it('faseNum null (fora de implementar/validar) → pr null, seção nem existe', () => {
    const view = buildPhaseDetailsView({ ...BASE, phase: 'discovery', faseNum: null, node: phaseNode('done') });
    expect(view.pr).toBeNull();
  });

  it('faseNum presente sem PR resolvido ainda → 3 linhas com "sem PR ainda"/"ainda não"', () => {
    const view = buildPhaseDetailsView({
      ...BASE,
      phase: 'implementar',
      faseNum: 1,
      node: phaseNode('running'),
      branch: 'esteira/parcelamento',
    });
    expect(view.pr).toEqual([
      { label: 'PR', value: 'sem PR ainda' },
      { label: 'merge', value: 'ainda não' },
      { label: 'branch', value: 'esteira/parcelamento' },
    ]);
  });

  it('PR aberto → estado "aberto", merge "ainda não"', () => {
    const view = buildPhaseDetailsView({
      ...BASE,
      phase: 'implementar',
      faseNum: 1,
      node: phaseNode('running'),
      pr: pr({ state: 'open' }),
      branch: 'esteira/x',
    });
    expect(view.pr?.[0]).toEqual({ label: 'PR', value: '#42 · aberto' });
    expect(view.pr?.[1]).toEqual({ label: 'merge', value: 'ainda não' });
  });

  it('PR mergeado com mergedAt → estado "mergeado", merge formatado DD/MM HH:mm', () => {
    const view = buildPhaseDetailsView({
      ...BASE,
      phase: 'validar',
      faseNum: 1,
      node: phaseNode('done'),
      pr: pr({ merged: true, mergedAt: '2026-07-29T14:32:00.000Z' }),
      branch: 'esteira/x',
    });
    expect(view.pr?.[0].value).toBe('#42 · mergeado');
    expect(view.pr?.[1].value).toMatch(/^\d{2}\/\d{2} \d{2}:\d{2}$/);
  });

  it('PR homologado vence "mergeado"; revertido vence homologado (prioridade do fato mais recente)', () => {
    const homologado = buildPhaseDetailsView({
      ...BASE,
      phase: 'validar',
      faseNum: 1,
      node: phaseNode('done'),
      pr: pr({ merged: true, mergedAt: 'x', homologado: true }),
    });
    expect(homologado.pr?.[0].value).toBe('#42 · homologado');

    const revertido = buildPhaseDetailsView({
      ...BASE,
      phase: 'validar',
      faseNum: 1,
      node: phaseNode('done'),
      pr: pr({ merged: true, mergedAt: 'x', homologado: true, revertidoCiclo: true }),
    });
    expect(revertido.pr?.[0].value).toBe('#42 · revertido');
  });

  it('branch ausente → "—"', () => {
    const view = buildPhaseDetailsView({ ...BASE, phase: 'implementar', faseNum: 1, node: phaseNode('running') });
    expect(view.pr?.[2]).toEqual({ label: 'branch', value: '—' });
  });
});

describe('buildPhaseDetailsView — artefatos', () => {
  it('sem result.json → artifacts vazio, nunca lança', () => {
    const view = buildPhaseDetailsView({ ...BASE, phase: 'implementar', faseNum: 1, node: phaseNode('running', null) });
    expect(view.artifacts).toEqual([]);
  });

  it('artifact_paths presente → ícone por extensão (.json → "{}", .html → "◧", outro → "▤")', () => {
    const view = buildPhaseDetailsView({
      ...BASE,
      phase: 'implementar',
      faseNum: 1,
      node: phaseNode('done', manifest({ artifact_paths: ['specs/x/plano-result.json', 'specs/x/e2e.html', 'specs/x/spec.md'] })),
    });
    expect(view.artifacts).toEqual([
      { path: 'specs/x/plano-result.json', icon: '{}' },
      { path: 'specs/x/e2e.html', icon: '◧' },
      { path: 'specs/x/spec.md', icon: '▤' },
    ]);
  });
});

describe('buildPhaseDetailsView — showReceipts (D-V7, nunca cobra de quem não rodou)', () => {
  it('etapa not-started (é a próxima, nunca rodou) → showReceipts false, mesmo sem verificar sources', () => {
    const view = buildPhaseDetailsView({ ...BASE, phase: 'validar', faseNum: 1, node: phaseNode('not-started') });
    expect(view.showReceipts).toBe(false);
  });

  it('etapa que já rodou (running/done/failed/stuck) → showReceipts true', () => {
    for (const status of ['running', 'done', 'failed', 'stuck'] as const) {
      const view = buildPhaseDetailsView({ ...BASE, phase: 'validar', faseNum: 1, node: phaseNode(status) });
      expect(view.showReceipts).toBe(true);
    }
  });
});

describe('buildPhaseDetailsView — recibos de conhecimento (D-V7)', () => {
  it('sem knowledge.consulted → receipts vazio (o componente decide "sem registro"/omitir)', () => {
    const view = buildPhaseDetailsView({ ...BASE, phase: 'plano', faseNum: null, node: phaseNode('done', manifest({})) });
    expect(view.receipts).toEqual([]);
  });

  it('knowledge.consulted.sources presente → um recibo por source, na ordem', () => {
    const view = buildPhaseDetailsView({
      ...BASE,
      phase: 'plano',
      faseNum: null,
      node: phaseNode('done', manifest({ knowledge: { consulted: { sources: ['vault/Notas/x.md', 'repo/docs/licoes.md#14'], hits: 2 } } })),
    });
    expect(view.receipts).toEqual([{ source: 'vault/Notas/x.md' }, { source: 'repo/docs/licoes.md#14' }]);
  });

  it('sources com shape errado (não-array, ou itens não-string) → filtra/degrada, nunca lança', () => {
    const view = buildPhaseDetailsView({
      ...BASE,
      phase: 'plano',
      faseNum: null,
      node: phaseNode('done', manifest({ knowledge: { consulted: { sources: ['ok', 42, null] as unknown as string[] } } })),
    });
    expect(view.receipts).toEqual([{ source: 'ok' }]);
  });
});

// CA-25 (lote 8) — a conta em que a sessão ARQUIVADA desta etapa rodou.
describe('buildPhaseDetailsView — archivedAccount (CA-25)', () => {
  it('sem sessão arquivada → archivedAccount null', () => {
    const view = buildPhaseDetailsView({ ...BASE, phase: 'implementar', faseNum: 1, node: phaseNode('not-started') });
    expect(view.archivedAccount).toBeNull();
  });

  it('sessão arquivada na MESMA conta ativa → mismatch false', () => {
    const view = buildPhaseDetailsView({
      ...BASE,
      phase: 'implementar',
      faseNum: 1,
      node: phaseNode('done', null, { sessionId: 'sess-1', profileSlug: ACTIVE_PROFILE, archivedAt: 100 }),
    });
    expect(view.archivedAccount).toEqual({ label: `conta: ${ACTIVE_PROFILE}`, mismatch: false });
  });

  it('sessão arquivada em OUTRA conta → mismatch true (CA-24 pode produzir isso: original + reiniciada)', () => {
    const view = buildPhaseDetailsView({
      ...BASE,
      phase: 'implementar',
      faseNum: 1,
      node: phaseNode('done', null, { sessionId: 'sess-1', profileSlug: 'tech-2', archivedAt: 100 }),
    });
    expect(view.archivedAccount).toEqual({ label: 'conta: tech-2', mismatch: true });
  });
});
