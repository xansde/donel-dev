// Novidades geradas no build a partir do git log (18/11): cada PR `feat:` ou
// `fix:` mesclado na branch vira uma novidade, sem o PR criar arquivo. Roda só
// no build (plugin do Vite, ver `gitPatchNotes`); o renderer recebe o resultado
// pronto pelo módulo virtual `virtual:donel-git-notes`. Os JSON de `./notes/`
// continuam valendo.
//
// Uma novidade por PR, não por commit: cada rodada de revisão ganha um `fix:`
// e a janela encheria de texto interno. O que conta é a linha de 1º pai da
// branch (o merge do PR, ou o commit feito direto nela).

import { execFileSync } from 'node:child_process';
import type { Plugin } from 'vite';
import type { PatchNoteItem } from './notes';

/**
 * Mudanças a partir daqui viram novidade: logo depois do último JSON em
 * `./notes/` (2026-11-17-2119), para nada aparecer duas vezes nem sumir.
 */
export const GIT_NOTES_SINCE = '2026-11-17T21:20:00-03:00';

/** Pasta dos JSON: PR que acrescenta um arquivo nela já tem a novidade escrita. */
export const NOTES_DIR = 'src/renderer/src/patchnotes/notes/';

/**
 * Hora local do dono: a janela agrupa por dia e o dia vira à meia-noite dele.
 * Convertida no JS, não por `TZ` do git: o git do Windows (build do PC) não
 * entende nome de fuso IANA e cairia em UTC.
 */
const STAMP_FORMAT = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Sao_Paulo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** `AAAA-MM-DD-HHMM` em São Paulo a partir da data ISO do git (`%cI`); `null` se inválida. */
export function localStamp(iso: string): string | null {
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return null;
  const part = Object.fromEntries(STAMP_FORMAT.formatToParts(time).map((p) => [p.type, p.value]));
  return `${part.year}-${part.month}-${part.day}-${part.hour}${part.minute}`;
}

export interface ChangedFile {
  /** Letra do `--name-status` (`A`, `M`, `D`…). */
  readonly status: string;
  readonly path: string;
}

/** Um passo da linha de 1º pai: o merge de um PR ou um commit feito direto na branch. */
export interface GitChange {
  readonly hash: string;
  readonly parents: readonly string[];
  /** `AAAA-MM-DD-HHMM`, já na hora local: a hora em que entrou na branch. */
  readonly stamp: string;
  /** Mensagem inteira (`%B`): título, linha em branco, corpo. */
  readonly message: string;
  /** Diferença contra o 1º pai: o que o PR trouxe. */
  readonly files: readonly ChangedFile[];
  /** Mensagens dos commits do PR (sem merges), o mais antigo primeiro; vazio num commit direto. */
  readonly commits: readonly string[];
}

const RECORD = '\x1e';
const FIELD = '\x1f';
export const GIT_LOG_FORMAT = `${RECORD}%H${FIELD}%P${FIELD}%cI${FIELD}%B${FIELD}`;

