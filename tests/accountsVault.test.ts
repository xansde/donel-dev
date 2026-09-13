import { describe, expect, it, vi } from 'vitest';
import {
  decryptVaultEntry,
  deleteVaultEntries,
  deleteVaultEntry,
  listVaultKeys,
  readVaultFile,
  writeVaultEntry,
  type SafeStorageLike,
  type VaultIoDeps,
} from '../src/main/accounts/vault';

// T1106 (011-contas-e-provedores, etapa 1) — cofre de credenciais
// (accounts-vault.json). Round-trip com safeStorage FALSO (nunca Electron
// real em teste); recusa gravar quando isEncryptionAvailable() é false;
// erro nunca contém o segredo; escrita atômica (mesmo padrão de
// config-store.ts: temp + rename).

function makeFakeSafeStorage(available = true): SafeStorageLike {
  return {
    isEncryptionAvailable: () => available,
    // Fake cifra: prefixo + base64 — nunca usado em produção, só prova o
    // round-trip do encanamento (o segredo real nunca aparece em claro no
    // arquivo escrito por este fake, só na memória do teste).
    encryptString: (plainText: string) => Buffer.from(`enc:${Buffer.from(plainText, 'utf8').toString('base64')}`, 'utf8'),
    decryptString: (encrypted: Buffer) => {
      const raw = encrypted.toString('utf8');
      if (!raw.startsWith('enc:')) throw new Error('formato inválido');
      return Buffer.from(raw.slice(4), 'base64').toString('utf8');
    },
  };
}

function makeMockIo(files: Record<string, string> = {}): { io: VaultIoDeps; files: Record<string, string>; calls: string[] } {
  const calls: string[] = [];
  const io: VaultIoDeps = {
    existsSync: vi.fn((path: string) => path in files || Object.values(files).some(() => true) || true),
    readFileText: vi.fn((path: string) => (path in files ? files[path] : null)),
    writeFileText: vi.fn((path: string, content: string) => {
      files[path] = content;
      calls.push(`write:${path}`);
    }),
    renameFile: vi.fn((from: string, to: string) => {
      files[to] = files[from];
      delete files[from];
      calls.push(`rename:${from}->${to}`);
    }),
    mkdirSync: vi.fn((path: string) => {
      calls.push(`mkdir:${path}`);
    }),
    unlinkFile: vi.fn((path: string) => {
      delete files[path];
      calls.push(`unlink:${path}`);
    }),
  };
  return { io, files, calls };
}

const FILE_PATH = 'C:\\fake\\userData\\accounts-vault.json';

describe('readVaultFile (puro, dado io)', () => {
  it('arquivo ausente devolve registro vazio v1', () => {
    const { io } = makeMockIo();
    expect(readVaultFile(FILE_PATH, io)).toEqual({ version: 1, entries: {} });
  });

  it('JSON corrompido devolve registro vazio v1 (nunca lança)', () => {
    const { io } = makeMockIo({ [FILE_PATH]: '{not json' });
    expect(readVaultFile(FILE_PATH, io)).toEqual({ version: 1, entries: {} });
  });

  it('entrada com valor não-string é descartada isolada', () => {
    const { io } = makeMockIo({ [FILE_PATH]: JSON.stringify({ version: 1, entries: { good: 'abc', bad: 42 } }) });
    expect(readVaultFile(FILE_PATH, io)).toEqual({ version: 1, entries: { good: 'abc' } });
  });
});

describe('writeVaultEntry / decryptVaultEntry — round-trip', () => {
  it('grava cifrado e lê de volta o texto plano original', () => {
    const { io, files } = makeMockIo();
    const safeStorage = makeFakeSafeStorage(true);

    const result = writeVaultEntry(FILE_PATH, safeStorage, io, 'account-1', 'super-secret-token');
    expect(result).toEqual({ kind: 'ok' });

    // O arquivo em disco NUNCA contém o segredo em claro.
    expect(files[FILE_PATH]).not.toContain('super-secret-token');

    expect(decryptVaultEntry(FILE_PATH, safeStorage, io, 'account-1')).toBe('super-secret-token');
  });

  it('múltiplas entradas convivem no mesmo arquivo sem se sobrescrever', () => {
    const { io } = makeMockIo();
    const safeStorage = makeFakeSafeStorage(true);

    writeVaultEntry(FILE_PATH, safeStorage, io, 'account-1', 'token-1');
    writeVaultEntry(FILE_PATH, safeStorage, io, 'account-2', 'token-2');

    expect(decryptVaultEntry(FILE_PATH, safeStorage, io, 'account-1')).toBe('token-1');
    expect(decryptVaultEntry(FILE_PATH, safeStorage, io, 'account-2')).toBe('token-2');
  });

  it('id desconhecido devolve null (nunca lança)', () => {
    const { io } = makeMockIo();
    const safeStorage = makeFakeSafeStorage(true);
    expect(decryptVaultEntry(FILE_PATH, safeStorage, io, 'nunca-existiu')).toBeNull();
  });
});

describe('recusa gravar quando safeStorage indisponível', () => {
  it('isEncryptionAvailable() false -> vault-unavailable, nunca grava texto plano', () => {
    const { io, files } = makeMockIo();
    const safeStorage = makeFakeSafeStorage(false);

    const result = writeVaultEntry(FILE_PATH, safeStorage, io, 'account-1', 'segredo');
    expect(result).toEqual({ kind: 'vault-unavailable' });
    expect(files[FILE_PATH]).toBeUndefined();
  });
});

