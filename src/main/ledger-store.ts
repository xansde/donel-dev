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
import { isBelow, isOpenedBy } from '../shared/mindscape/reach';
import type { MindscapeBoard } from '../shared/mindscape/model';
import type { ConfigIoDeps } from './config-store';
import {
  applyLedgerOp,
  emptyLedgerDoc,
  isHttpUrl,
  cannotDecide,
  isNewerLedger,
  lastDelivery,
  slackLetterSent,
  ledgerStrip,
  MAX_PROOF_FILE_BYTES,
  parseLedgerDoc,
  PROOF_FILE_TYPES,
  waitsForOwner,
  type LedgerActor,
  type LedgerDoc,
  type LedgerOp,
  type LedgerProof,
  type LedgerStrip,
  type LedgerTask,
} from '../shared/ledger/contract';
import type { LedgerApplyResult, LedgerSnapshot } from '../shared/ledger/channels';
import type { LedgerToolCall, ProofInput } from '../shared/ledger/tools';
import { detectSlackSend, slackGuard } from '../shared/ledger/slack-guard';

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
  /** The entry itself, not where a link points: a symlink is refused. */
  lstat(path: string): Promise<{ isSymbolicLink(): boolean }>;
  realpath(path: string): Promise<string>;
  readFile(path: string): Promise<Buffer>;
  mkdir(dir: string): Promise<void>;
  copyFile(from: string, to: string): Promise<void>;
  unlink(path: string): Promise<void>;
}

export const nodeLedgerProofFs: LedgerProofFs = {
  stat: (path) => fs.stat(path),
  lstat: (path) => fs.lstat(path),
  realpath: (path) => fs.realpath(path),
  readFile: (path) => fs.readFile(path),
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
  /** A print small enough to go inline in `tarefa_ver`; `null` = not a print, too big or unreadable. */
  proofImage(proof: LedgerProof): Promise<{ base64: string; mimeType: string } | null>;
  /** `tarefa_ver` by `placeId` of the delivery made at `deliveredAt` (memory only: after a restart, look again). */
  noteProofSeen(placeId: string, taskId: string, deliveredAt: number): void;
  proofSeen(placeId: string, taskId: string, deliveredAt: number): boolean;
}

/** The biggest print `tarefa_ver` sends inline (the path goes in any case). */
const MAX_INLINE_PROOF_BYTES = 5 * 1024 * 1024;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function createLedgerService(deps: LedgerServiceDeps): LedgerService {
  const { filePath, io } = deps;
  const now = deps.now ?? Date.now;
  const newId = deps.newId ?? (() => `t-${randomUUID().slice(0, 8)}`);
  const proofsDir = ledgerProofsDir(filePath);
  const seen = new Set<string>();
  const seenKey = (placeId: string, taskId: string, deliveredAt: number): string => `${placeId}\n${taskId}\n${deliveredAt}`;

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
        return { ok: false, reason: `Não consegui ler o Oráculo Harrow (${error instanceof Error ? error.message : String(error)}); nada foi gravado.` };
      }
      if (snapshot.readOnly) return { ok: false, reason: 'O Oráculo Harrow foi gravado por uma versão mais nova do Donel Dev; esta só lê.' };
      const result = applyLedgerOp(snapshot.doc, actor, op, { now: now(), newId });
      if (!result.ok) return result;
      if (!write(result.doc)) return { ok: false, reason: 'Não consegui gravar o Oráculo Harrow; nada mudou.' };
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
        // A link with a print's name could point at anything (the proofs go to the phone): only a real file,
        // and the file it really is (a folder junction on the way) has to be a print or video too.
        if ((await deps.proofFs.lstat(source)).isSymbolicLink()) return { error: `"${source}" é um atalho (link simbólico); mande o arquivo de verdade.` };
        const real = await deps.proofFs.realpath(source);
        if (extname(real).slice(1).toLowerCase() !== ext) return { error: `"${source}" leva a "${real}", que não é print nem vídeo.` };
        const info = await deps.proofFs.stat(real);
        if (!info.isFile()) return { error: `"${source}" não é um arquivo.` };
        if (info.size > MAX_PROOF_FILE_BYTES) return { error: `"${source}" passa de ${MAX_PROOF_FILE_BYTES / 1024 / 1024} MB.` };
        await deps.proofFs.mkdir(proofsDir);
        const file = `${new Date(now()).toISOString().slice(0, 10)}-${randomBytes(6).toString('hex')}.${ext}`;
        await deps.proofFs.copyFile(real, join(proofsDir, file));
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
    async proofImage(proof) {
      if (proof.kind !== 'arquivo' || !proof.mediaType.startsWith('image/')) return null;
      const path = join(proofsDir, proof.file);
      try {
        if ((await deps.proofFs.stat(path)).size > MAX_INLINE_PROOF_BYTES) return null;
        return { base64: (await deps.proofFs.readFile(path)).toString('base64'), mimeType: proof.mediaType };
      } catch {
        return null;
      }
    },
    noteProofSeen(placeId, taskId, deliveredAt) {
      seen.add(seenKey(placeId, taskId, deliveredAt));
    },
    proofSeen(placeId, taskId, deliveredAt) {
      return seen.has(seenKey(placeId, taskId, deliveredAt));
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
  /** The caller's board as saved in `mindscape.json` (who opened whom, the arrows). Missing = the strict answer. */
  readonly board?: MindscapeBoard;
}

