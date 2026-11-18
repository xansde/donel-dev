// t-e195b35c — the hooks' deadlines. A hook that waits on the PC's app holds the session while the app does not answer:
// with 10 s on every tool call (and a day on PermissionRequest) a busy app froze every session of the VPS (18/11,
// 08h13–08h45). A short deadline lets the CLI go on by itself.
import { describe, expect, it } from 'vitest';
import { buildSessionHooksSettings } from '../src/main/hooks-settings';

describe('prazos dos hooks de sessão', () => {
  it('todo hook http espera no máximo 2 s, e o pedido de permissão 30 s', () => {
    const settings = buildSessionHooksSettings({ port: 47900, token: 't'.repeat(32), tokenHeaderPath: '/tmp/h', curlPath: 'curl' });
    const http = Object.entries(settings.hooks).flatMap(([event, groups]) =>
      groups.flatMap((group) => group.hooks.filter((hook) => hook.type === 'http').map((hook) => [event, hook.timeout] as const)),
    );
    expect(http.length).toBeGreaterThan(5);
    for (const [event, timeout] of http) expect(timeout, event).toBe(event === 'PermissionRequest' ? 30 : 2);
  });
});
