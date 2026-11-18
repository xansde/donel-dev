import { describe, expect, it } from 'vitest';
import { defaultAppConfig, readAppConfig, sanitizeAppConfig, toAppConfigDto, writeAppConfig, type ConfigIoDeps } from '../src/main/config-store';
import { DEFAULT_ROUTER_PREFS } from '../src/shared/routerPrefs';

// Desktop roteador (plano da madrugada 18/11, item 11) — the flag that leaves only the Chat do Líder and the Conexões
// on the desktop. What would break without the owner noticing: the router not being the default, the old app not
// coming back when he turns it off, or the choice being lost on the next opening or by a channel that does not know it.

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

describe('desktop roteador (flag router.enabled)', () => {
  it('nasce ligado, inclusive para quem já tinha config sem a chave, e chega ao renderer', () => {
    const defaults = defaultAppConfig([]);
    expect(defaults.router).toEqual({ enabled: true });
    expect(DEFAULT_ROUTER_PREFS).toEqual({ enabled: true });
    const io = memoryIo({ [FILE]: JSON.stringify({ version: 1, favorites: ['C:\\a'] }) });
    const read = readAppConfig(FILE, defaults, LEGACY, io);
    expect(read.router).toEqual({ enabled: true });
    expect(toAppConfigDto(read, () => false).router).toEqual({ enabled: true });
  });

  it('desligada, volta o app antigo e fica desligada na próxima abertura; religada, volta ao roteador', () => {
    const files: Record<string, string> = {};
    const io = memoryIo(files);
    const defaults = defaultAppConfig([]);
    writeAppConfig(FILE, { ...defaults, router: { enabled: false } }, io, null);
    const off = readAppConfig(FILE, defaults, LEGACY, io);
    expect(off.router).toEqual({ enabled: false });

    writeAppConfig(FILE, { ...off, router: { enabled: true } }, io, off);
    expect(readAppConfig(FILE, defaults, LEGACY, io).router).toEqual({ enabled: true });
  });

  it('um canal que não conhece a chave não a apaga', () => {
    const files: Record<string, string> = {};
    const io = memoryIo(files);
    const defaults = defaultAppConfig([]);
    writeAppConfig(FILE, { ...defaults, router: { enabled: false } }, io, null);

    // An older channel: its AppConfig has no `router` (its sanitize put the key among the unknown ones) and it writes
    // the whole config with no baseline, as on its first save.
    const { router, ...known } = readAppConfig(FILE, defaults, LEGACY, io);
    const older = { ...known, favorites: ['C:\\b'], unknownFields: { router } };
    writeAppConfig(FILE, older as unknown as typeof defaults, io, null);
    expect(JSON.parse(files[FILE]!).favorites).toEqual(['C:\\b']);
    expect(JSON.parse(files[FILE]!).router).toEqual({ enabled: false });
    expect(readAppConfig(FILE, defaults, LEGACY, io).router).toEqual({ enabled: false });
  });

  it('valor estragado cai no padrão só dele', () => {
    const defaults = defaultAppConfig([]);
    expect(sanitizeAppConfig({ version: 1, router: { enabled: 'sim' } }, defaults).router).toEqual({ enabled: true });
    expect(sanitizeAppConfig({ version: 1, router: 'off' }, defaults).router).toEqual({ enabled: true });
    expect(sanitizeAppConfig({ version: 1, router: { enabled: false, extra: 1 } }, defaults).router).toEqual({ enabled: false });
  });
});
