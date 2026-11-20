// t-753e8199 — the transcriber learns from the owner's corrections (contract v1.3,
// ~/seazone/_scratch/celular-tailnet/contrato-correcao.md). Each correction of an audio's transcription is compared
// with the text it replaced, word by word (the smallest diff), and the glossary counts the right words (`termos`) and
// each wrong→right pair (`trocas`). Case, punctuation and accents are ignored only to compare; the right word is kept
// as the owner wrote it. The transcriber (bizops `rotinas/transcritor-vps/`) reads the file at each audio: the 30 most
// frequent terms go into its prompt and every swap seen twice or more is applied to what it writes next.
//
// The file (`~/.donel/transcricao/glossario.json`, or `DONEL_GLOSSARIO`) is written only by this daemon (600, temp →
// rename). `correcoes` is ours: the total of corrections learnt, beside the contract's `versao`, `termos` and `trocas`.

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export const DEFAULT_GLOSSARIO_FILE = join(homedir(), '.donel', 'transcricao', 'glossario.json');
export const glossarioFile = (env: NodeJS.ProcessEnv = process.env): string => env.DONEL_GLOSSARIO || DEFAULT_GLOSSARIO_FILE;
/** A swap is applied by the transcriber from this many corrections on. */
export const TROCA_ATIVA_N = 2;
/** A longer change on either side is the owner rewriting the sentence, not the transcriber mishearing a word. */
const MAX_EXPRESSAO = 4;

export interface Glossario {
  versao: 1;
  termos: Record<string, number>;
  trocas: Record<string, { certo: string; n: number }>;
  correcoes?: number;
}

export interface GlossarioResumo {
  readonly correcoes: number;
  /** The swaps the transcriber applies now (n ≥ 2). */
  readonly trocas: number;
}

export interface GlossarioStore {
  resumo(): GlossarioResumo;
  /** Learns one correction: `antes` is the text it replaced, `depois` what the owner wrote. */
  aprender(antes: string, depois: string): GlossarioResumo;
}

/** Only for comparing: no case, no accent, no punctuation. */
export function normalizar(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

interface Palavra {
  /** As written, without the punctuation around it. */
  readonly escrita: string;
  readonly chave: string;
}

function palavras(text: string): Palavra[] {
  return text
    .split(/\s+/)
    .map((token) => token.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ''))
    .map((escrita) => ({ escrita, chave: normalizar(escrita) }))
    .filter((palavra) => palavra.chave !== '');
}

export interface Mudanca {
  readonly errado: string;
  readonly certo: string;
}

/**
 * The changes from `antes` to `depois`, by the longest common run of words: each place where they differ is one change
 * (`errado` empty = words the owner added). Words removed alone and long rewrites are not changes to learn.
 */
export function mudancas(antes: string, depois: string): Mudanca[] {
  const a = palavras(antes);
  const b = palavras(depois);
  // lcs[i][j] = longest common run of a[i..] and b[j..].
  const lcs: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      lcs[i]![j] = a[i]!.chave === b[j]!.chave ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
    }
  }
  const out: Mudanca[] = [];
  let removed: Palavra[] = [];
  let added: Palavra[] = [];
  const flush = (): void => {
    if (added.length && added.length <= MAX_EXPRESSAO && removed.length <= MAX_EXPRESSAO) {
      out.push({ errado: removed.map((p) => p.escrita).join(' '), certo: added.map((p) => p.escrita).join(' ') });
    }
    removed = [];
    added = [];
  };
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i]!.chave === b[j]!.chave) {
      flush();
      i += 1;
      j += 1;
    } else if (j < b.length && (i >= a.length || lcs[i]![j + 1]! >= lcs[i + 1]![j]!)) {
      added.push(b[j]!);
      j += 1;
    } else {
      removed.push(a[i]!);
      i += 1;
    }
  }
  flush();
  return out;
}

const EMPTY = (): Glossario => ({ versao: 1, termos: {}, trocas: {}, correcoes: 0 });

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The file as the contract has it; anything else in it is dropped. Throws when it is not a glossary. */
function parse(text: string): Glossario {
  const raw = JSON.parse(text) as unknown;
  if (!isRecord(raw) || raw.versao !== 1 || !isRecord(raw.termos) || !isRecord(raw.trocas)) throw new Error('não é o glossário v1');
  const termos: Record<string, number> = {};
  for (const [termo, n] of Object.entries(raw.termos)) if (typeof n === 'number' && n > 0) termos[termo] = n;
  const trocas: Glossario['trocas'] = {};
  for (const [errado, troca] of Object.entries(raw.trocas)) {
    if (isRecord(troca) && typeof troca.certo === 'string' && typeof troca.n === 'number' && troca.n > 0) trocas[errado] = { certo: troca.certo, n: troca.n };
  }
  const correcoes = typeof raw.correcoes === 'number' && raw.correcoes >= 0 ? raw.correcoes : 0;
  return { versao: 1, termos, trocas, correcoes };
}

const resumoDe = (glossario: Glossario): GlossarioResumo => ({
  correcoes: glossario.correcoes ?? 0,
  trocas: Object.values(glossario.trocas).filter((troca) => troca.n >= TROCA_ATIVA_N).length,
});

/** The key already holding `text` (same words, any case or accent), or `text` itself. */
const chaveDe = (keys: readonly string[], text: string): string => keys.find((key) => normalizar(key) === normalizar(text)) ?? text;

export function createGlossarioStore(filePath: string, log: (line: string) => void): GlossarioStore {
  /** Missing = empty; unreadable = empty too (the GET stays up), and the next correction starts it again. */
  function read(): Glossario {
    let text: string;
    try {
      text = readFileSync(filePath, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') log(`[glossario] não li ${filePath}: ${(error as Error).message}`);
      return EMPTY();
    }
    try {
      return parse(text);
    } catch (error) {
      log(`[glossario] ${filePath} ilegível (${(error as Error).message}); a próxima correção recomeça o glossário`);
      return EMPTY();
    }
  }

  function write(glossario: Glossario): void {
    mkdirSync(dirname(filePath), { recursive: true, mode: 0o700 });
    const tmp = `${filePath}.tmp-${process.pid}`;
    writeFileSync(tmp, `${JSON.stringify(glossario, null, 2)}\n`, { mode: 0o600 });
    renameSync(tmp, filePath);
  }

  return {
    resumo: () => resumoDe(read()),
    aprender(antes, depois) {
      const glossario = read();
      glossario.correcoes = (glossario.correcoes ?? 0) + 1;
      for (const { errado, certo } of mudancas(antes, depois)) {
        const termo = chaveDe(Object.keys(glossario.termos), certo);
        // Kept as the owner wrote it the first time.
        glossario.termos[termo] = (glossario.termos[termo] ?? 0) + 1;
        if (!errado) continue;
        const chave = chaveDe(Object.keys(glossario.trocas), errado);
        const antiga = glossario.trocas[chave];
        glossario.trocas[chave] = antiga && normalizar(antiga.certo) === normalizar(certo) ? { certo: antiga.certo, n: antiga.n + 1 } : { certo, n: 1 };
      }
      write(glossario);
      // Counts only, never the owner's words.
      const resumo = resumoDe(glossario);
      log(`[glossario] correção aprendida: ${resumo.correcoes} correções, ${resumo.trocas} trocas ativas`);
      return resumo;
    },
  };
}
