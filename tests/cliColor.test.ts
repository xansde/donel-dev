import { describe, expect, it } from 'vitest';
import {
  CLI_COLOR_NAMES,
  cliColorNameToHex,
  extractCliColorName,
  extractCliColorNameFromLine,
  isCliColorName,
} from '../src/shared/cliColor';

// Fix #19 — a faixa de cor da aba lê o `/color` do CLI direto do transcript
// (não há UI de cor no app). Linha real observada num transcript do próprio
// donel-dev (esclarecimento do Alexandre, 03/08):
// {"type":"system","subtype":"local_command",
//  "content":"<local-command-stdout>Session color set to: blue</local-command-stdout>",
//  "sessionId":"…"}

const colorLine = (content: string, extra: Record<string, unknown> = {}): string =>
  JSON.stringify({ type: 'system', subtype: 'local_command', content, sessionId: 'abc-123', ...extra });

const stdout = (color: string): string => `<local-command-stdout>Session color set to: ${color}</local-command-stdout>`;

const userLine = (text: string): string =>
  JSON.stringify({ type: 'user', message: { role: 'user', content: text } });

describe('extractCliColorNameFromLine', () => {
  it('extrai o nome da cor de uma linha válida', () => {
    expect(extractCliColorNameFromLine(colorLine(stdout('blue')))).toBe('blue');
  });

  it('normaliza para minúsculo', () => {
    expect(extractCliColorNameFromLine(colorLine(stdout('BLUE')))).toBe('blue');
  });

  it('devolve null para linha que não é system/local_command', () => {
    expect(extractCliColorNameFromLine(userLine('/color blue'))).toBeNull();
  });

  it('devolve null para local_command sem "Session color set to"', () => {
    expect(extractCliColorNameFromLine(colorLine('<local-command-stdout>ok</local-command-stdout>'))).toBeNull();
  });

  it('devolve null para JSON inválido/linha cortada (leitura de cauda)', () => {
    expect(extractCliColorNameFromLine('{"type":"system","subtype":"local_c')).toBeNull();
  });

  it('devolve null para linha vazia', () => {
    expect(extractCliColorNameFromLine('')).toBeNull();
    expect(extractCliColorNameFromLine('   ')).toBeNull();
  });

  it('filtra por sessionId quando informado', () => {
    expect(extractCliColorNameFromLine(colorLine(stdout('red')), 'abc-123')).toBe('red');
    expect(extractCliColorNameFromLine(colorLine(stdout('red')), 'outra-sessao')).toBeNull();
  });

  it('não filtra quando a linha não carrega sessionId', () => {
    const raw = JSON.stringify({ type: 'system', subtype: 'local_command', content: stdout('green') });
    expect(extractCliColorNameFromLine(raw, 'abc-123')).toBe('green');
  });
});

describe('extractCliColorName', () => {
  it('devolve null quando não há nenhuma linha de cor', () => {
    const tail = [userLine('oi'), userLine('tudo bem?')].join('\n');
    expect(extractCliColorName(tail)).toBeNull();
  });

  it('devolve a ÚLTIMA cor quando o operador trocou várias vezes na mesma sessão', () => {
    // Caso real da issue #19: `/color blue` seguido de `/color red`, 22s depois.
    const tail = [colorLine(stdout('blue')), userLine('trabalhando'), colorLine(stdout('red'))].join('\n');
    expect(extractCliColorName(tail)).toBe('red');
  });

  it('ignora linhas malformadas no meio da varredura e ainda acha a cor válida anterior', () => {
    const tail = [colorLine(stdout('purple')), '{"type":"system","subtype":"local_c'].join('\n');
    expect(extractCliColorName(tail)).toBe('purple');
  });

  it('devolve null para tail vazio', () => {
    expect(extractCliColorName('')).toBeNull();
  });
});

describe('cliColorNameToHex', () => {
  it('mapeia cada uma das 8 cores conhecidas do CLI para um hex', () => {
    for (const name of CLI_COLOR_NAMES) {
      const hex = cliColorNameToHex(name);
      expect(hex).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it('devolve null para cor desconhecida — nunca chuta', () => {
    expect(cliColorNameToHex('turquoise')).toBeNull();
  });

  it('devolve null para null/undefined/vazio', () => {
    expect(cliColorNameToHex(null)).toBeNull();
    expect(cliColorNameToHex(undefined)).toBeNull();
    expect(cliColorNameToHex('')).toBeNull();
  });
});

describe('isCliColorName', () => {
  it('reconhece as 8 cores do CLI', () => {
    for (const name of CLI_COLOR_NAMES) {
      expect(isCliColorName(name)).toBe(true);
    }
  });

  it('rejeita nome fora da lista', () => {
    expect(isCliColorName('turquoise')).toBe(false);
    expect(isCliColorName('')).toBe(false);
  });
});