describe('erro nunca contém o segredo', () => {
  it('decryptString lançando não vaza o texto original na mensagem de erro', () => {
    const { io } = makeMockIo();
    const safeStorage: SafeStorageLike = {
      isEncryptionAvailable: () => true,
      encryptString: () => Buffer.from('opaque-blob'),
      decryptString: () => {
        throw new Error('decrypt failed');
      },
    };
    writeVaultEntry(FILE_PATH, safeStorage, io, 'account-1', 'meu-segredo-nunca-deve-vazar');
    expect(() => decryptVaultEntry(FILE_PATH, safeStorage, io, 'account-1')).not.toThrow();
    expect(decryptVaultEntry(FILE_PATH, safeStorage, io, 'account-1')).toBeNull();
  });
});

describe('deleteVaultEntry', () => {
  it('remove só a entrada pedida, preserva as demais', () => {
    const { io } = makeMockIo();
    const safeStorage = makeFakeSafeStorage(true);
    writeVaultEntry(FILE_PATH, safeStorage, io, 'account-1', 'token-1');
    writeVaultEntry(FILE_PATH, safeStorage, io, 'account-2', 'token-2');

    deleteVaultEntry(FILE_PATH, io, 'account-1');

    expect(decryptVaultEntry(FILE_PATH, safeStorage, io, 'account-1')).toBeNull();
    expect(decryptVaultEntry(FILE_PATH, safeStorage, io, 'account-2')).toBe('token-2');
  });
});

// 011-contas-e-provedores, etapa 3, Fase 1 — base para a faxina do cofre no
// boot (vault-reconciliation.ts): listar os ids (opacos, nunca o valor) e
// apagar vários numa escrita só.
describe('listVaultKeys', () => {
  it('arquivo ausente devolve lista vazia', () => {
    const { io } = makeMockIo();
    expect(listVaultKeys(FILE_PATH, io)).toEqual([]);
  });

  it('lista os ids das entradas, sem os valores', () => {
    const { io } = makeMockIo();
    const safeStorage = makeFakeSafeStorage(true);
    writeVaultEntry(FILE_PATH, safeStorage, io, 'account-1', 'token-1');
    writeVaultEntry(FILE_PATH, safeStorage, io, 'account-2', 'token-2');

    expect(listVaultKeys(FILE_PATH, io).sort()).toEqual(['account-1', 'account-2']);
  });
});

describe('deleteVaultEntries', () => {
  it('remove só as entradas pedidas que existem, preserva as demais, numa escrita só', () => {
    const { io, calls } = makeMockIo();
    const safeStorage = makeFakeSafeStorage(true);
    writeVaultEntry(FILE_PATH, safeStorage, io, 'account-1', 'token-1');
    writeVaultEntry(FILE_PATH, safeStorage, io, 'account-2', 'token-2');
    writeVaultEntry(FILE_PATH, safeStorage, io, 'account-3', 'token-3');
    const writesBefore = calls.filter((c) => c.startsWith('write:')).length;

    const removed = deleteVaultEntries(FILE_PATH, io, ['account-1', 'account-3', 'nunca-existiu']);

    expect([...removed].sort()).toEqual(['account-1', 'account-3']);
    expect(decryptVaultEntry(FILE_PATH, safeStorage, io, 'account-1')).toBeNull();
    expect(decryptVaultEntry(FILE_PATH, safeStorage, io, 'account-2')).toBe('token-2');
    expect(decryptVaultEntry(FILE_PATH, safeStorage, io, 'account-3')).toBeNull();
    // uma única escrita nova (a remoção conjunta), não uma por id.
    expect(calls.filter((c) => c.startsWith('write:')).length).toBe(writesBefore + 1);
  });

  it('nenhum id existe -> devolve [] sem escrever no arquivo', () => {
    const { io, calls } = makeMockIo();
    const safeStorage = makeFakeSafeStorage(true);
    writeVaultEntry(FILE_PATH, safeStorage, io, 'account-1', 'token-1');
    const writesBefore = calls.filter((c) => c.startsWith('write:')).length;

    const removed = deleteVaultEntries(FILE_PATH, io, ['nunca-existiu']);

    expect(removed).toEqual([]);
    expect(calls.filter((c) => c.startsWith('write:')).length).toBe(writesBefore);
  });

  it('lista vazia de ids -> devolve [] sem escrever', () => {
    const { io, calls } = makeMockIo();
    const safeStorage = makeFakeSafeStorage(true);
    writeVaultEntry(FILE_PATH, safeStorage, io, 'account-1', 'token-1');
    const writesBefore = calls.filter((c) => c.startsWith('write:')).length;

    expect(deleteVaultEntries(FILE_PATH, io, [])).toEqual([]);
    expect(calls.filter((c) => c.startsWith('write:')).length).toBe(writesBefore);
  });
});

describe('escrita atômica (temp + rename)', () => {
  it('grava num arquivo temporário e só então faz rename pro path final', () => {
    const { io, calls } = makeMockIo();
    const safeStorage = makeFakeSafeStorage(true);
    writeVaultEntry(FILE_PATH, safeStorage, io, 'account-1', 'token-1');

    const writeCall = calls.find((c) => c.startsWith('write:'));
    const renameCall = calls.find((c) => c.startsWith('rename:'));
    expect(writeCall).toMatch(/\.tmp-/);
    expect(renameCall).toContain('->' + FILE_PATH);
  });
});
