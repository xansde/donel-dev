// FIX (auditoria rodada 5, achado baixa — Fix 1 sem cobertura de unidade).
import { describe, expect, it } from 'vitest';
import { isTrustDialogVisible, trustDialogKind } from '../src/shared/trustDialog';

describe('isTrustDialogVisible', () => {
  it('detecta o diálogo quando as duas linhas do rodapé estão presentes (qualquer posição)', () => {
    const lines = [
      ' Quick safety check: Is this a project you created or one you trust?',
      ' ❯ 1. Yes, I trust this folder',
      '   2. No, exit',
      ' Enter to confirm · Esc to cancel ',
    ];
    expect(isTrustDialogVisible(lines)).toBe(true);
  });

  it('NÃO detecta com só a primeira linha pintada (achado alta original — diálogo ainda desenhando)', () => {
    const lines = [' Quick safety check: Is this a project you created or one you trust?', ' ❯ 1. Yes, I trust this folder'];
    expect(isTrustDialogVisible(lines)).toBe(false);
  });

  it('NÃO detecta texto digitado pelo usuário citando "trust this folder" sem o resto da assinatura (achado media — janela sem SessionStart)', () => {
    const lines = ['> por que aparece o trust this folder na aba boot?'];
    expect(isTrustDialogVisible(lines)).toBe(false);
  });

  it('NÃO detecta buffer vazio', () => {
    expect(isTrustDialogVisible([])).toBe(false);
  });

  it('detecta mesmo com as duas linhas fora de ordem entre si', () => {
    const lines = [' Enter to confirm · Esc to cancel ', '   2. No, exit'];
    expect(isTrustDialogVisible(lines)).toBe(true);
  });
});

// 014-chat T035 — textos da 2.1.293 (capturas reais em `tests/fixtures/chat/screens/boot-trust-dialog.json`).
describe('isTrustDialogVisible — CLI 2.1.293', () => {
  const REAL_2_1_293 = [
    ' Accessing workspace:',
    '',
    ' Quick safety check: Is this a project you created or one you trust? (Like your own code, a well-known open source',
    " project, or work from your team). If not, take a moment to review what's in this folder first.",
    '',
    ' ❯ No, exit',
    '   Yes, I trust this folder',
    '',
    ' Enter to confirm · Esc to cancel',
  ];

  it('detecta o diálogo pelos textos da 2.1.293 (sem "2. No, exit")', () => {
    expect(isTrustDialogVisible(REAL_2_1_293)).toBe(true);
    expect(trustDialogKind(REAL_2_1_293)).toBe('trust');
  });

  it('aceita linhas com máscara dim (o rodapé do diálogo pode vir dim)', () => {
    const lines = REAL_2_1_293.map((text) => ({ text, dim: text.includes('Enter to confirm') ? ([[1, text.length]] as Array<[number, number]>) : [] }));
    expect(isTrustDialogVisible(lines)).toBe(true);
  });

  it('com o rodapé ainda não pintado, NÃO detecta (Enter engolido)', () => {
    expect(isTrustDialogVisible(REAL_2_1_293.slice(0, -1))).toBe(false);
  });

  it('texto digitado citando "Quick safety check" não basta', () => {
    expect(isTrustDialogVisible(['❯ o que é o Quick safety check do claude?'])).toBe(false);
    expect(trustDialogKind(['❯ o que é o Quick safety check do claude?'])).toBeNull();
  });

  it('diálogo "external imports" também é diálogo de confiança', () => {
    const lines = [
      ' Allow external CLAUDE.md file imports?',
      ' ❯ Yes, allow external imports',
      '   No, disable external imports',
      ' Enter to confirm · Esc to cancel',
    ];
    expect(isTrustDialogVisible(lines)).toBe(true);
    expect(trustDialogKind(lines)).toBe('external-imports');
  });

  it('o marcador legado "2. No, exit" continua valendo (CLI antigo)', () => {
    expect(isTrustDialogVisible([' Enter to confirm · Esc to cancel', '   2. No, exit'])).toBe(true);
  });
});
