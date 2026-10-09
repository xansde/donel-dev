import { describe, expect, it } from 'vitest';
import {
  actionDetailPart,
  dsActionCategory,
  dsActionStatus,
  formatClock,
  formatDuration,
  isCommandText,
  noticeContent,
  parseExitCode,
  progressiveVerb,
  splitStats,
  stripImageMarkers,
  subagentStateText,
} from '../src/renderer/src/chat/rows/format';

describe('formatClock', () => {
  it('formats hh:mm in the given zone', () => {
    expect(formatClock('2026-10-07T17:05:09.000Z', 'UTC')).toBe('17:05');
    expect(formatClock('2026-10-07T17:05:09.000Z', 'America/Sao_Paulo')).toBe('14:05');
  });
  it('returns an empty string for an invalid instant', () => {
    expect(formatClock('lixo', 'UTC')).toBe('');
  });
});

describe('formatDuration', () => {
  it.each([
    [300, '0,3 s'],
    [6400, '6,4 s'],
    [6000, '6 s'],
    [42_000, '42 s'],
    [60_000, '1 min'],
    [161_000, '2 min 41 s'],
    [3_660_000, '61 min'],
  ])('%i ms -> %s', (ms, expected) => {
    expect(formatDuration(ms)).toBe(expected);
  });
  it('is empty for missing or negative values', () => {
    expect(formatDuration(undefined)).toBe('');
    expect(formatDuration(-5)).toBe('');
  });
});

describe('progressiveVerb (D-C4: gerund while running)', () => {
  it.each([
    ['Leu', 'Lendo'],
    ['Editou', 'Editando'],
    ['Rodou', 'Rodando'],
    ['Rodou em segundo plano', 'Rodando em segundo plano'],
    ['Buscou', 'Buscando'],
    ['Listou', 'Listando'],
    ['Criou', 'Criando'],
    ['Reescreveu', 'Reescrevendo'],
    ['Abriu', 'Abrindo'],
    ['Viu a imagem', 'Vendo a imagem'],
    ['Leu o PDF', 'Lendo o PDF'],
    ['Pesquisou na web', 'Pesquisando na web'],
    ['Atualizou a lista de tarefas', 'Atualizando a lista de tarefas'],
    ['Usou', 'Usando'],
  ])('%s -> %s', (past, gerund) => {
    expect(progressiveVerb(past)).toBe(gerund);
  });
  it('leaves an unknown shape untouched', () => {
    expect(progressiveVerb('Pronto')).toBe('Pronto');
    expect(progressiveVerb('')).toBe('');
  });
});

describe('splitStats', () => {
  it('splits "+a −b" into numbers', () => {
    expect(splitStats('+12 −3')).toEqual({ added: 12, removed: 3 });
    expect(splitStats('+0 -4')).toEqual({ added: 0, removed: 4 });
  });
  it('keeps any other stats as text', () => {
    expect(splitStats('linhas 10–20')).toEqual({ text: 'linhas 10–20' });
    expect(splitStats('em 6 arquivos')).toEqual({ text: 'em 6 arquivos' });
  });
  it('is empty without stats', () => {
    expect(splitStats(undefined)).toEqual({});
    expect(splitStats('')).toEqual({});
  });
});

describe('parseExitCode (D-C3: only when the result starts with "Exit code N")', () => {
  it('reads and strips the first line', () => {
    expect(parseExitCode('Exit code 1\nFAIL x\nboom')).toEqual({ exitCode: 1, body: 'FAIL x\nboom' });
    expect(parseExitCode('Exit code 127\r\nnot found')).toEqual({ exitCode: 127, body: 'not found' });
  });
  it('does not guess from the rest of the output', () => {
    expect(parseExitCode('ok\nExit code 2')).toEqual({ body: 'ok\nExit code 2' });
    expect(parseExitCode('42 tests passed')).toEqual({ body: '42 tests passed' });
    expect(parseExitCode('')).toEqual({ body: '' });
  });
});

describe('stripImageMarkers', () => {
  it('drops the [Image #n] markers', () => {
    expect(stripImageMarkers('olha [Image #1] e [Image #2]\nisto')).toBe('olha e\nisto');
    expect(stripImageMarkers('[Image #1]')).toBe('');
    expect(stripImageMarkers('sem marcador')).toBe('sem marcador');
  });
});

