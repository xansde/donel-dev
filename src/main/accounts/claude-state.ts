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

/**
 * 011-contas-e-provedores, etapa 3, Fase 2 (D7/D9, adendo) — lê o par VIGENTE
 * de `.credentials.json`, sem renovar nem escrever nada. Usada pelo mod local
 * pra ler a carga da conta ATIVA com o token que o próprio CLI mantém fresco
 * (D7) — nunca passa pelo caminho de renovação via cofre, que consumiria um
 * refresh token que o CLI já pode ter usado (o refresh token do cofre da
 * ativa fica órfão assim que o CLI renova o `~/.claude` dela por fora).
 * Reaproveita os mesmos privados (`readJsonObject`/`extractPair`) da captura
 * em `applyAccountSwitch`. Nunca lança; `null` se o arquivo não existir, ou o
 * par estiver ausente/malformado.
 */
export function readCurrentCredentialPair(deps: { readonly io: ClaudeStateIoDeps; readonly claudeHome: string }): CredentialPair | null {
  const credentialsJson = readJsonObject(credentialsFilePath(deps.claudeHome), deps.io);
  return extractPair(credentialsJson);
}

/** `disk-changed` = o par em disco não é mais o `expected` (o CLI rotacionou, outra conta entrou, arquivo sumiu): nada foi escrito. */
export type AdoptRefreshedPairResult = 'written' | 'disk-changed';

/**
 * Pool Seazone (patch local v3) — a segunda escrita de credencial do sistema,
 * e a única fora do switch: adota o par que o switcher devolveu no heartbeat
 * da conta ATIVA do pool, quando o servidor tem um mais novo. Só escreve se o
 * par em disco ainda for EXATAMENTE o que foi enviado (`expected`) — se o CLI
 * rotacionou nesse meio-tempo, o par dele vence e o próximo heartbeat o leva
 * ao servidor. Mesma conta, então `oauthAccount` de `.claude.json` não é
 * tocado. Escreve por merge: `scopes` e chaves desconhecidas do bloco
 * `claudeAiOauth` (`subscriptionType`, ...) e do arquivo ficam como estão.
 */
export function adoptRefreshedActivePair(
  deps: { readonly io: ClaudeStateIoDeps; readonly claudeHome: string },
  expected: CredentialPair,
  next: CredentialPair,
): AdoptRefreshedPairResult {
  const credentialsPath = credentialsFilePath(deps.claudeHome);
  const currentCredentials = readJsonObject(credentialsPath, deps.io);
  const currentPair = extractPair(currentCredentials);
  if (!currentPair || currentPair.accessToken !== expected.accessToken || currentPair.refreshToken !== expected.refreshToken) {
    return 'disk-changed';
  }
  const currentOauth = currentCredentials.claudeAiOauth as Record<string, unknown>;
  const nextOauth: Record<string, unknown> = {
    ...currentOauth,
    accessToken: next.accessToken,
    refreshToken: next.refreshToken,
    expiresAt: next.expiresAt,
  };
  writeJsonObjectAtomic(credentialsPath, { ...currentCredentials, claudeAiOauth: nextOauth }, deps.io);
  return 'written';
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
