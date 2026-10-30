import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  checkGhAvailability,
  GithubReadCache,
  isSafeBranchName,
  PR_STATUS_FIELDS,
  readBranchPullRequestStatus,
  readPhasePullRequestFacts,
  readUnresolvedThreadCount,
  REVIEW_THREADS_QUERY,
  readSpecIssueFacts,
  readSubIssueFacts,
  resetGhAvailabilityCacheForTest,
  runGhReadCommand,
  type GhReadCommand,
} from '../src/main/github-reader';

// CA-3/CA-5/achado-13 (009-modo-dev-v3, lote 4) — TDD do encanamento de
// spawn: allowlist de comandos `gh` (união de literais, mesmo padrão de
// `BoardReadTool`, taskdex-board-client.ts:151), degradação quando `gh`
// falta/falha/não autentica (CA-6), cache de TTL curto. Mesmo mock de
// `node:child_process` de tests/quota-headroom.test.ts (FakeChildProcess) —
// nenhum processo real spawna neste arquivo.

vi.mock('node:child_process', () => ({ spawn: vi.fn() }));

class FakeChildProcess extends EventEmitter {
  readonly stdout = new EventEmitter();
  readonly kill = vi.fn();
}

function jsonChunk(value: unknown): Buffer {
  return Buffer.from(JSON.stringify(value));
}

