import { existsSync, mkdirSync, mkdtempSync, promises as fs, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  TranscriptWatcherRegistry,
  readTranscriptTail,
  watchTranscript,
  type TranscriptChange,
  type TranscriptWatcherHandle,
  type TranscriptWatcherOptions,
} from '../src/main/transcript-watcher';
import { drainIo, fakeFsWatch, pollUntil, realDelay, trackReads, untilReadsSettle, type ReadTracker } from './helpers/fsWatchWait';

// `fs.watch` switchable: REAL by default, FAKE while `fakeFsWatch.active`. The
// rest of `node:fs` (reads, writes, tmpdir) stays real in both modes.
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  // Dynamic import: a static one is not initialised yet when this hoisted factory runs.
  const { wrapWatch } = await import('./helpers/fsWatchWait');
  return { ...actual, watch: wrapWatch(actual.watch) };
});

// T411 (004-nomear-sessoes, Fase C) — watcher do transcript da sessão VIVA:
// é ele que faz um `/rename` no CLI refletir na aba em menos de 1 s (CA-4).
//
// PEÇA COMPARTILHADA com a 006 (contexto consumido), por decisão registrada nos
// dois planos: as duas features leem o MESMO `.jsonl`, na MESMA cauda, no MESMO
// evento — um watcher só, payload de objeto
// (`{ sessionId, customTitle, contextTokens }`) e emissão quando QUALQUER campo
// muda. Se nascesse emitindo só o título, a 006 reescreveria este arquivo na
// semana seguinte (o `contextTokens` muda a cada turn, sem rename nenhum).
//
// DOIS MECANISMOS, de propósito (docs/testes/proposta.md §3 "Acelerar"):
//
//  - `describe('watchTranscript')` — casos de LÓGICA (debounce, comparação por
//    valor, "não apaga o que já sabe", dispose). Usam um `fs.watch` FALSO
//    (`fakeFsWatch`, disparado à mão) e timers falsos SÓ para o debounce
//    (`setTimeout`/`clearTimeout`). A leitura do `.jsonl` continua REAL em
//    tmpdir; a espera por ela é condicionada (`pollUntil`/`drainIo`), nunca
//    `sleep` fixo. Sem janela de 240 ms nem rajada de 500 ms.
//  - `describe('watchTranscript — fs.watch real')` — o que um falso esconderia:
//    evento do SO chegando de verdade, arquivo/diretório que nasce depois,
//    repoint de ponta a ponta. Poucos casos, todos com `fs.watch` real.

const DEBOUNCE_MS = 40;

/** Alias de leitura: espera condicionada com timers REAIS (serve nos dois mecanismos). */
const waitFor = (predicate: () => boolean, timeoutMs = 3_000): Promise<void> => pollUntil(predicate, timeoutMs);

const titleLine = (title: string, sessionId = 'abc-123'): string =>
  `${JSON.stringify({ type: 'custom-title', customTitle: title, sessionId })}\n`;

const userLine = (text: string): string =>
  `${JSON.stringify({ type: 'user', message: { role: 'user', content: text }, timestamp: new Date().toISOString() })}\n`;

/**
 * Fix #19 — linha real de `/color <nome>` no CLI (forma conferida num
 * transcript do próprio donel-dev, esclarecimento do Alexandre 03/08).
 */
const colorLine = (color: string, sessionId = 'abc-123'): string =>
  `${JSON.stringify({
    type: 'system',
    subtype: 'local_command',
    content: `<local-command-stdout>Session color set to: ${color}</local-command-stdout>`,
    level: 'info',
    sessionId,
  })}\n`;

/**
 * T606 (006) — turno do assistant com `usage`. A forma bate com o transcript
 * REAL conferido em 26/07: a `usage` fica em `message.usage`, não no topo da
 * linha (ver `specs/006-contexto-consumido/medicao-t606.md`).
 */
const assistantUsageLine = (
  { input = 0, cacheRead = 0, cacheCreation = 0, sidechain = false } = {} as {
    input?: number;
    cacheRead?: number;
    cacheCreation?: number;
    sidechain?: boolean;
  },
): string =>
  `${JSON.stringify({
    type: 'assistant',
    isSidechain: sidechain,
    message: {
      role: 'assistant',
      usage: {
        input_tokens: input,
        cache_read_input_tokens: cacheRead,
        cache_creation_input_tokens: cacheCreation,
        output_tokens: 999,
      },
    },
  })}\n`;

