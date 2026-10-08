import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  atMenuOpen,
  blockingScreen,
  hasQueuedMessages,
  imagePlaceholderCount,
  isReadyForInput,
  isWorking,
  modelDialog,
  pastedPlaceholder,
  readInputText,
  slashMenuOpen,
  transcriptSavingOff,
  transientMessage,
} from '../src/shared/chat/screen';
import type { ScreenLine } from '../src/shared/screenLine';

// 014-chat T037 — detectors of `src/shared/chat/screen.ts` over the screen
// fixtures of T034 (`tests/fixtures/chat/screens/`, see its README for which
// ones are real captures and which are synthetic).

const DIR = join(__dirname, 'fixtures', 'chat', 'screens');

interface Fixture {
  name: string;
  source: 'real' | 'synthetic';
  layout: 'fullscreen' | 'inline';
  lines: ScreenLine[];
}

function load(name: string): ScreenLine[] {
  const fixture = JSON.parse(readFileSync(join(DIR, `${name}.json`), 'utf8')) as Fixture;
  return fixture.lines;
}

describe('fixtures de tela (T034)', () => {
  const files = readdirSync(DIR).filter((f) => f.endsWith('.json'));

  it('existem fixtures nos dois layouts, reais e sintéticas', () => {
    const all = files.map((f) => JSON.parse(readFileSync(join(DIR, f), 'utf8')) as Fixture);
    expect(new Set(all.map((f) => f.layout))).toEqual(new Set(['fullscreen', 'inline']));
    expect(new Set(all.map((f) => f.source))).toEqual(new Set(['real', 'synthetic']));
  });

  it('toda máscara dim é uma lista de intervalos [início, fim) dentro da linha', () => {
    for (const file of files) {
      const fixture = JSON.parse(readFileSync(join(DIR, file), 'utf8')) as Fixture;
      for (const line of fixture.lines) {
        for (const [start, end] of line.dim) {
          expect(start).toBeGreaterThanOrEqual(0);
          expect(end).toBeGreaterThan(start);
          expect(end).toBeLessThanOrEqual(line.text.length);
        }
      }
    }
  });
});

interface Expectation {
  ready: boolean;
  /** `readInputText`: `null` = caixa ilegível/menu; `''` = vazia. */
  text: string | null;
  working?: boolean;
  queued?: boolean;
  slash?: boolean;
  at?: boolean;
  blocking?: { kind: string; title: string } | null;
}

const NO_BOX = { ready: false, text: null } as const;
const idle = (text = ''): Expectation => ({ ready: true, text, working: false, queued: false, blocking: null });

