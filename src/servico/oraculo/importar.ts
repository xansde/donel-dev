// Serviço da VPS — migração única do Oráculo do PC para a VPS. O dono copia o
// `ledger.json` e a pasta `ledger-provas/` do PC para a VPS (scp) e roda
// `donel-servico oraculo importar <ledger.json> <pasta-provas>`.
//
// Regra: não perder nada. Antes de gravar, confere que o parse do contrato
// guarda TODAS as tarefas do arquivo (o parse descarta tarefa malformada em
// silêncio) e que cada prova em arquivo existe na pasta. Depois de gravar,
// relê e confere ids e quantidade de eventos. O Oráculo que já estava na VPS
// vira cópia de segurança antes de ser trocado, e só é trocado se estiver
// vazio ou se o dono pedir (`--substituir`).

import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { isNewerLedger, parseLedgerDoc, type LedgerDoc } from '../../shared/ledger/contract';

export type ImportOutcome =
  | { readonly ok: true; readonly tarefas: number; readonly eventos: number; readonly provas: number; readonly copiaDeSeguranca: string | null }
  | { readonly ok: false; readonly reason: string; readonly detalhe?: string };

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8')) as unknown;
}

function proofFiles(doc: LedgerDoc): string[] {
  const files: string[] = [];
  for (const task of Object.values(doc.tasks)) {
    for (const event of task.events) {
      for (const proof of ('proofs' in event && event.proofs) || []) {
        if (proof.kind === 'arquivo') files.push(proof.file);
      }
    }
  }
  return files;
}

function eventCount(doc: LedgerDoc): number {
  return Object.values(doc.tasks).reduce((total, task) => total + task.events.length, 0);
}

export function importLedger(options: {
  readonly sourceFile: string;
  readonly sourceProofsDir: string | null;
  readonly targetFile: string;
  readonly targetProofsDir: string;
  readonly replace: boolean;
  readonly now?: () => number;
}): ImportOutcome {
  const now = options.now ?? Date.now;
  let raw: unknown;
  try {
    raw = readJson(options.sourceFile);
  } catch {
    return { ok: false, reason: 'arquivo-ilegivel' };
  }
  if (isNewerLedger(raw)) return { ok: false, reason: 'oraculo-mais-novo-que-o-servico', detalhe: 'atualize o serviço (instalar.sh) antes de importar' };
  const doc = parseLedgerDoc(raw);
  const rawTasks = typeof raw === 'object' && raw !== null && typeof (raw as { tasks?: unknown }).tasks === 'object' && (raw as { tasks?: unknown }).tasks !== null ? Object.keys((raw as { tasks: object }).tasks) : [];
  const lost = rawTasks.filter((id) => !(id in doc.tasks));
  if (lost.length > 0) return { ok: false, reason: 'tarefas-que-se-perderiam', detalhe: lost.join(', ') };

  const files = proofFiles(doc);
  const missing = files.filter((file) => !options.sourceProofsDir || !existsSync(join(options.sourceProofsDir, file)));
  if (missing.length > 0) return { ok: false, reason: 'provas-faltando', detalhe: missing.join(', ') };

  let backup: string | null = null;
  if (existsSync(options.targetFile)) {
    let current: LedgerDoc;
    try {
      current = parseLedgerDoc(readJson(options.targetFile));
    } catch {
      return { ok: false, reason: 'oraculo-da-vps-ilegivel' };
    }
    if (Object.keys(current.tasks).length > 0 && !options.replace) return { ok: false, reason: 'oraculo-da-vps-nao-esta-vazio', detalhe: 'use --substituir' };
    backup = `${options.targetFile}.antes-da-importacao-${new Date(now()).toISOString().replace(/[:.]/g, '-')}`;
    copyFileSync(options.targetFile, backup);
  }

  mkdirSync(options.targetProofsDir, { recursive: true, mode: 0o700 });
  for (const file of files) {
    const name = basename(file);
    const target = join(options.targetProofsDir, name);
    if (!existsSync(target)) copyFileSync(join(options.sourceProofsDir ?? '', name), target);
  }

  const tmp = `${options.targetFile}.tmp-importacao-${process.pid}`;
  writeFileSync(tmp, `${JSON.stringify(doc, null, 2)}\n`, { mode: 0o600 });
  renameSync(tmp, options.targetFile);

  const written = parseLedgerDoc(readJson(options.targetFile));
  const sameIds = Object.keys(written.tasks).length === rawTasks.length && rawTasks.every((id) => id in written.tasks);
  if (!sameIds || eventCount(written) !== eventCount(doc)) return { ok: false, reason: 'conferencia-falhou', detalhe: backup ? `a cópia anterior está em ${backup}` : undefined };

  return { ok: true, tarefas: rawTasks.length, eventos: eventCount(doc), provas: files.length, copiaDeSeguranca: backup };
}
