// wi-esteira4-enter-confirmado (13/08) — a leitura da CAIXA DE INPUT do REPL
// do `claude`, no buffer JÁ RENDERIZADO do xterm.
//
// NUNCA no byte stream: no ConPTY o espaço não é escrito, é um avanço de
// cursor — e ao tirar as sequências ANSI ele some junto (`bypass permissions`
// chega como `bypasspermissions`, e qualquer busca com espaço falha). Duas
// tentativas da sessão de 13/08 morreram nisso; é o mesmo achado T013 que o
// `TerminalPane.tsx` já registra em `getRenderedLines`, e está documentado em
// `docs/relatorio-bateria-enter-2026-08-13.md`.
//
// O sinal é ESTRUTURAL, não textual. O REPL desenha a caixa de input entre
// DUAS réguas de '─': o transcript fica ACIMA da régua de topo e a barra de
// status ABAIXO da régua de baixo. As duas capturas reais que este repo já
// versiona (e que os testes usam como fixture):
//
//   NÃO submetido (`tests/preTypeReadiness.test.ts`, smoke dev-mode-espelho):
//     '────────…────'
//     '❯ algum texto pré-digitado, nunca enviado'
//     '────────…────'
//     '  ⏵⏵ bypass permissions on (shift+tab to cycle)              /rc · focus'
//
//   SUBMETIDO (`tests/liveSessionInjection.test.ts`, pós-`/model sonnet`):
//     '❯ /model sonnet'
//     '  ⎿  Set model to Sonnet 5 …'
//     '────────…── model-injection-test ──'
//     '❯ '
//     '────────…────────'
//     '  ⏵⏵ accept edits on (shift+tab to cycle)                    /rc'
//
// Por que a CAIXA, e não outra coisa:
//  - IMUNE AO VIEWPORT FIXO. Este CLI redesenha um viewport de tamanho fixo,
//    não um log que só cresce (achado já documentado em
//    `liveSessionInjection.ts`): o eco do comando no transcript pode ser
//    empurrado para fora da cauda que `getRenderedLines` devolve. A caixa é
//    redesenhada em todo frame e nunca sai.
//  - O ECO NO TRANSCRIPT NÃO SERVE COMO PROVA NEGATIVA: depois de submeter, o
//    comando CONTINUA na tela, acima da régua de topo. "O comando aparece no
//    buffer" é verdade nos DOIS estados — por isso a decisão é POSICIONAL.
//  - IMUNE AO WRAP. `getRenderedLines` não consulta `isWrapped` e não junta
//    continuação (`TerminalPane.tsx`); o comando de fase carrega caminho
//    absoluto e estoura a largura com facilidade. Lemos TODAS as linhas entre
//    as réguas e concatenamos, em vez de procurar o comando numa linha só.
//  - NÃO depende de "esc to interrupt": essa string não aparece em nenhuma
//    captura deste repo, só como prosa num comentário de `preTypeReadiness.ts`.
//  - NÃO depende do rodapé 'shift+tab to cycle': ele está presente ANTES e
//    DEPOIS do submit (as duas fixtures acima o contêm) — não discrimina nada.

import { lineText, visibleText, visibleTextFrom, type LineInput } from './screenLine';
import { isTrustDialogVisible } from './trustDialog';

const RULER_CHAR = '─';

/** Mínimo de traços para uma linha ser régua. O comprimento VARIA (63 e 90 nas capturas) — régua nunca se reconhece por igualdade. */
const MIN_RULER_DASHES = 10;

/** Teto de linhas dentro da caixa: a 2.1.293 cresce até 15 (014/R6); acima disso são duas réguas quaisquer do transcript, não uma "caixa". */
const MAX_INPUT_BOX_LINES = 15;

/** A marca do prompt. `>` entra porque o banner de boot desenha `'> '`; `!` é o prompt do modo shell (a 2.1.293 troca o `❯` por `!`). */
const PROMPT_MARK_PATTERN = /^\s*([❯>!])\s?/;

/** A caixa multilinha recua as continuações em 2 colunas, para alinhar com o texto depois da marca. */
const CONTINUATION_INDENT_PATTERN = /^ {1,2}/;

/** Opção de menu/diálogo: '❯ 1. Yes, switch to Sonnet 5', '  2. No, keep current model'. */
const MENU_OPTION_PATTERN = /^\s*[❯>]?\s*\d+\.\s+\S/;

/**
 * Padrões do prompt interativo de permissão (addendum T009, medidos em PTY
 * real: "Bash requires confirmation for this command. … Do you want to
 * proceed? ❯ 1. Yes 2. No") + variações pt-BR caso o CLI localize, mais o
 * texto de auto-negação do modo headless do spike original.
 *
 * Moravam em `main/semaphore-state-machine.ts` até 13/08; vieram para cá
 * porque o veto do auto-start precisa deles e o buffer RENDERIZADO é onde eles
 * de fato casam. O main segue consumindo daqui, sem mudança de comportamento.
 */
export const PERMISSION_PROMPT_PATTERNS: readonly RegExp[] = [
  /do you want to proceed/i,
  /requires confirmation/i,
  /permission to use/i,
  /precis[oa] de (sua )?permiss[ãa]o/i,
  /\b1\.\s*yes\b/i,
];

