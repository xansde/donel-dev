import { describe, expect, it } from 'vitest';
import { copyTranscriptForResume, type TranscriptCopyIoDeps } from '../src/main/transcript-copy';

// Lote 8 (009-modo-dev-v3), CA-24 — o fs REAL da cópia de transcript entre
// perfis (a decisão pura mora em shared/transcriptCopy.ts, testada à parte).
// IO 100% fake (mesmo espírito de esteira-reader.test.ts) — nunca toca disco.

const HOMEDIR = 'C:\\Users\\fake';
const PATH_DEPS = { homedir: () => HOMEDIR };

function fakeIo(files: Record<string, true>, realpaths: Record<string, string> = {}): TranscriptCopyIoDeps & { copiedTo: string[]; mkdirCalls: string[] } {
  const copiedTo: string[] = [];
  const mkdirCalls: string[] = [];
  const knownFiles = { ...files };
  return {
    existsSync: (path) => path in knownFiles,
    mkdirSync: (path) => {
      mkdirCalls.push(path);
      knownFiles[path] = true;
    },
    copyFileSync: (_source, dest) => {
      copiedTo.push(dest);
      knownFiles[dest] = true;
    },
    realpathOrNull: (path) => realpaths[path] ?? null,
    copiedTo,
    mkdirCalls,
  };
}

const BASE_INPUT = {
  sessionId: 'sess-1',
  projectPath: 'C:\\proj',
  sourceProfileSlug: 'tech-1',
  targetProfileSlug: 'tech-2',
};

const SOURCE_FILE = 'C:\\Users\\fake\\.claude-profiles\\tech-1\\projects\\C--proj\\sess-1.jsonl';
const TARGET_DIR = 'C:\\Users\\fake\\.claude-profiles\\tech-2\\projects\\C--proj';
const TARGET_FILE = `${TARGET_DIR}\\sess-1.jsonl`;

describe('copyTranscriptForResume', () => {
  it('mesma conta → same-profile, nunca toca fs', () => {
    const io = fakeIo({});
    const result = copyTranscriptForResume({ ...BASE_INPUT, targetProfileSlug: 'tech-1' }, PATH_DEPS, io);
    expect(result).toEqual({ copied: false, reason: 'same-profile' });
    expect(io.copiedTo).toEqual([]);
  });

  it('sessão de origem ausente → source-missing, nunca lança, nunca copia', () => {
    const io = fakeIo({});
    const result = copyTranscriptForResume(BASE_INPUT, PATH_DEPS, io);
    expect(result).toEqual({ copied: false, reason: 'source-missing' });
    expect(io.copiedTo).toEqual([]);
  });

  it('origem existe, destino ainda não → cria o diretório do projeto no perfil destino e copia', () => {
    const io = fakeIo({ [SOURCE_FILE]: true });
    const result = copyTranscriptForResume(BASE_INPUT, PATH_DEPS, io);
    expect(result).toEqual({ copied: true });
    expect(io.mkdirCalls).toEqual([TARGET_DIR]);
    expect(io.copiedTo).toEqual([TARGET_FILE]);
  });

  it('diretório do projeto já existe no perfil destino → não recria, só copia', () => {
    const io = fakeIo({ [SOURCE_FILE]: true, [TARGET_DIR]: true });
    const result = copyTranscriptForResume(BASE_INPUT, PATH_DEPS, io);
    expect(result).toEqual({ copied: true });
    expect(io.mkdirCalls).toEqual([]);
    expect(io.copiedTo).toEqual([TARGET_FILE]);
  });

  it('perfil "principal" como origem/destino resolve para ~/.claude/projects (sem .claude-profiles)', () => {
    const sourceFile = 'C:\\Users\\fake\\.claude\\projects\\C--proj\\sess-1.jsonl';
    const io = fakeIo({ [sourceFile]: true });
    const result = copyTranscriptForResume({ ...BASE_INPUT, sourceProfileSlug: 'principal' }, PATH_DEPS, io);
    expect(result).toEqual({ copied: true });
    expect(io.copiedTo).toEqual([TARGET_FILE]);
  });

  // Achado real desta máquina (ver report do lote): `~/.claude-profiles/*/projects`
  // é um Windows Junction pra `~/.claude/projects` GLOBAL — origem e destino
  // podem ser o MESMO arquivo físico mesmo com paths de perfil diferentes.
  // Copiar em cima de si mesmo é, na melhor hipótese, desperdício; na pior,
  // risco de corromper o arquivo em uso — pula com segurança.
  it('origem e destino resolvem pro MESMO arquivo real (topologia com projects/ compartilhado por junction) → pula a cópia, sem erro', () => {
    const io = fakeIo(
      { [SOURCE_FILE]: true, [TARGET_FILE]: true },
      { [SOURCE_FILE]: 'C:\\Users\\fake\\.claude\\projects\\C--proj\\sess-1.jsonl', [TARGET_FILE]: 'C:\\Users\\fake\\.claude\\projects\\C--proj\\sess-1.jsonl' },
    );
    const result = copyTranscriptForResume(BASE_INPUT, PATH_DEPS, io);
    expect(result).toEqual({ copied: false, reason: 'already-same-file' });
    expect(io.copiedTo).toEqual([]);
  });

  it('payload inválido (sessionId vazio) → same-profile, nunca toca fs', () => {
    const io = fakeIo({ [SOURCE_FILE]: true });
    const result = copyTranscriptForResume({ ...BASE_INPUT, sessionId: '' }, PATH_DEPS, io);
    expect(result).toEqual({ copied: false, reason: 'same-profile' });
    expect(io.copiedTo).toEqual([]);
  });
});