describe('runGhReadCommand — allowlist e spawn (I/O mockado)', () => {
  afterEach(() => {
    vi.mocked(spawn).mockReset();
  });

  it('issue-view: monta o argv exato (issue view <n> --repo <r> --json <campos>)', async () => {
    const fake = new FakeChildProcess();
    vi.mocked(spawn).mockReturnValue(fake as never);

    const command: GhReadCommand = { kind: 'issue-view', repo: 'owner/repo', number: 88 };
    const promise = runGhReadCommand(command);
    fake.stdout.emit('data', jsonChunk({ number: 88 }));
    fake.emit('close', 0);

    await promise;
    const call = vi.mocked(spawn).mock.calls[0];
    expect(call[0]).toBe('gh');
    expect(call[1]).toEqual(['issue', 'view', '88', '--repo', 'owner/repo', '--json', 'number,title,state,url,labels']);
  });

  it('issue-sub-issues: monta a rota REST via `gh api` (contrato §F.5 — nenhum flag de escrita)', async () => {
    const fake = new FakeChildProcess();
    vi.mocked(spawn).mockReturnValue(fake as never);

    const promise = runGhReadCommand({ kind: 'issue-sub-issues', repo: 'owner/repo', number: 88 });
    fake.stdout.emit('data', jsonChunk([]));
    fake.emit('close', 0);
    await promise;

    const call = vi.mocked(spawn).mock.calls[0];
    expect(call[1]).toEqual(['api', 'repos/owner/repo/issues/88/sub_issues']);
  });

  it('pr-view: monta o argv exato (pr view <n> --repo <r> --json <campos>)', async () => {
    const fake = new FakeChildProcess();
    vi.mocked(spawn).mockReturnValue(fake as never);

    const promise = runGhReadCommand({ kind: 'pr-view', repo: 'owner/repo', number: 12 });
    fake.stdout.emit('data', jsonChunk({ number: 12 }));
    fake.emit('close', 0);
    await promise;

    const call = vi.mocked(spawn).mock.calls[0];
    expect(call[1]).toEqual(['pr', 'view', '12', '--repo', 'owner/repo', '--json', 'number,url,state,mergedAt,baseRefName,labels']);
  });

  it('pr-list-by-head: monta o argv exato (pr list --head <branch> --limit 1)', async () => {
    const fake = new FakeChildProcess();
    vi.mocked(spawn).mockReturnValue(fake as never);

    const promise = runGhReadCommand({ kind: 'pr-list-by-head', repo: 'owner/repo', head: 'esteira/algo' });
    fake.stdout.emit('data', jsonChunk([]));
    fake.emit('close', 0);
    await promise;

    const call = vi.mocked(spawn).mock.calls[0];
    expect(call[1]).toEqual([
      'pr',
      'list',
      '--repo',
      'owner/repo',
      '--head',
      'esteira/algo',
      '--state',
      'all',
      '--json',
      'number,url,state,mergedAt,baseRefName,labels',
      '--limit',
      '1',
    ]);
  });

  it('exit code != 0: ok:false, reason:"failed" (não confia em stdout parcial)', async () => {
    const fake = new FakeChildProcess();
    vi.mocked(spawn).mockReturnValue(fake as never);

    const promise = runGhReadCommand({ kind: 'issue-view', repo: 'o/r', number: 1 });
    fake.emit('close', 1);

    await expect(promise).resolves.toEqual({ ok: false, reason: 'failed' });
  });

  it('spawn lança (ENOENT síncrono — gh não instalado): ok:false, reason:"not_found"', async () => {
    vi.mocked(spawn).mockImplementation(() => {
      throw new Error('ENOENT');
    });

    const result = await runGhReadCommand({ kind: 'issue-view', repo: 'o/r', number: 1 });
    expect(result).toEqual({ ok: false, reason: 'not_found' });
  });

  it("evento 'error' do child (ENOENT assíncrono): ok:false, reason:'not_found'", async () => {
    const fake = new FakeChildProcess();
    vi.mocked(spawn).mockReturnValue(fake as never);

    const promise = runGhReadCommand({ kind: 'issue-view', repo: 'o/r', number: 1 });
    fake.emit('error', new Error('spawn gh ENOENT'));

    await expect(promise).resolves.toEqual({ ok: false, reason: 'not_found' });
  });

  it('sucesso: ok:true com o stdout acumulado', async () => {
    const fake = new FakeChildProcess();
    vi.mocked(spawn).mockReturnValue(fake as never);

    const promise = runGhReadCommand({ kind: 'issue-view', repo: 'o/r', number: 1 });
    fake.stdout.emit('data', Buffer.from('{"a":'));
    fake.stdout.emit('data', Buffer.from('1}'));
    fake.emit('close', 0);

    await expect(promise).resolves.toEqual({ ok: true, stdout: '{"a":1}' });
  });

  describe('timeout (fake timers) — nunca trava o main process', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it('mata o child e resolve ok:false/timeout quando passa do prazo', async () => {
      vi.useFakeTimers();
      const fake = new FakeChildProcess();
      vi.mocked(spawn).mockReturnValue(fake as never);

      const promise = runGhReadCommand({ kind: 'issue-view', repo: 'o/r', number: 1 }, { timeoutMs: 5000 });
      await vi.advanceTimersByTimeAsync(5001);

      await expect(promise).resolves.toEqual({ ok: false, reason: 'timeout' });
      expect(fake.kill).toHaveBeenCalled();
    });

    it('resolve normalmente quando o child fecha ANTES do timeout', async () => {
      vi.useFakeTimers();
      const fake = new FakeChildProcess();
      vi.mocked(spawn).mockReturnValue(fake as never);

      const promise = runGhReadCommand({ kind: 'issue-view', repo: 'o/r', number: 1 }, { timeoutMs: 5000 });
      fake.stdout.emit('data', Buffer.from('{}'));
      fake.emit('close', 0);
      await vi.advanceTimersByTimeAsync(100);

      await expect(promise).resolves.toEqual({ ok: true, stdout: '{}' });
    });
  });
});

