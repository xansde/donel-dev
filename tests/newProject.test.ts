import { describe, expect, it } from 'vitest';
import { isValidCreateProjectIpcInput, validateProjectFolderName } from '../src/shared/newProject';

// CA-30 (009-modo-dev-v3, lote 9) — "lançar um projeto do zero pelo app"
// (US-15 do backlog.md). TDD do módulo puro: validação do NOME da pasta
// (segurança — sem path traversal, sem caractere inválido no Windows, nunca
// sobrescreve pasta existente) nasce ANTES do encanamento de fs/spawn
// (src/main/project-creator.ts). Mesmo espírito de tests/project-scanner.test.ts
// e tests/github.test.ts (guarda de payload IPC testada isolada do spawn).

describe('validateProjectFolderName', () => {
  it('aceita um nome simples', () => {
    expect(validateProjectFolderName('meu-projeto')).toEqual({ ok: true, name: 'meu-projeto' });
  });

  it('trima espaços nas pontas antes de validar', () => {
    expect(validateProjectFolderName('  meu-projeto  ')).toEqual({ ok: true, name: 'meu-projeto' });
  });

  it('rejeita nome vazio (ou só espaços)', () => {
    expect(validateProjectFolderName('')).toEqual({ ok: false, reason: 'empty' });
    expect(validateProjectFolderName('   ')).toEqual({ ok: false, reason: 'empty' });
  });

  it('rejeita "." e ".." (traversal)', () => {
    expect(validateProjectFolderName('.')).toEqual({ ok: false, reason: 'invalid-chars' });
    expect(validateProjectFolderName('..')).toEqual({ ok: false, reason: 'invalid-chars' });
  });

  it('rejeita nome com ".." embutido (traversal fora dos dois casos exatos)', () => {
    expect(validateProjectFolderName('..\\..\\windows')).toEqual({ ok: false, reason: 'invalid-chars' });
    expect(validateProjectFolderName('../../etc')).toEqual({ ok: false, reason: 'invalid-chars' });
  });

  it('rejeita separadores de caminho — nome é sempre UM segmento (defende o join contra escape de root)', () => {
    expect(validateProjectFolderName('sub/pasta')).toEqual({ ok: false, reason: 'invalid-chars' });
    expect(validateProjectFolderName('sub\\pasta')).toEqual({ ok: false, reason: 'invalid-chars' });
  });

  it('rejeita os caracteres inválidos no Windows: < > : " | ? *', () => {
    for (const bad of ['a<b', 'a>b', 'a:b', 'a"b', 'a|b', 'a?b', 'a*b']) {
      expect(validateProjectFolderName(bad)).toEqual({ ok: false, reason: 'invalid-chars' });
    }
  });

  it('rejeita caractere de controle', () => {
    expect(validateProjectFolderName('nome\u0007ruim')).toEqual({ ok: false, reason: 'invalid-chars' });
  });

  it('rejeita nome terminado em ponto (Windows trunca silenciosamente)', () => {
    expect(validateProjectFolderName('nome.')).toEqual({ ok: false, reason: 'invalid-chars' });
    expect(validateProjectFolderName('nome.ok.')).toEqual({ ok: false, reason: 'invalid-chars' });
  });

  it('rejeita nomes reservados do Windows (case-insensitive)', () => {
    for (const reserved of ['CON', 'con', 'PRN', 'AUX', 'NUL', 'COM1', 'com9', 'LPT1', 'lpt9']) {
      expect(validateProjectFolderName(reserved)).toEqual({ ok: false, reason: 'reserved-name' });
    }
  });

  it('não confunde um nome reservado como PREFIXO (ex.: "console" não é "CON")', () => {
    expect(validateProjectFolderName('console')).toEqual({ ok: true, name: 'console' });
    expect(validateProjectFolderName('comum')).toEqual({ ok: true, name: 'comum' });
  });

  it('rejeita nome longo demais', () => {
    const tooLong = 'a'.repeat(101);
    expect(validateProjectFolderName(tooLong)).toEqual({ ok: false, reason: 'too-long' });
  });

  it('aceita nome no limite exato de tamanho', () => {
    const atLimit = 'a'.repeat(100);
    expect(validateProjectFolderName(atLimit)).toEqual({ ok: true, name: atLimit });
  });
});

describe('isValidCreateProjectIpcInput — guarda defensiva de payload IPC (mesmo espírito de isValidSaveProjectBindingIpcInput)', () => {
  it('aceita o shape correto', () => {
    expect(isValidCreateProjectIpcInput({ name: 'meu-projeto', root: 'C:\\Users\\x\\seazone' })).toBe(true);
  });

  it('rejeita payload não-objeto', () => {
    expect(isValidCreateProjectIpcInput(null)).toBe(false);
    expect(isValidCreateProjectIpcInput(undefined)).toBe(false);
    expect(isValidCreateProjectIpcInput('string')).toBe(false);
    expect(isValidCreateProjectIpcInput(42)).toBe(false);
  });

  it('rejeita campos ausentes ou de tipo errado', () => {
    expect(isValidCreateProjectIpcInput({ name: 'x' })).toBe(false);
    expect(isValidCreateProjectIpcInput({ root: 'C:\\x' })).toBe(false);
    expect(isValidCreateProjectIpcInput({ name: 1, root: 'C:\\x' })).toBe(false);
    expect(isValidCreateProjectIpcInput({ name: 'x', root: 1 })).toBe(false);
  });

  it('rejeita root vazio (mesmo com o nome válido) — sem root não há onde criar', () => {
    expect(isValidCreateProjectIpcInput({ name: 'x', root: '' })).toBe(false);
    expect(isValidCreateProjectIpcInput({ name: 'x', root: '   ' })).toBe(false);
  });
});
