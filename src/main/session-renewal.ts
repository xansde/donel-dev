// Sessão renovada em voo (B36) — the main side: writes the handoff
// instructions, names the handoff file and reads its header back. The handoff
// lives in the app's own folder (`<userData>/handoffs/`), never in the
// project's repository. The decisions are pure (`shared/sessionRenewal.ts`);
// the turn, the context and the swap are followed by the renderer.
//
// Text sent to the session is about the mechanism, not about a model: it works
// for the CLI the app runs today and is the extension point for another CLI.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { formatTokensK, HANDOFF_FORMAT_MARKER, parseHandoffHeader, type HandoffStatus } from '../shared/sessionRenewal';

export interface RenewalPrepareRequest {
  readonly sessionId: string;
  /** The transcript of the session that leaves (the chat of the tab shows it above the new one). */
  readonly transcriptPath: string | null;
  readonly cwd: string;
  readonly contextTokens: number;
  readonly limitTokens: number;
}

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
  prepare(request: RenewalPrepareRequest): RenewalRecord;
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

    prepare(request) {
      const at = now();
      const { date, file } = stamp(at);
      const base = `${file}-${slug(projectName(request.cwd))}-${request.sessionId.slice(0, 8)}`;
      const handoffPath = join(deps.handoffsDir, `${base}.md`);
      const instructionsPath = join(deps.handoffsDir, `${base}.instrucoes.md`);
      fs.mkdirSync(deps.handoffsDir);
      fs.writeFileSync(
        instructionsPath,
        buildHandoffInstructions({
          handoffPath,
          sessionId: request.sessionId,
          cwd: request.cwd,
          date,
          contextTokens: request.contextTokens,
          limitTokens: request.limitTokens,
        }),
      );
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
      };
      records.set(record.id, record);
      return record;
    },

    get(renewalId) {
      return records.get(renewalId);
    },

    status(renewalId) {
      const record = records.get(renewalId);
      if (record === undefined) return { kind: 'missing' };
      return parseHandoffHeader(fs.readFileText(record.handoffPath));
    },
  };
}

/** The name shown in the chat divider: the handoff file, without the folder. */
export function handoffFileName(handoffPath: string): string {
  return basename(handoffPath);
}