describe('checkGhAvailability — degradação (CA-6), memoizada por sessão de app', () => {
  afterEach(() => {
    vi.mocked(spawn).mockReset();
    resetGhAvailabilityCacheForTest();
  });

  it('gh instalado e autenticado (auth status exit 0): available:true', async () => {
    const fake = new FakeChildProcess();
    vi.mocked(spawn).mockReturnValue(fake as never);

    const promise = checkGhAvailability();
    fake.emit('close', 0);

    await expect(promise).resolves.toEqual({ available: true });
    expect(vi.mocked(spawn).mock.calls[0][1]).toEqual(['auth', 'status']);
  });

  it('gh ausente (spawn ENOENT): available:false, reason:not_installed', async () => {
    vi.mocked(spawn).mockImplementation(() => {
      throw new Error('ENOENT');
    });

    await expect(checkGhAvailability()).resolves.toEqual({ available: false, reason: 'not_installed' });
  });

  it('gh instalado mas sem sessão (auth status exit != 0): available:false, reason:not_authenticated', async () => {
    const fake = new FakeChildProcess();
    vi.mocked(spawn).mockReturnValue(fake as never);

    const promise = checkGhAvailability();
    fake.emit('close', 1);

    await expect(promise).resolves.toEqual({ available: false, reason: 'not_authenticated' });
  });

  it('memoizado por sessão: a segunda chamada NÃO spawna de novo', async () => {
    const fake = new FakeChildProcess();
    vi.mocked(spawn).mockReturnValue(fake as never);

    const first = checkGhAvailability();
    fake.emit('close', 0);
    await first;

    await checkGhAvailability();
    expect(vi.mocked(spawn)).toHaveBeenCalledTimes(1);
  });

  it('force:true reprova o cache e spawna de novo', async () => {
    const fakeA = new FakeChildProcess();
    vi.mocked(spawn).mockReturnValueOnce(fakeA as never);
    const first = checkGhAvailability();
    fakeA.emit('close', 0);
    await first;

    const fakeB = new FakeChildProcess();
    vi.mocked(spawn).mockReturnValueOnce(fakeB as never);
    const second = checkGhAvailability({ force: true });
    fakeB.emit('close', 1);

    await expect(second).resolves.toEqual({ available: false, reason: 'not_authenticated' });
    expect(vi.mocked(spawn)).toHaveBeenCalledTimes(2);
  });
});

describe('readSpecIssueFacts / readSubIssueFacts / readPhasePullRequestFacts — composição fato + degradação', () => {
  afterEach(() => {
    vi.mocked(spawn).mockReset();
  });

  it('readSpecIssueFacts: spawn ok + JSON válido -> fato tipado', async () => {
    const fake = new FakeChildProcess();
    vi.mocked(spawn).mockReturnValue(fake as never);

    const promise = readSpecIssueFacts({ repo: 'o/r', number: 88 });
    fake.stdout.emit('data', jsonChunk({ number: 88, title: 't', state: 'OPEN', url: 'u', labels: [] }));
    fake.emit('close', 0);

    await expect(promise).resolves.toEqual({ number: 88, title: 't', state: 'open', url: 'u', labels: [] });
  });

  it('readSpecIssueFacts: gh falha (issue não existe / sem permissão) -> null, nunca lança (CA-6)', async () => {
    const fake = new FakeChildProcess();
    vi.mocked(spawn).mockReturnValue(fake as never);

    const promise = readSpecIssueFacts({ repo: 'o/r', number: 88 });
    fake.emit('close', 1);

    await expect(promise).resolves.toBeNull();
  });

  it('readSpecIssueFacts: stdout não é JSON válido -> null, nunca lança', async () => {
    const fake = new FakeChildProcess();
    vi.mocked(spawn).mockReturnValue(fake as never);

    const promise = readSpecIssueFacts({ repo: 'o/r', number: 88 });
    fake.stdout.emit('data', Buffer.from('não é json'));
    fake.emit('close', 0);

    await expect(promise).resolves.toBeNull();
  });

  it('readSubIssueFacts: gh falha -> [] (degradação por omissão, nunca erro)', async () => {
    const fake = new FakeChildProcess();
    vi.mocked(spawn).mockReturnValue(fake as never);

    const promise = readSubIssueFacts({ repo: 'o/r', number: 88 });
    fake.emit('close', 1);

    await expect(promise).resolves.toEqual([]);
  });

  it('readPhasePullRequestFacts: number conhecido -> usa pr-view (não busca por head)', async () => {
    const fake = new FakeChildProcess();
    vi.mocked(spawn).mockReturnValue(fake as never);

    const promise = readPhasePullRequestFacts({ repo: 'o/r', number: 12 });
    fake.stdout.emit('data', jsonChunk({ number: 12, url: 'u', state: 'OPEN', labels: [] }));
    fake.emit('close', 0);
    await promise;

    expect(vi.mocked(spawn).mock.calls[0][1]).toContain('view');
  });

  it('readPhasePullRequestFacts: sem number, com head -> usa pr-list-by-head', async () => {
    const fake = new FakeChildProcess();
    vi.mocked(spawn).mockReturnValue(fake as never);

    const promise = readPhasePullRequestFacts({ repo: 'o/r', head: 'esteira/algo' });
    fake.stdout.emit('data', jsonChunk([{ number: 12, url: 'u', state: 'OPEN', labels: [] }]));
    fake.emit('close', 0);
    const result = await promise;

    expect(vi.mocked(spawn).mock.calls[0][1]).toContain('list');
    expect(result?.number).toBe(12);
  });

  it('readPhasePullRequestFacts: nem number nem head -> null, nunca spawna (sem endereço, sem fonte)', async () => {
    const result = await readPhasePullRequestFacts({ repo: 'o/r' });
    expect(result).toBeNull();
    expect(spawn).not.toHaveBeenCalled();
  });
});

