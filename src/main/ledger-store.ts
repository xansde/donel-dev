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
import { LEADER_OF_ALL } from '../shared/mindscape/leader';
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
  slackLetterText,
  slackSendState,
  type SlackSendState,
  ledgerStrip,
  transfersOf,
  eventNote,
  doneByOf,
  replacesOf,
  requestedByOf,
  frenteOf,
  ASKED_BY_OWNER,
  isCancelled,
  awaitsSend,
  isClosed,
  isServicePlace,
  viewState,
  maxProofBytes,
  parseLedgerDoc,
  PROOF_FILE_TYPES,
  waitsForOwner,
  type LedgerActor,
  type LedgerDoc,
  type LedgerForOwner,
  type LedgerOp,
  type LedgerProof,
  type LedgerStrip,
  type LedgerTask,
} from '../shared/ledger/contract';
import type { LedgerApplyResult, LedgerPassedOn, LedgerPassOnRequest, LedgerSnapshot, LedgerTurnRecord, LedgerTurnRecorded } from '../shared/ledger/channels';
import { isUrgentProgress, turnEndProgress, type LedgerProgress } from '../shared/ledger/andamento';
import { agoText, ledgerNews, progressTaskOf, turnAlreadyRecorded } from '../shared/ledger/novidades';
import type { LedgerToolCall, ProofInput } from '../shared/ledger/tools';
import { NOT_STARTED_GRACE_MS, orphanReasonIn, ownerGoneIn } from '../shared/ledger/inbox';
import { AGENT_BOT_SERVERS, detectAgentBotSend, detectSlackSend, fileNameOf, slackGuard, slackMessageLink, slackSendOutcome, type AgentBotSend } from '../shared/ledger/slack-guard';

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
  /** A proof read from a remote place: written once, never over an existing file. */
  writeFile(path: string, bytes: Buffer): Promise<void>;
  unlink(path: string): Promise<void>;
}

/** Fatia 6 — reads a proof file on the remote place of the calling session (`ledger-remote-proof.ts`). */
export type RemoteProofFetch = (path: string) => Promise<{ readonly ok: true; readonly bytes: Buffer; readonly ext: string; readonly mediaType: string } | { readonly ok: false; readonly error: string }>;

export const nodeLedgerProofFs: LedgerProofFs = {
  stat: (path) => fs.stat(path),
  lstat: (path) => fs.lstat(path),
  realpath: (path) => fs.realpath(path),
  readFile: (path) => fs.readFile(path),
  mkdir: async (dir) => {
    await fs.mkdir(dir, { recursive: true });
  },
  copyFile: (from, to) => fs.copyFile(from, to, fsConstants.COPYFILE_EXCL),
  writeFile: (path, bytes) => fs.writeFile(path, bytes, { flag: 'wx' }),
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
  /** A promise: in remote mode (docs/planos/oraculo-na-vps.md) the write goes to the Oráculo on the VPS. */
  apply(actor: LedgerActor, op: LedgerOp): Promise<LedgerApplyResult>;
  /**
   * Copies a print/video/prototype into `ledger-provas/` and returns the proof; text and link are only checked. With
   * `remote`, the file is on the calling session's remote place (the VPS) and is read through its ssh.
   */
  importProof(input: ProofInput, remote?: RemoteProofFetch): Promise<LedgerProof | { error: string }>;
  /** Removes copied proof files a refused delivery left behind. */
  discardProofs(proofs: readonly LedgerProof[]): Promise<void>;
  proofPath(proof: LedgerProof): string | null;
  /** A print small enough to go inline in `tarefa_ver`; `null` = not a print, too big or unreadable. */
  proofImage(proof: LedgerProof): Promise<{ base64: string; mimeType: string } | null>;
  /** `tarefa_ver` by `placeId` of the delivery made at `deliveredAt` (memory only: after a restart, look again). */
  noteProofSeen(placeId: string, taskId: string, deliveredAt: number): void;
  proofSeen(placeId: string, taskId: string, deliveredAt: number): boolean;
  /** The service's clock (the vitest moves it). */
  now(): number;
}

/** The biggest print `tarefa_ver` sends inline (the path goes in any case). */
const MAX_INLINE_PROOF_BYTES = 5 * 1024 * 1024;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * A proof file named by a session on this computer: absolute, a print/video/prototype, a real file (no link, and the
 * file it really is has the same kind), within the size. Shared by the local ledger and the remote one (oraculo na VPS).
 */