/**
 * Régua da moldura. Duas condições, e a segunda é o que impede o falso
 * positivo: uma tabela ou um travessão numa resposta do modelo têm poucos
 * traços em muito texto; a régua é MAJORITARIAMENTE traço, mesmo quando
 * carrega o nome da pasta à direita ('────… model-injection-test ──').
 */
export function isRulerLine(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed.length === 0) return false;
  let dashes = 0;
  for (const char of trimmed) if (char === RULER_CHAR) dashes += 1;
  return dashes >= MIN_RULER_DASHES && dashes * 2 >= trimmed.length;
}

export type CliInputBox =
  /**
   * Há texto REAL digitado na caixa (o que está em dim — placeholder, sugestão fantasma — não conta). `text` já vem
   * sem a marca de prompt, com as continuações do wrap concatenadas. `shell: true` = prompt `!` (modo shell); o
   * `!` NÃO está em `text` (o CLI o desenha no lugar do `❯`).
   */
  | { readonly kind: 'typed'; readonly text: string; readonly shell?: true }
  /** A caixa existe e está vazia (só a marca de prompt, ou só texto dim). */
  | { readonly kind: 'empty'; readonly shell?: true }
  /** Um seletor sequestrou a caixa ('Switch model?', permissão) — o `❯` ali é cursor de seleção, não prompt. */
  | { readonly kind: 'menu' }
  /** Não localizei a moldura. Ausência de evidência — nunca vira ação. */
  | { readonly kind: 'unreadable' };

/** Posição da última caixa de input (régua de topo e de base), ou `null` se não há par de réguas. */
export function locateInputBox(lines: readonly LineInput[]): { readonly top: number; readonly bottom: number } | null {
  let bottom = -1;
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (isRulerLine(lineText(lines[i]))) {
      bottom = i;
      break;
    }
  }
  if (bottom <= 0) return null;
  for (let i = bottom - 1; i >= 0; i -= 1) {
    if (isRulerLine(lineText(lines[i]))) return { top: i, bottom };
  }
  return null;
}

/**
 * A ÚLTIMA caixa do viewport: a última régua é a base, a régua anterior é o
 * topo, e o que está entre elas é o input. Ler de baixo para cima é o que faz
 * a função encontrar a caixa ATUAL mesmo com um transcript cheio de réguas.
 *
 * Aceita `string` (sem informação de atributo) ou `ScreenLine` (com a máscara
 * *dim*). Com a máscara, o placeholder (`Try "…"`), a dica de fila e a sugestão
 * fantasma são descartados antes de decidir se há texto — são dim, não texto.
 */
export function readInputBox(lines: readonly LineInput[]): CliInputBox {
  const located = locateInputBox(lines);
  if (!located) return { kind: 'unreadable' };
  const { top, bottom } = located;
  const inside = lines.slice(top + 1, bottom);
  if (inside.length === 0 || inside.length > MAX_INPUT_BOX_LINES) return { kind: 'unreadable' };
  if (inside.some((line) => MENU_OPTION_PATTERN.test(lineText(line)))) return { kind: 'menu' };

  // A marca se procura no texto CRU: com o turno em andamento o CLI 2.1.314 pinta o `❯` em dim (medido em
  // 30/10, com e sem statusLine), e procurá-la no texto visível dava "caixa ilegível" no meio de todo turno.
  // O que vem depois da marca continua sem as runs dim (placeholder, dica da fila, sugestão fantasma).
  const promptAt = inside.findIndex((line) => PROMPT_MARK_PATTERN.test(lineText(line)));
  if (promptAt < 0) return { kind: 'unreadable' };

  const mark = PROMPT_MARK_PATTERN.exec(lineText(inside[promptAt]));
  const shell = mark?.[1] === '!';
  // As linhas depois da marca são continuação do MESMO input lógico, quebrado
  // pela largura do terminal — junta sem separador nenhum (e sem o recuo de 2
  // colunas com que a caixa alinha as continuações).
  const text = [
    visibleTextFrom(inside[promptAt], mark?.[0].length ?? 0),
    ...inside.slice(promptAt + 1).map((line) => visibleText(line).replace(CONTINUATION_INDENT_PATTERN, '')),
  ].join('');
  if (text.trim() === '') return shell ? { kind: 'empty', shell: true } : { kind: 'empty' };
  return shell ? { kind: 'typed', text, shell: true } : { kind: 'typed', text };
}

/** Alguma linha da cauda é opção numerada de um seletor — dentro ou fora da moldura. */
export function hasMenuOption(lines: readonly LineInput[]): boolean {
  return lines.some((line) => MENU_OPTION_PATTERN.test(lineText(line)));
}

/** O prompt interativo de permissão de ferramenta está na tela. */
export function hasPermissionPrompt(lines: readonly LineInput[]): boolean {
  const joined = lines.map(lineText).join('\n');
  return PERMISSION_PROMPT_PATTERNS.some((pattern) => pattern.test(joined));
}