/**
 * Issue #21 — resposta do assistente com o id do modelo em `message.model`
 * (forma de `tests/fixtures/chat/*.jsonl`, colhida de transcript real).
 */
const assistantModelLine = (model: string, { sidechain = false } = {}): string =>
  `${JSON.stringify({
    type: 'assistant',
    isSidechain: sidechain,
    message: { role: 'assistant', model, content: [{ type: 'text', text: 'ok' }], usage: { input_tokens: 10, output_tokens: 5 } },
  })}
`;

describe('watchTranscript', () => {
  let dir: string;
  let filePath: string;
  let changes: TranscriptChange[];
  let disposers: (() => void)[];
  let reads: ReadTracker;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'donel-dev-transcript-watcher-'));
    filePath = join(dir, 'abc-123.jsonl');
    changes = [];
    disposers = [];
    reads = trackReads(fs, filePath);
    fakeFsWatch.reset();
    fakeFsWatch.active = true;
    // Só o debounce é falso. `setImmediate`/I/O ficam reais: a leitura do `.jsonl` é de verdade.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  });

  afterEach(() => {
    for (const dispose of disposers) dispose();
    reads.restore();
    vi.useRealTimers();
    fakeFsWatch.reset();
    rmSync(dir, { recursive: true, force: true });
  });

  function start(path = filePath, debounceMs = DEBOUNCE_MS): () => void {
    const watcher = watchTranscript({
      sessionId: 'abc-123',
      filePath: path,
      debounceMs,
      retryMs: 20,
      onChange: (change) => changes.push(change),
    });
    disposers.push(watcher.dispose);
    return watcher.dispose;
  }

  /**
   * Espera a leitura inicial (ou qualquer leitura em voo) TERMINAR — sinal
   * observado (`trackReads`), não palpite de tempo. Substitui o `settle()` de
   * 240 ms; e evita o falso negativo em que um evento cai durante uma leitura
   * (o watcher enfileira uma releitura ao fim da leitura em voo).
   */
  const idle = (): Promise<void> => untilReadsSettle(reads);

  /** O SO avisou que o arquivo mudou: dispara o evento e deixa o debounce correr. */
  async function osNotices(debounceMs = DEBOUNCE_MS): Promise<void> {
    await idle();
    fakeFsWatch.emit('abc-123.jsonl');
    vi.advanceTimersByTime(debounceMs);
    await idle();
  }

  /** Escreve no arquivo e avisa (a dupla que o `fs.watch` real faz sozinho). */
  async function appendAndNotice(text: string): Promise<void> {
    await fs.appendFile(filePath, text, 'utf8');
    await osNotices();
  }

  it('Fix #19 — emite a cor quando o operador roda /color na sessão viva', async () => {
    await fs.writeFile(filePath, userLine('trabalhando'), 'utf8');
    start();
    await idle();
    expect(changes).toEqual([]);

    await appendAndNotice(colorLine('blue'));

    await waitFor(() => changes.length === 1);
    expect(changes[0]).toEqual({ sessionId: 'abc-123', customTitle: null, contextTokens: null, cliColorName: 'blue', model: null });
  });

  it('Fix #19 — troca de cor na mesma sessão (/color blue → /color red) emite a ÚLTIMA', async () => {
    await fs.writeFile(filePath, colorLine('blue'), 'utf8');
    start();
    await waitFor(() => changes.length === 1);
    expect(changes[0].cliColorName).toBe('blue');

    await appendAndNotice(colorLine('red'));
    await waitFor(() => changes.length === 2);
    expect(changes[1].cliColorName).toBe('red');
  });

  it('lê na ABERTURA e emite o título que já existia (sessão retomada com nome antigo)', async () => {
    await fs.writeFile(filePath, `${userLine('oi')}${titleLine('nome de antes')}`, 'utf8');
    start();

    await waitFor(() => changes.length === 1);
    expect(changes[0].customTitle).toBe('nome de antes');
  });

  it('NÃO emite para escrita que não muda nenhum campo (linha comum de conversa)', async () => {
    await fs.writeFile(filePath, titleLine('estável'), 'utf8');
    start();
    await waitFor(() => changes.length === 1);

    await fs.appendFile(filePath, userLine('mais uma mensagem'), 'utf8');
    await osNotices();
    await fs.appendFile(filePath, userLine('e outra'), 'utf8');
    await osNotices();

    expect(changes).toHaveLength(1); // só o da abertura
  });

  it('NÃO emite de novo quando o MESMO título é regravado (comparação por valor)', async () => {
    await fs.writeFile(filePath, titleLine('igual'), 'utf8');
    start();
    await waitFor(() => changes.length === 1);

    await appendAndNotice(titleLine('igual'));

    expect(changes).toHaveLength(1);
  });

  it('emite a cada mudança REAL de título, em sequência', async () => {
    await fs.writeFile(filePath, userLine('trabalho'), 'utf8');
    start();
    await idle();

    await appendAndNotice(titleLine('primeiro'));
    await waitFor(() => changes.length === 1);
    await appendAndNotice(titleLine('segundo'));
    await waitFor(() => changes.length === 2);

    expect(changes.map((c) => c.customTitle)).toEqual(['primeiro', 'segundo']);
  });

  it('junta uma rajada de escritas num emit só (debounce)', async () => {
    await fs.writeFile(filePath, userLine('trabalho'), 'utf8');
    start();
    await idle();

    // Cinco escritas, cada uma com o seu evento, TODAS dentro da janela de
    // debounce (o relógio é falso: nenhuma passagem de tempo entre elas). O
    // valor final é o que vale. Sem orçamento de 500 ms nem flake sob carga.
    for (const title of ['a', 'b', 'c', 'd', 'final']) {
      await fs.appendFile(filePath, titleLine(title), 'utf8');
      fakeFsWatch.emit('abc-123.jsonl');
    }
    await idle();
    expect(changes).toEqual([]); // nada leu ainda: a janela não fechou

    vi.advanceTimersByTime(DEBOUNCE_MS);
    await waitFor(() => changes.length >= 1);
    await idle();
    expect(changes).toHaveLength(1);
    expect(changes[0].customTitle).toBe('final');
  });

  it('dispose() para de emitir — prova de que o handle não vaza', async () => {
    await fs.writeFile(filePath, titleLine('antes do dispose'), 'utf8');
    const dispose = start();
    await waitFor(() => changes.length === 1);

    dispose();
    expect(fakeFsWatch.openCount).toBe(0); // o handle do watch foi fechado
    await fs.appendFile(filePath, titleLine('depois do dispose'), 'utf8');
    // Evento perdido que ainda chegue a um listener já fechado: não pode virar leitura.
    fakeFsWatch.emit('abc-123.jsonl', { includeClosed: true });
    vi.advanceTimersByTime(DEBOUNCE_MS);
    await idle();

    expect(changes).toHaveLength(1);
    expect(changes[0].customTitle).toBe('antes do dispose');
  });

  it('dispose() duas vezes não lança', async () => {
    const dispose = start();
    dispose();
    expect(() => dispose()).not.toThrow();
  });

  // Regra deliberada, igual à do `resolveSessionName`: leitura que não acha
  // título é leitura FALHA (arquivo travado no meio de uma escrita, apagado,
  // cauda ilegível), não um `/rename` que removeu o nome. Sem isso, um erro
  // transitório de I/O faria o nome da aba piscar para o fallback e voltar.
  it('arquivo apagado embaixo do watcher: não lança e NÃO apaga o título já conhecido', async () => {
    await fs.writeFile(filePath, titleLine('vai sumir'), 'utf8');
    start();
    await waitFor(() => changes.length === 1);

    await fs.unlink(filePath);
    await osNotices();

    expect(changes).toHaveLength(1);
    expect(changes[0].customTitle).toBe('vai sumir');
  });

  // ---------------------------------------------------------------------------
  // T606/T608 (006-contexto-consumido) — o MESMO watcher passa a emitir também
  // o `contextTokens`. Estes casos são a prova de que a 006 não precisou de um
  // segundo leitor nem de um segundo canal.
  // ---------------------------------------------------------------------------

  it('emite contextTokens do turno novo (a soma da última usage)', async () => {
    await fs.writeFile(filePath, userLine('primeira pergunta'), 'utf8');
    start();
    await idle();
    expect(changes).toEqual([]);

    await appendAndNotice(assistantUsageLine({ input: 290, cacheCreation: 1505, cacheRead: 132_807 }));

    await waitFor(() => changes.length === 1);
    expect(changes[0]).toEqual({ sessionId: 'abc-123', customTitle: null, contextTokens: 134_602, cliColorName: null, model: null });
  });

  it('turno seguinte que só muda a usage EMITE (regressão que a regra antiga da 004 causaria)', async () => {
    await fs.writeFile(filePath, assistantUsageLine({ input: 100, cacheRead: 50_000 }), 'utf8');
    start();
    await waitFor(() => changes.length === 1);
    expect(changes[0].contextTokens).toBe(50_100);

    // Nenhum rename: só um turno novo, com contexto maior.
    await appendAndNotice(assistantUsageLine({ input: 120, cacheRead: 90_000 }));

    await waitFor(() => changes.length === 2);
    expect(changes[1].contextTokens).toBe(90_120);
    expect(changes[1].customTitle).toBeNull();
  });

  it('a ÚLTIMA usage vence quando há várias na cauda', async () => {
    await fs.writeFile(
      filePath,
      `${assistantUsageLine({ input: 1, cacheRead: 10_000 })}${userLine('segue')}${assistantUsageLine({ input: 2, cacheRead: 200_000 })}`,
      'utf8',
    );
    start();

    await waitFor(() => changes.length === 1);
    expect(changes[0].contextTokens).toBe(200_002);
  });

  it('o % CAI depois de um /compact — a usage nova é menor, e isso não é lacuna de leitura', async () => {
    await fs.writeFile(filePath, assistantUsageLine({ input: 200, cacheRead: 280_000 }), 'utf8');
    start();
    await waitFor(() => changes.length === 1);

    // Pós-compact: o contexto real encolheu, e o número tem de acompanhar.
    await appendAndNotice(assistantUsageLine({ input: 150, cacheRead: 20_000 }));

    await waitFor(() => changes.length === 2);
    expect(changes[1].contextTokens).toBe(20_150);
  });

  // Decisão explícita desta sessão (o handoff da 004 deixou em aberto e exigiu
  // teste): a regra do "não apaga o que já sabe" vale IGUAL para os tokens.
  // Cauda sem `usage` é lacuna de leitura — uma linha gigante de `tool_result`
  // empurrando a usage para fora da janela de 64 KB acontece no meio de 35% das
  // sessões (medicao-t606.md §B) — não é "o contexto voltou a zero". Sem esta
  // regra o `%` piscaria para `—` no meio de um turno longo, exatamente quando
  // o número mais importa.
  it('leitura sem usage NÃO apaga os tokens já conhecidos (nem emite evento novo)', async () => {
    await fs.writeFile(filePath, assistantUsageLine({ input: 100, cacheRead: 130_000 }), 'utf8');
    start();
    await waitFor(() => changes.length === 1);
    expect(changes[0].contextTokens).toBe(130_100);

    // Linha grande o bastante para empurrar a usage fora da cauda de 64 KB.
    await appendAndNotice(userLine('x'.repeat(70 * 1024)));

    expect(changes).toHaveLength(1); // nada novo: o valor conhecido permanece
  });

  it('turno de SUBAGENTE (isSidechain) não é confundido com o contexto da sessão', async () => {
    await fs.writeFile(filePath, assistantUsageLine({ input: 100, cacheRead: 130_000 }), 'utf8');
    start();
    await waitFor(() => changes.length === 1);

    await appendAndNotice(assistantUsageLine({ input: 10, cacheRead: 5_000, sidechain: true }));

    expect(changes).toHaveLength(1);
    expect(changes[0].contextTokens).toBe(130_100);
  });

  it('emite os DOIS campos numa rajada que muda título e usage ao mesmo tempo', async () => {
    await fs.writeFile(filePath, userLine('oi'), 'utf8');
    start();
    await idle();

    await appendAndNotice(`${assistantUsageLine({ input: 10, cacheRead: 60_000 })}${titleLine('com nome')}`);

    await waitFor(() => changes.length === 1);
    expect(changes[0]).toEqual({ sessionId: 'abc-123', customTitle: 'com nome', contextTokens: 60_010, cliColorName: null, model: null });
  });

  // Flake do smoke session-context (T611/T612): um append único seguido de
  // silêncio caía no debounce ENQUANTO a leitura do append anterior ainda
  // estava em voo (disco/CPU sob carga) e era descartado — sem outro evento
  // depois, a StatusBar ficava para sempre no valor velho.
  // ---------------------------------------------------------------------------
  // Issue #21 — QUARTO campo da mesma varredura: o modelo da última resposta.
  // ---------------------------------------------------------------------------

  it('#21 — emite o modelo da última resposta do assistente', async () => {
    await fs.writeFile(filePath, userLine('oi'), 'utf8');
    start();
    await idle();
    expect(changes).toEqual([]);

    await appendAndNotice(assistantModelLine('claude-opus-5-5'));

    await waitFor(() => changes.length === 1);
    expect(changes[0].model).toBe('claude-opus-5-5');
  });

  it('#21 — `/model` no CLI: a resposta seguinte vem com outro id e o watcher EMITE a troca', async () => {
    await fs.writeFile(filePath, assistantModelLine('claude-opus-5-5'), 'utf8');
    start();
    await waitFor(() => changes.length === 1);

    await appendAndNotice(`${userLine('/model haiku')}${assistantModelLine('claude-haiku-4-5-20251001')}`);

    await waitFor(() => changes.length === 2);
    expect(changes[1].model).toBe('claude-haiku-4-5-20251001');
  });

  it('#21 — resposta `<synthetic>` (erro de API) e turno de subagente NÃO trocam o modelo conhecido', async () => {
    await fs.writeFile(filePath, assistantModelLine('claude-opus-5-5'), 'utf8');
    start();
    await waitFor(() => changes.length === 1);

    await appendAndNotice(`${assistantModelLine('<synthetic>')}${assistantModelLine('claude-haiku-5-5', { sidechain: true })}`);

    expect(changes).toHaveLength(1);
    expect(changes[0].model).toBe('claude-opus-5-5');
  });

  it('#21 — leitura sem resposta na cauda NÃO apaga o modelo já conhecido', async () => {
    await fs.writeFile(filePath, assistantModelLine('claude-sonnet-5-5'), 'utf8');
    start();
    await waitFor(() => changes.length === 1);

    await appendAndNotice(userLine('x'.repeat(70 * 1024)));

    expect(changes).toHaveLength(1);
  });

  it('escrita que chega durante uma leitura em voo NÃO se perde: o watcher relê ao terminar', async () => {
    await fs.writeFile(filePath, assistantUsageLine({ input: 1_000 }), 'utf8');
    start();
    await waitFor(() => changes.length === 1);
    expect(changes[0].contextTokens).toBe(1_000);

    // Segura o próximo `open` do arquivo: a leitura do append B fica em voo.
    const originalOpen = fs.open;
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let gated = false;
    (fs as unknown as { open: unknown }).open = async (path: unknown, ...rest: never[]) => {
      if (!gated && path === filePath) {
        gated = true;
        await gate;
      }
      return (originalOpen as (...a: unknown[]) => Promise<unknown>).call(fs, path, ...rest);
    };

    try {
      await fs.appendFile(filePath, assistantUsageLine({ input: 2_000 }), 'utf8');
      fakeFsWatch.emit('abc-123.jsonl');
      vi.advanceTimersByTime(DEBOUNCE_MS);
      await pollUntil(() => gated);

      // Append C chega com a leitura de B em voo; o debounce dele dispara agora.
      await fs.appendFile(filePath, assistantUsageLine({ input: 3_000 }), 'utf8');
      fakeFsWatch.emit('abc-123.jsonl');
      vi.advanceTimersByTime(DEBOUNCE_MS);

      release();
      await waitFor(() => changes.some((change) => change.contextTokens === 3_000));
    } finally {
      (fs as unknown as { open: unknown }).open = originalOpen;
      release();
    }
    expect(changes[changes.length - 1].contextTokens).toBe(3_000);
  });
});