export async function checkLocalProofFile(proofFs: LedgerProofFs, source: string): Promise<{ readonly real: string; readonly ext: string; readonly mediaType: string } | { readonly error: string }> {
  const ext = extname(source).slice(1).toLowerCase();
  const mediaType = PROOF_FILE_TYPES[ext];
  if (!isAbsolute(source)) return { error: `"${source}": use o caminho absoluto do arquivo.` };
  if (!mediaType) return { error: `"${source}": a prova em arquivo é print, vídeo ou protótipo HTML (${Object.keys(PROOF_FILE_TYPES).join(', ')}). Saída de comando vai como texto.` };
  try {
    // A link with a print's name could point at anything (the proofs go to the phone): only a real file,
    // and the file it really is (a folder junction on the way) has to be a print or video too.
    if ((await proofFs.lstat(source)).isSymbolicLink()) return { error: `"${source}" é um atalho (link simbólico); mande o arquivo de verdade.` };
    const real = await proofFs.realpath(source);
    if (extname(real).slice(1).toLowerCase() !== ext) return { error: `"${source}" leva a "${real}", que não é print, vídeo nem protótipo.` };
    const info = await proofFs.stat(real);
    if (!info.isFile()) return { error: `"${source}" não é um arquivo.` };
    const max = maxProofBytes(mediaType);
    if (info.size > max) return { error: `"${source}" passa de ${max / 1024 / 1024} MB${mediaType === 'text/html' ? ' (o protótipo é um HTML autocontido de até 2 MB)' : ''}.` };
    return { real, ext, mediaType };
  } catch {
    return { error: `Não consegui copiar "${source}" (o arquivo existe neste computador?). Numa sessão remota, mande a prova como texto ou link.` };
  }
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
    async apply(actor, op) {
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
    async importProof(input, remote) {
      if (input.tipo === 'texto') return { kind: 'texto', text: input.texto };
      if (input.tipo === 'link') return isHttpUrl(input.url) ? { kind: 'link', url: input.url } : { error: `"${input.url}" não é um link http(s).` };
      const source = input.caminho;
      const newName = (ext: string): string => `${new Date(now()).toISOString().slice(0, 10)}-${randomBytes(6).toString('hex')}.${ext}`;
      if (remote) {
        const fetched = await remote(source);
        if (!fetched.ok) return { error: fetched.error };
        try {
          await deps.proofFs.mkdir(proofsDir);
          const file = newName(fetched.ext);
          await deps.proofFs.writeFile(join(proofsDir, file), fetched.bytes);
          return { kind: 'arquivo', file, mediaType: fetched.mediaType };
        } catch {
          return { error: `Li "${source}" na VPS, mas não consegui guardar a cópia neste computador.` };
        }
      }
      const checked = await checkLocalProofFile(deps.proofFs, source);
      if ('error' in checked) return checked;
      const { real, ext, mediaType } = checked;
      try {
        await deps.proofFs.mkdir(proofsDir);
        const file = newName(ext);
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
    now,
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
  /**
   * 06/11 — the places of the boards the main could read (project folder → place id → `estado` of `sessao_listar`:
   * trabalhando, parada, fechada, nao-comecou…). A board missing here is unknown: none of its tasks counts as orphan,
   * and `tarefa_listar` counts them apart (`desconhecidas`), never as alive.
   */
  readonly placeStates?: ReadonlyMap<string, ReadonlyMap<string, string>>;
}

/** Why a task is orphan (not closed, its owner place gone); `null` = alive, closed or unknown. The rule is shared with the box. */
export function orphanReason(caller: LedgerCaller, task: LedgerTask, now: number): string | null {
  return orphanReasonIn(caller.placeStates, task, now);
}

/** The owner place of `task` could not be checked: its board did not answer. Closed and delivered tasks do not depend on it. */
export function ownerUnknown(caller: LedgerCaller, task: LedgerTask): boolean {
  // The Líder único is no place of any board: whether the board answered says nothing of it (t-52b31719).
  if (task.ownerPlaceId === LEADER_OF_ALL || isServicePlace(task.ownerPlaceId)) return false;
  return !isClosed(task) && task.state !== 'entregue' && !awaitsSend(task) && !caller.placeStates?.has(task.projectPath);
}

export { NOT_STARTED_GRACE_MS };

/** Why the owner place of `task` can no longer do the work (closed, out of the board, never started); `null` = alive or unknown. */
export function ownerGone(caller: LedgerCaller, task: LedgerTask, now: number): string | null {
  return ownerGoneIn(caller.placeStates, task, now);
}

/** The words of the record of a passage: "passada sozinha: o lugar X fechou". */
export function passOnReason(placeId: string, gone: LedgerPassOnRequest['gone']): string {
  return `passada sozinha: o lugar ${placeId} ${gone === 'fechada' ? 'fechou' : 'não começou'}`;
}

/**
 * 06/11 (t-e753b554) — a place is gone: each task it owns that is aberta, em execução or rejeitada passes to `to`,
 * signed by the gone place itself (the owner place may pass its task on), with the reason "passada sozinha…" in the
 * `criada` event the transfer already writes (v4: no new kind, no new field). A delivered task stays: it waits for
 * whoever decides. A never-started place passes only past `NOT_STARTED_GRACE_MS` (`ownerGone`).
 */
export async function passOnTasks(service: LedgerService, requests: readonly LedgerPassOnRequest[]): Promise<LedgerPassedOn[]> {
  let doc: LedgerDoc;
  try {
    const snapshot = service.load();
    if (snapshot.readOnly) return [];
    doc = snapshot.doc;
  } catch {
    return [];
  }
  const now = service.now();
  const passed: LedgerPassedOn[] = [];
  for (const request of requests) {
    if (!request.to || request.to === request.placeId) continue;
    const caller: LedgerCaller = { projectPath: request.projectPath, placeId: request.placeId, boardPlaceIds: [], placeStates: new Map([[request.projectPath, new Map([[request.placeId, request.gone]])]]) };
    const tasks: { id: string; title?: string }[] = [];
    for (const task of Object.values(doc.tasks)) {
      if (task.projectPath !== request.projectPath || task.ownerPlaceId !== request.placeId || task.slack) continue;
      if (isClosed(task) || (task.state !== 'aberta' && task.state !== 'em-execucao' && task.state !== 'rejeitada')) continue;
      if (!ownerGone(caller, task, now)) continue;
      const result = await service.apply({ kind: 'lugar', placeId: request.placeId }, { op: 'transferir', id: task.id, to: request.to, reason: passOnReason(request.placeId, request.gone) });
      if (result.ok) tasks.push({ id: task.id, ...(task.title ? { title: task.title } : {}) });
    }
    if (tasks.length) passed.push({ projectPath: request.projectPath, placeId: request.placeId, to: request.to, tasks });
  }
  return passed;
}

/**
 * t-2c18d666 — the line the Líder único reads when a place passed it a task by hand (`tarefa_transferir` with
 * "lider"); `null` when the answer is not a transfer to it.
 */
export function leaderTransferNotice(service: LedgerService, fromPlaceId: string, answerText: string, reason: string): string | null {
  let answer: { transferida?: unknown; id?: unknown; dono?: unknown };
  try {
    answer = JSON.parse(answerText) as typeof answer;
  } catch {
    return null;
  }
  if (answer.transferida !== true || answer.dono !== LEADER_OF_ALL || typeof answer.id !== 'string') return null;
  let task: LedgerTask | undefined;
  try {
    task = service.load().doc.tasks[answer.id];
  } catch {
    task = undefined;
  }
  const board = task?.projectPath.split(/[\\/]/).filter(Boolean).pop();
  return `◆ Oráculo: ${fromPlaceId} passou para você a tarefa ${answer.id}${task?.title ? ` «${task.title}»` : ''}${board ? ` (quadro ${board})` : ''}. Motivo: ${reason}. Leia com tarefa_ver e assuma com tarefa_assumir, ou passe adiante com tarefa_transferir.`;
}

/**
 * 08/11 (dono: "Eles devem atualizar diretamente o ledger") — the end of a turn of a session, recorded on its live
 * task as an `andamento` (`turno-encerrado` + the start of what it said) instead of a notice in the Líder's chat.
 * Nothing when it owns no live task, or when it already wrote its own record during this turn.
 */
export async function recordTurnEnd(service: LedgerService, record: LedgerTurnRecord): Promise<LedgerTurnRecorded> {
  // The end of its previous turn, on the ledger's own clock (memory only: after a restart the first turn is recorded).
  const key = `${record.projectPath}\n${record.placeId}`;
  const since = turnEnds.get(key);
  turnEnds.set(key, service.now());
  let doc: LedgerDoc;
  try {
    const snapshot = service.load();
    if (snapshot.readOnly) return 'falhou';
    doc = snapshot.doc;
  } catch {
    return 'falhou';
  }
  const task = progressTaskOf(doc, record.projectPath, record.placeId);
  if ('reason' in task) return 'sem-tarefa';
  if (turnAlreadyRecorded(task, record.placeId, since)) return 'ja-registrado';
  const result = await service.apply({ kind: 'lugar', placeId: record.placeId }, { op: 'andamento', id: task.id, progress: turnEndProgress(record.text) });
  return result.ok ? 'registrado' : 'falhou';
}

/**
 * 08/11 — the words of what reaches the Líder of the board at once after a tool (the bridge puts who said it in front):
 * a delivery for acceptance, or a record of "travada" / "precisa-do-dono". `null` = it stays in the ledger only.
 */
export function urgentLedgerNotice(call: LedgerToolCall, answerText: string): string | null {
  let answer: { entregue?: unknown; registrado?: unknown; id?: unknown };
  try {
    answer = JSON.parse(answerText) as typeof answer;
  } catch {
    return null;
  }
  if (typeof answer.id !== 'string') return null;
  if (call.tool === 'tarefa_entregar' && answer.entregue === true) return `entregou a tarefa ${answer.id} para aceite. Leia a prova com tarefa_ver ${answer.id}.`;
  if (call.tool === 'tarefa_andamento' && answer.registrado === true && isUrgentProgress({ estado: call.estado })) {
    const what = call.estado === 'travada' ? 'está travada' : 'precisa do dono';
    return `${what} (tarefa ${answer.id})${call.precisa ? `: ${call.precisa}` : ''}.`;
  }
  return null;
}

/** A first `tarefa_novidades` (no read yet in this run of the app) looks this far back. */
export const FIRST_NEWS_READ_MS = 24 * 60 * 60 * 1000;
/** The last `tarefa_novidades` of each reader (place + board, or `*` for every board): memory only, like `proofSeen`. */
const newsCursors = new Map<string, number>();

/** Place → when its previous turn ended (`recordTurnEnd`). */
const turnEnds = new Map<string, number>();

/** The vitest starts each case with no reads and no turns. */
export function resetNewsCursors(): void {
  newsCursors.clear();
  turnEnds.clear();
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
  if (!caller.board) return 'não consegui ler o quadro para conferir a cadeia de quem entregou; um Revisor de fora dela ou o dono decide.';
  // Who delivered and, when another place did the work, who did it: a Revisor of neither chain decides.
  for (const from of [delivery.by.placeId, doneByOf(delivery)].filter((id): id is string => id !== undefined)) {
    if (isOpenedBy(caller.board, from, caller.placeId) || isBelow(caller.board, from, caller.placeId)) {
      return `você está na cadeia de quem entregou ou fez o trabalho (${from}): um Revisor de fora dela ou o dono decide.`;
    }
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

/** The "para o dono" block back in the tool's pt-BR words (1-based proof numbers, as it was sent). */
function forOwnerView(forOwner: LedgerForOwner): Record<string, unknown> {
  const visual = forOwner.visual;
  return {
    ...(forOwner.title ? { titulo: forOwner.title } : {}),
    pergunta: forOwner.question,
    resumo: forOwner.summary,
    opcoes: forOwner.options.map((option) => ({
      rotulo: option.label,
      efeito: option.effect,
      ...(option.risk ? { risco: option.risk } : {}),
      fecha: option.closes,
      ...(option.recommended ? { recomendada: true } : {}),
    })),
    porque: forOwner.why,
    risco: forOwner.risk,
    ...(visual?.kind === 'prova' ? { visual: { prova: visual.proof + 1 } } : {}),
    ...(visual?.kind === 'antes-depois' ? { visual: { antes: visual.before + 1, depois: visual.after + 1 } } : {}),
    ...(visual?.kind === 'checagens' ? { visual: { checagens: visual.checks.map((check) => ({ nome: check.name, ok: check.ok, frase: check.sentence })) } } : {}),
  };
}

function taskView(task: LedgerTask, doc: LedgerDoc, orphan: string | null = null): Record<string, unknown> {
  const delivery = lastDelivery(task);
  const decision = [...task.events].reverse().find((event) => event.kind === 'aceita' || event.kind === 'rejeitada');
  const who = (actor: LedgerActor): string => (actor.kind === 'dono' ? 'dono' : actor.placeId);
  const transfers = transfersOf(task);
  return {
    id: task.id,
    ...(task.title ? { titulo: task.title } : {}),
    estado: viewState(task),
    pedido: task.request,
    criterio: task.doneWhen,
    prazo: task.due,
    dono: task.ownerPlaceId,
    risco: task.risk,
    ...(replacesOf(task) ? { substitui: replacesOf(task) } : {}),
    ...(requestedByOf(task) ? { quemPediu: requestedByOf(task) } : {}),
    ...(frenteOf(task) ? { frente: frenteOf(task) } : {}),
    ...(transfers.length ? { transferencias: transfers.map((t) => ({ de: t.from, para: t.to, por: who(t.by), em: new Date(t.at).toISOString(), motivo: t.reason })) } : {}),
    ...(delivery
      ? {
          entrega: {
            por: who(delivery.by),
            ...(doneByOf(delivery) ? { feitoPor: doneByOf(delivery) } : {}),
            em: new Date(delivery.at).toISOString(),
            provas: delivery.proofs?.map((proof) => (proof.kind === 'arquivo' ? `arquivo ${proof.file}` : proof.kind === 'link' ? proof.url : `texto (${proof.text.length} caracteres; leia com tarefa_ver)`)),
            ...(eventNote(delivery) ? { nota: eventNote(delivery) } : {}),
            ...(delivery.forOwner ? { paraODono: forOwnerView(delivery.forOwner) } : {}),
          },
        }
      : {}),
    ...(decision
      ? { decisao: { tipo: isCancelled(task) ? 'cancelada' : decision.kind, por: who(decision.by), ...(decision.option ? { opcao: decision.option } : {}), ...(eventNote(decision) ? { motivo: eventNote(decision) } : {}) } }
      : {}),
    ...(waitsForOwner(doc, task) ? { esperandoDono: true } : {}),
    ...(orphan ? { orfa: `${orphan}: passe adiante com tarefa_transferir ou encerre com tarefa_cancelar.` } : {}),
    ...(task.slack
      ? {
          cartaSlack: {
            destino: task.slack.destination,
            ...(task.slack.thread ? { thread: task.slack.thread } : {}),
            texto: slackLetterText(task.slack),
            ...(task.slack.file ? { arquivo: task.slack.file.path, arquivoNome: task.slack.file.name } : {}),
            enviada: slackLetterSent(task),
            ...(SEND_LABEL[slackSendState(task)] ? { envio: SEND_LABEL[slackSendState(task)] } : {}),
            ...(task.state === 'aceita' && slackSendState(task) === 'nenhum' ? { proximo: 'Aceita: envie este texto exato a este destino, uma vez.' } : {}),
            ...(task.state === 'aceita' && slackSendState(task) === 'falhou'
              ? { proximo: 'O envio falhou e não chegou ao Slack: pode mandar o mesmo texto ao mesmo destino mais uma vez, uma só. Se falhar de novo, a carta se esgota.' }
              : {}),
            ...(task.state === 'rejeitada' && !isCancelled(task) ? { proximo: 'Rejeitada: não envie. Ajuste o texto pelo motivo e crie outra carta com carta_slack.' } : {}),
            ...(isCancelled(task) ? { proximo: 'Cancelada: não envie.' } : {}),
          },
        }
      : {}),
  };
}

/** What `tarefa_ver` says of a letter's send (`nenhum` says nothing). */
const SEND_LABEL: Record<SlackSendState, string | null> = {
  nenhum: null,
  'sem-confirmacao': 'envio sem confirmação: a carta conta como usada',
  confirmado: 'envio confirmado pelo Slack',
  falhou: 'envio falhou; resta um reenvio',
  esgotada: 'o reenvio também falhou; a carta se esgotou',
};

export interface LedgerToolAnswer {
  readonly ok: boolean;
  readonly text: string;
  /** `tarefa_ver`: the first print of the delivery, inline (a session on another computer cannot open the path). */
  readonly image?: { readonly base64: string; readonly mimeType: string };
}

function callerActor(caller: LedgerCaller): LedgerActor {
  return { kind: 'lugar', placeId: caller.placeId, ...(caller.roleId ? { roleId: caller.roleId } : {}) };
}

/** `remote`: the calling session runs on a remote place; its proof files are read there (fatia 6). */
export async function runLedgerTool(service: LedgerService, caller: LedgerCaller, call: LedgerToolCall, remote?: RemoteProofFetch): Promise<LedgerToolAnswer> {
  const actor = callerActor(caller);
  const answer = (result: LedgerApplyResult, what: string): { ok: boolean; text: string } =>
    result.ok ? { ok: true, text: JSON.stringify({ [what]: true, id: result.task.id, estado: result.task.state }) } : { ok: false, text: result.reason };

  switch (call.tool) {
    case 'tarefa_criar': {
      const owner = call.dono === undefined || call.dono === 'seu' ? caller.placeId : call.dono;
      if (!caller.boardPlaceIds.includes(owner)) return { ok: false, text: `"${owner}" não é um lugar deste quadro (veja sessao_listar).` };
      const lowRefused = call.risco === 'baixo' ? lowRiskRefusal(caller, owner) : null;
      const result = await service.apply(actor, {
        op: 'criar',
        projectPath: caller.projectPath,
        request: call.pedido,
        doneWhen: call.criterio,
        due: call.prazo,
        ownerPlaceId: owner,
        risk: lowRefused ? 'alto' : call.risco,
        ...(call.titulo ? { title: call.titulo } : {}),
        ...(call.substitui ? { replaces: call.substitui } : {}),
        // Who asked: what the creator said, or the owner when the task came from his phone's "Pedir".
        ...(call.quemPediu ? { requestedBy: call.quemPediu } : call.pedidoDoDono ? { requestedBy: ASKED_BY_OWNER } : {}),
        ...(call.frente ? { frente: call.frente } : {}),
      });
      if (!result.ok || !lowRefused) return answer(result, 'criada');
      return {
        ok: true,
        text: JSON.stringify({ criada: true, id: result.task.id, estado: result.task.state, risco: 'alto', aviso: `Risco baixo não vale aqui (${lowRefused}); a tarefa espera o dono.` }),
      };
    }
    case 'tarefa_frente': {
      const task = (() => {
        try {
          return service.load().doc.tasks[call.id];
        } catch {
          return undefined;
        }
      })();
      if (!task) return { ok: false, text: `Não existe tarefa "${call.id}" (veja tarefa_listar).` };
      if (task.projectPath !== caller.projectPath) return { ok: false, text: 'A tarefa é de outro quadro; só se mexe em tarefa do próprio quadro.' };
      const result = await service.apply(actor, { op: 'frente', id: task.id, frente: call.frente, ...(call.quemPediu ? { requestedBy: call.quemPediu } : {}) });
      return result.ok ? { ok: true, text: JSON.stringify({ frente: frenteOf(result.task), id: result.task.id, ...(requestedByOf(result.task) ? { quemPediu: requestedByOf(result.task) } : {}) }) } : { ok: false, text: result.reason };
    }
    case 'tarefa_assumir':
      return answer(await service.apply(actor, { op: 'assumir', id: call.id }), 'assumida');
    case 'tarefa_cancelar':
    case 'tarefa_transferir': {
      let doc: LedgerDoc;
      try {
        doc = service.load().doc;
      } catch (error) {
        return { ok: false, text: `Não consegui ler o Oráculo Harrow: ${error instanceof Error ? error.message : String(error)}` };
      }
      const task = doc.tasks[call.id];
      if (!task) return { ok: false, text: `Não existe tarefa "${call.id}" (veja tarefa_listar).` };
      if (task.projectPath !== caller.projectPath) return { ok: false, text: 'A tarefa é de outro quadro; só se mexe em tarefa do próprio quadro.' };
      if (call.tool === 'tarefa_cancelar') return answer(await service.apply(actor, { op: 'cancelar', id: task.id, reason: call.motivo }), 'cancelada');
      const to = call.para === 'seu' ? caller.placeId : call.para;
      // The Líder único has no place, but owns tasks too (t-52b31719): "lider" is a destination of every board.
      if (to !== LEADER_OF_ALL && !caller.boardPlaceIds.includes(to)) return { ok: false, text: `"${to}" não é um lugar deste quadro que você alcança (veja sessao_listar), nem "lider" (o Líder único).` };
      const gone = ownerGone(caller, task, service.now());
      const result = await service.apply(actor, { op: 'transferir', id: task.id, to, reason: gone && !call.motivo.includes(gone) ? `${call.motivo} (${gone})` : call.motivo, ...(gone ? { ownerGone: true } : {}) });
      if (!result.ok) return { ok: false, text: result.reason };
      return {
        ok: true,
        text: JSON.stringify({ transferida: true, id: result.task.id, estado: result.task.state, dono: result.task.ownerPlaceId, ...(result.task.state === 'aberta' ? { proximo: 'O novo dono assume com tarefa_assumir.' } : {}) }),
      };
    }
    case 'carta_slack': {
      const result = await service.apply(actor, {
        op: 'carta-slack',
        projectPath: caller.projectPath,
        slack: {
          destination: call.destino,
          ...(call.destinoNome ? { destinationLabel: call.destinoNome } : {}),
          ...(call.thread ? { thread: call.thread } : {}),
          // With a file, the comment lives in the file and `text` stays '' (`SlackLetter.file`: safe for a v4 app).
          ...(call.arquivo
            ? { text: '', file: { path: call.arquivo, name: call.arquivoNome ?? fileNameOf(call.arquivo), comment: call.texto } }
            : { text: call.texto }),
          reason: call.motivo,
        },
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
      if (call.feitoPor && !caller.boardPlaceIds.includes(call.feitoPor)) return { ok: false, text: `Nada foi entregue. "feitoPor": "${call.feitoPor}" não é um lugar deste quadro (veja sessao_listar).` };
      const proofs: LedgerProof[] = [];
      for (const input of call.provas) {
        const proof = await service.importProof(input, remote);
        if ('error' in proof) {
          await service.discardProofs(proofs);
          return { ok: false, text: `Nada foi entregue. ${proof.error}` };
        }
        proofs.push(proof);
      }
      const result = await service.apply(actor, { op: 'entregar', id: call.id, proofs, ...(call.nota ? { note: call.nota } : {}), ...(call.paraODono ? { forOwner: call.paraODono } : {}), ...(call.feitoPor ? { doneBy: call.feitoPor } : {}) });
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
        ? answer(await service.apply(actor, { op: 'aceitar', id: call.id }), 'aceita')
        : answer(await service.apply(actor, { op: 'rejeitar', id: call.id, reason: call.motivo }), 'rejeitada');
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
      const text = JSON.stringify({ ...taskView(task, doc, orphanReason(caller, task, service.now())), ...(proofs.length ? { provas: proofs.map((proof) => proofView(service, proof)) } : {}) }, null, 1);
      for (const proof of proofs) {
        const image = await service.proofImage(proof);
        if (image) return { ok: true, text, image };
      }
      return { ok: true, text };
    }
    case 'tarefa_andamento': {
      let doc: LedgerDoc;
      try {
        doc = service.load().doc;
      } catch (error) {
        return { ok: false, text: `Não consegui ler o Oráculo Harrow: ${error instanceof Error ? error.message : String(error)}` };
      }
      const task = progressTaskOf(doc, caller.projectPath, caller.placeId, call.id);
      if ('reason' in task) return { ok: false, text: `Nada registrado. ${task.reason}` };
      const progress: LedgerProgress = {
        estado: call.estado,
        ...(call.precisa ? { precisa: call.precisa } : {}),
        ...(call.prova ? { prova: call.prova } : {}),
        ...(call.proximo ? { proximo: call.proximo } : {}),
      };
      const result = await service.apply(actor, { op: 'andamento', id: task.id, progress });
      if (!result.ok) return { ok: false, text: `Nada registrado. ${result.reason}` };
      return {
        ok: true,
        text: JSON.stringify({
          registrado: true,
          id: result.task.id,
          estado: call.estado,
          aviso: isUrgentProgress(progress) ? 'O Líder do seu quadro recebe este registro agora.' : 'Fica no registro; o Líder lê quando quiser (tarefa_novidades).',
        }),
      };
    }
    case 'tarefa_novidades': {
      let doc: LedgerDoc;
      try {
        doc = service.load().doc;
      } catch (error) {
        return { ok: false, text: `Não consegui ler o Oráculo Harrow: ${error instanceof Error ? error.message : String(error)}` };
      }
      const now = service.now();
      // The Líder único without "quadro" has no board: every board.
      const scope = caller.projectPath || null;
      const key = `${caller.placeId}\n${scope ?? '*'}`;
      const since = call.horas ? now - call.horas * 60 * 60 * 1000 : (newsCursors.get(key) ?? now - FIRST_NEWS_READ_MS);
      newsCursors.set(key, now);
      const news = ledgerNews(doc, scope, since, now);
      return {
        ok: true,
        text: JSON.stringify(
          {
            desde: agoText(since, now),
            ...(news.grupos.length ? { sessoes: news.grupos.length, grupos: news.grupos } : { nada: 'Nada mudou no Oráculo desde a última leitura.' }),
          },
          null,
          1,
        ),
      };
    }
    case 'tarefa_listar': {
      let doc: LedgerDoc;
      try {
        doc = service.load().doc;
      } catch (error) {
        return { ok: false, text: `Não consegui ler o Oráculo Harrow: ${error instanceof Error ? error.message : String(error)}` };
      }
      const scope = call.todos ? null : caller.projectPath;
      const situacao = call.situacao ?? (call.estado ? 'todas' : 'vivas');
      const now = service.now();
      const orphanOf = (task: LedgerTask): string | null => orphanReason(caller, task, now);
      const inScope = Object.values(doc.tasks).filter((task) => scope === null || task.projectPath === scope);
      const counts = { vivas: 0, orfas: 0, fechadas: 0, desconhecidas: 0, esperandoEnvio: 0 };
      for (const task of inScope) {
        counts[isClosed(task) ? 'fechadas' : awaitsSend(task) ? 'esperandoEnvio' : orphanOf(task) ? 'orfas' : ownerUnknown(caller, task) ? 'desconhecidas' : 'vivas'] += 1;
      }
      const tasks = inScope
        .filter((task) => !call.estado || viewState(task) === call.estado)
        .filter((task) => situacao === 'todas' || (situacao === 'orfas' ? orphanOf(task) !== null : !isClosed(task) && !awaitsSend(task) && orphanOf(task) === null))
        .sort((a, b) => a.createdAt - b.createdAt);
      const hidden = situacao === 'todas' ? 0 : inScope.length - tasks.length;
      return {
        ok: true,
        text: JSON.stringify(
          {
            faixa: { ...stripView(ledgerStrip(doc, scope)), ...counts },
            situacao,
            ...(hidden ? { fora: `${hidden} tarefa(s) fora desta lista; "situacao": "todas" mostra o histórico inteiro, "orfas" as que ficaram sem lugar.` } : {}),
            tarefas: tasks.map((task) => ({
              ...taskView(task, doc, orphanOf(task)),
              ...(ownerUnknown(caller, task) ? { desconhecida: 'o quadro desta tarefa não respondeu: não sei se o lugar dono ainda existe.' } : {}),
            })),
          },
          null,
          1,
        ),
      };
    }
  }
}

// Slack só com carta — the hook bridge's guard (pure decision in `slack-guard.ts`).
//
// `PreToolUse` frees the call and writes `enviada` on its letters right away, on disk: from that moment the letter
// is spent, even if the app closes before the answer, and a second call finds nothing to free. At `PostToolUse` /
// `PostToolUseFailure` the answer is read (`slackSendOutcome`): Slack took it → an `enviada` "confirmado"; an
// EXPLICIT failure ("fetch failed", `isError`, `ok: false`) → an `enviada` "falhou" (`SEND_ANSWER`), and the letter frees ONE resend of the same
// text (t-8119864a); a doubt, or no answer within `LETTER_IN_FLIGHT_MS`, writes nothing: the letter stays spent,
// "envio sem confirmação".
//
// A post by an agent's OWN bot (`agentBotServers`) passes with no letter. At its answer the guard writes the record
// "enviado pelo bot do agente" (op `slack-bot`: destination, text, file, link and outcome), on the board and place
// of the session (`placeOf`), for the owner to see later. An answer that never comes (the app closed) leaves no record.

export const LETTER_IN_FLIGHT_MS = 15 * 60 * 1000;

interface LetterInFlight {
  readonly ptyId: string;
  readonly toolUseId: string | null;
  readonly callKey: string;
  readonly letterIds: readonly string[];
  /** A post by an agent's own bot: recorded at the answer, no letter. */
  readonly bot?: AgentBotSend;
  readonly cwd?: string;
  readonly at: number;
}

/** The board and place of a session, for the record of its bot's post; `null` = unknown (the record keeps the folder). */
export type SlackSessionPlace = (ptyId: string) => Promise<{ readonly projectPath: string; readonly placeId: string } | null>;

export interface SlackLetterGuardOptions {
  readonly now?: () => number;
  /** The MCP servers of the agents' own bots (from the config); default `AGENT_BOT_SERVERS`. */
  readonly agentBotServers?: () => readonly string[];
  readonly placeOf?: SlackSessionPlace;
}

export interface SlackLetterGuard {
  /** `PreToolUse`: `null` = the call goes on (its letters are now spent); a string = the refusal the session reads. */
  before(ptyId: string, payload: Record<string, unknown>): Promise<string | null>;
  /**
   * `PostToolUse` / `PostToolUseFailure` of the same call: records the answer; only an explicit failure reopens. A
   * bot's post is recorded asynchronously (the promise ends when it is on disk).
   */
  after(ptyId: string, event: string, payload: Record<string, unknown>): Promise<void> | void;
}

const toolNameOf = (payload: Record<string, unknown>): string => (typeof payload.tool_name === 'string' ? payload.tool_name : '');

function callKeyOf(payload: Record<string, unknown>): string {
  let input = '';
  try {
    input = JSON.stringify(payload.tool_input) ?? '';
  } catch {
    input = '';
  }
  return `${typeof payload.agent_id === 'string' ? payload.agent_id : ''}\u0000${toolNameOf(payload)}\u0000${input}`;
}

export function createSlackLetterGuard(service: () => LedgerService | null, options: SlackLetterGuardOptions | (() => number) = {}): SlackLetterGuard {
  const opts: SlackLetterGuardOptions = typeof options === 'function' ? { now: options } : options;
  const now = opts.now ?? Date.now;
  const botServers = (): readonly string[] => opts.agentBotServers?.() ?? AGENT_BOT_SERVERS;
  const inFlight: LetterInFlight[] = [];

  async function recordBot(ptyId: string, entry: LetterInFlight, event: string, payload: Record<string, unknown>): Promise<void> {
    const bot = entry.bot!;
    const outcome = slackSendOutcome(event, payload.tool_response, payload.error);
    let place: { projectPath: string; placeId: string } | null = null;
    try {
      place = (await opts.placeOf?.(ptyId)) ?? null;
    } catch {
      place = null;
    }
    const ledger = service();
    if (!ledger) return;
    const link = outcome.kind === 'falhou' ? null : slackMessageLink(payload.tool_response, bot);
    try {
      await ledger.apply(
        { kind: 'lugar', placeId: place?.placeId ?? `sessao:${ptyId}` },
        {
          op: 'slack-bot',
          projectPath: place?.projectPath ?? entry.cwd ?? '',
          bot: {
            server: bot.server,
            tool: bot.tool,
            destination: bot.destination,
            ...(bot.thread ? { thread: bot.thread } : {}),
            text: bot.text,
            ...(bot.file ? { file: bot.file } : {}),
            outcome: outcome.kind,
            ...(outcome.kind === 'falhou' ? { why: outcome.why } : {}),
            ...(link ? { link } : {}),
          },
        },
      );
    } catch {
      // the record is for the owner to see later; failing to write it never touches the send
    }
  }

  function prune(): void {
    const cutoff = now() - LETTER_IN_FLIGHT_MS;
    for (let i = inFlight.length - 1; i >= 0; i--) if (inFlight[i]!.at < cutoff) inFlight.splice(i, 1);
  }

  return {
    async before(ptyId, payload) {
      const toolName = toolNameOf(payload);
      if (detectSlackSend(toolName, payload.tool_input).kind === 'none' && !detectAgentBotSend(toolName, payload.tool_input, botServers())) return null;
      prune();
      const ledger = service();
      let doc: LedgerDoc | null = null;
      try {
        const snapshot = ledger?.load();
        doc = snapshot && !snapshot.readOnly ? snapshot.doc : null;
      } catch {
        doc = null;
      }
      const verdict = slackGuard(doc, toolName, payload.tool_input, botServers());
      if (verdict.kind === 'not-slack') return null;
      if (verdict.kind === 'deny') return verdict.reason;
      if (verdict.kind === 'agent-bot') {
        const toolUseId = typeof payload.tool_use_id === 'string' ? payload.tool_use_id : null;
        const cwd = typeof payload.cwd === 'string' ? payload.cwd : undefined;
        inFlight.push({ ptyId, toolUseId, callKey: callKeyOf(payload), letterIds: [], bot: verdict.send, ...(cwd ? { cwd } : {}), at: now() });
        return null;
      }
      for (const id of verdict.letterIds) {
        const task = doc!.tasks[id]!;
        const marked = await ledger!.apply({ kind: 'lugar', placeId: task.ownerPlaceId }, { op: 'slack-enviada', id });
        if (!marked.ok) return `Envio ao Slack bloqueado pelo Donel Dev: não consegui marcar a carta ${id} como usada (${marked.reason}). Tente de novo.`;
      }
      const toolUseId = typeof payload.tool_use_id === 'string' ? payload.tool_use_id : null;
      inFlight.push({ ptyId, toolUseId, callKey: callKeyOf(payload), letterIds: verdict.letterIds, at: now() });
      return null;
    },
    async after(ptyId, event, payload) {
      if (event !== 'PostToolUse' && event !== 'PostToolUseFailure') return;
      prune(); // an answer after the deadline finds nothing: the letter stays spent
      const toolUseId = typeof payload.tool_use_id === 'string' ? payload.tool_use_id : null;
      const callKey = callKeyOf(payload);
      const index = inFlight.findIndex(
        (entry) => entry.ptyId === ptyId && (entry.toolUseId !== null && toolUseId !== null ? entry.toolUseId === toolUseId : entry.callKey === callKey),
      );
      if (index < 0) return;
      const [entry] = inFlight.splice(index, 1);
      if (entry!.bot) return recordBot(ptyId, entry!, event, payload);
      const outcome = slackSendOutcome(event, payload.tool_response, payload.error);
      if (outcome.kind === 'sem-confirmacao') return; // spent, "envio sem confirmação"
      const ledger = service();
      if (!ledger) return;
      let doc: LedgerDoc;
      try {
        doc = ledger.load().doc;
      } catch {
        return;
      }
      for (const id of entry!.letterIds) {
        const task = doc.tasks[id];
        if (!task) continue;
        await ledger.apply(
          { kind: 'lugar', placeId: task.ownerPlaceId },
          outcome.kind === 'confirmado' ? { op: 'slack-resultado', id, outcome: 'confirmado' } : { op: 'slack-resultado', id, outcome: 'falhou', why: outcome.why },
        );
      }
    },
  };
}
