import { describe, expect, it } from 'vitest';
import {
  aggregateChecks,
  buildFixPrompt,
  needsFix,
  parseCheck,
  parsePullRequestStatus,
  parseUnresolvedThreadCount,
  repoFromPullRequestUrl,
  reviewSignal,
  shouldPoll,
  type PrCheck,
  type PullRequestStatus,
} from '../src/shared/pullRequestStatus';

// B3 — JSON do `gh pr view --json ...` → modelo do indicador da sidebar.
// As formas abaixo são as que o gh 2.97 devolve (conferidas à mão contra um repo real
// e o cli/cli em 30/10; nomes trocados por genéricos).

const checkRun = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  __typename: 'CheckRun',
  name: 'build (windows-latest)',
  workflowName: 'CI',
  status: 'COMPLETED',
  conclusion: 'SUCCESS',
  detailsUrl: 'https://github.com/o/r/actions/runs/1/job/2',
  ...over,
});

const ghPr = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  number: 142,
  title: 'feat: painel de PRs',
  url: 'https://github.com/acme/atlas/pull/142',
  state: 'OPEN',
  isDraft: false,
  headRefName: 'feature/painel-prs-sidebar',
  statusCheckRollup: [],
  reviewDecision: '',
  latestReviews: [],
  ...over,
});

describe('parseCheck — um item de statusCheckRollup', () => {
  it('CheckRun concluído com sucesso → pass, nome "<workflow> / <job>", link do job', () => {
    expect(parseCheck(checkRun())).toEqual({ name: 'CI / build (windows-latest)', state: 'pass', url: 'https://github.com/o/r/actions/runs/1/job/2' });
  });

  it('CheckRun não concluído (QUEUED/IN_PROGRESS/WAITING) → pending', () => {
    for (const status of ['QUEUED', 'IN_PROGRESS', 'WAITING', 'PENDING', 'REQUESTED']) {
      expect(parseCheck(checkRun({ status, conclusion: '' }))?.state).toBe('pending');
    }
  });

  it('CheckRun com conclusão de falha → fail', () => {
    for (const conclusion of ['FAILURE', 'TIMED_OUT', 'CANCELLED', 'ACTION_REQUIRED', 'STARTUP_FAILURE']) {
      expect(parseCheck(checkRun({ conclusion }))?.state).toBe('fail');
    }
  });

  it('CheckRun pulado/neutro → skipped (não pesa no agregado)', () => {
    for (const conclusion of ['SKIPPED', 'NEUTRAL', 'STALE']) {
      expect(parseCheck(checkRun({ conclusion }))?.state).toBe('skipped');
    }
  });

  it('CheckRun sem workflow → só o nome do job', () => {
    expect(parseCheck(checkRun({ workflowName: '' }))?.name).toBe('build (windows-latest)');
  });

  it('StatusContext: SUCCESS/FAILURE/ERROR/PENDING/EXPECTED', () => {
    const ctx = (state: string) => parseCheck({ __typename: 'StatusContext', context: 'ci/legacy', state, targetUrl: 'https://ci.example/1' });
    expect(ctx('SUCCESS')).toEqual({ name: 'ci/legacy', state: 'pass', url: 'https://ci.example/1' });
    expect(ctx('FAILURE')?.state).toBe('fail');
    expect(ctx('ERROR')?.state).toBe('fail');
    expect(ctx('PENDING')?.state).toBe('pending');
    expect(ctx('EXPECTED')?.state).toBe('pending');
  });

  it('link que não é https vira null (o painel não abre esquema estranho)', () => {
    expect(parseCheck(checkRun({ detailsUrl: 'javascript:alert(1)' }))?.url).toBeNull();
    expect(parseCheck(checkRun({ detailsUrl: 'http://insecure' }))?.url).toBeNull();
  });

  it('forma desconhecida → null (some da lista, não vira check inventado)', () => {
    expect(parseCheck(null)).toBeNull();
    expect(parseCheck({ __typename: 'Outro', name: 'x' })).toBeNull();
    expect(parseCheck(checkRun({ name: 42 }))).toBeNull();
    expect(parseCheck(checkRun({ conclusion: 'ALGO_NOVO' }))).toBeNull();
  });
});

