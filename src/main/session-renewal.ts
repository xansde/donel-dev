// Sessão renovada em voo (B36) — the main side: writes the handoff
// instructions, names the handoff file and reads its header back. The handoff
// lives in the app's own folder (`<userData>/handoffs/`), never in the
// project's repository. The decisions are pure (`shared/sessionRenewal.ts`);
// the turn, the context and the swap are followed by the renderer.
//
// Text sent to the session is about the mechanism, not about a model: it works
// for the CLI the app runs today and is the extension point for another CLI.

import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, posix } from 'node:path';
import { shQuote } from './remote-session';
import { formatTokensK, HANDOFF_FORMAT_MARKER, parseHandoffHeader, type HandoffStatus } from '../shared/sessionRenewal';

export interface RenewalPrepareRequest {
  readonly sessionId: string;
  /** The transcript of the session that leaves (the chat of the tab shows it above the new one). */
  readonly transcriptPath: string | null;
  readonly cwd: string;
  readonly contextTokens: number;
  readonly limitTokens: number;
}

/**
 * A session on a remote place (VPS) cannot read nor write a path of this computer: its handoff lives on the place,
 * in `<home>/.donel/handoffs/`, and the app reads it there over ssh (`index.ts`). Both sessions — the one that
 * leaves and the new one — run on the same place, so the new one reads the same file.
 */
export interface RenewalRemote {
  readonly sshTarget: string;
  /** `$HOME` on the place (absolute, POSIX). */
  readonly home: string;
}

/** Where the handoffs of a remote session live, under its `$HOME`. */
export const REMOTE_HANDOFFS_DIR = '.donel/handoffs';

export interface RenewalRecord {
  readonly id: string;
  readonly previousSessionId: string;
  readonly previousTranscriptPath: string | null;
  readonly handoffPath: string;
  readonly instructionsPath: string;
  readonly cwd: string;
  /** Sent to the session that leaves: "write the handoff". One line. */
  readonly requestPrompt: string;
  /** Sent to the new session as its first message: "read the handoff first". One line. */
  readonly firstPrompt: string;
  /** The text of the instructions (written by the service on this computer; over ssh by the caller on a place). */
  readonly instructions: string;
  /** A session on a remote place: `handoffPath` and `instructionsPath` are paths ON the place. */
  readonly remote?: {
    readonly sshTarget: string;
    /** The copy on this computer, written when the handoff is read ready: what the chat's "abrir" opens. */
    readonly localCopyPath: string;
  };
}

export interface RenewalFs {
  mkdirSync(path: string): void;
  writeFileSync(path: string, content: string): void;
  /** `null` = missing or unreadable. */
  readFileText(path: string): string | null;
}

export interface SessionRenewalServiceDeps {
  readonly handoffsDir: string;
  readonly now?: () => number;
  readonly randomId: () => string;
  readonly fs?: RenewalFs;
}

export interface SessionRenewalService {
  readonly handoffsDir: string;
  /** With `remote`, nothing is written here: the caller writes `instructions` on the place. */
  prepare(request: RenewalPrepareRequest, remote?: RenewalRemote): RenewalRecord;
  get(renewalId: string): RenewalRecord | undefined;
  status(renewalId: string): HandoffStatus;
}

const systemFs: RenewalFs = {
  mkdirSync: (path) => mkdirSync(path, { recursive: true }),
  writeFileSync: (path, content) => writeFileSync(path, content, 'utf8'),
  readFileText: (path) => {
    try {
      return readFileSync(path, 'utf8');
    } catch {
      return null;
    }
  },
};

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function stamp(at: number): { date: string; file: string } {
  const d = new Date(at);
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  return { date, file: `${date}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}` };
}

function projectName(cwd: string): string {
  return cwd.split(/[\\/]/).filter(Boolean).pop() ?? 'projeto';
}

/** File-name safe slug of the project folder. */
function slug(text: string): string {
  const out = text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return out.slice(0, 40) || 'projeto';
}