// O que um watch falso esconderia: o evento do SO chegando de verdade, o
// arquivo/diretório que nasce depois (retry real), o repoint de ponta a ponta.
// `fs.watch` REAL em tmpdir e timers reais (debounce curto): `fs.watch` entrega
// pelo loop de I/O do libuv, que timers fake não adiantam.
describe('watchTranscript — fs.watch real', () => {
  let dir: string;
  let filePath: string;
  let changes: TranscriptChange[];
  let disposers: (() => void)[];

  beforeEach(() => {
    fakeFsWatch.reset(); // active=false: `fs.watch` real
    dir = mkdtempSync(join(tmpdir(), 'donel-dev-transcript-watcher-real-'));
    filePath = join(dir, 'abc-123.jsonl');
    changes = [];
    disposers = [];
  });

  afterEach(() => {
    for (const dispose of disposers) dispose();
    rmSync(dir, { recursive: true, force: true });
  });

  function start(path = filePath): () => void {
    const watcher = watchTranscript({
      sessionId: 'abc-123',
      filePath: path,
      debounceMs: DEBOUNCE_MS,
      retryMs: 20,
      onChange: (change) => changes.push(change),
    });
    disposers.push(watcher.dispose);
    return watcher.dispose;
  }

  it('emite o nome novo quando um custom-title é acrescentado à sessão viva (CA-4)', async () => {
    await fs.writeFile(filePath, userLine('trabalhando'), 'utf8');
    start();
    await drainIo(() => fs.stat(dir)); // consome a leitura inicial (sem título, não emite)
    expect(changes).toEqual([]);

    await fs.appendFile(filePath, titleLine('renomeado ao vivo'), 'utf8');

    await waitFor(() => changes.length === 1);
    expect(changes[0]).toEqual({ sessionId: 'abc-123', customTitle: 'renomeado ao vivo', contextTokens: null, cliColorName: null, model: null });
  });

  it('arquivo que ainda NÃO existe na abertura (o CLI cria na 1ª mensagem) — dispara quando ele nasce', async () => {
    expect(existsSync(filePath)).toBe(false);
    start();
    await drainIo(() => fs.stat(dir));
    expect(changes).toEqual([]);

    await fs.writeFile(filePath, `${userLine('primeira mensagem')}${titleLine('nasceu com nome')}`, 'utf8');

    await waitFor(() => changes.length >= 1);
    expect(changes[0].customTitle).toBe('nasceu com nome');
  });

  it('DIRETÓRIO que ainda não existe (projeto que nunca abriu sessão) — dispara quando ele aparece', async () => {
    const nestedDir = join(dir, 'projeto-novo');
    const nestedFile = join(nestedDir, 'abc-123.jsonl');
    start(nestedFile);
    await drainIo(() => fs.stat(dir));
    expect(changes).toEqual([]);

    mkdirSync(nestedDir, { recursive: true });
    await fs.writeFile(nestedFile, titleLine('projeto novo'), 'utf8');

    await waitFor(() => changes.length >= 1, 5_000);
    expect(changes[0].customTitle).toBe('projeto novo');
  });
});

