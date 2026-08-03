// Fix #19 — a faixa de cor da aba NUNCA aparecia porque não existe (e nunca
// existiu) um lugar na UI do Donel Dev para escolher a cor de uma sessão. O
// Alexandre esclareceu na validação de 03/08: o desenho pretendido é a faixa
// acompanhar o comando `/color` do PRÓPRIO CLI (`claude`), não um estado do
// app — ele rodou `/color blue` e `/color red` na mesma sessão e nada mudou
// na aba, porque nada lia essa informação.
//
// O CLI não persiste a cor em NENHUM lugar estruturado (verificado:
// `~/.claude.json`, `~/.claude/sessions/*.json`, `~/.claude/state/`,
// `~/.claude/session-env/`, `settings.json` — nada). A ÚNICA fonte é uma
// linha de `system`/`local_command` no transcript da própria sessão:
//
//   {"type":"system","subtype":"local_command",
//    "content":"<local-command-stdout>Session color set to: blue</local-command-stdout>",
//    "sessionId":"…"}
//
// Este módulo é PURO (sem fs/Electron/React) de propósito — mesmo padrão de
// `sessionName.ts`/`contextWindow.ts`: o parser da linha é compartilhado
// entre a varredura de cauda do `transcript-watcher.ts` (main) e qualquer
// teste unitário, sem depender de I/O.

/**
 * As 8 cores que o CLI `claude` aceita em `/color` — extraído do binário
 * instalado (`grep -a -o` em `claude.exe`, achado literal
 * `["red","blue","green","yellow","purple","orange","pink","cyan"]`,
 * verificado em 03/08 para a issue #19). NÃO é uma lista inventada: é o
 * enum real do CLI. Um nome fora desta lista nunca deveria aparecer no
 * transcript — se aparecer (versão nova do CLI com mais cores), o parser
 * devolve o nome cru e o mapa de CSS abaixo trata como desconhecido (sem
 * faixa), nunca inventa uma cor.
 */
export type CliColorName = 'red' | 'blue' | 'green' | 'yellow' | 'purple' | 'orange' | 'pink' | 'cyan';

export const CLI_COLOR_NAMES: readonly CliColorName[] = ['red', 'blue', 'green', 'yellow', 'purple', 'orange', 'pink', 'cyan'];

export function isCliColorName(value: string): value is CliColorName {
  return (CLI_COLOR_NAMES as readonly string[]).includes(value);
}

/**
 * Mapa nome→CSS. Decisão nomeada (esclarecimento do Alexandre, 03/08): a
 * faixa pinta a cor REAL que o operador digitou no CLI (blue = azul, green =
 * verde…), e isso rompe CONSCIENTEMENTE a regra "nenhum hex novo" do design
 * (`design/modo-dev-v3-verificacao.md` §3, paleta fixa de 4 tokens em
 * `src/shared/tabAppearance.ts`) — a paleta de 4 tokens não cobre 8 cores
 * livres do CLI, e não fazia sentido inventar um 5º/6º/7º/8º token só para
 * isso. Valores escolhidos para ficarem coerentes com o tema escuro do app
 * (`--bg-app: #0e1116`) e legíveis como faixa fina de 2px — tons médios,
 * saturados o bastante para não sumir no fundo escuro, sem "gritar" ao lado
 * dos tokens `--accent`/`--state-*` já usados no resto da UI.
 */
export const CLI_COLOR_HEX: Record<CliColorName, string> = {
  red: '#e05c5c',
  blue: '#4c9cf0', // mesmo tom de --accent — "azul do CLI" e "azul do app" são o mesmo azul de propósito.
  green: '#5fbf6f',
  yellow: '#e8b44c', // mesmo tom de --donel-accent (dourado/amarelo).
  purple: '#a878e0',
  orange: '#e8935f',
  pink: '#e07fb0',
  cyan: '#4cc9d9',
};

/** `null` para nome desconhecido/vazio — NUNCA chuta uma cor (regra explícita da issue #19). */
export function cliColorNameToHex(name: string | null | undefined): string | null {
  if (!name) return null;
  return isCliColorName(name) ? CLI_COLOR_HEX[name] : null;
}

const LOCAL_COMMAND_TYPE = 'system';
const LOCAL_COMMAND_SUBTYPE = 'local_command';
const SESSION_COLOR_PATTERN = /Session color set to:\s*(\w+)/i;

/**
 * Uma linha JSONL → nome de cor cru (minúsculo, pode não estar em
 * `CLI_COLOR_NAMES` — a validação fica em `cliColorNameToHex`), ou `null` se
 * a linha não é um `Session color set to: …` válido.
 *
 * `expectedSessionId`, quando informado, descarta a linha se ela carregar um
 * `sessionId` diferente — defesa extra além do watcher já ler só o `.jsonl`
 * daquela sessão (o nome do arquivo já É o sessionId); sem essa checagem
 * ficaríamos só na confiança de que nunca havería uma linha "estranha" no
 * meio do arquivo certo.
 */
export function extractCliColorNameFromLine(line: string, expectedSessionId?: string): string | null {
  const raw = line.trim();
  if (!raw || raw[0] !== '{') return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null; // linha cortada pela leitura de cauda, ou linha corrompida
  }

  if (typeof parsed !== 'object' || parsed === null) return null;
  const record = parsed as { type?: unknown; subtype?: unknown; content?: unknown; sessionId?: unknown };
  if (record.type !== LOCAL_COMMAND_TYPE || record.subtype !== LOCAL_COMMAND_SUBTYPE) return null;
  if (expectedSessionId && typeof record.sessionId === 'string' && record.sessionId !== expectedSessionId) return null;
  if (typeof record.content !== 'string') return null;

  const match = SESSION_COLOR_PATTERN.exec(record.content);
  if (!match) return null;

  const name = match[1].trim().toLowerCase();
  return name || null;
}

/**
 * Último `Session color set to: …` de um trecho de JSONL, ou `null`. Varre
 * de trás para frente porque, na mesma sessão, o operador pode trocar de cor
 * várias vezes (`/color blue` → `/color red`) — a ÚLTIMA vence, mesmo padrão
 * de `extractCustomTitle` (sessionName.ts).
 */
export function extractCliColorName(tailText: string, expectedSessionId?: string): string | null {
  if (!tailText) return null;

  const lines = tailText.split('\n');
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const name = extractCliColorNameFromLine(lines[index], expectedSessionId);
    if (name !== null) return name;
  }

  return null;
}
