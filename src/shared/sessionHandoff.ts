// Sessão renovada em voo (B36) — the texts of a handoff, pure: the instructions the session that leaves follows, the
// file names and the two one-line prompts (ask for the handoff; read it first). Shared by the app on the PC
// (`src/main/session-renewal.ts`) and the Oráculo on a place, which renews with the PC away (`src/oraculo/renovar-local.ts`,
// t-49dee38d). No Electron, no ssh, no file system here.

import { formatTokensK, HANDOFF_FORMAT_MARKER } from './sessionRenewal';

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/** The local date of `at` (`AAAA-MM-DD`) and the file stamp (`AAAA-MM-DD-HHMMSS`). */
export function handoffStamp(at: number): { readonly date: string; readonly file: string } {
  const d = new Date(at);
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  return { date, file: `${date}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}` };
}

/** The last folder of a path (`\` or `/`). */
export function handoffProjectName(cwd: string): string {
  return cwd.split(/[\\/]/).filter(Boolean).pop() ?? 'projeto';
}

/** File-name safe slug of the project folder. */
export function handoffSlug(text: string): string {
  const out = text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return out.slice(0, 40) || 'projeto';
}

/** `<AAAA-MM-DD-HHMMSS>-<projeto>-<sid8>`: the handoff is `<base>.md`, its instructions `<base>.instrucoes.md`. */
export function handoffBaseName(at: number, cwd: string, sessionId: string): string {
  return `${handoffStamp(at).file}-${handoffSlug(handoffProjectName(cwd))}-${sessionId.slice(0, 8)}`;
}

export function buildHandoffInstructions(input: {
  readonly handoffPath: string;
  readonly sessionId: string;
  readonly cwd: string;
  readonly date: string;
  readonly contextTokens: number;
  readonly limitTokens: number;
}): string {
  const project = handoffProjectName(input.cwd);
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

/** Sent to the session that leaves: "write the handoff". One line. */
export function handoffRequestPrompt(input: { readonly contextTokens: number; readonly limitTokens: number; readonly instructionsPath: string }): string {
  return (
    `[Donel Dev · renovação] Contexto em ${formatTokensK(input.contextTokens)} (limite ` +
    `${formatTokensK(input.limitTokens)}). Antes de qualquer outra coisa, siga as instruções de passagem de ` +
    `bastão em ${input.instructionsPath}`
  );
}

/** Sent to the new session as its first message: "read the handoff first". One line. `by` = who ended the old one. */
export function handoffFirstPrompt(input: { readonly sessionId: string; readonly handoffPath: string; readonly by?: string }): string {
  return (
    `[Donel Dev · sessão renovada em voo] Esta sessão continua a ${input.sessionId.slice(0, 8)}, encerrada ${input.by ?? 'pelo app'} ` +
    `ao chegar no limite de contexto. Leia primeiro a passagem de bastão em ${input.handoffPath} e siga a seção ` +
    `"Primeira ação da sessão nova". Só vale como aprovado o que a passagem marca como aprovado. Depois responda ` +
    `em poucas linhas com a prioridade e o estado das frentes, e espere a próxima mensagem.`
  );
}