describe('GithubReadCache — TTL curto (nunca martela a API a cada render)', () => {
  it('devolve undefined pra chave nunca lida', () => {
    const cache = new GithubReadCache(() => 0);
    expect(cache.get('k')).toBeUndefined();
  });

  it('devolve o valor cacheado dentro do TTL', () => {
    let now = 0;
    const cache = new GithubReadCache(() => now);
    cache.set('k', { a: 1 });
    now = 5_000;
    expect(cache.get('k')).toEqual({ a: 1 });
  });

  it('expira depois do TTL (undefined de novo)', () => {
    let now = 0;
    const cache = new GithubReadCache(() => now);
    cache.set('k', { a: 1 });
    now = 60_000;
    expect(cache.get('k')).toBeUndefined();
  });
});

describe('readSpecIssueFacts com cache — segunda leitura não spawna de novo', () => {
  afterEach(() => {
    vi.mocked(spawn).mockReset();
  });

  it('cache hit evita novo spawn', async () => {
    const cache = new GithubReadCache();
    const fake = new FakeChildProcess();
    vi.mocked(spawn).mockReturnValue(fake as never);

    const first = readSpecIssueFacts({ repo: 'o/r', number: 88 }, { cache });
    fake.stdout.emit('data', jsonChunk({ number: 88, title: 't', state: 'OPEN', url: 'u', labels: [] }));
    fake.emit('close', 0);
    await first;

    const second = await readSpecIssueFacts({ repo: 'o/r', number: 88 }, { cache });
    expect(second).toEqual({ number: 88, title: 't', state: 'open', url: 'u', labels: [] });
    expect(vi.mocked(spawn)).toHaveBeenCalledTimes(1);
  });
});