// T606 — a leitura de cauda em si, isolada do watcher: uma passada, dois
// campos. `fs` real em tmpdir (o que pode dar errado aqui é justamente o que um
// mock esconderia: linha cortada, arquivo ausente, arquivo vazio).
describe('readTranscriptTail', () => {
  let dir: string;
  let filePath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'donel-dev-transcript-tail-'));
    filePath = join(dir, 'abc-123.jsonl');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('devolve os dois campos numa leitura só', async () => {
    await fs.writeFile(
      filePath,
      `${userLine('oi')}${assistantUsageLine({ input: 290, cacheCreation: 1505, cacheRead: 132_807 })}${titleLine('nome')}`,
      'utf8',
    );

    await expect(readTranscriptTail(filePath)).resolves.toEqual({ customTitle: 'nome', contextTokens: 134_602, cliColorName: null, model: null });
  });

  it('Fix #19 — devolve os TRÊS campos (título, tokens e cor) numa leitura só', async () => {
    await fs.writeFile(
      filePath,
      `${userLine('oi')}${assistantUsageLine({ input: 290, cacheCreation: 1505, cacheRead: 132_807 })}${titleLine('nome')}${colorLine('purple')}`,
      'utf8',
    );

    await expect(readTranscriptTail(filePath)).resolves.toEqual({
      customTitle: 'nome',
      contextTokens: 134_602,
      cliColorName: 'purple',
      model: null,
    });
  });

  it('#21 — devolve o modelo da ÚLTIMA resposta junto dos outros campos', async () => {
    await fs.writeFile(
      filePath,
      `${assistantModelLine('claude-opus-5-5')}${userLine('troca')}${assistantModelLine('claude-sonnet-5-5')}${titleLine('nome')}`,
      'utf8',
    );

    await expect(readTranscriptTail(filePath)).resolves.toEqual({
      customTitle: 'nome',
      contextTokens: 10,
      cliColorName: null,
      model: 'claude-sonnet-5-5',
    });
  });

  it('último de cada um vence, independente da ordem entre eles', async () => {
    await fs.writeFile(
      filePath,
      [
        titleLine('nome antigo'),
        assistantUsageLine({ input: 1, cacheRead: 1_000 }),
        titleLine('nome novo'),
        assistantUsageLine({ input: 2, cacheRead: 2_000 }),
      ].join(''),
      'utf8',
    );

    await expect(readTranscriptTail(filePath)).resolves.toEqual({ customTitle: 'nome novo', contextTokens: 2_002, cliColorName: null, model: null });
  });

  it('linha cortada no início do chunk (a cauda corta no meio de uma linha) não lança', async () => {
    // Arquivo maior que a cauda: a leitura começa no meio de uma linha gigante.
    const giant = `${JSON.stringify({ type: 'user', message: { role: 'user', content: 'x'.repeat(70 * 1024) } })}\n`;
    await fs.writeFile(filePath, `${giant}${assistantUsageLine({ input: 5, cacheRead: 500 })}${titleLine('sobreviveu')}`, 'utf8');

    await expect(readTranscriptTail(filePath)).resolves.toEqual({ customTitle: 'sobreviveu', contextTokens: 505, cliColorName: null, model: null });
  });

  it('arquivo vazio → os dois null', async () => {
    await fs.writeFile(filePath, '', 'utf8');
    await expect(readTranscriptTail(filePath)).resolves.toEqual({ customTitle: null, contextTokens: null, cliColorName: null, model: null });
  });

  it('arquivo inexistente → os dois null, sem lançar', async () => {
    await expect(readTranscriptTail(join(dir, 'nao-existe.jsonl'))).resolves.toEqual({
      customTitle: null,
      contextTokens: null,
      cliColorName: null,
      model: null,
    });
  });

  it('transcript sem nenhuma usage e sem título → os dois null (não 0)', async () => {
    await fs.writeFile(filePath, `${userLine('só conversa')}${userLine('mais conversa')}`, 'utf8');
    await expect(readTranscriptTail(filePath)).resolves.toEqual({ customTitle: null, contextTokens: null, cliColorName: null, model: null });
  });
});

