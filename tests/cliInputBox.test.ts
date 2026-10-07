import { describe, expect, it } from 'vitest';
import {
  hasMenuOption,
  hasPermissionPrompt,
  isRulerLine,
  isSafeToSendEnter,
  readInputBox,
} from '../src/shared/cliInputBox';
import { TRUST_DIALOG_CONFIRM_MARKER, TRUST_DIALOG_EXIT_MARKER } from '../src/shared/trustDialog';

// wi-esteira4-enter-confirmado (13/08) — o leitor da CAIXA DE INPUT do REPL.
//
// As fixtures NÃO são inventadas: as duas molduras abaixo são as capturas reais
// que este repo já versiona — `IDLE_FOOTER_NO_BANNER` de
// `tests/preTypeReadiness.test.ts` (T329, smoke `dev-mode-espelho`: texto
// pré-digitado e NUNCA enviado) e o snapshot pós-`/model sonnet` de
// `tests/liveSessionInjection.test.ts` (caixa VAZIA depois de um comando que
// de fato submeteu). São os dois estados que o auto-start precisa distinguir,
// e é de propósito que as réguas tenham comprimentos DIFERENTES (63 e 90):
// régua nunca pode ser reconhecida por igualdade.

/** Comando de fase real: caminho absoluto Windows, o pior caso de largura. */
const PHASE_COMMAND = '/esteira-implementar-3 --input "C:/Users/xansd/.donel/esteira/inbox/run-1.json"';

const RULER_63 = '───────────────────────────────────────────────────────────────';
const RULER_90 = '──────────────────────────────────────────────────────────────────────────────────────────';
const RULER_NAMED = '────────────────────────────────────────────────────────────────── model-injection-test ──';
const FOOTER = '  ⏵⏵ bypass permissions on (shift+tab to cycle)              /rc · focus';

/** O estado do BUG: o comando está escrito na caixa e nunca foi submetido. */
const BOX_TYPED = [RULER_63, `❯ ${PHASE_COMMAND}`, RULER_63, FOOTER];

/** Captura real (`liveSessionInjection.test.ts`): o comando SUBMETEU — subiu para o transcript e a caixa esvaziou. */
const BOX_EMPTY_AFTER_SUBMIT = [
  '❯ /model sonnet',
  '  ⎿  Set model to Sonnet 5 and saved as your default for new sessions',
  '                                                 Stop hook error occurred · ctrl+o to see',
  RULER_NAMED,
  '❯ ',
  RULER_90,
  '  ⏵⏵ accept edits on (shift+tab to cycle)                                             /rc',
];

describe('isRulerLine', () => {
  it('reconhece a régua da moldura em qualquer comprimento', () => {
    expect(isRulerLine(RULER_63)).toBe(true);
    expect(isRulerLine(RULER_90)).toBe(true);
  });

  it('reconhece a régua que carrega o nome da pasta à direita', () => {
    // O CLI escreve o nome do projeto DENTRO da régua de topo — comparar régua
    // por igualdade (ou exigir que só tenha traços) perderia esta.
    expect(isRulerLine(RULER_NAMED)).toBe(true);
  });

  it('linha de texto com poucos traços NÃO é régua', () => {
    // Falso positivo que quebraria tudo: resposta do modelo com tabela/travessão.
    expect(isRulerLine('  ⎿  Set model to — Sonnet 5')).toBe(false);
    expect(isRulerLine('| a | b |')).toBe(false);
    expect(isRulerLine('─── e um texto bem mais longo que a régua, com muitas palavras ───')).toBe(false);
  });

  it('linha vazia não é régua', () => {
    expect(isRulerLine('')).toBe(false);
    expect(isRulerLine('    ')).toBe(false);
  });
});