describe('B3 — pr-view-branch e pr-review-threads (painel de PRs da sidebar)', () => {
  afterEach(() => {
    vi.mocked(spawn).mockReset();
  });

  it('pr-view-branch: argv exato, `--` antes da branch e spawn com cwd na pasta do projeto', async () => {
    const fake = new FakeChildProcess();
    vi.mocked(spawn).mockReturnValue(fake as never);

    const promise = runGhReadCommand({ kind: 'pr-view-branch', cwd: '/tmp/proj', branch: 'feature/x' });
    fake.stdout.emit('data', jsonChunk({}));
    fake.emit('close', 0);
    await promise;

    const call = vi.mocked(spawn).mock.calls[0];
    expect(call[0]).toBe('gh');
    expect(call[1]).toEqual(['pr', 'view', '--json', 'number,title,url,state,isDraft,headRefName,statusCheckRollup,reviewDecision,latestReviews', '--', 'feature/x']);
    expect(call[2]).toEqual({ windowsHide: true, cwd: '/tmp/proj' });
    expect(PR_STATUS_FIELDS.split(',')).toContain('statusCheckRollup');
  });

  it('os kinds antigos continuam sem cwd (nada muda para a Esteira)', async () => {
    const fake = new FakeChildProcess();
    vi.mocked(spawn).mockReturnValue(fake as never);
    const promise = runGhReadCommand({ kind: 'pr-view', repo: 'o/r', number: 1 });
    fake.emit('close', 0);
    await promise;
    expect(vi.mocked(spawn).mock.calls[0][2]).toEqual({ windowsHide: true });
  });

  it('pr-review-threads: `gh api graphql` com a consulta fixa; dono/nome crus (-f), número Int (-F)', async () => {
    const fake = new FakeChildProcess();
    vi.mocked(spawn).mockReturnValue(fake as never);

    const promise = runGhReadCommand({ kind: 'pr-review-threads', owner: 'acme', name: 'atlas', number: 142 });
    fake.stdout.emit('data', jsonChunk({}));
    fake.emit('close', 0);
    await promise;

    expect(vi.mocked(spawn).mock.calls[0][1]).toEqual([
      'api',
      'graphql',
      '-f',
      `query=${REVIEW_THREADS_QUERY}`,
      '-f',
      'owner=acme',
      '-f',
      'name=atlas',
      '-F',
      'number=142',
    ]);
  });

  it('a consulta GraphQL é só leitura: começa por `query`, nenhuma `mutation`', () => {
    expect(REVIEW_THREADS_QUERY.startsWith('query(')).toBe(true);
    expect(REVIEW_THREADS_QUERY.toLowerCase()).not.toContain('mutation');
  });

  it('isSafeBranchName: aceita nomes de branch reais, recusa o que viraria flag ou argumento estranho', () => {
    for (const ok of ['main', 'staging', 'feature/painel-prs-sidebar', 'docs/novidades-e-backlog-30-10', 'fix_1.2']) expect(isSafeBranchName(ok)).toBe(true);
    for (const bad of ['', '-x', '--repo=evil/x', 'a b', 'a\nb', 'a\u0001b', 'a~1', 'a^', 'a:b', 'a?', 'a*', 'a[', 'a\\b', 'x'.repeat(256)]) {
      expect(isSafeBranchName(bad)).toBe(false);
    }
  });

  it('readBranchPullRequestStatus: branch insegura nem spawna', async () => {
    await expect(readBranchPullRequestStatus('/tmp/proj', '--help')).resolves.toBeNull();
    expect(vi.mocked(spawn)).not.toHaveBeenCalled();
  });

  it('readBranchPullRequestStatus: PR aberto vira o modelo do indicador', async () => {
    const fake = new FakeChildProcess();
    vi.mocked(spawn).mockReturnValue(fake as never);
    const promise = readBranchPullRequestStatus('/tmp/proj', 'feature/x');
    fake.stdout.emit(
      'data',
      jsonChunk({
        number: 7,
        title: 't',
        url: 'https://github.com/o/r/pull/7',
        state: 'OPEN',
        isDraft: false,
        headRefName: 'feature/x',
        statusCheckRollup: [{ __typename: 'CheckRun', name: 'ci', status: 'IN_PROGRESS', conclusion: '', detailsUrl: 'https://github.com/o/r/actions/runs/1' }],
        reviewDecision: 'REVIEW_REQUIRED',
        latestReviews: [],
      }),
    );
    fake.emit('close', 0);
    const pr = await promise;
    expect(pr?.number).toBe(7);
    expect(pr?.rollup).toBe('pending');
    expect(pr?.review).toBe('review-required');
  });

  it('readBranchPullRequestStatus: branch sem PR (gh sai com 1) → null, nunca lança', async () => {
    const fake = new FakeChildProcess();
    vi.mocked(spawn).mockReturnValue(fake as never);
    const promise = readBranchPullRequestStatus('/tmp/proj', 'main');
    fake.emit('close', 1);
    await expect(promise).resolves.toBeNull();
  });

  it('readUnresolvedThreadCount: conta as abertas; dono inseguro nem spawna', async () => {
    await expect(readUnresolvedThreadCount({ owner: '-x', name: 'r' }, 1)).resolves.toBeNull();
    expect(vi.mocked(spawn)).not.toHaveBeenCalled();

    const fake = new FakeChildProcess();
    vi.mocked(spawn).mockReturnValue(fake as never);
    const promise = readUnresolvedThreadCount({ owner: 'o', name: 'r' }, 7);
    fake.stdout.emit('data', jsonChunk({ data: { repository: { pullRequest: { reviewThreads: { nodes: [{ isResolved: false }, { isResolved: true }] } } } } }));
    fake.emit('close', 0);
    await expect(promise).resolves.toBe(1);
  });
});
