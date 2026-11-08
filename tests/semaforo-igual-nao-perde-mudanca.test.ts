import { describe, expect, it } from 'vitest';
import type { SemaphoreStateInfo } from '../src/shared';
import { sameSemaphoreInfo } from '../src/renderer/src/sameSemaphoreInfo';

// O app guarda o estado de cada aba só quando ele muda (peso do renderer, 08/11). Uma mudança vista como "igual"
// deixaria o estado parado, e a entrega de mensagens entre sessões esperaria por nada.
describe('estado do semáforo: igual só quando tudo é igual', () => {
  const base: SemaphoreStateInfo = { state: 'working', stateEnteredAt: 1000, pendingKinds: ['permission'] };

  it('o mesmo estado repetido pela ponte é igual', () => {
    expect(sameSemaphoreInfo(base, { ...base, pendingKinds: ['permission'] })).toBe(true);
  });

  it('qualquer campo que muda, ou que aparece ou some, é mudança', () => {
    expect(sameSemaphoreInfo(undefined, base)).toBe(false);
    expect(sameSemaphoreInfo(base, { ...base, state: 'waiting' })).toBe(false);
    expect(sameSemaphoreInfo(base, { ...base, stateEnteredAt: 2000 })).toBe(false);
    expect(sameSemaphoreInfo(base, { ...base, pendingKinds: ['permission', 'question'] })).toBe(false);
    expect(sameSemaphoreInfo(base, { ...base, turnFailure: 'rate_limit' })).toBe(false);
    expect(sameSemaphoreInfo(base, { ...base, unconfirmed: true })).toBe(false);
    const { pendingKinds: _gone, ...withoutKinds } = base;
    expect(sameSemaphoreInfo(base, withoutKinds)).toBe(false);
    // A field the type does not know yet still counts.
    expect(sameSemaphoreInfo(base, { ...base, futureField: 1 } as SemaphoreStateInfo)).toBe(false);
  });
});
