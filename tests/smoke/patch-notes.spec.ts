import { expect, test } from '@playwright/test';
import { closeIsolatedApp, launchIsolatedApp } from './helpers/launch';

// Novidades da versão: a janela abre sozinha na estreia (o helper de launch a
// fecha), e o botão Novidades do rodapé a reabre a qualquer hora. A caixa tem
// de conter o texto e o botão Entendi — o print de 29/10 mostrava os dois
// vazando para fora dela.

test('o botão Novidades reabre a janela, com tudo dentro da caixa', async () => {
  const launched = await launchIsolatedApp({ name: 'patch-notes' });
  try {
    const { window } = launched;
    const notes = window.getByTestId('patch-notes');
    await expect(notes).toBeHidden();

    await window.getByTestId('patch-notes-open').click();
    await expect(notes).toBeVisible();
    await expect(notes).toContainText('As novidades das últimas versões.');

    const dialog = await window.getByRole('dialog').boundingBox();
    const body = await notes.boundingBox();
    const ok = await notes.getByRole('button', { name: 'Entendi' }).boundingBox();
    expect(dialog && body && ok).toBeTruthy();
    if (dialog && body && ok) {
      expect(body.x + body.width).toBeLessThanOrEqual(dialog.x + dialog.width + 1);
      expect(ok.x + ok.width).toBeLessThanOrEqual(dialog.x + dialog.width + 1);
      expect(ok.y + ok.height).toBeLessThanOrEqual(dialog.y + dialog.height + 1);
    }

    if (process.env.PATCH_NOTES_SHOT) await window.screenshot({ path: process.env.PATCH_NOTES_SHOT });

    await notes.getByRole('button', { name: 'Entendi' }).click();
    await expect(notes).toBeHidden();
  } finally {
    await closeIsolatedApp(launched);
  }
});