/** The strip with the same pt-BR words as the rest of the tool (`aberta`, `em-execucao`, `esperandoDono`…). */
function stripView(strip: LedgerStrip): Record<string, unknown> {
  return {
    total: strip.total,
    abertas: strip.open,
    emExecucao: strip.running,
    entreguesSemDecisao: strip.deliveredUnaccepted,
    esperandoDono: strip.waitingForOwner,
    esperandoDesde: strip.oldestWaitingSince === null ? null : new Date(strip.oldestWaitingSince).toISOString(),
    validadasSemDonoPct: strip.validatedWithoutOwnerPct,
  };
}

/** Low risk only when whoever creates is not the owner of the work nor opened by it (it would review itself). */
function lowRiskRefusal(caller: LedgerCaller, owner: string): string | null {
  if (owner === caller.placeId) return 'quem cria não pode ser o dono do trabalho';
  if (!caller.board) return 'não consegui ler o quadro para conferir quem abriu quem';
  if (isOpenedBy(caller.board, owner, caller.placeId)) return `você foi aberta pelo dono do trabalho (${owner})`;
  return null;
}

/** Why the place `caller` may not decide this delivery, beyond the contract's rules; `null` = may. */
function decideRefusal(caller: LedgerCaller, task: LedgerTask, seen: boolean): string | null {
  const delivery = lastDelivery(task);
  // State, role, risk and self-decision: the contract answers those.
  if (task.state !== 'entregue' || !delivery || delivery.by.kind !== 'lugar' || cannotDecide(task, callerActor(caller))) return null;
  if (task.projectPath !== caller.projectPath) return 'a tarefa é de outro quadro; só se decide tarefa do próprio quadro.';
  if (!seen) return 'leia a prova antes com tarefa_ver.';
  const from = delivery.by.placeId;
  if (!caller.board) return 'não consegui ler o quadro para conferir a cadeia de quem entregou; um Revisor de fora dela ou o dono decide.';
  if (isOpenedBy(caller.board, from, caller.placeId) || isBelow(caller.board, from, caller.placeId)) {
    return `você está na cadeia de quem entregou (${from}): um Revisor de fora dela ou o dono decide.`;
  }
  return null;
}