describe('aggregateChecks — vermelho > amarelo > verde', () => {
  const c = (state: PrCheck['state']): PrCheck => ({ name: state, state, url: null });

  it('qualquer falha → fail, mesmo com outros rodando', () => {
    expect(aggregateChecks([c('pass'), c('pending'), c('fail')])).toBe('fail');
  });
  it('sem falha, algum rodando → pending', () => {
    expect(aggregateChecks([c('pass'), c('pending')])).toBe('pending');
  });
  it('só passou/pulado → pass', () => {
    expect(aggregateChecks([c('pass'), c('skipped')])).toBe('pass');
    expect(aggregateChecks([c('skipped')])).toBe('pass');
  });
  it('sem check → none', () => {
    expect(aggregateChecks([])).toBe('none');
  });
});

describe('reviewSignal — decisão do GitHub, senão os reviews dados', () => {
  it('reviewDecision manda quando existe', () => {
    expect(reviewSignal('CHANGES_REQUESTED', [])).toBe('changes-requested');
    expect(reviewSignal('APPROVED', [])).toBe('approved');
    expect(reviewSignal('REVIEW_REQUIRED', [])).toBe('review-required');
  });
  it('sem decisão (repo sem review obrigatório): mudança pedida vence aprovação', () => {
    expect(
      reviewSignal('', [
        { author: 'a', state: 'APPROVED' },
        { author: 'b', state: 'CHANGES_REQUESTED' },
      ]),
    ).toBe('changes-requested');
    expect(reviewSignal('', [{ author: 'a', state: 'APPROVED' }])).toBe('approved');
    expect(reviewSignal('', [{ author: 'a', state: 'COMMENTED' }])).toBe('none');
    expect(reviewSignal(undefined, [])).toBe('none');
  });
});

describe('parsePullRequestStatus — saída de gh pr view → indicador', () => {
  it('PR aberto na forma real do gh 2.97 (sem checks, sem review) → none/none', () => {
    const real = {
      headRefName: 'docs/pda-pool-contas',
      isDraft: false,
      latestReviews: [],
      number: 116,
      reviewDecision: '',
      state: 'OPEN',
      statusCheckRollup: [],
      title: 'docs: PDA pool-contas (organização do pool e sincronização entre PCs)',
      url: 'https://github.com/acme/atlas/pull/116',
    };
    expect(parsePullRequestStatus(real)).toEqual({
      number: 116,
      title: 'docs: PDA pool-contas (organização do pool e sincronização entre PCs)',
      url: 'https://github.com/acme/atlas/pull/116',
      isDraft: false,
      headRefName: 'docs/pda-pool-contas',
      checks: [],
      rollup: 'none',
      review: 'none',
      reviews: [],
      unresolvedThreads: null,
    });
  });

  it('checks e reviews viram o agregado e o sinal', () => {
    const pr = parsePullRequestStatus(
      ghPr({
        statusCheckRollup: [checkRun(), checkRun({ name: 'lint', conclusion: 'FAILURE' })],
        latestReviews: [{ author: { login: 'revisora' }, state: 'CHANGES_REQUESTED', body: 'arruma' }],
      }),
    );
    expect(pr?.rollup).toBe('fail');
    expect(pr?.review).toBe('changes-requested');
    expect(pr?.reviews).toEqual([{ author: 'revisora', state: 'CHANGES_REQUESTED' }]);
    expect(pr?.checks.map((check) => check.state)).toEqual(['pass', 'fail']);
  });

  it('PR mergeado ou fechado → null (a branch ficou para trás — ex.: `staging`, cujo PR antigo já foi mergeado)', () => {
    expect(parsePullRequestStatus(ghPr({ state: 'MERGED' }))).toBeNull();
    expect(parsePullRequestStatus(ghPr({ state: 'CLOSED' }))).toBeNull();
  });

  it('rascunho fica marcado', () => {
    expect(parsePullRequestStatus(ghPr({ isDraft: true }))?.isDraft).toBe(true);
  });

  it('forma estranha → null, nunca lança', () => {
    expect(parsePullRequestStatus(undefined)).toBeNull();
    expect(parsePullRequestStatus([])).toBeNull();
    expect(parsePullRequestStatus(ghPr({ number: '142' }))).toBeNull();
    expect(parsePullRequestStatus(ghPr({ url: 'file:///etc/passwd' }))).toBeNull();
  });

  it('statusCheckRollup ausente → sem checks (não quebra)', () => {
    expect(parsePullRequestStatus(ghPr({ statusCheckRollup: undefined }))?.rollup).toBe('none');
  });
});

