// Ledger com prova (item 19, D1) — the store of `<userData>/ledger.json` and its proofs in
// `<userData>/ledger-provas/`. Only the main writes them. Same shape as mindscape-store.ts: the whole document
// goes through temp → rename (`ConfigIoDeps`), a newer `schemaVersion` is read and never written, a file that
// exists but cannot be read fails instead of coming back empty (it would be written over).
//
// `LedgerService.apply(actor, op)` is THE entry point of every port: the MCP tools (`runLedgerTool`, below),
// the owner's IPC, and next the phone (an HTTP server of the main on the Tailscale network). It re-reads the
// file, runs the pure `applyLedgerOp` (shared/ledger/contract.ts) and writes. A proof file is copied in
// BEFORE (`importProof`) and only its name enters the document.

import { randomBytes, randomUUID } from 'node:crypto';
import { constants as fsConstants, promises as fs } from 'node:fs';
import { dirname, extname, isAbsolute, join } from 'node:path';
import type { ConfigIoDeps } from './config-store';
import {
  applyLedgerOp,
  emptyLedgerDoc,
  isHttpUrl,
  isNewerLedger,
  lastDelivery,
  ledgerStrip,
  MAX_PROOF_FILE_BYTES,
  parseLedgerDoc,
  PROOF_FILE_TYPES,
  waitsForOwner,
  type LedgerActor,
  type LedgerDoc,
  type LedgerOp,
  type LedgerProof,
  type LedgerTask,
} from '../shared/ledger/contract';
import type { LedgerApplyResult, LedgerSnapshot } from '../shared/ledger/channels';
import type { LedgerToolCall, ProofInput } from '../shared/ledger/tools';

/** Smoke/test override: isolates the ledger from the real one. */
export const LEDGER_FILE_ENV_VAR = 'DONEL_LEDGER_FILE';

export function ledgerFilePath(env: Record<string, string | undefined>, userDataPath: string): string {
  const override = env[LEDGER_FILE_ENV_VAR];
  return override && override.trim() ? override : join(userDataPath, 'ledger.json');
}

export function ledgerProofsDir(ledgerFile: string): string {
  return join(dirname(ledgerFile), 'ledger-provas');
}

/** What the proof copy needs (injected: the vitest uses a temp folder). */
export interface LedgerProofFs {
  stat(path: string): Promise<{ isFile(): boolean; size: number }>;
  mkdir(dir: string): Promise<void>;
  copyFile(from: string, to: string): Promise<void>;
  unlink(path: string): Promise<void>;
}

export const nodeLedgerProofFs: LedgerProofFs = {
  stat: (path) => fs.stat(path),
  mkdir: async (dir) => {
    await fs.mkdir(dir, { recursive: true });
  },
  copyFile: (from, to) => fs.copyFile(from, to, fsConstants.COPYFILE_EXCL),
  unlink: (path) => fs.unlink(path),
};

export interface LedgerServiceDeps {
  readonly filePath: string;
  readonly io: ConfigIoDeps;
  readonly proofFs: LedgerProofFs;
  readonly now?: () => number;
  readonly newId?: () => string;
  /** After every successful write (the renderer's strip). */
  readonly onChange?: (snapshot: LedgerSnapshot) => void;
}