// T412 — ciclo de vida: um watcher por aba `claude` viva, baixa no
// `PtyManager.onExit`. O que este bloco prova é o que a Fatia 3 do plano marcou
// como o risco da fase: handle vazado. `watchFn` fake porque aqui o objeto de
// teste é o REGISTRO, não o `fs.watch` (esse já tem os testes acima).
describe('TranscriptWatcherRegistry', () => {
  function makeRegistry() {
    const disposed: string[] = [];
    const started: string[] = [];
    const watchFn = (options: TranscriptWatcherOptions): TranscriptWatcherHandle => {
      started.push(options.sessionId);
      return { dispose: () => disposed.push(options.sessionId) };
    };
    return { registry: new TranscriptWatcherRegistry(watchFn), disposed, started };
  }

  const optionsFor = (id: string): TranscriptWatcherOptions => ({
    sessionId: id,
    filePath: `C:\fake\${id}.jsonl`,
    onChange: () => undefined,
  });

  it('6 abas abertas e fechadas → 0 handles (DoD do T412)', () => {
    const { registry, disposed } = makeRegistry();
    const ids = ['s1', 's2', 's3', 's4', 's5', 's6'];

    for (const id of ids) registry.start(`pty-${id}`, optionsFor(id));
    expect(registry.size).toBe(6);

    for (const id of ids) registry.stop(`pty-${id}`);
    expect(registry.size).toBe(0);
    expect(disposed).toEqual(ids);
  });

  it('reabrir a MESMA aba fecha o watcher anterior em vez de acumular dois no mesmo arquivo', () => {
    const { registry, disposed } = makeRegistry();
    registry.start('pty-1', optionsFor('s1'));
    registry.start('pty-1', optionsFor('s1-retomada'));

    expect(registry.size).toBe(1);
    expect(disposed).toEqual(['s1']);
  });

  it('stop de aba que nunca abriu watcher (terminal livre) é no-op e não lança', () => {
    const { registry, disposed } = makeRegistry();
    expect(() => registry.stop('pty-shell')).not.toThrow();
    expect(disposed).toEqual([]);
    expect(registry.size).toBe(0);
  });

  it('disposeAll fecha tudo (janela fechada leva os PTYs e os watchers)', () => {
    const { registry, disposed } = makeRegistry();
    registry.start('pty-1', optionsFor('s1'));
    registry.start('pty-2', optionsFor('s2'));

    registry.disposeAll();

    expect(registry.size).toBe(0);
    expect(disposed).toEqual(['s1', 's2']);
  });
});