describe('conversas não resolvidas (consulta GraphQL fixa)', () => {
  it('conta só as abertas', () => {
    const raw = { data: { repository: { pullRequest: { reviewThreads: { nodes: [{ isResolved: false }, { isResolved: true }, { isResolved: false }] } } } } };
    expect(parseUnresolvedThreadCount(raw)).toBe(2);
  });
  it('resposta real sem conversas → 0', () => {
    expect(parseUnresolvedThreadCount({ data: { repository: { pullRequest: { reviewThreads: { nodes: [] } } } } })).toBe(0);
  });
  it('erro do GraphQL / forma estranha → null (não "0" inventado)', () => {
    expect(parseUnresolvedThreadCount({ errors: [{ message: 'x' }] })).toBeNull();
    expect(parseUnresolvedThreadCount({ data: { repository: null } })).toBeNull();
  });
});

describe('repoFromPullRequestUrl', () => {
  it('extrai dono e nome', () => {
    expect(repoFromPullRequestUrl('https://github.com/acme/atlas/pull/142')).toEqual({ owner: 'acme', name: 'atlas' });
  });
  it('recusa URL que não é de PR ou com parte que viraria flag', () => {
    expect(repoFromPullRequestUrl('https://github.com/acme/atlas/issues/1')).toBeNull();
    expect(repoFromPullRequestUrl('https://github.com/-x/atlas/pull/1')).toBeNull();
    expect(repoFromPullRequestUrl('não é url')).toBeNull();
  });
});

describe('needsFix / shouldPoll', () => {
  const base = parsePullRequestStatus(ghPr()) as PullRequestStatus;

  it('consertar só com check vermelho ou mudança pedida', () => {
    expect(needsFix({ ...base, rollup: 'fail' })).toBe(true);
    expect(needsFix({ ...base, review: 'changes-requested' })).toBe(true);
    expect(needsFix({ ...base, rollup: 'pending', review: 'review-required' })).toBe(false);
    expect(needsFix({ ...base, rollup: 'pass', review: 'approved' })).toBe(false);
  });

  it('polling só com check rodando', () => {
    expect(shouldPoll({ ...base, rollup: 'pending' })).toBe(true);
    expect(shouldPoll({ ...base, rollup: 'fail' })).toBe(false);
    expect(shouldPoll({ ...base, rollup: 'pass' })).toBe(false);
    expect(shouldPoll(null)).toBe(false);
  });
});

describe('buildFixPrompt — o texto que vai para a sessão', () => {
  const pr = parsePullRequestStatus(
    ghPr({
      statusCheckRollup: [
        checkRun(),
        checkRun({ name: 'vitest', conclusion: 'FAILURE', detailsUrl: 'https://github.com/o/r/actions/runs/9/job/10' }),
        checkRun({ __typename: 'StatusContext', context: 'ci/legacy', state: 'ERROR', targetUrl: undefined }),
      ],
      latestReviews: [{ author: { login: 'revisora' }, state: 'CHANGES_REQUESTED' }],
    }),
  ) as PullRequestStatus;

  it('nomeia o PR, cada check vermelho com o link, quem pediu mudanças, as conversas e o pedido', () => {
    expect(buildFixPrompt({ ...pr, unresolvedThreads: 3 })).toBe(
      [
        'O PR #142 (feat: painel de PRs) precisa de conserto: https://github.com/acme/atlas/pull/142',
        '',
        'Checks que falharam:',
        '- CI / vitest — https://github.com/o/r/actions/runs/9/job/10',
        '- ci/legacy',
        '',
        'Mudanças pedidas no review (revisora).',
        'Há 3 conversas não resolvidas no PR.',
        '',
        'Investigue a causa (use o `gh`: `gh pr checks`, `gh run view --log-failed`, `gh pr view --comments`), corrija nesta branch, rode os testes e me diga o que mudou antes de fazer push.',
      ].join('\n'),
    );
  });

  it('só mudanças pedidas, sem check vermelho nem conversa lida: sem as seções vazias', () => {
    const text = buildFixPrompt({ ...pr, checks: [], rollup: 'none', unresolvedThreads: null });
    expect(text).not.toContain('Checks que falharam');
    expect(text).not.toContain('conversa');
    expect(text).toContain('Mudanças pedidas no review (revisora).');
  });

  it('uma conversa só → singular', () => {
    expect(buildFixPrompt({ ...pr, unresolvedThreads: 1 })).toContain('Há 1 conversa não resolvida no PR.');
  });
});
