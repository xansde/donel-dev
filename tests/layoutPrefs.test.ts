import { describe, expect, it } from 'vitest';
import { defaultAppConfig, readAppConfig, writeAppConfig, type ConfigIoDeps } from '../src/main/config-store';
import { DEFAULT_LAYOUT_PREFS, showsOracle, toggleCenterView } from '../src/shared/layoutPrefs';

// Oráculo no centro (owner, 06/11) — what would break without him noticing: the new layout not being the default,
// the button not coming back, or the choice being lost on the next opening (or by a channel that does not know it).

function memoryIo(files: Record<string, string>): ConfigIoDeps {
  return {
    existsSync: () => true,
    readFileText: (path) => files[path] ?? null,
    writeFileText: (path, content) => {
      files[path] = content;
    },
    renameFile: (from, to) => {
      files[to] = files[from]!;
      delete files[from];
    },
    mkdirSync: () => undefined,
    unlinkFile: (path) => {
      delete files[path];
    },
  };
}

const FILE = 'C:\\fake\\config.json';
const LEGACY = { projectConfigPath: 'C:\\fake\\project-config.json', activeProfilePath: 'C:\\fake\\active-profile.json' };

describe('layout do centro', () => {
  it('padrão novo: o Oráculo no centro, inclusive para quem já tinha config sem a chave', () => {
    const defaults = defaultAppConfig([]);
    expect(defaults.layout).toEqual({ oracleCenter: true, centerView: 'oracle' });
    expect(showsOracle(DEFAULT_LAYOUT_PREFS)).toBe(true);
    const io = memoryIo({ [FILE]: JSON.stringify({ version: 1, favorites: ['C:\\a'] }) });
    expect(readAppConfig(FILE, defaults, LEGACY, io).layout).toEqual(DEFAULT_LAYOUT_PREFS);
  });

  it('alterna Oráculo ⇄ Terminais e o layout antigo nunca mostra o Oráculo', () => {
    const terminals = toggleCenterView(DEFAULT_LAYOUT_PREFS);
    expect(terminals.centerView).toBe('terminals');
    expect(showsOracle(terminals)).toBe(false);
    expect(toggleCenterView(terminals)).toEqual(DEFAULT_LAYOUT_PREFS);
    expect(showsOracle({ oracleCenter: false, centerView: 'oracle' })).toBe(false);
  });

  it('lembra a escolha na próxima abertura, e um canal que não conhece a chave não a apaga', () => {
    const files: Record<string, string> = {};
    const io = memoryIo(files);
    const defaults = defaultAppConfig([]);
    const chosen = { ...defaults, layout: { oracleCenter: false, centerView: 'terminals' as const } };
    writeAppConfig(FILE, chosen, io, null);
    expect(readAppConfig(FILE, defaults, LEGACY, io).layout).toEqual({ oracleCenter: false, centerView: 'terminals' });

    // An older channel: it does not know `layout`, keeps it among the unknown keys and writes it back.
    const { layout: _unknown, ...olderDefaults } = defaults;
    const older = readAppConfig(FILE, olderDefaults as typeof defaults, LEGACY, io);
    writeAppConfig(FILE, { ...older, favorites: ['C:\\b'] }, io, older);
    expect(JSON.parse(files[FILE]!).layout).toEqual({ oracleCenter: false, centerView: 'terminals' });
  });
});
