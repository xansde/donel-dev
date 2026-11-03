import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { expect, test } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { seededUserDataDir } from './helpers/projectRoots';
import { closeIsolatedApp, launchIsolatedApp } from './helpers/launch';
import { launchClaudeTab } from './helpers/ui';

// Navegador interno (docs/design/navegador-interno.md). Com o `claude` falso (default): o painel de uma aba
// de sessão abre, navega pela barra de endereço numa página de um servidor local de teste e esconde a view
// nativa enquanto um modal do app está por cima.

let electronApp: ElectronApplication;
let appWindow: Page;
let userDataDir: string;
let server: Server;
let baseUrl: string;

const PAGES: Record<string, string> = {
  '/': `<!doctype html><html><head><title>Página de teste</title></head><body>
    <h1>Olá do servidor</h1>
    <label>Nome <input id="nome" aria-label="Nome"></label>
    <button onclick="document.getElementById('out').textContent = 'Clicou: ' + document.getElementById('nome').value">Enviar</button>
    <p id="out">nada ainda</p>
    <a href="/dois">Ir para a página dois</a>
  </body></html>`,
  '/dois': `<!doctype html><html><head><title>Página dois</title></head><body><h1>Segunda página</h1><p>Chegou na dois.</p></body></html>`,
};

/** URLs of every live webContents of the app (main process), to see what the panel view loaded. */
async function webContentsUrls(app: ElectronApplication): Promise<string[]> {
  return app.evaluate(({ webContents }) => webContents.getAllWebContents().map((contents) => contents.getURL()));
}

/** Visibility of the native child views of the main window (the panel views). */
async function childViewsVisible(app: ElectronApplication): Promise<boolean[]> {
  return app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows().find((candidate) => candidate.contentView.children.length > 0);
    return window ? window.contentView.children.map((view) => view.getVisible()) : [];
  });
}

test.beforeAll(async () => {
  server = createServer((req, res) => {
    const body = PAGES[(req.url ?? '/').split('?')[0]];
    res.writeHead(body ? 200 : 404, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(body ?? 'não achei');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  ({ app: electronApp, window: appWindow, userDataDir } = await launchIsolatedApp({ userDataDir: seededUserDataDir('browser-panel') }));
});

test.afterAll(async () => {
  test.setTimeout(90_000);
  await closeIsolatedApp({ app: electronApp, userDataDir });
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

test('painel abre na aba, navega pela barra de endereço e some sob um modal @navegador', async () => {
  test.setTimeout(90_000);
  await launchClaudeTab(appWindow, { name: 'navegador-manual' });

  await appWindow.getByTestId('browser-toggle').click();
  const panel = appWindow.getByTestId('browser-panel');
  await expect(panel).toBeVisible();

  // file:// é recusado com motivo, sem carregar nada.
  const address = panel.getByLabel('Endereço');
  await address.fill('file:///C:/Windows/win.ini');
  await address.press('Enter');
  await expect(panel.getByRole('alert')).toContainText('só abre endereços http e https');

  await address.fill(`${baseUrl}/`);
  await address.press('Enter');
  await expect(address).toHaveValue(`${baseUrl}/`, { timeout: 15_000 });
  await expect.poll(() => webContentsUrls(electronApp), { timeout: 15_000 }).toContain(`${baseUrl}/`);
  await expect.poll(() => childViewsVisible(electronApp)).toEqual([true]);

  // Um modal do app por cima do painel: a view nativa se esconde (e um print entra no lugar).
  await appWindow.getByRole('button', { name: 'Preferências' }).click();
  await expect(appWindow.getByRole('dialog')).toBeVisible();
  await expect(appWindow.getByTestId('browser-viewport')).toHaveAttribute('data-covered', 'true');
  await expect.poll(() => childViewsVisible(electronApp)).toEqual([false]);
  await appWindow.keyboard.press('Escape');
  await expect(appWindow.getByRole('dialog')).toBeHidden();
  await expect(appWindow.getByTestId('browser-viewport')).toHaveAttribute('data-covered', 'false');
  await expect.poll(() => childViewsVisible(electronApp)).toEqual([true]);

  // Fechar o painel esconde a view; a página continua viva para o agente.
  await panel.getByRole('button', { name: 'Fechar navegador' }).click();
  await expect(panel).toBeHidden();
  await expect.poll(() => childViewsVisible(electronApp)).toEqual([false]);
});