function proofView(service: LedgerService, proof: LedgerProof): Record<string, unknown> {
  switch (proof.kind) {
    case 'texto':
      return { tipo: 'texto', texto: proof.text };
    case 'link':
      return { tipo: 'link', url: proof.url };
    case 'arquivo':
      return { tipo: 'arquivo', midia: proof.mediaType, caminho: service.proofPath(proof) };
  }
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
            provas: delivery.proofs?.map((proof) => (proof.kind === 'arquivo' ? `arquivo ${proof.file}` : proof.kind === 'link' ? proof.url : `texto (${proof.text.length} caracteres; leia com tarefa_ver)`)),
            ...(delivery.text ? { nota: delivery.text } : {}),
          },
        }
      : {}),
    ...(decision ? { decisao: { tipo: decision.kind, por: who(decision.by), ...(decision.text ? { motivo: decision.text } : {}) } } : {}),
    ...(waitsForOwner(doc, task) ? { esperandoDono: true } : {}),
    ...(task.slack
      ? {
          cartaSlack: {
            destino: task.slack.destination,
            ...(task.slack.thread ? { thread: task.slack.thread } : {}),
            texto: task.slack.text,
            enviada: slackLetterSent(task),
            ...(task.state === 'aceita' && !slackLetterSent(task) ? { proximo: 'Aceita: envie este texto exato a este destino, uma vez.' } : {}),
            ...(task.state === 'rejeitada' ? { proximo: 'Rejeitada: não envie. Ajuste o texto pelo motivo e crie outra carta com carta_slack.' } : {}),
          },
        }
      : {}),
  };
}

export interface LedgerToolAnswer {
  readonly ok: boolean;
  readonly text: string;
  /** `tarefa_ver`: the first print of the delivery, inline (a session on another computer cannot open the path). */
  readonly image?: { readonly base64: string; readonly mimeType: string };
}

function callerActor(caller: LedgerCaller): LedgerActor {
  return { kind: 'lugar', placeId: caller.placeId, ...(caller.roleId ? { roleId: caller.roleId } : {}) };
}

