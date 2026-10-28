import { describe, expect, it } from 'vitest';
import { toGerund } from '../src/shared/chat/gerund';
import { deriveFooter, expiredStopRequest, formatElapsed, STOP_TIMEOUT_MS, stopFeedback } from '../src/renderer/src/chat/workingFooterModel';
import type { ConversationRow, LiveAction, LiveState } from '../src/shared/chat/rows';

const action = (verb: string, target?: string): LiveAction => ({
  toolUseId: 't1',
  tool: 'Bash',
  summary: target ? { verb, target } : { verb },
  startedAt: '2026-10-08T10:00:00.000Z',
  scope: 'main',
});

const live = (patch: Partial<LiveState> = {}): LiveState => ({
  status: 'working',
  currentAction: null,
  pendings: [],
  sends: [],
  activeSubagents: [],
  terminalNeeded: null,
  ...patch,
});

let seq = 0;
const row = (kind: string, extra: Record<string, unknown> = {}): ConversationRow =>
  ({ id: `${kind}-${seq++}`, kind, turnId: null, at: '2026-10-08T10:00:00.000Z', scope: 'main', ...extra }) as unknown as ConversationRow;
const interrupted = (): ConversationRow => row('notice', { notice: 'interrupted', params: {} });

describe('toGerund', () => {
  it.each([
    ['Leu', 'Lendo'],
    ['Editou', 'Editando'],
    ['Escreveu', 'Escrevendo'],
    ['Reescreveu', 'Reescrevendo'],
    ['Criou', 'Criando'],
    ['Rodou', 'Rodando'],
    ['Rodou em segundo plano', 'Rodando em segundo plano'],
    ['Abriu', 'Abrindo'],
    ['Viu a imagem', 'Vendo a imagem'],
    ['Leu o PDF', 'Lendo o PDF'],
    ['Pesquisou na web', 'Pesquisando na web'],
    ['Lançou subagente', 'Lançando subagente'],
    ['Usou a skill', 'Usando a skill'],
    ['Atualizou a lista de tarefas', 'Atualizando a lista de tarefas'],
  ])('%s -> %s', (past, gerund) => {
    expect(toGerund(past)).toBe(gerund);
  });

  it('leaves an unknown shape untouched', () => {
    expect(toGerund('Foo')).toBe('Foo');
    expect(toGerund('')).toBe('');
  });
});

describe('formatElapsed', () => {
  it('formats m:ss', () => {
    expect(formatElapsed(0)).toBe('0:00');
    expect(formatElapsed(7_400)).toBe('0:07');
    expect(formatElapsed(65_000)).toBe('1:05');
    expect(formatElapsed(3_725_000)).toBe('62:05');
    expect(formatElapsed(-5)).toBe('0:00');
  });
});

describe('deriveFooter', () => {
  it('keeps the footer (and Parar) while a pending is open and the status is waiting', () => {
    const pending = { id: 'p1' } as unknown as LiveState['pendings'][number];
    expect(deriveFooter({ live: live({ status: 'waiting-you' as LiveState['status'], pendings: [pending] }), rows: [], lastAction: null })).toMatchObject({ kind: 'working' });
    expect(deriveFooter({ live: live({ status: 'idle' as LiveState['status'] }), rows: [], lastAction: null })).toBeNull();
  });
  it.each(['question', 'permission', 'plan'] as const)('names the open %s pending instead of a bare "trabalhando"', (kind) => {
    const pending = { id: 'p1', kind } as unknown as LiveState['pendings'][number];
    expect(deriveFooter({ live: live({ status: 'waiting-you' as LiveState['status'], pendings: [pending] }), rows: [], lastAction: null })).toEqual({
      kind: 'working',
      waitingSubagents: 0,
      waitingFor: kind,
    });
  });

  it('shows the live action in gerund', () => {
    const f = deriveFooter({ live: live({ currentAction: action('Rodou', 'npm test') }), rows: [], lastAction: null });
    expect(f).toEqual({ kind: 'working', verb: 'Rodando', target: 'npm test', waitingSubagents: 0, actionStartedAt: '2026-10-08T10:00:00.000Z' });
  });

  it('says "pensando" when there is no action and no subagent (owner, 28/10: the chat must show it is alive)', () => {
    expect(deriveFooter({ live: live(), rows: [], lastAction: null })).toEqual({ kind: 'working', waitingSubagents: 0, thinking: true });
  });

  it('counts subagents when only they remain (D-C18)', () => {
    expect(deriveFooter({ live: live({ activeSubagents: ['a', 'b'] }), rows: [], lastAction: null })).toEqual({
      kind: 'working',
      waitingSubagents: 2,
    });
  });

  it('an action wins over the subagent count', () => {
    const f = deriveFooter({ live: live({ activeSubagents: ['a'], currentAction: action('Leu', 'x.ts') }), rows: [], lastAction: null });
    expect(f).toMatchObject({ kind: 'working', verb: 'Lendo', waitingSubagents: 0, alsoSubagents: 1 });
  });

  it('is hidden when idle and nothing was interrupted', () => {
    expect(deriveFooter({ live: live({ status: 'idle' }), rows: [row('user'), row('assistant')], lastAction: null })).toBeNull();
    expect(deriveFooter({ live: null, rows: [], lastAction: null })).toBeNull();
  });

  it('shows "Interrompido" when the last user/notice row is the interruption', () => {
    const f = deriveFooter({ live: live({ status: 'idle' }), rows: [row('user'), interrupted()], lastAction: action('Rodou', 'npm test') });
    expect(f).toEqual({ kind: 'interrupted', after: { verb: 'Rodou', target: 'npm test' } });
  });

  it('a user row after the interruption clears the state', () => {
    expect(deriveFooter({ live: live({ status: 'idle' }), rows: [interrupted(), row('user')], lastAction: null })).toBeNull();
  });

  it('a screen that is working again wins over the old interruption marker', () => {
    expect(deriveFooter({ live: live(), rows: [interrupted()], lastAction: null, screenWorking: true })?.kind).toBe('working');
  });

  it('the CLI fires no Stop on interrupt: status stays working, the marker + an idle screen say interrupted', () => {
    expect(deriveFooter({ live: live(), rows: [interrupted()], lastAction: null, screenWorking: false })?.kind).toBe('interrupted');
  });

  it('with the screen unknown, a working status and the marker keep reading as interrupted', () => {
    expect(deriveFooter({ live: live(), rows: [row('user'), interrupted()], lastAction: null })?.kind).toBe('interrupted');
  });

  it('skips trailing rows that are not user/notice when looking for the interruption', () => {
    const rows = [row('user'), interrupted(), row('action')];
    expect(deriveFooter({ live: live({ status: 'idle' }), rows, lastAction: null })?.kind).toBe('interrupted');
  });
});

describe('stopFeedback (retorno do Parar/Esc)', () => {
  it('sem pedido: nada', () => {
    expect(stopFeedback(null, 10_000)).toBe('none');
  });

  it('dentro do teto: "parando…"', () => {
    expect(stopFeedback(1000, 1000)).toBe('stopping');
    expect(stopFeedback(1000, 1000 + STOP_TIMEOUT_MS - 1)).toBe('stopping');
  });

  it('vencido o teto: volta ao normal com o aviso (stuck)', () => {
    expect(stopFeedback(1000, 1000 + STOP_TIMEOUT_MS)).toBe('stuck');
  });

  it('pedido que não escreveu nada já nasce vencido', () => {
    expect(stopFeedback(expiredStopRequest(50_000), 50_000)).toBe('stuck');
  });
});
