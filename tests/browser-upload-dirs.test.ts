// The upload folders the owner authorized live in the app's config: they survive a restart, "Remover" takes them
// out, and a channel that does not know the key (the userData is shared) writes without erasing them.
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createSystemConfigIoDeps, defaultAppConfig, readAppConfig, sanitizeAppConfig, writeAppConfig, type AppConfig } from '../src/main/config-store';
import { withUploadFolder, withoutUploadFolder } from '../src/shared/browser/upload';

describe('pastas de envio na config', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it('salva, relê depois de reiniciar, remove, e sobrevive à escrita de um canal que não conhece a chave', () => {
    const dir = mkdtempSync(join(tmpdir(), 'donel-upload-dirs-'));
    dirs.push(dir);
    const path = join(dir, 'config.json');
    const legacy = { projectConfigPath: join(dir, 'project-config.json'), activeProfilePath: join(dir, 'active-profile.json') };
    const io = createSystemConfigIoDeps();
    const defaults = defaultAppConfig(['C:\\projetos']);
    const restart = (): AppConfig => readAppConfig(path, defaults, legacy, io);

    // Permitir: saved.
    const first = restart();
    const allowed: AppConfig = { ...first, browserUploads: { folders: withUploadFolder(first.browserUploads.folders, 'D:\\envios') } };
    writeAppConfig(path, allowed, io, first);
    expect(restart().browserUploads.folders).toEqual(['D:\\envios']);

    // The same folder written another way does not enter twice.
    expect(withUploadFolder(['D:\\envios'], 'd:/ENVIOS/')).toEqual(['D:\\envios']);

    // An older channel: the key is unknown to it, so it rides in `unknownFields` and its write keeps it.
    const { browserUploads: _unknownToOldChannel, ...oldShape } = restart();
    const oldChannel = { ...oldShape, unknownFields: { browserUploads: { folders: ['D:\\envios'] } } } as unknown as AppConfig;
    writeAppConfig(path, { ...oldChannel, favorites: ['C:\\projetos\\atlas'] }, io, oldChannel);
    expect(restart().browserUploads.folders).toEqual(['D:\\envios']);

    // Remover: gone after the next restart.
    const before = restart();
    writeAppConfig(path, { ...before, browserUploads: { folders: withoutUploadFolder(before.browserUploads.folders, 'd:\\envios') } }, io, before);
    expect(restart().browserUploads.folders).toEqual([]);
    expect(JSON.parse(readFileSync(path, 'utf8')).browserUploads).toEqual({ folders: [] });
  });

  it('o sanitize só guarda caminhos, uma vez cada', () => {
    const defaults = defaultAppConfig([]);
    const read = (browserUploads: unknown): readonly string[] => sanitizeAppConfig({ browserUploads }, defaults).browserUploads.folders;
    expect(read({ folders: ['D:\\envios', 'd:/envios', '', 3, null, ' E:\\docs '] })).toEqual(['D:\\envios', 'E:\\docs']);
    expect(read('D:\\envios')).toEqual([]);
    expect(read({ folders: 'D:\\envios' })).toEqual([]);
  });
});