const TABLE: Record<string, Expectation> = {
  // ciclo de vida
  'boot-trust-dialog': { ...NO_BOX, blocking: { kind: 'trust', title: 'Quick safety check' } },
  'boot-trust-dialog-after-down': { ...NO_BOX, blocking: { kind: 'trust', title: 'Quick safety check' } },
  'boot-banner-only': { ...NO_BOX, working: false, blocking: null },
  'boot-repl-armed-inline': idle(),
  'idle-empty': idle(),
  'idle-empty-placeholder': idle(),
  'idle-typed': idle('abcdefghrstuvwxyzABCDEFGHIJKLMNO'),
  'idle-ghost-suggestion': idle(),
  working: { ready: true, text: '', working: true, queued: false, blocking: null },
  'working-queued-one': { ready: true, text: '', working: true, queued: true, blocking: null },
  'working-queued-two': { ready: true, text: '', working: true, queued: true, blocking: null },
  interrupted: idle(),
  'working-typed': { ready: true, text: 'half written message', working: true, queued: false, blocking: null },
  // caixa
  'box-shell-typed': idle('!echo spike'),
  'box-shell-placeholder': idle('!'),
  'box-multiline-3': idle('line1line2line3'),
  'box-15-lines': idle(Array.from({ length: 15 }, (_, i) => `line${i + 1}`).join('')),
  'box-long-wrapped': idle(
    'file:///C:/Users/xansd/AppData/Local/Temp/claude/C--Users-xansd-seazone-donel-dev/1dbd900d-f2d1-41bb-9c56-484f03770e11/scratchpad/research-014/b2/assets/red.png',
  ),
  'box-pasted-text-placeholder': idle('[Pasted text #11 +500 lines]'),
  'box-image-placeholder': idle('[Image #8] describe the image in 3 words'),
  // menus
  'menu-slash-open': { ...idle('/spike-help'), slash: true, at: false },
  'menu-slash-only': { ...idle('/'), slash: true, at: false },
  'menu-slash-args-closed': { ...idle('/spike-skill alpha beta'), slash: false },
  'menu-at-open': { ...idle('read @notes/al'), at: true, slash: false },
  'menu-at-no-match': { ...idle('@notes/al'), at: false },
  'menu-shortcuts-help': { ...idle(), slash: false, at: false },
  // diálogos
  'dialog-permission-inline': { ...NO_BOX, blocking: { kind: 'permission', title: 'Do you want to create spike-perm2.txt?' } },
  'dialog-question': { ...NO_BOX, blocking: { kind: 'question', title: 'Você prefere Red ou Blue?' } },
  'dialog-plan': { ...NO_BOX, blocking: { kind: 'plan', title: 'Exit plan mode?' } },
  'dialog-external-imports': { ...NO_BOX, blocking: { kind: 'external-imports', title: 'Allow external CLAUDE.md file imports?' } },
  'dialog-model': { ...NO_BOX, blocking: { kind: 'screen', title: 'Select model' } },
  // telas sem caixa (lista R16)
  'screen-resume-session': { ...NO_BOX, blocking: { kind: 'screen', title: 'Resume session' } },
  'screen-settings': { ...NO_BOX, blocking: { kind: 'screen', title: 'Settings' } },
  'screen-status': { ...NO_BOX, blocking: { kind: 'screen', title: 'Settings' } },
  'screen-usage': { ...NO_BOX, blocking: { kind: 'screen', title: 'Settings' } },
  'screen-permissions': { ...NO_BOX, blocking: { kind: 'screen', title: 'Permissions' } },
  'screen-manage-mcp-servers': { ...NO_BOX, blocking: { kind: 'screen', title: 'Manage MCP servers' } },
  'screen-hooks': { ...NO_BOX, blocking: { kind: 'screen', title: 'Hooks' } },
  'screen-memory': { ...NO_BOX, blocking: { kind: 'screen', title: 'Memory' } },
  'screen-theme': { ...NO_BOX, blocking: { kind: 'screen', title: 'Theme' } },
  'screen-skills': { ...NO_BOX, blocking: { kind: 'screen', title: 'Skills' } },
  'screen-plugins': { ...NO_BOX, blocking: { kind: 'screen', title: 'Plugins' } },
  'screen-export-conversation': { ...NO_BOX, blocking: { kind: 'screen', title: 'Export conversation' } },
  'screen-rewind': { ...NO_BOX, blocking: { kind: 'screen', title: 'Rewind' } },
  'screen-add-directory-to-workspace': { ...NO_BOX, blocking: { kind: 'screen', title: 'Add directory to workspace' } },
  'screen-background': { ...NO_BOX, blocking: { kind: 'screen', title: 'Background' } },
  'screen-effort': { ...NO_BOX, blocking: { kind: 'screen', title: 'Effort' } },
  'screen-help': { ...NO_BOX, blocking: { kind: 'screen', title: 'Help' } },
  // mensagens
  'msg-unknown-command': idle(),
  'msg-transcript-saving-off': idle(),
  'msg-ctrl-c-again': idle(),
  'msg-esc-again': idle('line oneline twoline three'),
};

describe('detectores sobre as fixtures', () => {
  it('a tabela cobre TODAS as fixtures (fixture nova exige expectativa nova)', () => {
    const names = readdirSync(DIR).filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, ''));
    expect(Object.keys(TABLE).sort()).toEqual(names.sort());
  });

  for (const [name, expected] of Object.entries(TABLE)) {
    describe(name, () => {
      const lines = load(name);

      it('isReadyForInput / readInputText', () => {
        expect(isReadyForInput(lines)).toBe(expected.ready);
        expect(readInputText(lines)).toBe(expected.text);
      });

      if (expected.blocking !== undefined) {
        it('blockingScreen', () => {
          expect(blockingScreen(lines)).toEqual(expected.blocking);
        });
      }
      if (expected.working !== undefined) {
        it('isWorking', () => {
          expect(isWorking(lines)).toBe(expected.working);
        });
      }
      if (expected.queued !== undefined) {
        it('hasQueuedMessages', () => {
          expect(hasQueuedMessages(lines)).toBe(expected.queued);
        });
      }
      if (expected.slash !== undefined) {
        it('slashMenuOpen', () => {
          expect(slashMenuOpen(lines)).toBe(expected.slash);
        });
      }
      if (expected.at !== undefined) {
        it('atMenuOpen', () => {
          expect(atMenuOpen(lines)).toBe(expected.at);
        });
      }
    });
  }
});

