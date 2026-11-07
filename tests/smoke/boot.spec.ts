import { expect, test } from '@playwright/test';
import { closeIsolatedApp, dismissPatchNotes, launchIsolatedApp } from './helpers/launch';
import { launchClaudeTab } from './helpers/ui';

// O único smoke da suíte (decisão do dono, 03/11: testes "o mais próximo de
// zero"). Prova o que nenhum teste unitário prova: o app buildado abre, o
// preload expõe a API e uma sessão nasce num PTY de verdade (node-pty casando
// com a ABI do Electron), com o CLI falso — sem cota, sem conta real.
// Uma abertura do app, isolada em userData próprio.

test('o app abre e uma sessão nasce num PTY', async () => {
  test.setTimeout(90_000);
  const launched = await launchIsolatedApp({ name: 'boot' });
  try {
    const { window } = launched;
    await dismissPatchNotes(window);
    // Oráculo no centro (06/11) — a new machine opens on the Oráculo; the terminals are one click away.
    await expect(window.locator('[data-testid="oracle-center"]')).toBeVisible();
    await window.locator('[data-testid="center-view-switch"]').getByRole('radio', { name: 'Terminais' }).click();
    await expect(window.locator('[data-testid="empty-state"]')).toBeVisible();
    expect(await window.evaluate(() => typeof (window as unknown as { donel?: unknown }).donel)).toBe('object');
    await launchClaudeTab(window, { name: 'boot' });
  } finally {
    await closeIsolatedApp(launched);
  }
});
