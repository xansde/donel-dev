import { describe, expect, it } from 'vitest';
import { resolveCardRepo, resolveCardRepos, type CardRepoResolverIoDeps } from '../src/main/cardRepoResolver';
import type { RepoEntry } from '../src/shared/projectBinding';

// Issue #34 (P0) — "o do Dalton carregou no projeto spotsys". `spotsys` e
// `dalton` compartilham o MESMO board (`workspaceId`/`teamId`) em
// `repos.json`, e o app resolvia sempre para o `default_repo` (spotsys). A
// fixture abaixo reproduz exatamente esse caso real.

const ESTEIRA_STATE_ROOT = 'C:\\Users\\fake\\.claude\\esteira-state';
const CARD_ID = 'cms38m5gf003r01mjvpz7msth';

const SHARED_BOARD = { workspaceId: 'cmnp2fv5p000304l8fvlbg35q', teamId: 'cmovgnnsz01em01p6zlchb1zs' };

const spotsys: RepoEntry = { repoSlug: 'spotsys', repoPath: 'C:\\Users\\xansd\\seazone\\spotsys', ...SHARED_BOARD };
const dalton: RepoEntry = { repoSlug: 'dalton', repoPath: 'C:\\Users\\xansd\\seazone\\dalton', ...SHARED_BOARD };
const soloRepo: RepoEntry = {
  repoSlug: 'donel-dev',
  repoPath: 'C:\\Users\\xansd\\seazone\\donel-dev',
  workspaceId: 'ws-solo',
  teamId: 'team-solo',
};

function fakeIo(existingPaths: readonly string[]): CardRepoResolverIoDeps {
  const set = new Set(existingPaths);
  return { existsSync: (path) => set.has(path) };
}

function v3TraceDir(repoSlug: string, cardId: string): string {
  return `${ESTEIRA_STATE_ROOT}\\${repoSlug}\\${cardId}`;
}

function legacyCtxPath(repoPath: string, cardId: string): string {
  return `${repoPath}\\.esteira\\discovery\\${cardId}-ctx.md`;
}

describe('resolveCardRepo (issue #34)', () => {
  it('card com rastro em esteira-state devolve o repo daquele rastro, mesmo com outro repo em foco', () => {
    const io = fakeIo([v3TraceDir('dalton', CARD_ID)]);

    const result = resolveCardRepo(
      { cardId: CARD_ID, esteiraStateRoot: ESTEIRA_STATE_ROOT, repos: [spotsys, dalton], boardRepoPath: spotsys.repoPath },
      io,
    );

    expect(result).toEqual({ kind: 'resolved', repoPath: dalton.repoPath, repoSlug: 'dalton' });
  });

  it('card com rastro só no .esteira/ legado de um repo devolve esse repo', () => {
    const io = fakeIo([legacyCtxPath(dalton.repoPath, CARD_ID)]);

    const result = resolveCardRepo(
      { cardId: CARD_ID, esteiraStateRoot: ESTEIRA_STATE_ROOT, repos: [spotsys, dalton], boardRepoPath: spotsys.repoPath },
      io,
    );

    expect(result).toEqual({ kind: 'resolved', repoPath: dalton.repoPath, repoSlug: 'dalton' });
  });

  it('fixture do caso real: dois repos no MESMO board, card com estado só no segundo — resolve para o segundo, nunca para o default_repo', () => {
    // `spotsys` é o `default_repo`/board em foco; o card só tem rastro em `dalton`.
    const io = fakeIo([v3TraceDir('dalton', CARD_ID)]);

    const result = resolveCardRepo(
      { cardId: CARD_ID, esteiraStateRoot: ESTEIRA_STATE_ROOT, repos: [spotsys, dalton], boardRepoPath: spotsys.repoPath },
      io,
    );

    expect(result.kind).toBe('resolved');
    expect(result).toEqual({ kind: 'resolved', repoPath: dalton.repoPath, repoSlug: 'dalton' });
    expect((result as { repoPath: string }).repoPath).not.toBe(spotsys.repoPath);
  });

  it('sem rastro em disco e board ambíguo (2+ repos) devolve "precisa escolher", nunca um repo qualquer', () => {
    const io = fakeIo([]);

    const result = resolveCardRepo(
      { cardId: CARD_ID, esteiraStateRoot: ESTEIRA_STATE_ROOT, repos: [spotsys, dalton], boardRepoPath: spotsys.repoPath },
      io,
    );

    expect(result.kind).toBe('ambiguous');
    if (result.kind === 'ambiguous') {
      expect(result.candidates).toEqual(
        expect.arrayContaining([
          { repoSlug: 'spotsys', repoPath: spotsys.repoPath },
          { repoSlug: 'dalton', repoPath: dalton.repoPath },
        ]),
      );
      expect(result.candidates).toHaveLength(2);
    }
  });

  it('sem rastro em disco e board com 1 repo só resolve para esse repo', () => {
    const io = fakeIo([]);

    const result = resolveCardRepo(
      { cardId: CARD_ID, esteiraStateRoot: ESTEIRA_STATE_ROOT, repos: [soloRepo, spotsys, dalton], boardRepoPath: soloRepo.repoPath },
      io,
    );

    expect(result).toEqual({ kind: 'resolved', repoPath: soloRepo.repoPath, repoSlug: 'donel-dev' });
  });

  it('sem rastro, sem board selecionado devolve "unknown" — nunca fabrica um repo', () => {
    const io = fakeIo([]);

    const result = resolveCardRepo(
      { cardId: CARD_ID, esteiraStateRoot: ESTEIRA_STATE_ROOT, repos: [spotsys, dalton], boardRepoPath: null },
      io,
    );

    expect(result).toEqual({ kind: 'unknown' });
  });

  it('board selecionado no dropdown sem entrada nenhuma em repos.json (bootstrap "nenhum board configurado") resolve para o próprio dropdown — escolha explícita, nada a desambiguar', () => {
    const io = fakeIo([]);
    const unregisteredPath = 'C:\\Users\\xansd\\seazone\\projeto-novo';

    const result = resolveCardRepo(
      { cardId: CARD_ID, esteiraStateRoot: ESTEIRA_STATE_ROOT, repos: [spotsys, dalton], boardRepoPath: unregisteredPath },
      io,
    );

    expect(result).toEqual({ kind: 'resolved', repoPath: unregisteredPath, repoSlug: 'projeto-novo' });
  });
});