export function buildHandoffInstructions(input: {
  readonly handoffPath: string;
  readonly sessionId: string;
  readonly cwd: string;
  readonly date: string;
  readonly contextTokens: number;
  readonly limitTokens: number;
}): string {
  const project = projectName(input.cwd);
  return [
    '# Passagem de bastão — instruções do Donel Dev',
    '',
    `O contexto desta sessão chegou a ${formatTokensK(input.contextTokens)} (limite proposto: ${formatTokensK(input.limitTokens)}).`,
    'O Donel Dev vai encerrar este processo e abrir uma sessão nova na mesma aba, na mesma pasta e com a mesma conta.',
    'A sessão nova começa do zero: só sabe o que estiver escrito na passagem e na memória do projeto.',
    '',
    'Faça agora, nesta ordem, sem começar trabalho novo:',
    '',
    '1. Se o projeto tiver convenção de memória ou vault (por exemplo CLAUDE.md, AGENTS.md, MEMORY.md, ou um vault com',
    '   context.md, todo.md e log.md), atualize-a com o estado atual, como faria num fim de sessão. Sem convenção, pule',
    '   este passo: não crie arquivo de memória no projeto.',
    '2. Escreva a passagem de bastão em:',
    `   ${input.handoffPath}`,
    '   exatamente neste formato. O cabeçalho entre `---` é lido pelo app; o resto é para a sessão nova.',
    '',
    '```markdown',
    '---',
    HANDOFF_FORMAT_MARKER,
    `sessao-anterior: ${input.sessionId}`,
    `projeto: ${input.cwd}`,
    'trabalho-vivo: nenhum',
    '---',
    `# Passagem de bastão — ${project}, ${input.date}`,
    '',
    '## Prioridade',
    '## Frentes',
    '(estado de cada frente: feito, em andamento, próximo passo)',
    '## Decisões tomadas',
    '## Rascunhos',
    '(aprovados × esperando OK — a sessão nova só trata como aprovado o que estiver aqui como aprovado)',
    '## Comandos prontos',
    '## Trabalho vivo',
    '(agentes em segundo plano, processos, agendamentos de cron ou loop desta sessão: o que a sessão nova recria ou acompanha)',
    '## Primeira ação da sessão nova',
    '```',
    '',
    '3. O campo `trabalho-vivo`:',
    '   - `nenhum` quando nada desta sessão precisa continuar rodando. Agendamentos (cron, loop) não impedem a troca:',
    '     liste-os na seção "Trabalho vivo" para a sessão nova recriar.',
    '   - Uma descrição curta quando houver agente em segundo plano ou processo que não pode morrer. O app espera e',
    '     não encerra a sessão: quando o trabalho terminar, reescreva o cabeçalho com `trabalho-vivo: nenhum`.',
    '4. Escrita a terceiros e produção: a sessão nova herda aprovação só pelo que estiver escrito. Na dúvida, "esperando OK".',
    '5. Termine respondendo só "Passagem pronta." (ou, com trabalho vivo, o que está esperando).',
    '',
  ].join('\n');
}

