// T1109 (011-contas-e-provedores, etapa 1) — ÚNICA escrita de credencial do
// sistema (regra dura do tasks.md: "mod nenhum escreve em ~/.claude*").
// Ordem invariante (data-model.md §3): captura do par rotacionado -> escreve
// `.credentials.json` -> apaga o bloco `oauthAccount` de `~/.claude.json`.
// Inverter a ordem perde o par rotacionado da conta que sai — a conta fica
// órfã de credencial válida. `claudeHome` é parametrizado (C1), default
// `~/.claude` (ver `defaultClaudeHome`, session-indexer.ts) — nunca resolvido
// aqui dentro, sempre recebido pronto (módulo puro/injetável).

import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { CredentialPair } from './account-mod';

const CREDENTIALS_FILE_NAME = '.credentials.json';

export function credentialsFilePath(claudeHome: string): string {
  return join(claudeHome, CREDENTIALS_FILE_NAME);
}

export interface ClaudeStateIoDeps {
  existsSync: (path: string) => boolean;
  readFileText: (path: string) => string | null;
  writeFileText: (path: string, content: string) => void;
  renameFile: (fromPath: string, toPath: string) => void;
  mkdirSync: (path: string) => void;
  unlinkFile: (path: string) => void;
}

export function createSystemClaudeStateIoDeps(): ClaudeStateIoDeps {
  return {
    existsSync,
    readFileText: (path) => {
      try {
        return readFileSync(path, 'utf8');
      } catch {
        return null;
      }
    },
    writeFileText: (path, content) => {
      const fd = openSync(path, 'w');
      try {
        writeSync(fd, content, null, 'utf8');
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
    },
    renameFile: (fromPath, toPath) => renameSync(fromPath, toPath),
    mkdirSync: (path) => mkdirSync(path, { recursive: true }),
    unlinkFile: (path) => {
      try {
        unlinkSync(path);
      } catch {
        // best-effort.
      }
    },
  };
}

function readJsonObject(filePath: string, io: ClaudeStateIoDeps): Record<string, unknown> {
  const raw = io.readFileText(filePath);
  if (raw === null) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Escrita atômica (temp + rename) — mesmo padrão de `writeAppConfig` (config-store.ts). Nunca deixa o arquivo anterior corrompido se o rename falhar. */
function writeJsonObjectAtomic(filePath: string, content: Record<string, unknown>, io: ClaudeStateIoDeps): void {
  const dir = dirname(filePath);
  if (!io.existsSync(dir)) io.mkdirSync(dir);

  const tmpPath = `${filePath}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  io.writeFileText(tmpPath, JSON.stringify(content, null, 2));
  try {
    io.renameFile(tmpPath, filePath);
  } catch (error) {
    io.unlinkFile(tmpPath);
    throw error;
  }
}

/** Extrai o par vigente de um `.credentials.json` já parseado, ou `null` se ausente/malformado (nunca lança). */
function extractPair(credentialsJson: Record<string, unknown>): CredentialPair | null {
  const oauth = credentialsJson.claudeAiOauth;
  if (typeof oauth !== 'object' || oauth === null) return null;
  const candidate = oauth as Partial<CredentialPair>;
  if (typeof candidate.accessToken !== 'string' || typeof candidate.refreshToken !== 'string' || typeof candidate.expiresAt !== 'number') {
    return null;
  }
  return {
    accessToken: candidate.accessToken,
    refreshToken: candidate.refreshToken,
    expiresAt: candidate.expiresAt,
    scopes: Array.isArray(candidate.scopes) ? candidate.scopes.filter((s): s is string => typeof s === 'string') : [],
  };
}

export interface ApplySwitchDeps {
  readonly io: ClaudeStateIoDeps;
  readonly claudeHome: string;
  /** `~/.claude.json` — irmão de `claudeHome`, fora da árvore de junctions (mesmo path que `profile-manager.ts` chama de `globalClaudeJsonPath`). */
  readonly claudeJsonPath: string;
  /**
   * Chamado com o par ATUAL do disco (antes de sobrescrever), ou `null` se
   * nunca existiu. É o ponto onde o motor persiste o par rotacionado via
   * `mod.captureRotatedPair`. Uma exceção aqui ABORTA o switch inteiro —
   * nada é escrito (a ordem invariante garante isso: captura roda primeiro).
   */
  readonly onRotatedPairCaptured: (currentPair: CredentialPair | null) => void | Promise<void>;
}

/**
 * A ÚNICA função do sistema que escreve credencial. Ordem invariante:
 * 1. Lê o par vigente do disco e chama `onRotatedPairCaptured` (aborta tudo se lançar).
 * 2. Escreve `.credentials.json` com o par novo, MERGEANDO (preserva chaves top-level desconhecidas).
 * 3. Remove o bloco `oauthAccount` de `~/.claude.json` (força o CLI a re-fetch); demais chaves preservadas byte a byte.
 */
export async function applyAccountSwitch(deps: ApplySwitchDeps, newPair: CredentialPair): Promise<void> {
  const credentialsPath = credentialsFilePath(deps.claudeHome);

  // Passo 1 — captura do par rotacionado (ANTES de qualquer escrita).
  const currentCredentials = readJsonObject(credentialsPath, deps.io);
  const currentPair = extractPair(currentCredentials);
  await deps.onRotatedPairCaptured(currentPair);

  // Passo 2 — escreve .credentials.json (merge preservando chaves desconhecidas).
  const nextCredentials: Record<string, unknown> = { ...currentCredentials, claudeAiOauth: newPair };
  writeJsonObjectAtomic(credentialsPath, nextCredentials, deps.io);

  // Passo 3 — apaga oauthAccount de ~/.claude.json (demais chaves preservadas).
  const currentClaudeJson = readJsonObject(deps.claudeJsonPath, deps.io);
  if ('oauthAccount' in currentClaudeJson) {
    const { oauthAccount: _removed, ...rest } = currentClaudeJson;
    writeJsonObjectAtomic(deps.claudeJsonPath, rest, deps.io);
  }
}
