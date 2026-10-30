import { existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path, { join } from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { createIsolatedUserDataDir, removeIsolatedUserDataDir, removeTempDir } from './userDataIsolation';

// T1217 (011-contas-e-provedores, etapa 2) — a asserção que protege contra o
// PIOR CASO da etapa (C27/D12/A12): depois da virada completa numa árvore de
// perfis FALSA (`mkdtemp`, isolada do `homedir()`/`%APPDATA%` reais), o
// diretório original existe sob `.old`, as 6 junctions foram desfeitas, e o
// ALVO (`<home falso>/.claude/projects`) continua com todos os arquivos —
// nada foi deletado, só renomeado (D13).

const APP_MAIN = path.join(__dirname, '../../out/main/index.js');
const APP_CWD = path.join(__dirname, '../..');

// Mesma lista de PROFILE_LINK_DIRS (src/main/profile-manager.ts), duplicada
// de propósito — smokes deste diretório nunca importam de src/ (ver
// repoUnderTest.ts).
const PROFILE_LINK_DIR_NAMES = ['projects', 'skills', 'commands', 'rules', 'plugins', 'templates'];

let electronApp: ElectronApplication;
let appWindow: Page;
let userDataDir: string;
let fakeHomeRoot: string;
let claudeHomeDir: string;
let profilesRoot: string;
let profileDir: string;

test.beforeAll(async () => {
  userDataDir = createIsolatedUserDataDir('migration-nunca-deleta');
  fakeHomeRoot = mkdtempSync(path.join(tmpdir(), 'donel-migration-nao-deleta-'));
  claudeHomeDir = join(fakeHomeRoot, '.claude');
  profilesRoot = join(fakeHomeRoot, '.claude-profiles');
  profileDir = join(profilesRoot, 'acc-1');

  mkdirSync(claudeHomeDir, { recursive: true });
  mkdirSync(profileDir, { recursive: true });

  // Alvo real de cada junction + marcador que TEM que sobreviver ao
  // arquivamento inteiro (é a prova de que nada foi deletado).
  for (const dirName of PROFILE_LINK_DIR_NAMES) {
    mkdirSync(join(claudeHomeDir, dirName), { recursive: true });
  }
  writeFileSync(join(claudeHomeDir, 'projects', 'keep-me.jsonl'), '{"marker":"nao-pode-sumir"}', 'utf8');

  // As 6 junctions de verdade (fs.symlinkSync 'junction' — não pede admin no Windows).
  for (const dirName of PROFILE_LINK_DIR_NAMES) {
    symlinkSync(join(claudeHomeDir, dirName), join(profileDir, dirName), 'junction');
  }

  writeFileSync(
    join(profileDir, '.credentials.json'),
    JSON.stringify({ claudeAiOauth: { accessToken: 'fake-access-acc-1', refreshToken: 'fake-refresh-acc-1', expiresAt: Date.now() + 3600_000, scopes: [] } }),
    'utf8',
  );

  electronApp = await electron.launch({ args: [APP_MAIN, `--user-data-dir=${userDataDir}`], cwd: APP_CWD });
  appWindow = await electronApp.firstWindow();
  await appWindow.waitForLoadState('domcontentloaded');
  await appWindow.evaluate((home) => window.donel.accounts.setConfig({ claudeHome: home }), claudeHomeDir);
});

test.afterAll(async () => {
  await electronApp.close();
  removeIsolatedUserDataDir(userDataDir);
  removeTempDir(fakeHomeRoot);
});

test('T1217 — virada completa: .old existe, junctions desfeitas, alvo global intacto @contas', async () => {
  test.setTimeout(60_000);

  const scanBefore = await appWindow.evaluate(() => window.donel.migration.scan());
  expect(scanBefore.entries).toHaveLength(1);
  expect(scanBefore.canArchive).toBe(false);

  const importResult = await appWindow.evaluate(() => window.donel.migration.importCredentials('acc-1'));
  expect(importResult.kind).toBe('imported');

  const consolidateResult = await appWindow.evaluate(() => window.donel.migration.consolidateTranscripts('acc-1'));
  // `projects` é junction pro MESMO `claudeHome/projects` de teste — mesma
  // topologia da máquina real (achado A7): já consolidado, zero cópias.
  expect(consolidateResult.result).toBe('already-consolidated');
  expect(consolidateResult.copied).toBe(0);

  const scanAfterImport = await appWindow.evaluate(() => window.donel.migration.scan());
  expect(scanAfterImport.canArchive).toBe(true);

  const archiveOutcome = await appWindow.evaluate(() => window.donel.migration.archive());
  expect(archiveOutcome.kind).toBe('archived');
  if (archiveOutcome.kind !== 'archived') throw new Error('expected archived');

  // 1. O diretório original (`.claude-profiles`) não existe mais — foi RENOMEADO, nunca deletado.
  expect(existsSync(profilesRoot)).toBe(false);

  // 2. `.old` existe com o conteúdo do perfil (menos as junctions, já desfeitas).
  expect(existsSync(archiveOutcome.archivedTo)).toBe(true);
  expect(existsSync(join(archiveOutcome.archivedTo, 'acc-1', '.credentials.json'))).toBe(true);

  // 3. As 6 junctions foram desfeitas — o path do LINK não existe mais dentro do perfil arquivado.
  for (const dirName of PROFILE_LINK_DIR_NAMES) {
    expect(existsSync(join(archiveOutcome.archivedTo, 'acc-1', dirName))).toBe(false);
  }

  // 4. A ASSERÇÃO CRÍTICA: o alvo GLOBAL (`<home falso>/.claude/projects`) continua
  // intacto, com o marcador ainda lá — desfazer a junction NUNCA atravessou o link.
  expect(existsSync(join(claudeHomeDir, 'projects', 'keep-me.jsonl'))).toBe(true);
  expect(readFileSync(join(claudeHomeDir, 'projects', 'keep-me.jsonl'), 'utf8')).toContain('nao-pode-sumir');
  for (const dirName of PROFILE_LINK_DIR_NAMES) {
    expect(existsSync(join(claudeHomeDir, dirName))).toBe(true);
  }
});
