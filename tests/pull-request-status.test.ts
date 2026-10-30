import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createPullRequestStatusService,
  createSystemPullRequestStatusDeps,
  openPullRequestUrl,
  PR_FIXTURE_ENV_VAR,
  PR_STATUS_TTL_MS,
  type PullRequestStatusDeps,
} from '../src/main/pull-request-status';
import type { PullRequestStatus } from '../src/shared/pullRequestStatus';

// B3 — quando o main lê o `gh` para a sidebar: cache curto por pasta+branch
// (inclusive do "sem PR"), uma leitura em voo por chave, `gh` ausente = nada,
// conversas só no detalhe.

const PR: PullRequestStatus = {
  number: 142,
  title: 'feat: painel',
  url: 'https://github.com/acme/atlas/pull/142',
  isDraft: false,
  headRefName: 'feature/x',
  checks: [],
  rollup: 'pending',
  review: 'none',
  reviews: [],
  unresolvedThreads: null,
};

function deps(over: Partial<PullRequestStatusDeps> = {}): PullRequestStatusDeps & { clock: { now: number } } {
  const clock = { now: 1_000 };
  return {
    clock,
    gitBranch: vi.fn(async () => 'feature/x'),
    ghAvailable: vi.fn(async () => true),
    readPullRequest: vi.fn(async () => PR),
    readUnresolvedThreads: vi.fn(async () => 2),
    now: () => clock.now,
    ...over,
  };
}

describe('createPullRequestStatusService', () => {
  it('pasta numa branch com PR aberto → o PR, sem ler as conversas', async () => {
    const d = deps();
    const service = createPullRequestStatusService(d);
    await expect(service.get('/proj')).resolves.toEqual({ pr: PR });
    expect(d.readPullRequest).toHaveBeenCalledWith('/proj', 'feature/x');
    expect(d.readUnresolvedThreads).not.toHaveBeenCalled();
  });

  it('details: também conta as conversas não resolvidas (repo tirado da URL do PR)', async () => {
    const d = deps();
    const service = createPullRequestStatusService(d);
    await expect(service.get('/proj', { details: true })).resolves.toEqual({ pr: { ...PR, unresolvedThreads: 2 } });
    expect(d.readUnresolvedThreads).toHaveBeenCalledWith({ owner: 'acme', name: 'atlas' }, 142);
  });

  it('sem branch (não é git / HEAD destacado) → nada, e o gh nem é consultado', async () => {
    const d = deps({ gitBranch: vi.fn(async () => null) });
    const service = createPullRequestStatusService(d);
    await expect(service.get('/proj')).resolves.toEqual({ pr: null });
    expect(d.ghAvailable).not.toHaveBeenCalled();
    expect(d.readPullRequest).not.toHaveBeenCalled();
  });

  it('gh ausente/deslogado → nada aparece e nada spawna', async () => {
    const d = deps({ ghAvailable: vi.fn(async () => false) });
    const service = createPullRequestStatusService(d);
    await expect(service.get('/proj')).resolves.toEqual({ pr: null });
    expect(d.readPullRequest).not.toHaveBeenCalled();
  });

  it('caminho que não é string → nada', async () => {
    const d = deps();
    await expect(createPullRequestStatusService(d).get(42)).resolves.toEqual({ pr: null });
    expect(d.gitBranch).not.toHaveBeenCalled();
  });

  it('cache de 30 s por pasta+branch: o foco repetido da janela não respawna; depois do TTL, relê', async () => {
    const d = deps();
    const service = createPullRequestStatusService(d);
    await service.get('/proj');
    d.clock.now += PR_STATUS_TTL_MS - 1;
    await service.get('/proj');
    expect(d.readPullRequest).toHaveBeenCalledTimes(1);
    d.clock.now += 2;
    await service.get('/proj');
    expect(d.readPullRequest).toHaveBeenCalledTimes(2);
  });

  it('o "sem PR" também fica no cache (branch padrão não martela o gh)', async () => {
    const d = deps({ readPullRequest: vi.fn(async () => null) });
    const service = createPullRequestStatusService(d);
    await service.get('/proj');
    await service.get('/proj');
    expect(d.readPullRequest).toHaveBeenCalledTimes(1);
  });

  it('trocou de branch → chave nova, lê de novo na hora', async () => {
    let branch = 'feature/x';
    const d = deps({ gitBranch: vi.fn(async () => branch) });
    const service = createPullRequestStatusService(d);
    await service.get('/proj');
    branch = 'feature/y';
    await service.get('/proj');
    expect(d.readPullRequest).toHaveBeenLastCalledWith('/proj', 'feature/y');
    expect(d.readPullRequest).toHaveBeenCalledTimes(2);
  });

  it('duas linhas da mesma pasta pedindo juntas → uma leitura só', async () => {
    const d = deps();
    const service = createPullRequestStatusService(d);
    await Promise.all([service.get('/proj'), service.get('/proj'), service.get('/proj')]);
    expect(d.readPullRequest).toHaveBeenCalledTimes(1);
  });

  it('leitor que lança → null, nunca propaga', async () => {
    const d = deps({ readPullRequest: vi.fn(async () => Promise.reject(new Error('boom'))) });
    await expect(createPullRequestStatusService(d).get('/proj')).resolves.toEqual({ pr: null });
  });
});

describe('openPullRequestUrl — só https sai do app', () => {
  it('abre https', async () => {
    const open = vi.fn(async () => undefined);
    await expect(openPullRequestUrl('https://github.com/o/r/pull/1', open)).resolves.toBe(true);
    expect(open).toHaveBeenCalledWith('https://github.com/o/r/pull/1');
  });

  it('recusa outros esquemas e não-string sem chamar o shell', async () => {
    const open = vi.fn(async () => undefined);
    for (const url of ['http://x', 'file:///c:/windows', 'javascript:alert(1)', 42, '']) await expect(openPullRequestUrl(url, open)).resolves.toBe(false);
    expect(open).not.toHaveBeenCalled();
  });
});

describe('seam de teste DONEL_GH_PR_FIXTURE', () => {
  let dir: string | null = null;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = null;
  });

  it('lê PR e conversas do JSON pelos mesmos parsers, sem gh', async () => {
    dir = mkdtempSync(join(tmpdir(), 'donel-pr-fixture-'));
    const file = join(dir, 'pr.json');
    writeFileSync(
      file,
      JSON.stringify({
        pullRequest: { number: 9, title: 't', url: 'https://github.com/o/r/pull/9', state: 'OPEN', statusCheckRollup: [], latestReviews: [], reviewDecision: '' },
        reviewThreads: { data: { repository: { pullRequest: { reviewThreads: { nodes: [{ isResolved: false }] } } } } },
      }),
    );
    const system = createSystemPullRequestStatusDeps(async () => 'feature/x', { [PR_FIXTURE_ENV_VAR]: file });
    const result = await createPullRequestStatusService(system).get('/proj', { details: true });
    expect(result.pr?.number).toBe(9);
    expect(result.pr?.unresolvedThreads).toBe(1);
  });
});
