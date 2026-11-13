import { describe, expect, it } from 'vitest';
import { emptyLedgerDoc, type LedgerDoc, type LedgerEvent, type LedgerTask } from '../src/shared/ledger/contract';
import { hourlyRhythm, lastLaunchAt, silenceNotice, SILENCE_ALERT_MS } from '../src/shared/ledger/ritmo';

// t-23f0297d — the Líder único must hear when the ledger goes quiet while sessions work, and the app's own
// end-of-turn records must not hide that silence (they write themselves every turn).

const H = 60 * 60 * 1000;
const T0 = new Date(2026, 10, 13, 9, 0, 0).getTime();
const lugar = { kind: 'lugar', placeId: 'place:dev' } as const;

function task(id: string, events: LedgerEvent[]): LedgerTask {
  return { id, projectPath: 'C:/proj/atlas', request: 'x', doneWhen: 'y', due: '2026-11-14', ownerPlaceId: 'place:dev', risk: 'baixo', state: 'em-execucao', createdAt: events[0]!.at, events } as LedgerTask;
}

function doc(...tasks: LedgerTask[]): LedgerDoc {
  return { ...emptyLedgerDoc(), tasks: Object.fromEntries(tasks.map((t) => [t.id, t])) };
}

const LEDGER = doc(
  task('t-a', [
    { kind: 'criada', at: T0, by: { kind: 'dono' } },
    { kind: 'criada', at: T0 + 10 * 60_000, by: { kind: 'dono' }, text: '⟦priorizada 1⟧' },
    { kind: 'assumida', at: T0 + 20 * 60_000, by: lugar },
    { kind: 'comentada', at: T0 + 30 * 60_000, by: lugar, text: '⟦andamento⟧ estado: trabalhando\nprova: PR' },
    // The app's own end of turn, 2 h later: it is no launch.
    { kind: 'comentada', at: T0 + 2 * H, by: lugar, text: '⟦andamento⟧ estado: turno-encerrado\nresumo: fiz x' },
  ]),
);

describe('ritmo do Oráculo', () => {
  it('o fim de turno automático e as marcas de organização não contam como lançamento', () => {
    expect(lastLaunchAt(LEDGER)).toBe(T0 + 30 * 60_000);
    const hours = hourlyRhythm(LEDGER, T0 + 2 * H + 5 * 60_000, 3);
    expect(hours.map((h) => h.total)).toEqual([3, 0, 0]);
    expect(hours[0]!.counts).toMatchObject({ criada: 1, andamento: 1, outro: 1 });
  });

  it('avisa o Líder único depois de 1 h sem lançamento com sessão trabalhando, uma vez por silêncio', () => {
    const last = lastLaunchAt(LEDGER)!;
    const late = last + SILENCE_ALERT_MS + 5 * 60_000;
    const notice = silenceNotice({ lastLaunchAt: last, working: 3, now: late, alertedFor: null });
    expect(notice).toContain('1 h 05 min sem lançamento');
    expect(notice).toContain('3 sessões trabalhando');
    // Already heard about this silence; too soon; nobody working; empty ledger.
    expect(silenceNotice({ lastLaunchAt: last, working: 3, now: late, alertedFor: last })).toBeNull();
    expect(silenceNotice({ lastLaunchAt: last, working: 3, now: last + SILENCE_ALERT_MS - 1, alertedFor: null })).toBeNull();
    expect(silenceNotice({ lastLaunchAt: last, working: 0, now: late, alertedFor: null })).toBeNull();
    expect(silenceNotice({ lastLaunchAt: null, working: 3, now: late, alertedFor: null })).toBeNull();
  });
});