// Revisor, #406 (vem do #377): `hasPermissionPrompt` acha QUALQUER resto de diálogo na tela, inclusive um já
// respondido que segue visível acima da saída da ferramenta (terminal rolado, /model aberto, colagem longa que tira
// a caixa da leitura). Serve de veto de Enter, nunca para dizer "há um pedido aberto": por isso esta regra estrita,
// POSICIONAL. Um diálogo aberto é o ÚLTIMO bloco da tela: abaixo das opções só há linhas vazias e o rodapé dele.
// Os espaços são opcionais nos padrões porque o main lê o fluxo de bytes sem ANSI, onde o ConPTY os perde.
const OPEN_QUESTION = /Do\s*you\s*want\s*to\b.*\?|requires\s*confirmation/i;
const OPEN_OPTION = /^\s*(?:❯\s*)?\d+\.\s*\S/;
const OPEN_YES = /^\s*(?:❯\s*)?(\d)\.\s*Yes\s*$/;
/** O rodapé que o CLI desenha sob as opções ("Esc to cancel · Tab to amend"). */
const DIALOG_FOOTER = /Esc\s*to\s*cancel|Tab\s*to\s*amend|ctrl\+e\s*to\s*explain/i;
/** Linhas que nunca estão sob um diálogo aberto: resposta, saída de ferramenta, prompt, spinner. */
const NOT_UNDER_DIALOG = /^\s*(?:[●⎿❯>]|[·✢✳✶✻✽*]\s)/u;
/** Linhas desconhecidas (uma statusLine) aceitas sob as opções, e só junto do rodapé do diálogo. */
const MAX_UNKNOWN_UNDER_DIALOG = 2;
/** Recuo mínimo da continuação de uma opção quebrada pela largura (a opção começa na coluna 1 a 3). */
const OPTION_CONTINUATION_INDENT = 4;

function indentWidth(line: string): number {
  return line.length - line.trimStart().length;
}

function blocksDialog(line: string): boolean {
  return isRulerLine(line) || NOT_UNDER_DIALOG.test(line) || OPEN_QUESTION.test(line) || /▔{10}/.test(line);
}

/**
 * O diálogo de permissão ABERTO, lido de baixo para cima: `question` é a linha da pergunta e `last` a da última
 * opção; `null` = o último bloco da tela não é um diálogo de permissão. O topo dele pode estar fora da tela (comando
 * longo): isso continua sendo um diálogo aberto, só incompleto.
 */
export function openPermissionAt(lines: readonly LineInput[]): { readonly question: number; readonly last: number } | null {
  const plain = lines.map(lineText);
  let last = plain.length - 1;
  while (last >= 0 && !OPEN_OPTION.test(plain[last])) {
    if (plain[last].trim() !== '' && blocksDialog(plain[last])) return null;
    last -= 1;
  }
  if (last < 0) return null;
  // Debaixo da última opção: a continuação dela (colada e mais recuada), linhas vazias, o rodapé, e no máximo duas
  // linhas desconhecidas se o rodapé está lá.
  let footer = false;
  let unknown = 0;
  let continuation = true;
  for (let i = last + 1; i < plain.length; i += 1) {
    const line = plain[i];
    if (line.trim() === '') continuation = false;
    else if (continuation && indentWidth(line) >= OPTION_CONTINUATION_INDENT) continue;
    else if (DIALOG_FOOTER.test(line)) footer = true;
    else unknown += 1;
    if (line.trim() !== '') continuation = false;
  }
  if (unknown > MAX_UNKNOWN_UNDER_DIALOG || (unknown > 0 && !footer)) return null;
  // O bloco de opções, contíguo, com a opção "Yes"; acima dele (pulando linhas vazias), a pergunta.
  let yes = false;
  let i = last;
  for (; i >= 0; i -= 1) {
    const line = plain[i];
    if (OPEN_OPTION.test(line)) {
      if (OPEN_YES.test(line)) yes = true;
      continue;
    }
    if (line.trim() === '' || blocksDialog(line) || indentWidth(line) < OPTION_CONTINUATION_INDENT) break;
  }
  if (!yes) return null;
  while (i >= 0 && plain[i].trim() === '') i -= 1;
  if (i < 0 || !OPEN_QUESTION.test(plain[i])) return null;
  return { question: i, last };
}

/**
 * VETO. `false` = não escrever `\r`, ponto. É um predicado SEPARADO da
 * confirmação de propósito: um prova que falta enviar, o outro prova que
 * enviar é seguro.
 *
 * O dano de um Enter mal colocado não é submeter duas vezes (linha vazia num
 * prompt ocioso é inerte) — é RESPONDER a um diálogo: conceder confiança a uma
 * pasta, ou aprovar uma chamada de ferramenta que ninguém revisou. Por isso o
 * veto varre a cauda INTEIRA, não só a caixa: o popup pode ser desenhado fora
 * dela.
 */
export function isSafeToSendEnter(lines: readonly LineInput[]): boolean {
  if (isTrustDialogVisible(lines)) return false;
  if (hasMenuOption(lines)) return false;
  if (hasPermissionPrompt(lines)) return false;
  return true;
}
