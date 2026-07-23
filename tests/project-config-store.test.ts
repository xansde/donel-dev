import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readProjectConfig, toggleFavorite, writeProjectConfig } from '../src/main/project-config-store';

// T007 — persistência mínima de favoritos (FR-001), isolada pro T015
// absorver no ConfigStore formal. `toggleFavorite` é pura (testada sem I/O);
// read/write usam uma pasta temporária real (mesmo espírito do
// tests/pty-manager.test.ts, que também toca I/O de verdade quando o módulo
// não é 100% puro).

describe('toggleFavorite (puro)', () => {
  it('adiciona um caminho novo', () => {
    expect(toggleFavorite([], 'C:\\a', true)).toEqual(['C:\\a']);
  });

  it('não duplica quando o caminho já está favoritado', () => {
    expect(toggleFavorite(['C:\\a'], 'C:\\a', true)).toEqual(['C:\\a']);
  });

  it('remove quando favorite=false', () => {
    expect(toggleFavorite(['C:\\a', 'C:\\b'], 'C:\\a', false)).toEqual(['C:\\b']);
  });

  it('remover um caminho que não está na lista é no-op', () => {
    expect(toggleFavorite(['C:\\b'], 'C:\\a', false)).toEqual(['C:\\b']);
  });
});

describe('readProjectConfig / writeProjectConfig (I/O real em pasta temporária)', () => {
  let dir: string;
  let filePath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'donel-dev-project-config-'));
    // Diretório intermediário inexistente de propósito — cobre o
    // mkdirSync(..., { recursive: true }) do writeProjectConfig.
    filePath = join(dir, 'nested', 'project-config.json');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('retorna config vazia quando o arquivo não existe', () => {
    expect(readProjectConfig(filePath)).toEqual({ favorites: [] });
  });

  it('grava e relê, criando diretórios intermediários', () => {
    writeProjectConfig(filePath, { favorites: ['C:\\a', 'C:\\b'] });

    expect(readProjectConfig(filePath)).toEqual({ favorites: ['C:\\a', 'C:\\b'] });
  });

  it('cai no default vazio se o JSON estiver corrompido', () => {
    // writeProjectConfig cria o diretório intermediário; sobrescrevemos o
    // arquivo em seguida com JSON inválido.
    writeProjectConfig(filePath, { favorites: ['C:\\a'] });
    writeFileSync(filePath, '{ isso não é json', 'utf8');

    expect(readProjectConfig(filePath)).toEqual({ favorites: [] });
  });
});