export function createSessionRenewalService(deps: SessionRenewalServiceDeps): SessionRenewalService {
  const fs = deps.fs ?? systemFs;
  const now = deps.now ?? Date.now;
  const records = new Map<string, RenewalRecord>();

  return {
    handoffsDir: deps.handoffsDir,

    prepare(request, remote) {
      const at = now();
      const { date, file } = stamp(at);
      const base = `${file}-${slug(projectName(request.cwd))}-${request.sessionId.slice(0, 8)}`;
      const dir = remote ? posix.join(remote.home, REMOTE_HANDOFFS_DIR) : deps.handoffsDir;
      const joinIn = remote ? posix.join : join;
      const handoffPath = joinIn(dir, `${base}.md`);
      const instructionsPath = joinIn(dir, `${base}.instrucoes.md`);
      const instructions = buildHandoffInstructions({
        handoffPath,
        sessionId: request.sessionId,
        cwd: request.cwd,
        date,
        contextTokens: request.contextTokens,
        limitTokens: request.limitTokens,
      });
      if (!remote) {
        fs.mkdirSync(deps.handoffsDir);
        fs.writeFileSync(instructionsPath, instructions);
      }
      const record: RenewalRecord = {
        id: deps.randomId(),
        previousSessionId: request.sessionId,
        previousTranscriptPath: request.transcriptPath,
        handoffPath,
        instructionsPath,
        cwd: request.cwd,
        requestPrompt:
          `[Donel Dev · renovação] Contexto em ${formatTokensK(request.contextTokens)} (limite ` +
          `${formatTokensK(request.limitTokens)}). Antes de qualquer outra coisa, siga as instruções de passagem de ` +
          `bastão em ${instructionsPath}`,
        firstPrompt:
          `[Donel Dev · sessão renovada em voo] Esta sessão continua a ${request.sessionId.slice(0, 8)}, encerrada pelo app ` +
          `ao chegar no limite de contexto. Leia primeiro a passagem de bastão em ${handoffPath} e siga a seção ` +
          `"Primeira ação da sessão nova". Só vale como aprovado o que a passagem marca como aprovado. Depois responda ` +
          `em poucas linhas com a prioridade e o estado das frentes, e espere a próxima mensagem.`,
        instructions,
        ...(remote ? { remote: { sshTarget: remote.sshTarget, localCopyPath: join(deps.handoffsDir, `${base}.md`) } } : {}),
      };
      records.set(record.id, record);
      return record;
    },

    get(renewalId) {
      return records.get(renewalId);
    },

    status(renewalId) {
      const record = records.get(renewalId);
      if (record === undefined || record.remote) return { kind: 'missing' }; // a remote handoff is read over ssh
      return parseHandoffHeader(fs.readFileText(record.handoffPath));
    },
  };
}

/** The name shown in the chat divider: the handoff file, without the folder. */
export function handoffFileName(handoffPath: string): string {
  return basename(handoffPath);
}

// ---------------------------------------------------------------------------
// A session on a remote place — the scripts the main runs there over ssh (`runRemoteScript`, stdin). Pure.
// ---------------------------------------------------------------------------

const HOME_MARK = 'DONEL_HOME=';
const FILE_MARK = 'DONEL_FILE_BEGIN';

/** Prints the place's `$HOME` after a marker (a login shell may print other lines first). */
export function buildRemoteHomeScript(): string {
  return `printf '${HOME_MARK}%s\\n' "$HOME"\n`;
}

/** The `$HOME` printed by `buildRemoteHomeScript`, or `null` (no answer, or not an absolute path). */
export function parseRemoteHome(stdout: string): string | null {
  const line = stdout.split(/\r?\n/).find((candidate) => candidate.startsWith(HOME_MARK));
  const home = line?.slice(HOME_MARK.length).trim();
  return home && home.startsWith('/') ? home : null;
}

/** Writes `content` to `path` on the place (the folder is created), byte for byte: a quoted heredoc expands nothing. */
export function buildRemoteWriteScript(path: string, content: string, delimiter = `DONEL_EOF_${randomBytes(8).toString('hex')}`): string {
  if (content.includes(delimiter)) throw new Error('delimitador presente no conteúdo');
  const body = content.endsWith('\n') ? content : `${content}\n`;
  return `set -e\nmkdir -p -- ${shQuote(posix.dirname(path))}\ncat > ${shQuote(path)} <<'${delimiter}'\n${body}${delimiter}\necho DONEL_OK\n`;
}

/** Prints the file after a marker; a missing file prints only the marker. */
export function buildRemoteReadScript(path: string): string {
  return `printf '${FILE_MARK}\\n'; cat -- ${shQuote(path)} 2>/dev/null || true\n`;
}

/** The file printed by `buildRemoteReadScript`; `null` when the marker never came (ssh failed). */
export function parseRemoteRead(stdout: string): string | null {
  const at = stdout.indexOf(`${FILE_MARK}\n`);
  return at === -1 ? null : stdout.slice(at + FILE_MARK.length + 1);
}
