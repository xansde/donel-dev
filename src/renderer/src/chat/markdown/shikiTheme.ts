// Shiki theme bound to the design-system's `--code-*` tokens (T051,
// design/chat-verificacao.md §4 "Paleta de código"). Same technique as Shiki's
// own css-variables theme: colors are `var(--…)` strings, so the DOM resolves
// them and the palette follows the app tokens — no hex here.
//
// Role table (approved): keyword/storage → kw · entity.name.function,
// support.function → fn · entity.name.type, support.type, support.class → ty ·
// constant.numeric, constant.language → nu · string → st · comment → cm.
import type { ThemeRegistration } from 'shiki/core';

export type CodeRole = 'tx' | 'kw' | 'fn' | 'ty' | 'nu' | 'st' | 'cm';

export const CODE_ROLE_VAR: Readonly<Record<CodeRole, string>> = {
  tx: 'var(--code-tx)',
  kw: 'var(--code-kw)',
  fn: 'var(--code-fn)',
  ty: 'var(--code-ty)',
  nu: 'var(--code-nu)',
  st: 'var(--code-st)',
  cm: 'var(--code-cm)',
};

const ROLE_SCOPES: Readonly<Record<Exclude<CodeRole, 'tx'>, readonly string[]>> = {
  kw: [
    'keyword',
    'storage',
    // Extras beyond the approved table (documented in the T051 report):
    'entity.name.tag', // HTML/JSX/XML tags read like keywords
    'keyword.operator.new',
    'keyword.operator.expression',
    'keyword.operator.word',
    'keyword.operator.logical.python',
  ],
  fn: ['entity.name.function', 'support.function', 'meta.function-call', 'entity.other.attribute-name'],
  ty: ['entity.name.type', 'support.type', 'support.class', 'entity.other.inherited-class'],
  nu: ['constant.numeric', 'constant.language'],
  st: ['string', 'markup.inserted', 'meta.diff.header.to-file'],
  cm: ['comment'],
};

export const DONEL_CODE_THEME: ThemeRegistration = {
  name: 'donel-code',
  type: 'dark',
  colors: {
    'editor.foreground': CODE_ROLE_VAR.tx,
    // The block frame paints the background (DS CodeBlock); the theme stays transparent.
    'editor.background': 'transparent',
  },
  tokenColors: [
    {
      // Symbolic operators are plain text — only WORDS are keywords. More
      // specific than `keyword`, so it wins over the kw rule below.
      scope: ['keyword.operator'],
      settings: { foreground: CODE_ROLE_VAR.tx },
    },
    ...(Object.entries(ROLE_SCOPES) as Array<[Exclude<CodeRole, 'tx'>, readonly string[]]>).map(([role, scope]) => ({
      scope: [...scope],
      settings: { foreground: CODE_ROLE_VAR[role] },
    })),
    {
      // Removed lines in a `diff` block: coral fixed = removed (D-C26).
      scope: ['markup.deleted', 'meta.diff.header.from-file'],
      settings: { foreground: 'var(--state-permission)' },
    },
  ],
};