// T016 (014-chat, FR-033) — `/clear`/`/resume` trocam a conversa da aba: o
// registro re-aponta o watcher da MESMA chave (ptyId) para o `.jsonl` novo, que
// pode ainda não existir (conversa sem mensagem não cria arquivo).
describe('TranscriptWatcherRegistry.repoint', () => {
  let dir: string;
  beforeEach(() => {
    fakeFsWatch.reset(); // `fs.watch` real nos casos que usam o watcher de verdade
    dir = mkdtempSync(join(tmpdir(), 'donel-repoint-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('re-aponta para arquivo que ainda não existe e emite quando ele nasce, com o sessionId novo', async () => {
    const registry = new TranscriptWatcherRegistry();
    const changes: TranscriptChange[] = [];
    const oldFile = join(dir, 'old.jsonl');
    const newFile = join(dir, 'new.jsonl');
    await fs.writeFile(oldFile, titleLine('antigo', 'old'));

    registry.start('pty-1', { sessionId: 'old', filePath: oldFile, onChange: (c) => changes.push(c), debounceMs: DEBOUNCE_MS });
    await waitFor(() => changes.some((c) => c.sessionId === 'old'));

    registry.repoint('pty-1', { sessionId: 'new', transcriptPath: newFile });
    expect(existsSync(newFile)).toBe(false);
    expect(registry.size).toBe(1);

    await fs.writeFile(newFile, titleLine('novo', 'new'));
    await waitFor(() => changes.some((c) => c.sessionId === 'new' && c.customTitle === 'novo'));

    // O arquivo velho deixou de ser observado: escrever nele não emite mais.
    // Barreira em vez de `settle()` de 240 ms: depois da escrita no velho vem uma
    // mudança REAL no novo; quando ela chega, o evento do velho (se existisse,
    // no mesmo diretório vigiado) já teve a mesma chance de chegar.
    const before = changes.length;
    await fs.appendFile(oldFile, titleLine('antigo 2', 'old'));
    await fs.appendFile(newFile, titleLine('novo 2', 'new'));
    await waitFor(() => changes.some((c) => c.customTitle === 'novo 2'));
    await realDelay(DEBOUNCE_MS * 2);
    expect(changes.length).toBe(before + 1);
    expect(changes.slice(before).every((c) => c.sessionId === 'new')).toBe(true);
    registry.disposeAll();
  });

  it('repoint de chave sem watcher é no-op (aba de terminal livre) e não abre handle', () => {
    const registry = new TranscriptWatcherRegistry();
    registry.repoint('pty-livre', { sessionId: 'x', transcriptPath: join(dir, 'x.jsonl') });
    expect(registry.size).toBe(0);
  });

  it('repoint fecha o handle anterior (zero handle vazado)', () => {
    const disposed: string[] = [];
    const registry = new TranscriptWatcherRegistry((o) => ({ dispose: () => disposed.push(o.sessionId) }));
    registry.start('pty-1', { sessionId: 'a', filePath: join(dir, 'a.jsonl'), onChange: () => undefined });
    registry.repoint('pty-1', { sessionId: 'b', transcriptPath: join(dir, 'b.jsonl') });
    expect(disposed).toEqual(['a']);
    expect(registry.size).toBe(1);
  });
});