const SUBJECT = /^(feat|fix)(\([^)]*\))?!?:\s*(.+)$/;
const TASK_ID = /\s*\(t-[0-9a-z]+\)/gi;
// Id de tarefa solto no começo do texto ("t-89279f84, item 4: …").
const LEADING_TASK_ID = /^t-[0-9a-f]{8}\b[,:;]?\s*/i;
const PR_REF = /\s*\((?:#|PR\s*#?)\d+\)/gi;
const GITHUB_MERGE = /^Merge pull request #\d+ from \S+/;
const REVERTS = /This reverts commit ([0-9a-f]{7,40})/g;
// Só trailers conhecidos: "Nota: a tela muda" é texto para o dono, não trailer.
const TRAILER = /^(Co-Authored-By|Signed-off-by|Reviewed-by|Acked-by|Tested-by|Reported-by|Helped-by):\s/i;
const LIST_ITEM = /^[-*]\s/;
const STAMP = /^\d{4}-\d{2}-\d{2}-\d{4}$/;
const HASH = /^[0-9a-f]{7,40}$/;
const NAME_STATUS = /^([A-Z])\d*\t(.+)$/;

/**
 * Saída de `git log --first-parent -m --name-status --format=GIT_LOG_FORMAT` em
 * passos da branch (ainda sem `commits`). Registro torto ou data inválida é ignorado.
 */
export function parseFirstParentLog(raw: string): GitChange[] {
  const changes: GitChange[] = [];
  for (const record of raw.split(RECORD)) {
    const fields = record.split(FIELD);
    if (fields.length !== 5) continue;
    const [hash, parents, date, message, nameStatus] = fields.map((field) => field.trim());
    const stamp = localStamp(date);
    if (!HASH.test(hash) || stamp === null || !STAMP.test(stamp)) continue;
    // `-m` repete o registro de um merge por pai em git antigo; vale o 1º (contra o 1º pai).
    if (changes.some((change) => change.hash === hash)) continue;
    const files = nameStatus
      .split(/\r?\n/)
      .map((line) => NAME_STATUS.exec(line))
      .filter((match): match is RegExpExecArray => match !== null)
      .map((match) => ({ status: match[1], path: match[2] }));
    changes.push({ hash, parents: parents.split(/\s+/).filter(Boolean), stamp, message, files, commits: [] });
  }
  return changes;
}

/**
 * O passo chega ao app (mexe em `src/`) e não trouxe a novidade escrita à mão
 * (nenhum JSON novo em `./notes/`, senão ela sairia duas vezes).
 */
export function reachesAppWithoutNote(files: readonly ChangedFile[]): boolean {
  return (
    files.some((file) => file.path.startsWith('src/')) &&
    !files.some((file) => file.status === 'A' && file.path.startsWith(NOTES_DIR))
  );
}

function lines(message: string): string[] {
  return message.split(/\r?\n/);
}

function firstParagraph(body: readonly string[]): string {
  let start = 0;
  while (start < body.length && body[start].trim() === '') start++;
  const paragraph: string[] = [];
  for (let i = start; i < body.length && body[i].trim() !== ''; i++) paragraph.push(body[i].trim());
  // Trailer (`Co-Authored-By:`) ou lista de arquivos não é texto para o dono.
  if (paragraph.length === 0 || paragraph.every((line) => TRAILER.test(line)) || LIST_ITEM.test(paragraph[0])) return '';
  return paragraph.join(' ');
}

function isFeatOrFix(message: string): boolean {
  return SUBJECT.test(lines(message)[0].trim());
}

/**
 * Título (`feat:`/`fix:`) e mensagem de onde sai o texto:
 * - merge do GitHub: o título do PR (3ª linha) e o commit `feat`/`fix` mais antigo do PR;
 * - outro merge: o commit `feat`/`fix` mais antigo do PR, nos dois papéis;
 * - commit direto: ele mesmo.
 */
function sourceOf(change: GitChange): { subject: string; bodyFrom: string } | null {
  const [first = '', ...rest] = lines(change.message);
  if (change.parents.length < 2) return { subject: first.trim(), bodyFrom: change.message };
  const oldest = change.commits.find(isFeatOrFix);
  if (GITHUB_MERGE.test(first.trim())) {
    const prTitle = rest.find((line) => line.trim() !== '')?.trim() ?? '';
    return { subject: prTitle, bodyFrom: oldest ?? '' };
  }
  return oldest === undefined ? null : { subject: lines(oldest)[0].trim(), bodyFrom: oldest };
}

function capitalize(text: string): string {
  return text.charAt(0).toLocaleUpperCase('pt-BR') + text.slice(1);
}

function clean(text: string): string {
  return text.replace(TASK_ID, '').replace(PR_REF, '').trim().replace(LEADING_TASK_ID, '');
}

/** Hashes desfeitos por um `Revert` (`This reverts commit <hash>`) em qualquer mensagem. */
export function revertedHashes(changes: readonly GitChange[]): string[] {
  const messages = changes.flatMap((change) => [change.message, ...change.commits]);
  return messages.flatMap((message) => [...message.matchAll(REVERTS)].map((match) => match[1]));
}

/**
 * Uma novidade por PR `feat:`/`fix:` (ou commit `feat:`/`fix:` feito direto na
 * branch) que chega ao app; o resto (chore, test, docs, refactor, ci, revert,
 * só scripts/servidor, PR com JSON próprio, PR desfeito depois) fica de fora.
 * Título sem prefixo, escopo, `(t-…)` e `(#N)`; texto é o 1º parágrafo do corpo
 * do commit `feat`/`fix` mais antigo do PR, ou o título quando não há texto.
 * A hora é a do merge (quando entrou na branch), para cair num dia que o dono
 * ainda não viu. A chave segue o padrão dos arquivos
 * (`AAAA-MM-DD-HHMM-slug.json`) para a janela ordenar tudo junto.
 */
export function changesToNotes(changes: readonly GitChange[]): Record<string, PatchNoteItem> {
  const reverted = revertedHashes(changes);
  const notes: Record<string, PatchNoteItem> = {};
  for (const change of changes) {
    if (!reachesAppWithoutNote(change.files)) continue;
    if (reverted.some((hash) => change.hash.startsWith(hash))) continue;
    const source = sourceOf(change);
    const match = source && SUBJECT.exec(source.subject);
    if (!source || !match) continue;
    const stripped = clean(match[3]);
    if (stripped === '') continue;
    const title = capitalize(stripped);
    const text = capitalize(clean(firstParagraph(lines(source.bodyFrom).slice(1)))) || title;
    notes[`./git/${change.stamp}-${change.hash.slice(0, 8)}.json`] = { title, text };
  }
  return notes;
}

function git(cwd: string, args: readonly string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    timeout: 15_000,
    maxBuffer: 32 * 1024 * 1024,
  });
}

/**
 * Lê a linha de 1º pai de `HEAD` em `cwd` desde `since`, com o que cada passo
 * mudou e, nos merges que chegam ao app, os commits do PR. Sem git, sem
 * repositório ou com erro devolve `[]`: o build segue só com os JSON.
 */
export function readGitChanges(cwd: string, since: string = GIT_NOTES_SINCE): GitChange[] {
  try {
    const changes = parseFirstParentLog(
      git(cwd, [
        'log',
        '--first-parent',
        '-m',
        '--name-status',
        '--no-renames',
        `--since=${since}`,
        `--format=${GIT_LOG_FORMAT}`,
        'HEAD',
      ]),
    );
    return changes.map((change) => {
      if (change.parents.length < 2 || !reachesAppWithoutNote(change.files)) return change;
      const raw = git(cwd, [
        'log',
        '--reverse',
        '--no-merges',
        `--format=${RECORD}%B`,
        `${change.parents[0]}..${change.hash}`,
      ]);
      const commits = raw
        .split(RECORD)
        .map((message) => message.trim())
        .filter(Boolean);
      return { ...change, commits };
    });
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
      return `export default ${JSON.stringify(changesToNotes(readGitChanges(root)))};`;
    },
  };
}
