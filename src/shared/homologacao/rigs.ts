// Mindscape de homologação, fatia 2 (docs/planos/mindscape-homologacao-v1.md, "rigs.json — formato rigs-factory@1")
// — the shape of the factory's rigs, as the factory itself writes it (decision D1: the rig describes itself and the
// Donel only mirrors). Pure: no React, no Electron. The Donel never writes this file.
//
// Contract rules that live here:
//  - `formato` is `rigs-factory@<major>`; a major other than 1 is refused whole (nothing of it is shown);
//  - an unknown field is ignored; a required field missing or of the wrong type hides THAT item and names it in
//    `foraDoContrato`, the rest keeps showing;
//  - there is no chair type for a person: "Você" is the special target `dono`, which only RECEIVES arrows. An arrow
//    out of `dono` is refused (the owner is never in the path of the seal).

import type { ChairHealth } from '../mindscape/chairs';

export const RIGS_FORMAT_NAME = 'rigs-factory';
export const RIGS_MAJOR = 1;
/** The special target of the arrows that reach the owner. */
export const OWNER_TARGET = 'dono';
/** Older than this, the rigs file counts as stopped ("parado desde HH:MM"): the loop rewrites it every 5 min. */
export const RIGS_STALE_MS = 15 * 60_000;
/** The `linha` under a chair is cut here (contract: up to 60 characters). */
export const RIG_LINE_MAX = 60;

export type RigChairKind = 'agente' | 'codigo' | 'fila';
export type RigLinkKind = 'delega' | 'verifica' | 'escala' | 'acorda';

export const RIG_CHAIR_KINDS: readonly RigChairKind[] = ['agente', 'codigo', 'fila'];
export const RIG_LINK_KINDS: readonly RigLinkKind[] = ['delega', 'verifica', 'escala', 'acorda'];
const HEALTHS: readonly ChairHealth[] = ['problema', 'atencao', 'bem', 'sem-sinal'];

/** The state of a chair that is NOT a session of the Donel (code, queue), as the factory wrote it. */
export interface RigChairState {
  readonly saude: ChairHealth;
  readonly linha?: string;
  /** ISO 8601, as written. */
  readonly desde?: string;
}

export interface RigChair {
  readonly id: string;
  readonly nome: string;
  readonly tipo: RigChairKind;
  /** Only on `agente`: the Donel role whose places sit here. Without it the chair is "vaga". */
  readonly papel?: string;
  /** Only on `agente`: the agreed model ("combinado" in the drawer). */
  readonly modelo?: string;
  /** Only on `codigo` and `fila` (on `agente` the live state comes from the Donel). */
  readonly estado?: RigChairState;
}

export interface RigPod {
  readonly id: string;
  readonly nome: string;
  readonly missao?: string;
  /** Ids of chairs that exist in the file, in the file's order. */
  readonly cadeiras: readonly string[];
}

export interface Rig {
  readonly id: string;
  readonly nome: string;
  readonly missao?: string;
  readonly pods: readonly RigPod[];
}

export interface RigLink {
  readonly de: string;
  /** A chair id or `OWNER_TARGET`. */
  readonly para: string;
  readonly tipo: RigLinkKind;
  readonly rotulo?: string;
}

export interface RigsShape {
  /** ISO 8601, as written. */
  readonly geradoEm: string;
  readonly geradoEmMs: number;
  /** 1 or 2, left to right. */
  readonly rigs: readonly Rig[];
  /**
   * The chairs between the rigs ("fora das duas cadeias"): the file's `foraDosRigs`, then every chair of the file
   * that no pod holds, so nothing the factory runs disappears from the screen.
   */
  readonly foraDosRigs: readonly string[];
  readonly cadeiras: readonly RigChair[];
  readonly ligacoes: readonly RigLink[];
  /** What was hidden for breaking the contract, in words ("item fora do contrato: <id>"). */
  readonly foraDoContrato: readonly string[];
}

export type RigsParse =
  | { readonly ok: true; readonly shape: RigsShape }
  | { readonly ok: false; readonly reason: 'json' | 'formato' | 'estrutura'; readonly message: string };

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

function oneOf<T extends string>(value: unknown, known: readonly T[]): T | undefined {
  return typeof value === 'string' && (known as readonly string[]).includes(value) ? (value as T) : undefined;
}

function cut(line: string): string {
  return line.length > RIG_LINE_MAX ? `${line.slice(0, RIG_LINE_MAX - 1)}…` : line;
}

/** `rigs-factory@1` → 1; anything else → the reason it is refused. */
function checkFormat(value: unknown): string | null {
  const match = typeof value === 'string' ? /^([a-z0-9-]+)@(\d+)$/.exec(value) : null;
  if (!match || match[1] !== RIGS_FORMAT_NAME) return `formato ${typeof value === 'string' ? value : 'ausente'}: este arquivo não é ${RIGS_FORMAT_NAME}`;
  if (Number(match[2]) !== RIGS_MAJOR) return `formato ${value as string}: este Donel lê até @${RIGS_MAJOR}`;
  return null;
}