describe('isCommandText (D-C11: mono for / and !)', () => {
  it('detects / and ! prefixes', () => {
    expect(isCommandText('/model sonnet')).toBe(true);
    expect(isCommandText('!ls')).toBe(true);
    expect(isCommandText('  /color red')).toBe(true);
    expect(isCommandText('oi /não')).toBe(false);
    expect(isCommandText('')).toBe(false);
  });
});

describe('DS mapping', () => {
  it('maps categories to the DS icons', () => {
    expect(dsActionCategory('read')).toBe('read');
    expect(dsActionCategory('edit')).toBe('edit');
    expect(dsActionCategory('write')).toBe('edit');
    expect(dsActionCategory('bash')).toBe('command');
    expect(dsActionCategory('search')).toBe('search');
    expect(dsActionCategory('skill')).toBe('skill');
    for (const c of ['web', 'agent', 'mcp', 'task', 'other'] as const) expect(dsActionCategory(c)).toBe('tool');
  });
  it('maps statuses (ok -> done, error -> failed)', () => {
    expect(dsActionStatus('ok')).toBe('done');
    expect(dsActionStatus('error')).toBe('failed');
    expect(dsActionStatus('running')).toBe('running');
    expect(dsActionStatus('denied')).toBe('denied');
    expect(dsActionStatus('interrupted')).toBe('interrupted');
  });
  it('picks the detail part by category', () => {
    expect(actionDetailPart('edit')).toBe('diff');
    expect(actionDetailPart('write')).toBe('diff');
    expect(actionDetailPart('bash')).toBe('output');
    expect(actionDetailPart('search')).toBe('files');
    expect(actionDetailPart('mcp')).toBe('raw');
    expect(actionDetailPart('other')).toBe('raw');
    expect(actionDetailPart('read')).toBeNull();
    expect(actionDetailPart('skill')).toBeNull();
  });
});

describe('noticeContent (G3 tones, params -> text)', () => {
  it('compact shows the token drop', () => {
    expect(noticeContent('compact', { preTokens: 180_000, postTokens: 12_400 })).toMatchObject({
      text: 'conversa compactada · 180k → 12k',
      tone: 'muted',
    });
    expect(noticeContent('compact', {}).text).toBe('conversa compactada');
  });
  it('limit and api-error are amber', () => {
    expect(noticeContent('limit', {})).toMatchObject({ text: 'Limite da conta atingido', tone: 'warn' });
    expect(noticeContent('api-error', { status: 529 })).toMatchObject({
      text: 'Erro da API — a rodada parou',
      tone: 'warn',
    });
  });
  it('interrupted and informational follow the source', () => {
    expect(noticeContent('interrupted', {})).toMatchObject({ text: 'Interrompido', tone: 'muted' });
    expect(noticeContent('informational', { text: 'oi' })).toMatchObject({ text: 'oi', tone: 'muted' });
    expect(noticeContent('informational', { text: 'cuidado', level: 'warning' })).toMatchObject({ tone: 'warn' });
  });
  it('account switch shows only the label, never an e-mail', () => {
    expect(noticeContent('account-switch', { label: 'Conta 2' }).text).toBe('Conta trocada para Conta 2');
    expect(noticeContent('account-switch', {}).text).toBe('Conta trocada');
    expect(noticeContent('account-switch', { label: 'a@b.com' }).text).toBe('Conta trocada');
  });
  it('conversation switch has its own text for /resume', () => {
    expect(noticeContent('conversation-switch', { reason: 'clear' }).text).toBe(
      'Conversa nova — a anterior está em Sessões anteriores',
    );
    expect(noticeContent('conversation-switch', {}).text).toBe('Conversa nova — a anterior está em Sessões anteriores');
    expect(noticeContent('conversation-switch', { reason: 'resume' }).text).toBe(
      'Conversa retomada — a anterior está em Sessões anteriores',
    );
  });
  it('generated file carries name and path for the "abrir" action', () => {
    expect(noticeContent('generated-file', { name: 'relatorio.html', path: 'C:\\x\\relatorio.html' })).toMatchObject({
      text: 'Gerou',
      fileName: 'relatorio.html',
      filePath: 'C:\\x\\relatorio.html',
    });
  });
});

describe('subagentStateText', () => {
  it('composes "falhou em <tempo>" and keeps the DS label otherwise', () => {
    expect(subagentStateText('failed', 12_000)).toBe('Falhou em 12 s');
    expect(subagentStateText('failed', undefined)).toBeUndefined();
    expect(subagentStateText('running', 5000)).toBeUndefined();
    expect(subagentStateText('unknown', undefined)).toBeUndefined();
  });
});
