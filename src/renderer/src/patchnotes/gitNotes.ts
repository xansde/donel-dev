// Novidades geradas no build a partir do git log (18/11): todo commit `feat:` ou
// `fix:` vira uma novidade, sem o PR criar arquivo. Roda só no build (plugin do
// Vite, ver `gitPatchNotes`); o renderer recebe o resultado pronto pelo módulo
// virtual `virtual:donel-git-notes`. Os JSON de `./notes/` continuam valendo.

import { execFileSync } from 'node:child_process';
import type { Plugin } from 'vite';
import type { PatchNoteItem } from './notes';

/**
 * Commits a partir daqui viram novidade; os anteriores já têm o seu JSON em
 * `./notes/` e, sem este corte, apareceriam duas vezes.
 */
export const GIT_NOTES_SINCE = '2026-11-18T01:30:00-03:00';

/** Hora local do dono: a janela agrupa por dia e o dia vira à meia-noite dele. */
const NOTES_TIME_ZONE = 'America/Sao_Paulo';

export interface GitCommit {
  readonly hash: string;
  /** `AAAA-MM-DD-HHMM`, já na hora local. */
  readonly stamp: string;
  /** Mensagem inteira (`%B`): título, linha em branco, corpo. */
  readonly message: string;
}

const RECORD = '\x1e';
const FIELD = '\x1f';
export const GIT_LOG_FORMAT = `${RECORD}%h${FIELD}%cd${FIELD}%B`;

const SUBJECT = /^(feat|fix)(\([^)]*\))?!?:\s*(.+)$/;
const TASK_ID = /\s*\(t-[0-9a-z]+\)/gi;
const TRAILER = /^[A-Za-z][A-Za-z-]*:\s/;
const LIST_ITEM = /^[-*]\s/;
const STAMP = /^\d{4}-\d{2}-\d{2}-\d{4}$/;
const HASH = /^[0-9a-f]+$/;

/** Saída de `git log --format=GIT_LOG_FORMAT` em commits. Registro torto é ignorado. */
export function parseGitLog(raw: string): GitCommit[] {
  return raw
    .split(RECORD)
    .map((record) => record.split(FIELD))
    .filter((fields) => fields.length === 3 && HASH.test(fields[0].trim()) && STAMP.test(fields[1].trim()))
    .map(([hash, stamp, message]) => ({ hash: hash.trim(), stamp: stamp.trim(), message: message.trim() }));
}

function firstParagraph(lines: readonly string[]): string {
  let start = 0;
  while (start < lines.length && lines[start].trim() === '') start++;
  const paragraph: string[] = [];
  for (let i = start; i < lines.length && lines[i].trim() !== ''; i++) paragraph.push(lines[i].trim());
  // Trailer (`Co-Authored-By:`) ou lista de arquivos não é texto para o dono.
  if (paragraph.length === 0 || paragraph.every((line) => TRAILER.test(line)) || LIST_ITEM.test(paragraph[0])) return '';
  return paragraph.join(' ');
}

/**
 * Só `feat:` e `fix:` (com ou sem escopo) viram novidade; o resto (chore, test,
 * docs, refactor, ci, merge) fica de fora. Título sem prefixo, escopo e `(t-…)`;
 * texto é o 1º parágrafo do corpo, ou o título quando não há corpo (ou
 * quando o 1º parágrafo é uma lista).
 * A chave segue o padrão dos arquivos (`AAAA-MM-DD-HHMM-slug.json`) para a
 * janela ordenar tudo junto.
 */
export function commitsToNotes(commits: readonly GitCommit[]): Record<string, PatchNoteItem> {
  const notes: Record<string, PatchNoteItem> = {};
  for (const commit of commits) {
    const [subject = '', ...body] = commit.message.split(/\r?\n/);
    const match = SUBJECT.exec(subject.trim());
    if (!match) continue;
    const stripped = match[3].replace(TASK_ID, '').trim();
    if (stripped === '') continue;
    const title = stripped.charAt(0).toLocaleUpperCase('pt-BR') + stripped.slice(1);
    const text = firstParagraph(body).replace(TASK_ID, '').trim() || title;
    notes[`./git/${commit.stamp}-${commit.hash.toLowerCase()}.json`] = { title, text };
  }
  return notes;
}

/**
 * Lê o git log de `cwd` desde `GIT_NOTES_SINCE`. Sem git, sem repositório ou
 * com erro devolve `[]`: o build segue só com os JSON.
 */
export function readGitCommits(cwd: string, since: string = GIT_NOTES_SINCE): GitCommit[] {
  try {
    const raw = execFileSync(
      'git',
      ['log', '--no-merges', `--since=${since}`, '--date=format-local:%Y-%m-%d-%H%M', `--format=${GIT_LOG_FORMAT}`, 'HEAD'],
      {
        cwd,
        encoding: 'utf8',
        env: { ...process.env, TZ: NOTES_TIME_ZONE },
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 15_000,
        maxBuffer: 32 * 1024 * 1024,
      },
    );
    return parseGitLog(raw);
  } catch {
    return [];
  }
}

export const GIT_NOTES_MODULE = 'virtual:donel-git-notes';
const RESOLVED_GIT_NOTES_MODULE = `\0${GIT_NOTES_MODULE}`;

/** Plugin do Vite que entrega ao renderer as novidades do git log. */
export function gitPatchNotes(): Plugin {
  let root = process.cwd();
  return {
    name: 'donel:git-patch-notes',
    configResolved(config) {
      root = config.root;
    },
    resolveId: (id) => (id === GIT_NOTES_MODULE ? RESOLVED_GIT_NOTES_MODULE : null),
    load(id) {
      if (id !== RESOLVED_GIT_NOTES_MODULE) return null;
      return `export default ${JSON.stringify(commitsToNotes(readGitCommits(root)))};`;
    },
  };
}