describe('readInputBox', () => {
  it('lê o comando digitado entre as réguas', () => {
    expect(readInputBox(BOX_TYPED)).toEqual({ kind: 'typed', text: PHASE_COMMAND });
  });

  it('caixa vazia depois de um comando submetido é `empty`', () => {
    expect(readInputBox(BOX_EMPTY_AFTER_SUBMIT)).toEqual({ kind: 'empty' });
  });

  it('a marca de prompt sem espaço nenhum também é caixa vazia', () => {
    // `translateToString(true)` faz trimRight — a linha '❯ ' chega como '❯'.
    expect(readInputBox([RULER_63, '❯', RULER_63, FOOTER])).toEqual({ kind: 'empty' });
  });

  it('junta as continuações do wrap num texto só', () => {
    // `getRenderedLines` não consulta `isWrapped` nem junta continuação: um
    // comando com caminho absoluto chega PARTIDO em várias linhas. Procurar o
    // comando numa linha só (`lines.some(l => l.includes(cmd))`) falharia aqui.
    const wrapped = [
      RULER_63,
      '❯ /esteira-implementar-3 --input "C:/Users/xansd/.donel/estei',
      'ra/inbox/run-1.json"',
      RULER_63,
      FOOTER,
    ];
    expect(readInputBox(wrapped)).toEqual({
      kind: 'typed',
      text: '/esteira-implementar-3 --input "C:/Users/xansd/.donel/esteira/inbox/run-1.json"',
    });
  });

  it('menu numerado dentro da moldura é `menu`, nunca texto digitado', () => {
    // O `❯` aqui é CURSOR DE SELEÇÃO, não prompt: um Enter responde o diálogo.
    const menu = [RULER_63, '❯ 1. Yes, switch to Sonnet 5', '  2. No, keep current model', RULER_63, FOOTER];
    expect(readInputBox(menu)).toEqual({ kind: 'menu' });
  });

  it('sem par de réguas o estado é `unreadable` — ausência de evidência', () => {
    expect(readInputBox(['✻ Welcome to Claude Code!', '> '])).toEqual({ kind: 'unreadable' });
    expect(readInputBox([])).toEqual({ kind: 'unreadable' });
  });

  it('uma régua só (a de topo saiu do viewport) é `unreadable`', () => {
    expect(readInputBox(['texto qualquer', RULER_63, FOOTER])).toEqual({ kind: 'unreadable' });
  });

  it('muitas linhas entre duas réguas não viram caixa', () => {
    const transcript = [RULER_63, ...Array.from({ length: 9 }, (_, i) => `❯ linha ${i}`), RULER_63];
    expect(readInputBox(transcript)).toEqual({ kind: 'unreadable' });
  });

  it('moldura sem marca de prompt é `unreadable`', () => {
    expect(readInputBox([RULER_63, '  algum aviso do CLI', RULER_63, FOOTER])).toEqual({ kind: 'unreadable' });
  });
});

describe('isSafeToSendEnter', () => {
  it('prompt ocioso com o comando digitado é seguro', () => {
    expect(isSafeToSendEnter(BOX_TYPED)).toBe(true);
    expect(isSafeToSendEnter(BOX_EMPTY_AFTER_SUBMIT)).toBe(true);
  });

  it('diálogo de confiança de pasta NUNCA é seguro', () => {
    // Um Enter aqui concede confiança à pasta sozinho.
    expect(isSafeToSendEnter([TRUST_DIALOG_CONFIRM_MARKER, TRUST_DIALOG_EXIT_MARKER])).toBe(false);
  });

  it('prompt de permissão de ferramenta NUNCA é seguro', () => {
    // O pior caso: um Enter aprovaria execução de ferramenta que ninguém
    // revisou. Com ESPAÇOS, provando que o casamento acontece no buffer
    // RENDERIZADO (é no byte stream do ConPTY que os espaços somem).
    const permissao = [
      'Bash requires confirmation for this command.',
      'Do you want to proceed?',
      '❯ 1. Yes',
      '  2. No, and tell Claude what to do differently',
    ];
    expect(isSafeToSendEnter(permissao)).toBe(false);
    expect(hasPermissionPrompt(permissao)).toBe(true);
  });

  it('opção numerada em qualquer linha da cauda veta, mesmo fora da moldura', () => {
    // O popup pode ser desenhado FORA da caixa — o veto varre a cauda inteira.
    expect(hasMenuOption([...BOX_TYPED, '❯ 1. Yes, proceed'])).toBe(true);
    expect(isSafeToSendEnter([...BOX_TYPED, '❯ 1. Yes, proceed'])).toBe(false);
  });
});
