// Navegador integrado — two owners with a generation (docs/design/navegador-interno.md, D11/D12).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BrowserControl } from '../src/shared/browser/control';

describe('BrowserControl', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('a late Devolver of an old Assumir is ignored; the current one gives the browser back', () => {
    const control = new BrowserControl();
    const old = control.takeOver();
    const current = control.takeOver();
    expect(control.handBack(old)).toBe(false);
    expect(control.snapshot()).toMatchObject({ owner: 'human', generation: current });
    expect(control.handBack(current)).toBe(true);
    expect(control.snapshot().owner).toBe('agent');
  });

  it('the agent waits while the owner drives, and gives up at the ceiling', async () => {
    const control = new BrowserControl();
    const generation = control.takeOver();
    const released = control.waitForAgentTurn(10 * 60_000);
    control.handBack(generation);
    expect(await released).toBe('ok');

    control.takeOver();
    const stuck = control.waitForAgentTurn(10 * 60_000);
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(await stuck).toBe('timeout');
    expect(control.snapshot().owner).toBe('human');
  });

  it('askHuman withdraws its own request at the ceiling, but keeps an Assumir the owner made in between', async () => {
    const control = new BrowserControl();
    const first = control.askHuman('captcha', 1000);
    expect(control.snapshot()).toMatchObject({ owner: 'human', reason: 'captcha', requestedByAgent: true });
    await vi.advanceTimersByTimeAsync(1000);
    expect(await first).toBe('timeout');
    expect(control.snapshot().owner).toBe('agent');

    const second = control.askHuman('2FA', 1000);
    const ownerGeneration = control.takeOver();
    await vi.advanceTimersByTimeAsync(1000);
    expect(await second).toBe('timeout');
    expect(control.snapshot()).toMatchObject({ owner: 'human', generation: ownerGeneration });
  });
});
