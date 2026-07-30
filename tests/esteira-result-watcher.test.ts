import { mkdirSync, mkdtempSync, promises as fs, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { watchEsteiraResult, type EsteiraResultEvent, type EsteiraResultWatcherHandle } from '../src/main/esteira-result-watcher';

// T308 (003-modo-dev, Batch A) — watcher de arquivamento por manifesto
// (CA-6): mesmo padrão de `transcript-watcher.ts` — vigia o DIRETÓRIO
// `handoffs/…` (nunca o arquivo), `fs.watch` REAL em tmpdir (o que este
// módulo pode errar é justamente o que um mock esconderia). Raiz v3 (CA-4):
// `<esteiraStateRoot>/<repoSlug>/<cardId>/<fase>/handoffs/…`, fora do repo.

const RETRY_MS = 40;
const REPO_SLUG = 'donel-dev';

async function waitFor(predicate: () => boolean, timeoutMs = 3_000): Promise<void> {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) throw new Error(`waitFor: condição não satisfeita em ${timeoutMs} ms`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function settle(ms = RETRY_MS * 4): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function resultManifest(status: string): string {
  return JSON.stringify({
    card_id: 'card-1',
    fase: 'plano',
    status,
    started_at: 'x',
    finished_at: 'x',
    executor: 'claude',
    model: 'opus',
    effort: 'high',
    outputs: {},
  });
}

describe('watchEsteiraResult', () => {
  let stateRoot: string;
  let handoffsDir: string;
  let events: EsteiraResultEvent[];
  let handle: EsteiraResultWatcherHandle | undefined;

  beforeEach(() => {
    stateRoot = mkdtempSync(join(tmpdir(), 'donel-dev-esteira-result-watcher-'));
    handoffsDir = join(stateRoot, REPO_SLUG, 'card-1', 'plano', 'handoffs');
    events = [];
  });

  afterEach(() => {
    handle?.dispose();
    rmSync(stateRoot, { recursive: true, force: true });
  });

  it('manifesto aparecendo com status success dispara o evento', async () => {
    mkdirSync(handoffsDir, { recursive: true });
    handle = watchEsteiraResult({
      esteiraStateRoot: stateRoot,
      repoSlug: REPO_SLUG,
      fase: 'plano',
      cardId: 'card-1',
      onArchived: (event) => events.push(event),
      retryMs: RETRY_MS,
    });

    await fs.writeFile(join(handoffsDir, 'plano-result.json'), resultManifest('success'));
    await waitFor(() => events.length === 1);

    expect(events[0]).toEqual({
      cardId: 'card-1',
      fase: 'plano',
      faseNum: undefined,
      manifestPath: join(handoffsDir, 'plano-result.json'),
    });
  });

  it("status diferente de success NÃO dispara (etapa que falhou fica aberta, CA-6)", async () => {
    mkdirSync(handoffsDir, { recursive: true });
    handle = watchEsteiraResult({
      esteiraStateRoot: stateRoot,
      repoSlug: REPO_SLUG,
      fase: 'plano',
      cardId: 'card-1',
      onArchived: (event) => events.push(event),
      retryMs: RETRY_MS,
    });

    await fs.writeFile(join(handoffsDir, 'plano-result.json'), resultManifest('error'));
    await settle();

    expect(events).toEqual([]);
  });

  it('diretório inexistente no boot faz retry limitado, nunca lança', async () => {
    expect(() => {
      handle = watchEsteiraResult({
        esteiraStateRoot: stateRoot,
        repoSlug: REPO_SLUG,
        fase: 'plano',
        cardId: 'card-1',
        onArchived: (event) => events.push(event),
        retryMs: RETRY_MS,
        maxRetries: 2,
      });
    }).not.toThrow();

    // Diretório nasce DEPOIS do boot — o retry tem de achá-lo.
    mkdirSync(handoffsDir, { recursive: true });
    await fs.writeFile(join(handoffsDir, 'plano-result.json'), resultManifest('success'));
    await waitFor(() => events.length === 1);

    expect(events[0].cardId).toBe('card-1');
  });

  it('dois manifestos da mesma fase (reprocessamento) não duplicam evento', async () => {
    mkdirSync(handoffsDir, { recursive: true });
    handle = watchEsteiraResult({
      esteiraStateRoot: stateRoot,
      repoSlug: REPO_SLUG,
      fase: 'plano',
      cardId: 'card-1',
      onArchived: (event) => events.push(event),
      retryMs: RETRY_MS,
    });

    await fs.writeFile(join(handoffsDir, 'plano-result.json'), resultManifest('success'));
    await waitFor(() => events.length === 1);

    // Reescreve o MESMO manifesto (ex.: retomada que regrava status success de novo).
    await fs.writeFile(join(handoffsDir, 'plano-result.json'), resultManifest('success'));
    await settle();

    expect(events).toHaveLength(1);
  });

  it('dispose() fecha o watcher — escrita depois não emite mais nada', async () => {
    mkdirSync(handoffsDir, { recursive: true });
    handle = watchEsteiraResult({
      esteiraStateRoot: stateRoot,
      repoSlug: REPO_SLUG,
      fase: 'plano',
      cardId: 'card-1',
      onArchived: (event) => events.push(event),
      retryMs: RETRY_MS,
    });

    handle.dispose();
    await fs.writeFile(join(handoffsDir, 'plano-result.json'), resultManifest('success'));
    await settle();

    expect(events).toEqual([]);
  });

  // CA-4/D.0-bis — implementar/validar arquivam sob handoffs/fase-<n>/.
  describe('implementar/validar — arquivamento por fase do plano', () => {
    it('com faseNum, vigia handoffs/fase-<n>/ e dispara com o faseNum ecoado', async () => {
      const implHandoffsDir = join(stateRoot, REPO_SLUG, 'card-1', 'implementar', 'handoffs', 'fase-1');
      mkdirSync(implHandoffsDir, { recursive: true });
      handle = watchEsteiraResult({
        esteiraStateRoot: stateRoot,
        repoSlug: REPO_SLUG,
        fase: 'implementar',
        cardId: 'card-1',
        faseNum: 1,
        onArchived: (event) => events.push(event),
        retryMs: RETRY_MS,
      });

      await fs.writeFile(
        join(implHandoffsDir, 'implementar-result.json'),
        JSON.stringify({
          card_id: 'card-1',
          fase: 'implementar',
          status: 'success',
          started_at: 'x',
          finished_at: 'x',
          executor: 'claude',
          model: 'opus',
          effort: 'high',
          outputs: {},
        }),
      );
      await waitFor(() => events.length === 1);

      expect(events[0].faseNum).toBe(1);
      expect(events[0].manifestPath).toBe(join(implHandoffsDir, 'implementar-result.json'));
    });

    it('sem faseNum, fica inerte — nunca observa fase-1 por chute, dispose() é no-op', async () => {
      const implHandoffsDir = join(stateRoot, REPO_SLUG, 'card-1', 'implementar', 'handoffs', 'fase-1');
      mkdirSync(implHandoffsDir, { recursive: true });

      handle = watchEsteiraResult({
        esteiraStateRoot: stateRoot,
        repoSlug: REPO_SLUG,
        fase: 'implementar',
        cardId: 'card-1',
        onArchived: (event) => events.push(event),
        retryMs: RETRY_MS,
      });

      await fs.writeFile(
        join(implHandoffsDir, 'implementar-result.json'),
        JSON.stringify({ card_id: 'card-1', fase: 'implementar', status: 'success', outputs: {} }),
      );
      await settle();

      expect(events).toEqual([]);
      expect(() => handle?.dispose()).not.toThrow();
    });
  });
});