function parseChair(raw: unknown): RigChair | null {
  if (!isObject(raw)) return null;
  const id = text(raw.id);
  const nome = text(raw.nome);
  const tipo = oneOf(raw.tipo, RIG_CHAIR_KINDS);
  if (!id || !nome || !tipo) return null;
  if (tipo === 'agente') {
    const papel = text(raw.papel);
    const modelo = text(raw.modelo);
    return { id, nome, tipo, ...(papel ? { papel } : {}), ...(modelo ? { modelo } : {}) };
  }
  let estado: RigChairState | undefined;
  if (isObject(raw.estado)) {
    const saude = oneOf(raw.estado.saude, HEALTHS);
    const linha = text(raw.estado.linha);
    const desde = text(raw.estado.desde);
    if (saude) estado = { saude, ...(linha ? { linha: cut(linha) } : {}), ...(desde ? { desde } : {}) };
  }
  return { id, nome, tipo, ...(estado ? { estado } : {}) };
}

function idOf(raw: unknown, fallback: string): string {
  return (isObject(raw) && text(raw.id)) || fallback;
}

export function parseRigsFile(source: string): RigsParse {
  let raw: unknown;
  try {
    raw = JSON.parse(source);
  } catch {
    return { ok: false, reason: 'json', message: 'o arquivo não é JSON' };
  }
  if (!isObject(raw)) return { ok: false, reason: 'estrutura', message: 'o arquivo não é um objeto' };
  const refused = checkFormat(raw.formato);
  if (refused) return { ok: false, reason: 'formato', message: refused };
  const geradoEm = text(raw.geradoEm);
  const geradoEmMs = geradoEm ? Date.parse(geradoEm) : NaN;
  if (!geradoEm || !Number.isFinite(geradoEmMs)) return { ok: false, reason: 'estrutura', message: 'geradoEm ausente ou fora de data' };
  if (!Array.isArray(raw.rigs)) return { ok: false, reason: 'estrutura', message: 'rigs ausente' };

  const outside: string[] = [];

  // Chairs first: the pods, the middle column and the links only keep ids that exist.
  const chairs: RigChair[] = [];
  const known = new Set<string>();
  /** Ids of chairs already named as out of the contract: a pod that lists them is not warned twice. */
  const refusedChairs = new Set<string>();
  (Array.isArray(raw.cadeiras) ? raw.cadeiras : []).forEach((item, index) => {
    const chair = parseChair(item);
    if (!chair || known.has(chair.id)) {
      const id = idOf(item, `cadeira ${index + 1}`);
      refusedChairs.add(id);
      outside.push(id);
      return;
    }
    known.add(chair.id);
    chairs.push(chair);
  });

  const placed = new Set<string>();
  /** The chair ids of a pod or of the middle; one the file does not have is warned (`where` names the list). */
  const takeChairs = (value: unknown, where: string): string[] => {
    const ids: string[] = [];
    for (const id of Array.isArray(value) ? value : []) {
      if (typeof id === 'string' && !known.has(id) && !refusedChairs.has(id)) outside.push(`cadeira ${id} ${where} não existe no arquivo`);
      if (typeof id !== 'string' || !known.has(id) || placed.has(id)) continue;
      placed.add(id);
      ids.push(id);
    }
    return ids;
  };

  const rigs: Rig[] = [];
  raw.rigs.forEach((item, index) => {
    const id = isObject(item) ? text(item.id) : undefined;
    const nome = isObject(item) ? text(item.nome) : undefined;
    if (!isObject(item) || !id || !nome || rigs.length >= 2) {
      outside.push(idOf(item, `rig ${index + 1}`));
      return;
    }
    const pods: RigPod[] = [];
    (Array.isArray(item.pods) ? item.pods : []).forEach((pod, podIndex) => {
      const podId = isObject(pod) ? text(pod.id) : undefined;
      const podName = isObject(pod) ? text(pod.nome) : undefined;
      if (!isObject(pod) || !podId || !podName || !Array.isArray(pod.cadeiras)) {
        outside.push(idOf(pod, `pod ${podIndex + 1} de ${id}`));
        return;
      }
      const missao = text(pod.missao);
      pods.push({ id: podId, nome: podName, ...(missao ? { missao } : {}), cadeiras: takeChairs(pod.cadeiras, `do pod ${podName}`) });
    });
    const missao = text(item.missao);
    rigs.push({ id, nome, ...(missao ? { missao } : {}), pods });
  });
  if (rigs.length === 0) return { ok: false, reason: 'estrutura', message: 'nenhum rig dentro do contrato' };

  const foraDosRigs = takeChairs(raw.foraDosRigs, 'de foraDosRigs');
  for (const chair of chairs) if (!placed.has(chair.id)) foraDosRigs.push(chair.id);

  const ligacoes: RigLink[] = [];
  for (const item of Array.isArray(raw.ligacoes) ? raw.ligacoes : []) {
    const de = isObject(item) ? text(item.de) : undefined;
    const para = isObject(item) ? text(item.para) : undefined;
    const tipo = isObject(item) ? oneOf(item.tipo, RIG_LINK_KINDS) : undefined;
    const valid = de !== undefined && de !== OWNER_TARGET && known.has(de) && para !== undefined && (para === OWNER_TARGET || known.has(para)) && tipo !== undefined;
    if (!valid) {
      outside.push(`ligação ${de ?? '?'} → ${para ?? '?'}`);
      continue;
    }
    const rotulo = text((item as Json).rotulo);
    ligacoes.push({ de, para, tipo, ...(rotulo ? { rotulo } : {}) });
  }

  return { ok: true, shape: { geradoEm, geradoEmMs, rigs, foraDosRigs, cadeiras: chairs, ligacoes, foraDoContrato: outside } };
}