// Issue #38 — a lista da porta de entrada rotulava TODO card com o repo do
// dropdown de board, mesmo quando o card real era de outro repo que
// compartilha o mesmo board (`spotsys`/`dalton`). `resolveCardRepos` é o
// mesmo `resolveCardRepo`, em lote — uma chamada, um mapa `cardId ->
// resolução`, nunca um IPC por linha.
describe('resolveCardRepos (issue #38)', () => {
  const OTHER_CARD_ID = 'cms38m5gf003r01mjvpz7other';

  it('resolve cada card do lote de forma independente, mesmo com rastros em repos diferentes', () => {
    const io = fakeIo([v3TraceDir('dalton', CARD_ID), v3TraceDir('spotsys', OTHER_CARD_ID)]);

    const result = resolveCardRepos(
      {
        cardIds: [CARD_ID, OTHER_CARD_ID],
        esteiraStateRoot: ESTEIRA_STATE_ROOT,
        repos: [spotsys, dalton],
        boardRepoPath: spotsys.repoPath,
      },
      io,
    );

    expect(result).toEqual({
      [CARD_ID]: { kind: 'resolved', repoPath: dalton.repoPath, repoSlug: 'dalton' },
      [OTHER_CARD_ID]: { kind: 'resolved', repoPath: spotsys.repoPath, repoSlug: 'spotsys' },
    });
  });

  it('lista vazia devolve mapa vazio', () => {
    const io = fakeIo([]);

    const result = resolveCardRepos(
      { cardIds: [], esteiraStateRoot: ESTEIRA_STATE_ROOT, repos: [spotsys, dalton], boardRepoPath: spotsys.repoPath },
      io,
    );

    expect(result).toEqual({});
  });

  it('card sem rastro nenhum e board ambíguo entra no mapa como "ambiguous", não desaparece nem quebra os demais', () => {
    const io = fakeIo([v3TraceDir('dalton', OTHER_CARD_ID)]);

    const result = resolveCardRepos(
      {
        cardIds: [CARD_ID, OTHER_CARD_ID],
        esteiraStateRoot: ESTEIRA_STATE_ROOT,
        repos: [spotsys, dalton],
        boardRepoPath: spotsys.repoPath,
      },
      io,
    );

    expect(result[CARD_ID].kind).toBe('ambiguous');
    expect(result[OTHER_CARD_ID]).toEqual({ kind: 'resolved', repoPath: dalton.repoPath, repoSlug: 'dalton' });
  });
});
