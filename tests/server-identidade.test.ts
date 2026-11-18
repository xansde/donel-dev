// Branch `server` — o "Donel Dev Server" instala ao lado do Alfa no mesmo PC. O que quebraria sem o dono perceber:
// os dois gravando a mesma pasta de dados (um canal apaga a config do outro), o instalador de um substituindo o
// outro (mesmo appId) e a atualização automática de um instalando o outro.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { APP_IDENTITY, isOwnUpdate } from '../src/shared/appIdentity';

const ALFA = { appName: 'donel-dev', appId: 'com.seazone.doneldev.alfa', installerPrefix: 'DonelDevAlfa-Setup-' };

/** The scalar value of a `key: value` line of electron-builder.yml (top level or indented once). */
function yamlValue(text: string, key: string): string | undefined {
  const match = new RegExp(`^\\s*${key}:\\s*(.+?)\\s*$`, 'm').exec(text);
  return match?.[1].replace(/^["']|["']$/g, '');
}

describe('identidade do Donel Dev Server', () => {
  it('tem pasta de dados, appId e nome próprios, diferentes do Alfa e do estável', () => {
    expect(APP_IDENTITY.productName).toBe('Donel Dev Server');
    expect(APP_IDENTITY.appName).not.toBe(ALFA.appName);
    expect([ALFA.appId, 'com.seazone.doneldev', 'com.seazone.doneldev.beta']).not.toContain(APP_IDENTITY.appId);
    expect(APP_IDENTITY.installerPrefix).not.toBe(ALFA.installerPrefix);
    expect(`${APP_IDENTITY.productName} ${APP_IDENTITY.appName} ${APP_IDENTITY.appId}`.toLowerCase()).not.toContain('alfa');
  });

  it('o instalador sai com a mesma identidade que o app usa em tempo de execução', () => {
    const builder = readFileSync(join(__dirname, '..', 'electron-builder.yml'), 'utf8');
    expect(yamlValue(builder, 'appId')).toBe(APP_IDENTITY.appId);
    expect(yamlValue(builder, 'productName')).toBe(APP_IDENTITY.productName);
    expect(yamlValue(builder, 'shortcutName')).toBe(APP_IDENTITY.productName);
    // The package name inside the installer names the updater cache (`<name>-updater`) the uninstaller deletes.
    expect(yamlValue(builder, 'name')).toBe(APP_IDENTITY.appName);
    expect(yamlValue(builder, 'artifactName')?.startsWith(APP_IDENTITY.installerPrefix)).toBe(true);
  });
});

describe('a atualização do Server só aceita instalador do Server', () => {
  it('aceita a versão nova do Server', () => {
    expect(isOwnUpdate({ files: [{ url: `${APP_IDENTITY.installerPrefix}26.1118.1030.exe` }] })).toBe(true);
  });

  it('recusa a release do Alfa, mesmo que o feed a devolva (não instala o Alfa por cima do Server)', () => {
    expect(isOwnUpdate({ files: [{ url: `${ALFA.installerPrefix}26.1118.428.exe` }] })).toBe(false);
    expect(isOwnUpdate({ files: [{ url: `${APP_IDENTITY.installerPrefix}26.1118.1030.exe` }, { url: `${ALFA.installerPrefix}26.1118.428.exe` }] })).toBe(false);
  });

  it('recusa feed sem arquivo ou malformado', () => {
    expect(isOwnUpdate({ files: [] })).toBe(false);
    expect(isOwnUpdate({})).toBe(false);
    expect(isOwnUpdate(null)).toBe(false);
  });
});