export interface LedgerService {
  /** Missing file → empty ledger. Throws when the file exists but is unreadable or not a ledger. */
  load(): LedgerSnapshot;
  apply(actor: LedgerActor, op: LedgerOp): LedgerApplyResult;
  /** Copies a print/video into `ledger-provas/` and returns the proof; text and link are only checked. */
  importProof(input: ProofInput): Promise<LedgerProof | { error: string }>;
  /** Removes copied proof files a refused delivery left behind. */
  discardProofs(proofs: readonly LedgerProof[]): Promise<void>;
  proofPath(proof: LedgerProof): string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function createLedgerService(deps: LedgerServiceDeps): LedgerService {
  const { filePath, io } = deps;
  const now = deps.now ?? Date.now;
  const newId = deps.newId ?? (() => `t-${randomUUID().slice(0, 8)}`);
  const proofsDir = ledgerProofsDir(filePath);

  function readRaw(): { raw: unknown; exists: boolean } {
    const text = io.readFileText(filePath);
    if (text === null) {
      if (io.existsSync(filePath)) throw new Error('ledger.json existe mas não pôde ser lido');
      return { raw: null, exists: false };
    }
    try {
      return { raw: JSON.parse(text) as unknown, exists: true };
    } catch {
      throw new Error('ledger.json não é JSON válido');
    }
  }

  function load(): LedgerSnapshot {
    const { raw, exists } = readRaw();
    if (!exists) return { doc: emptyLedgerDoc(), readOnly: false };
    if (!isRecord(raw) || !isRecord(raw.tasks)) throw new Error('ledger.json não é um ledger');
    return { doc: parseLedgerDoc(raw), readOnly: isNewerLedger(raw) };
  }

  function write(doc: LedgerDoc): boolean {
    const tmpPath = `${filePath}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    try {
      const dir = dirname(filePath);
      if (!io.existsSync(dir)) io.mkdirSync(dir);
      io.writeFileText(tmpPath, JSON.stringify(doc, null, 2));
      io.renameFile(tmpPath, filePath);
      return true;
    } catch {
      io.unlinkFile(tmpPath);
      return false;
    }
  }

  return {
    load,
    apply(actor, op) {
      let snapshot: LedgerSnapshot;
      try {
        snapshot = load();
      } catch (error) {
        return { ok: false, reason: `Não consegui ler o ledger (${error instanceof Error ? error.message : String(error)}); nada foi gravado.` };
      }
      if (snapshot.readOnly) return { ok: false, reason: 'O ledger foi gravado por uma versão mais nova do Donel Dev; esta só lê.' };
      const result = applyLedgerOp(snapshot.doc, actor, op, { now: now(), newId });
      if (!result.ok) return result;
      if (!write(result.doc)) return { ok: false, reason: 'Não consegui gravar o ledger; nada mudou.' };
      deps.onChange?.({ doc: result.doc, readOnly: false });
      return { ok: true, task: result.task };
    },
    async importProof(input) {
      if (input.tipo === 'texto') return { kind: 'texto', text: input.texto };
      if (input.tipo === 'link') return isHttpUrl(input.url) ? { kind: 'link', url: input.url } : { error: `"${input.url}" não é um link http(s).` };
      const source = input.caminho;
      const ext = extname(source).slice(1).toLowerCase();
      const mediaType = PROOF_FILE_TYPES[ext];
      if (!isAbsolute(source)) return { error: `"${source}": use o caminho absoluto do arquivo.` };
      if (!mediaType) return { error: `"${source}": a prova em arquivo é print ou vídeo (${Object.keys(PROOF_FILE_TYPES).join(', ')}). Saída de comando vai como texto.` };
      try {
        const info = await deps.proofFs.stat(source);
        if (!info.isFile()) return { error: `"${source}" não é um arquivo.` };
        if (info.size > MAX_PROOF_FILE_BYTES) return { error: `"${source}" passa de ${MAX_PROOF_FILE_BYTES / 1024 / 1024} MB.` };
        await deps.proofFs.mkdir(proofsDir);
        const file = `${new Date(now()).toISOString().slice(0, 10)}-${randomBytes(6).toString('hex')}.${ext}`;
        await deps.proofFs.copyFile(source, join(proofsDir, file));
        return { kind: 'arquivo', file, mediaType };
      } catch {
        return { error: `Não consegui copiar "${source}" (o arquivo existe neste computador?). Numa sessão remota, mande a prova como texto ou link.` };
      }
    },
    async discardProofs(proofs) {
      for (const proof of proofs) if (proof.kind === 'arquivo') await deps.proofFs.unlink(join(proofsDir, proof.file)).catch(() => undefined);
    },
    proofPath(proof) {
      return proof.kind === 'arquivo' ? join(proofsDir, proof.file) : null;
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------
// The MCP port: a `tarefa_*` call of a session, with the caller resolved from the board by the main.

export interface LedgerCaller {
  readonly projectPath: string;
  readonly placeId: string;
  readonly roleId?: string;
  /** The place ids of the caller's board (to check the `dono` of a new task). */
  readonly boardPlaceIds: readonly string[];
}

function taskView(task: LedgerTask, doc: LedgerDoc): Record<string, unknown> {
  const delivery = lastDelivery(task);
  const decision = [...task.events].reverse().find((event) => event.kind === 'aceita' || event.kind === 'rejeitada');
  const who = (actor: LedgerActor): string => (actor.kind === 'dono' ? 'dono' : actor.placeId);
  return {
    id: task.id,
    estado: task.state,
    pedido: task.request,
    criterio: task.doneWhen,
    prazo: task.due,
    dono: task.ownerPlaceId,
    risco: task.risk,
    ...(delivery
      ? {
          entrega: {
            por: who(delivery.by),
            em: new Date(delivery.at).toISOString(),
            provas: delivery.proofs?.map((proof) => (proof.kind === 'arquivo' ? `arquivo ${proof.file}` : proof.kind === 'link' ? proof.url : `texto (${proof.text.length} caracteres)`)),
            ...(delivery.text ? { nota: delivery.text } : {}),
          },
        }
      : {}),
    ...(decision ? { decisao: { tipo: decision.kind, por: who(decision.by), ...(decision.text ? { motivo: decision.text } : {}) } } : {}),
    ...(waitsForOwner(doc, task) ? { esperandoDono: true } : {}),
  };
}

export async function runLedgerTool(service: LedgerService, caller: LedgerCaller, call: LedgerToolCall): Promise<{ ok: boolean; text: string }> {
  const actor: LedgerActor = { kind: 'lugar', placeId: caller.placeId, ...(caller.roleId ? { roleId: caller.roleId } : {}) };
  const answer = (result: LedgerApplyResult, what: string): { ok: boolean; text: string } =>
    result.ok ? { ok: true, text: JSON.stringify({ [what]: true, id: result.task.id, estado: result.task.state }) } : { ok: false, text: result.reason };

  switch (call.tool) {
    case 'tarefa_criar': {
      const owner = call.dono === undefined || call.dono === 'seu' ? caller.placeId : call.dono;
      if (!caller.boardPlaceIds.includes(owner)) return { ok: false, text: `"${owner}" não é um lugar deste quadro (veja sessao_listar).` };
      return answer(
        service.apply(actor, { op: 'criar', projectPath: caller.projectPath, request: call.pedido, doneWhen: call.criterio, due: call.prazo, ownerPlaceId: owner, risk: call.risco }),
        'criada',
      );
    }
    case 'tarefa_assumir':
      return answer(service.apply(actor, { op: 'assumir', id: call.id }), 'assumida');
    case 'tarefa_entregar': {
      const proofs: LedgerProof[] = [];
      for (const input of call.provas) {
        const proof = await service.importProof(input);
        if ('error' in proof) {
          await service.discardProofs(proofs);
          return { ok: false, text: `Nada foi entregue. ${proof.error}` };
        }
        proofs.push(proof);
      }
      const result = service.apply(actor, { op: 'entregar', id: call.id, proofs, ...(call.nota ? { note: call.nota } : {}) });
      if (!result.ok) await service.discardProofs(proofs);
      return answer(result, 'entregue');
    }
    case 'tarefa_aceitar':
      return answer(service.apply(actor, { op: 'aceitar', id: call.id }), 'aceita');
    case 'tarefa_rejeitar':
      return answer(service.apply(actor, { op: 'rejeitar', id: call.id, reason: call.motivo }), 'rejeitada');
    case 'tarefa_listar': {
      let doc: LedgerDoc;
      try {
        doc = service.load().doc;
      } catch (error) {
        return { ok: false, text: `Não consegui ler o ledger: ${error instanceof Error ? error.message : String(error)}` };
      }
      const scope = call.todos ? null : caller.projectPath;
      const tasks = Object.values(doc.tasks)
        .filter((task) => (scope === null || task.projectPath === scope) && (!call.estado || task.state === call.estado))
        .sort((a, b) => a.createdAt - b.createdAt);
      return { ok: true, text: JSON.stringify({ faixa: ledgerStrip(doc, scope), tarefas: tasks.map((task) => taskView(task, doc)) }, null, 1) };
    }
  }
}