describe('menus só existem quando a caixa os pede', () => {
  it('slashMenuOpen / atMenuOpen são falsos em tela ociosa e em diálogo', () => {
    for (const name of ['idle-empty', 'working', 'dialog-model', 'boot-trust-dialog']) {
      expect(slashMenuOpen(load(name))).toBe(false);
      expect(atMenuOpen(load(name))).toBe(false);
    }
  });
});

describe('modelDialog', () => {
  it('lê as opções, o cursor e o modelo atual do "Select model"', () => {
    const dialog = modelDialog(load('dialog-model'));
    expect(dialog).not.toBeNull();
    expect(dialog?.options.length).toBeGreaterThanOrEqual(9);
    expect(dialog?.options[0]).toMatchObject({ index: 1, label: 'Default (recommended)' });
    expect(dialog?.cursor).toBe(5);
    expect(dialog?.current).toBe(5);
    expect(dialog?.options.find((o) => o.index === 5)?.label).toBe('Haiku 5.5');
  });

  it('é null fora do diálogo', () => {
    expect(modelDialog(load('idle-empty'))).toBeNull();
    expect(modelDialog(load('screen-permissions'))).toBeNull();
  });
});

describe('transcriptSavingOff', () => {
  it('detecta o aviso "Transcript saving is off"', () => {
    expect(transcriptSavingOff(load('msg-transcript-saving-off'))).toBe(true);
    expect(transcriptSavingOff(load('idle-empty'))).toBe(false);
  });
});

describe('pastedPlaceholder / imagePlaceholderCount', () => {
  it('lê [Pasted text #N +M lines] da caixa', () => {
    expect(pastedPlaceholder(load('box-pasted-text-placeholder'))).toEqual({ id: 11, lines: 500 });
    expect(pastedPlaceholder(load('idle-empty'))).toBeNull();
  });

  it('conta os [Image #N] da caixa', () => {
    expect(imagePlaceholderCount(load('box-image-placeholder'))).toBe(1);
    expect(imagePlaceholderCount(load('idle-empty'))).toBe(0);
  });

  it('só olha a caixa: o eco no transcript não conta', () => {
    const lines: ScreenLine[] = [
      { text: '❯ [Image #8] describe it', dim: [] },
      { text: '  ⎿  [Image #8]', dim: [] },
      { text: '─'.repeat(100), dim: [] },
      { text: '❯ ', dim: [] },
      { text: '─'.repeat(100), dim: [] },
      { text: '  ? for shortcuts', dim: [[2, 17]] },
    ];
    expect(imagePlaceholderCount(lines)).toBe(0);
  });
});

describe('transientMessage', () => {
  it('reconhece as mensagens transitórias do CLI', () => {
    expect(transientMessage(load('msg-unknown-command'))).toBe('unknown-command');
    expect(transientMessage(load('msg-ctrl-c-again'))).toBe('ctrl-c-again');
    expect(transientMessage(load('msg-esc-again'))).toBe('esc-again');
    expect(transientMessage(load('idle-empty'))).toBeNull();
  });
});

describe('gate de prontidão (send-protocol §1)', () => {
  it('sem caixa, ou com diálogo, nunca está pronto', () => {
    for (const name of ['boot-banner-only', 'boot-trust-dialog', 'dialog-permission-inline', 'dialog-question', 'dialog-plan', 'screen-hooks']) {
      expect(isReadyForInput(load(name))).toBe(false);
    }
  });

  it('o rodapé é obrigatório: caixa pintada sem rodapé ainda não está pronta', () => {
    const lines = load('idle-empty').slice(0, -1);
    expect(isReadyForInput(lines)).toBe(false);
  });

  it('aceita entrada de strings simples (sem máscara dim)', () => {
    const plain = load('idle-empty').map((l) => l.text);
    expect(isReadyForInput(plain)).toBe(true);
  });
});