export async function runLedgerTool(service: LedgerService, caller: LedgerCaller, call: LedgerToolCall): Promise<LedgerToolAnswer> {
  const actor = callerActor(caller);
  const answer = (result: LedgerApplyResult, what: string): { ok: boolean; text: string } =>
    result.ok ? { ok: true, text: JSON.stringify({ [what]: true, id: result.task.id, estado: result.task.state }) } : { ok: false, text: result.reason };

  switch (call.tool) {
    case 'tarefa_criar': {
      const owner = call.dono === undefined || call.dono === 'seu' ? caller.placeId : call.dono;
      if (!caller.boardPlaceIds.includes(owner)) return { ok: false, text: `"${owner}" não é um lugar deste quadro (veja sessao_listar).` };
      const lowRefused = call.risco === 'baixo' ? lowRiskRefusal(caller, owner) : null;
      const result = service.apply(actor, {
        op: 'criar',
        projectPath: caller.projectPath,
        request: call.pedido,
        doneWhen: call.criterio,
        due: call.prazo,
        ownerPlaceId: owner,
        risk: lowRefused ? 'alto' : call.risco,
      });
      if (!result.ok || !lowRefused) return answer(result, 'criada');
      return {
        ok: true,
        text: JSON.stringify({ criada: true, id: result.task.id, estado: result.task.state, risco: 'alto', aviso: `Risco baixo não vale aqui (${lowRefused}); a tarefa espera o dono.` }),
      };
    }
    case 'tarefa_assumir':
      return answer(service.apply(actor, { op: 'assumir', id: call.id }), 'assumida');
    case 'carta_slack': {
      const result = service.apply(actor, {
        op: 'carta-slack',
        projectPath: caller.projectPath,
        slack: { destination: call.destino, ...(call.destinoNome ? { destinationLabel: call.destinoNome } : {}), ...(call.thread ? { thread: call.thread } : {}), text: call.texto, reason: call.motivo },
      });
      if (!result.ok) return { ok: false, text: result.reason };
      return {
        ok: true,
        text: JSON.stringify({
          criada: true,
          id: result.task.id,
          estado: result.task.state,
          esperandoDono: true,
          proximo: `Não envie ainda. Diga que está esperando o dono decidir a carta e veja a decisão com tarefa_ver ${result.task.id}. Aceita: envie este texto exato a este destino, uma vez. Rejeitada: o motivo diz o ajuste; crie outra carta.`,
        }),
      };
    }
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
    case 'tarefa_rejeitar': {
      let doc: LedgerDoc;
      try {
        doc = service.load().doc;
      } catch (error) {
        return { ok: false, text: `Não consegui ler o Oráculo Harrow: ${error instanceof Error ? error.message : String(error)}` };
      }
      const task = doc.tasks[call.id];
      const deliveredAt = task ? lastDelivery(task)?.at : undefined;
      const why = task ? decideRefusal(caller, task, deliveredAt !== undefined && service.proofSeen(caller.placeId, task.id, deliveredAt)) : null;
      if (why) return { ok: false, text: `Não ${call.tool === 'tarefa_aceitar' ? 'aceitei' : 'rejeitei'}: ${why}` };
      return call.tool === 'tarefa_aceitar'
        ? answer(service.apply(actor, { op: 'aceitar', id: call.id }), 'aceita')
        : answer(service.apply(actor, { op: 'rejeitar', id: call.id, reason: call.motivo }), 'rejeitada');
    }
    case 'tarefa_ver': {
      let doc: LedgerDoc;
      try {
        doc = service.load().doc;
      } catch (error) {
        return { ok: false, text: `Não consegui ler o Oráculo Harrow: ${error instanceof Error ? error.message : String(error)}` };
      }
      const task = doc.tasks[call.id];
      if (!task) return { ok: false, text: `Não existe tarefa "${call.id}" (veja tarefa_listar).` };
      const delivery = lastDelivery(task);
      if (delivery) service.noteProofSeen(caller.placeId, task.id, delivery.at);
      const proofs = delivery?.proofs ?? [];
      const text = JSON.stringify({ ...taskView(task, doc), ...(proofs.length ? { provas: proofs.map((proof) => proofView(service, proof)) } : {}) }, null, 1);
      for (const proof of proofs) {
        const image = await service.proofImage(proof);
        if (image) return { ok: true, text, image };
      }
      return { ok: true, text };
    }
    case 'tarefa_listar': {
      let doc: LedgerDoc;
      try {
        doc = service.load().doc;
      } catch (error) {
        return { ok: false, text: `Não consegui ler o Oráculo Harrow: ${error instanceof Error ? error.message : String(error)}` };
      }
      const scope = call.todos ? null : caller.projectPath;
      const tasks = Object.values(doc.tasks)
        .filter((task) => (scope === null || task.projectPath === scope) && (!call.estado || task.state === call.estado))
        .sort((a, b) => a.createdAt - b.createdAt);
      return { ok: true, text: JSON.stringify({ faixa: stripView(ledgerStrip(doc, scope)), tarefas: tasks.map((task) => taskView(task, doc)) }, null, 1) };
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Slack só com carta — the hook bridge's `PreToolUse` guard (pure decision in `slack-guard.ts`).

/**
 * `null` = the call goes on (not a Slack post, or an accepted letter freed it and is now used); a string = the
 * refusal the session reads. A ledger that cannot be read, or a letter that cannot be marked as used, refuses.
 */
export function guardSlackSend(service: LedgerService | null, toolName: string, toolInput: unknown): string | null {
  if (detectSlackSend(toolName, toolInput).kind === 'none') return null;
  let doc: LedgerDoc | null = null;
  try {
    const snapshot = service?.load();
    doc = snapshot && !snapshot.readOnly ? snapshot.doc : null;
  } catch {
    doc = null;
  }
  const verdict = slackGuard(doc, toolName, toolInput);
  if (verdict.kind === 'not-slack') return null;
  if (verdict.kind === 'deny') return verdict.reason;
  for (const id of verdict.letterIds) {
    const task = doc!.tasks[id]!;
    const marked = service!.apply({ kind: 'lugar', placeId: task.ownerPlaceId }, { op: 'slack-enviada', id });
    if (!marked.ok) return `Envio ao Slack bloqueado pelo Donel Dev: não consegui marcar a carta ${id} como usada (${marked.reason}). Tente de novo.`;
  }
  return null;
}
