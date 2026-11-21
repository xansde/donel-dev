// Saída iii (18/11) — the phone app talks to this daemon over the tailnet, no Supabase in between
// (contract: ~/seazone/_scratch/celular-tailnet/contrato.md, v1). Routes under `/api/v2/` of the phone's server
// (src/main/celular/server.ts, port 47815, tailnet only). The answers carry the same columns as the Supabase views
// the app read until today (`celular.oraculo`, `celular.ledger`, `celular.lider_conversa`, `celular.tarefas_pedidas_v`),
// built here from the ledger itself; the writes land in the local queues (celular-local.ts) that today's consumers
// apply, and each write kicks them so it applies in seconds.
//
// Auth: every request is signed with the device key the phone already keeps (`K = sha256(token)`, the hash the daemon
// stores): `Authorization: Donel-HMAC <ts_ms>.<hex>`, hex = HMAC-SHA256(K, "donel-req-v1\n" + METHOD + "\n" + path
// with query + "\n" + ts_ms + "\n" + sha256hex(body)). Five minutes of clock either way. No token ever on the wire.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { isClosed, lastDelivery, SERVICE_PLACE_PREFIX, VIGIA_SERVICE, type LedgerDoc, type LedgerEvent, type LedgerTask } from '../shared/ledger/contract';
import { deliveryNote } from '../shared/ledger/labels';
import { actorName, cartaRow, cartaRows, maskSecrets, tarefaRow, tarefaRows, type CartaProvaRef, type PlaceInfoOf, type TarefaRow } from '../shared/ledger/mirror';
import { localFlagOn } from '../main/local-flags';
import { prepareProof, type ProofReader } from '../main/ledger-mirror/cartas';
import type { MobileRequest, MobileResponse } from '../main/celular/server';
import { CHAT_AUDIO_MAX_MS, CHAT_AUDIO_MAX_PARTES, CHAT_AUDIO_MIMES, CHAT_AUDIO_PARTE_MIMES, type CelularLocalStore } from './celular-local';
import { MAX_ARQUIVO_BODY, MAX_ARQUIVO_BYTES } from './chat-arquivo';
import type { GlossarioResumo, GlossarioStore } from './glossario';
import { CREDENCIAL_PATH, type CredencialHandler } from './credencial';
import { projetoDoQuadro, visaoGeral, type QuadroLeitura } from './quadro-v2';
import { montarUsoIa, USO_IA_PATH, type UsoIaPaths } from './uso-ia';
import { HOMOLOGACAO_PATH, lerHomologacao, type HomologacaoPaths } from './homologacao';
import type { Avisos } from './avisos';

export const V2_PREFIX = '/api/v2/';
export const SIGNATURE_SCHEME = 'donel-req-v1';
export const CLOCK_WINDOW_MS = 5 * 60_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const DAY_MS = 86_400_000;
const MAX_BODY = 64 * 1024;
/** t-268ed62a — only the voice message (`POST chat/audio`, base64 in JSON) gets this much (contract v1.2). */
export const CHAT_AUDIO_PATH = 'chat/audio';
export const MAX_AUDIO_BODY = 6 * 1024 * 1024;
const MAX_AUDIO_MS = 5 * 60_000;
// No repeated group: V8 recursed on `(?:x{4})*` and overflowed the stack above ~4.4 MB of base64 (PR #500 review).
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;
const isBase64 = (value: string): boolean => value.length % 4 === 0 && BASE64.test(value);
/** t-b03fdec8 — a voice message of any length, in parts of 60 s (contract v1.6): each part's body has the same 6 MB. */
export const CHAT_AUDIO_PARTE_PATH = 'chat/audio/parte';
export const CHAT_AUDIO_FIM_PATH = 'chat/audio/fim';
const CONTINUA_INVALIDO = 'O áudio anterior não existe, não foi fechado pela VPS ou tem outro formato; ou este áudio já continua outro.';
/** t-a1ad1ca2 — the owner's file (`POST chat/arquivo`, contract v1.4): the only route with ~20 MB of body. */
export const CHAT_ARQUIVO_PATH = 'chat/arquivo';
const MAX_NOME = 255;
const MAX_MIME = 255;
const MAX_LEGENDA = 4000;
/** t-753e8199 — the owner corrects an audio's transcription (contract v1.3). */
export const CHAT_CORRECAO_PATH = 'chat/correcao';
const MAX_CORRECAO = 4000;
/**
 * t-c62538a7 — the result of each of the owner's requests (`GET resultados`, contract v1.7), and `GET prova` finding the
 * file of any task, not only of the ones waiting for him. Behind a local flag read at each request: off = 404 and the
 * old `prova`.
 */
export const RESULTADOS_FLAG = 'celular-resultados';
const RESULTADOS_DIAS = 30;
const MAX_RESULTADOS = 400;
const MAX_RESULTADO_NOTA = 2000;
const MAX_RESULTADO_LINKS = 10;
/** Who asked, as `quadro::e_do_dono` in the app reads it. */
const OWNER_ASKED = /^\s*(alexandre|dono)\b/i;
const NOT_A_RESULT = new Set(['cancelada', 'substituída']);
/**
 * t-b07b50ff (docs/adr/0011) — the phone's native warnings (`GET avisos`, a long-poll): behind a local flag read at each
 * request; off = 404 `desligada` and the app stops its service.
 */
export const AVISOS_PATH = 'avisos';
export const AVISOS_FLAG = 'celular-avisos';

const HEADERS = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } as const;
const json = (status: number, value: unknown): MobileResponse => ({ status, headers: { ...HEADERS, 'Content-Type': 'application/json; charset=utf-8' }, body: JSON.stringify(value) });
const erro = (status: number, codigo: string, mensagem?: string): MobileResponse => json(status, { erro: codigo, ...(mensagem ? { mensagem } : {}) });

export interface CelularV2Deps {
  /** The paired device that signed `message` with its key, or null (auth.verifySignature). */
  readonly verify: (message: string, signatureHex: string) => { readonly name: string } | null;
  readonly doc: () => LedgerDoc | null;
  readonly store: CelularLocalStore;
  readonly places?: () => PlaceInfoOf | undefined;
  readonly ownerName?: () => string;
  readonly readProof: ProofReader;
  /** The tree the estado_derivado writes (only when it changes). */
  readonly arvoreFile: string;
  /** Runs the consumers now (a write should not wait a 15 s round). */
  readonly kick?: (fila: 'decisoes' | 'pedidas' | 'chat') => void;
  /** A new voice message for the daemon's transcriber (chat-audio.ts). */
  readonly audio?: (id: string) => void;
  /** What the transcriber learns from the owner's corrections (glossario.ts); absent = nothing learnt. */
  readonly glossario?: GlossarioStore;
  /**
   * t-c441e144 (docs/adr/0010) — the credential box (`POST credencial`): the RAW body goes to src/oraculo/credencial/,
   * the only code that touches the password. Absent = 404. Wired only where the chat lives (it announces there).
   */
  readonly credencial?: CredencialHandler;
  /** t-f091595a — the task board, read only (quadro-v2.ts); absent = `quadro-desligado`. */
  readonly quadro?: () => Promise<QuadroLeitura>;
  /**
   * t-1c683858 — the "Uso de IA" screen (`GET uso-ia`, src/oraculo/uso-ia.ts): where it reads and keeps its state, and
   * the local flag `celular-uso-ia`, read at every request. Absent or off = 404 `desligada`.
   */
  readonly usoIa?: UsoIaPaths & { readonly flagOn: () => boolean };
  /**
   * t-b3f48bf5 — the homologation screen (`GET homologacao`, src/oraculo/homologacao.ts): the cron's cleaned copy, read
   * only, at a path fixed here; the local flag `celular-homologacao`, read at every request. Absent or off = 404 `desligada`.
   */
  readonly homologacao?: HomologacaoPaths & { readonly flagOn: () => boolean };
  /** t-b07b50ff — the warnings' long-poll (src/oraculo/avisos.ts): only the entregador, where the chat lives. Absent = 404. */
  readonly avisos?: Avisos;
  readonly log?: (line: string) => void;
  readonly now?: () => number;
  /** Local feature flags (`local-flags.ts`); default: the files in `~/.donel/flags/` of this machine, read each time. */
  readonly flagOn?: (name: string) => boolean;
}

export function signedMessage(method: string, pathWithQuery: string, ts: string, body: string): string {
  return `${SIGNATURE_SCHEME}\n${method.toUpperCase()}\n${pathWithQuery}\n${ts}\n${createHash('sha256').update(body, 'utf8').digest('hex')}`;
}

function parseBody(body: string, max = MAX_BODY): Record<string, unknown> | null {
  if (body.length > max) return null;
  try {
    const value = JSON.parse(body) as unknown;
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const textOrNull = (value: unknown): string | null => (typeof value === 'string' ? value : null);
const trimmedOrNull = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value.trim() : null);
const iso = (ms: number | null | undefined): string | null => (typeof ms === 'number' ? new Date(ms).toISOString() : null);

export function createCelularV2Handler(deps: CelularV2Deps): (request: MobileRequest) => Promise<MobileResponse> {
  const now = deps.now ?? Date.now;
  const flagOn = deps.flagOn ?? ((name: string) => localFlagOn(name));
  /** A proof's prepared form, by file: the hash of a print is read once, not at every list. */
  const prepared = new Map<string, Awaited<ReturnType<typeof prepareProof>>>();

  /** The device that signed, or why not. */
  function authorize(request: MobileRequest): { readonly denied: MobileResponse } | { readonly device: string } {
    const match = /^Donel-HMAC\s+(\d{10,16})\.([0-9a-f]{64})$/.exec(request.authorization?.trim() ?? '');
    if (!match) return { denied: erro(401, 'nao-pareado') };
    const ts = match[1]!;
    if (Math.abs(now() - Number(ts)) > CLOCK_WINDOW_MS) return { denied: erro(401, 'relogio', 'O relógio do celular está fora da hora da VPS.') };
    const device = deps.verify(signedMessage(request.method, request.url, ts, request.body ?? ''), match[2]!);
    return device ? { device: device.name } : { denied: erro(401, 'nao-pareado') };
  }

  function rowsOf(doc: LedgerDoc): TarefaRow[] {
    return tarefaRows(doc, deps.places?.(), { ownerName: deps.ownerName?.() ?? 'Alexandre' }).rows;
  }

  const updatedAt = (doc: LedgerDoc, id: string): string | null => {
    const events = doc.tasks[id]?.events ?? [];
    return iso(events.length ? events[events.length - 1]!.at : doc.tasks[id]?.createdAt);
  };

  async function provaMeta(ref: CartaProvaRef): Promise<Record<string, unknown>> {
    let got = prepared.get(ref.file);
    if (!got) {
      got = await prepareProof(ref, deps.readProof);
      // A file not there yet is looked for again next time (as the espelho did); the cache stays small.
      if (!got.sem_arquivo) {
        if (prepared.size >= 500) prepared.clear();
        prepared.set(ref.file, { ...got, bytes: undefined });
      }
    }
    return { ordem: ref.ordem, tipo: got.undecodable ? 'arquivo' : ref.tipo, media_type: ref.media_type, rotulo: ref.rotulo, sha256: got.sha256, tamanho: got.tamanho, sem_arquivo: got.sem_arquivo, pronta: !got.sem_arquivo };
  }

  async function cartas(): Promise<MobileResponse> {
    const doc = deps.doc();
    if (!doc) return erro(503, 'sem-ledger');
    const cards = new Map(cartaRows(doc).rows.map((row) => [row.id, row]));
    const out: Array<Record<string, unknown>> = [];
    for (const row of rowsOf(doc)) {
      if (!row.esperando_dono) continue;
      const card = cards.get(row.id);
      const provas = card ? await Promise.all(card.provas.map(provaMeta)) : [];
      out.push({
        id: row.id,
        quadro: row.quadro,
        titulo: row.titulo,
        frente: row.frente,
        estado: row.estado,
        risco: row.risco,
        prazo: row.prazo,
        quem_pediu: row.quem_pediu,
        quem_faz_agora: row.quem_faz_agora,
        quem_criou: row.quem_criou,
        pedido: row.pedido,
        ultima_entrega: row.ultima_entrega,
        link_da_prova: row.link_da_prova,
        prova_texto: row.prova_texto === null ? null : row.prova_texto.slice(0, 4000),
        criada_em: row.criada_em,
        entregue_em: row.entregue_em,
        atualizado_em: updatedAt(doc, row.id),
        carta:
          card && (card.pergunta !== null || card.opcoes.length > 0)
            ? { pergunta: card.pergunta, resumo: card.resumo, opcoes: card.opcoes, porque: card.porque, risco: card.risco, titulo: card.titulo, visual: card.visual, tipo: card.tipo, corpo: card.corpo }
            : null,
        na_fila: deps.store.pendingDecision(row.id),
        provas,
      });
    }
    out.sort((a, b) => String(a.entregue_em ?? '￿').localeCompare(String(b.entregue_em ?? '￿')) || String(a.id).localeCompare(String(b.id)));
    return json(200, { cartas: out, gerado_em: new Date(now()).toISOString() });
  }

  async function prova(query: URLSearchParams): Promise<MobileResponse> {
    const doc = deps.doc();
    const tarefa = query.get('tarefa') ?? '';
    const ordem = Number(query.get('ordem'));
    const task = doc && Object.hasOwn(doc.tasks, tarefa) ? doc.tasks[tarefa] : undefined;
    const card = !doc ? undefined : flagOn(RESULTADOS_FLAG) ? (task ? cartaRow(task, []) : undefined) : cartaRows(doc).rows.find((row) => row.id === tarefa);
    const ref = card?.provas.find((candidate) => candidate.ordem === ordem);
    if (!ref) {
      // A text proof is not a file: it goes as the task's text proof, masked.
      const row = doc && doc.tasks[tarefa] ? rowsOf(doc).find((candidate) => candidate.id === tarefa) : undefined;
      if (row?.prova_texto && ordem >= 1) return { status: 200, headers: { ...HEADERS, 'Content-Type': 'text/plain; charset=utf-8' }, body: row.prova_texto };
      return erro(404, 'nao-encontrada');
    }
    const got = await prepareProof(ref, deps.readProof);
    if (!got.bytes || got.sem_arquivo) return erro(404, 'nao-encontrada');
    return { status: 200, headers: { ...HEADERS, 'Content-Type': ref.media_type, 'X-Sha256': got.sha256 ?? '', 'Content-Security-Policy': "sandbox; default-src 'none'" }, body: new Uint8Array(got.bytes) };
  }

  const lastAt = (task: LedgerTask): number => (task.events.length ? task.events[task.events.length - 1]!.at : task.createdAt);

  const masked = (value: string, max: number): string => {
    const text = maskSecrets(value).text;
    return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
  };

  /** A link's short label: host and a short path (the app may ignore it). */
  function linkLabel(url: string): string {
    try {
      const parsed = new URL(url);
      const path = parsed.pathname === '/' ? '' : parsed.pathname;
      return `${parsed.host}${path.length > 40 ? `${path.slice(0, 39)}…` : path}`;
    } catch {
      return url.length > 60 ? `${url.slice(0, 59)}…` : url;
    }
  }

  /**
   * r-6df6986e (Líder único) — the proof is people's text, marked at the source and never guessed from the words: the
   * ledger has no field for it on a proof, so the mark is who wrote the delivery. Today only the vigia de travas
   * (`servico:vigia`) writes its proof for the owner to read (what stopped, the likely cause, what the team did).
   */
  function provaLegivel(delivery: LedgerEvent): boolean {
    return delivery.by.kind === 'lugar' && delivery.by.placeId === `${SERVICE_PLACE_PREFIX}${VIGIA_SERVICE}`;
  }

  async function entregaOf(task: LedgerTask, row: TarefaRow, places: PlaceInfoOf | undefined): Promise<Record<string, unknown> | null> {
    const delivery = lastDelivery(task);
    if (!delivery) return null;
    const proofs = delivery.proofs ?? [];
    const nameOf = (projectPath: string, placeId: string): string | undefined => places?.(projectPath, placeId)?.name;
    const firstText = proofs.find((proof) => proof.kind === 'texto');
    const note = delivery.forOwner?.summary ?? deliveryNote(delivery, task.projectPath, nameOf) ?? (firstText?.kind === 'texto' ? firstText.text : undefined);
    const links = proofs
      .flatMap((proof) => (proof.kind === 'link' ? [maskSecrets(proof.url).text] : []))
      .slice(0, MAX_RESULTADO_LINKS)
      .map((url) => ({ url, rotulo: linkLabel(url) }));
    return {
      nota: note === undefined ? null : masked(note.trim(), MAX_RESULTADO_NOTA),
      links,
      prova_texto: row.prova_texto,
      prova_legivel: provaLegivel(delivery),
      provas: await Promise.all(cartaRow(task, []).provas.map(provaMeta)),
    };
  }

  /** One task's result, as `GET resultados` lists it and `GET resultado` gives it. */
  async function resultadoOf(row: TarefaRow, task: LedgerTask, places: PlaceInfoOf | undefined, ownerName: string): Promise<Record<string, unknown>> {
    const delivery = lastDelivery(task);
    return {
      id: row.id,
      quadro: row.quadro,
      frente: row.frente,
      titulo: row.titulo,
      estado: row.estado,
      esperando_dono: row.esperando_dono,
      quem_pediu: row.quem_pediu,
      pedido: masked(row.pedido, MAX_RESULTADO_NOTA),
      criterio: row.criterio ? masked(row.criterio, 1000) : null,
      quem_faz_agora: row.quem_faz_agora,
      quem_entregou: delivery ? actorName(delivery.by, task.projectPath, places, ownerName) : null,
      criada_em: row.criada_em,
      entregue_em: row.entregue_em,
      decidida_em: row.decidida_em,
      atualizado_em: iso(lastAt(task)),
      decisao: row.decisao,
      motivo: row.motivo === null ? null : masked(row.motivo, 1000),
      ultimo_andamento: row.ultimo_andamento,
      ultimo_andamento_em: row.ultimo_andamento_em,
      entrega: await entregaOf(task, row, places),
    };
  }

  /**
   * t-3206a54f — the result of any one task (`GET resultado?tarefa=<id>`): a mission's objective opens its last delivery
   * and its text proof, also when the owner did not ask for it (the vigia's records). Same flag as `resultados`.
   */
  async function resultado(query: URLSearchParams): Promise<MobileResponse> {
    const doc = deps.doc();
    if (!doc) return erro(503, 'sem-ledger');
    const id = query.get('tarefa') ?? '';
    const task = Object.hasOwn(doc.tasks, id) ? doc.tasks[id]! : undefined;
    if (!task) return erro(404, 'nao-encontrada');
    const places = deps.places?.();
    const ownerName = deps.ownerName?.() ?? 'Alexandre';
    const row = tarefaRow(doc, task, places, [], { ownerName });
    return json(200, { gerado_em: new Date(now()).toISOString(), resultado: await resultadoOf(row, task, places, ownerName) });
  }

  async function resultados(): Promise<MobileResponse> {
    const doc = deps.doc();
    if (!doc) return erro(503, 'sem-ledger');
    const places = deps.places?.();
    const ownerName = deps.ownerName?.() ?? 'Alexandre';
    const since = now() - RESULTADOS_DIAS * DAY_MS;
    const picked = tarefaRows(doc, places, { ownerName })
      .rows.filter((row) => (OWNER_ASKED.test(row.quem_pediu) || row.quem_pediu.trim() === ownerName.trim()) && !NOT_A_RESULT.has(row.estado))
      .map((row) => ({ row, task: doc.tasks[row.id]! }))
      .filter(({ row, task }) => row.esperando_dono || !isClosed(task) || lastAt(task) >= since)
      .sort((a, b) => lastAt(b.task) - lastAt(a.task) || a.row.id.localeCompare(b.row.id))
      .slice(0, MAX_RESULTADOS);
    const out: Array<Record<string, unknown>> = [];
    for (const { row, task } of picked) out.push(await resultadoOf(row, task, places, ownerName));
    return json(200, { gerado_em: new Date(now()).toISOString(), desde_dias: RESULTADOS_DIAS, resultados: out });
  }

  function tarefas(query: URLSearchParams): MobileResponse {
    const doc = deps.doc();
    if (!doc) return erro(503, 'sem-ledger');
    const days = Number(query.get('desde_dias'));
    const since = Number.isFinite(days) && days > 0 ? now() - days * DAY_MS : null;
    const open = new Set(['aberta', 'em execução', 'entregue', 'esperando envio']);
    const out = rowsOf(doc)
      .filter((row) => since === null || open.has(row.estado) || Date.parse(row.decidida_em ?? row.entregue_em ?? row.criada_em) >= since)
      .map((row) => ({
        id: row.id,
        quadro: row.quadro,
        titulo: row.titulo,
        frente: row.frente,
        estado: row.estado,
        esperando_dono: row.esperando_dono,
        risco: row.risco,
        prazo: row.prazo,
        quem_pediu: row.quem_pediu,
        quem_faz_agora: row.quem_faz_agora,
        ultima_entrega: row.ultima_entrega,
        link_da_prova: row.link_da_prova,
        decisao: row.decisao,
        motivo: row.motivo,
        criada_em: row.criada_em,
        entregue_em: row.entregue_em,
        decidida_em: row.decidida_em,
        atualizado_em: updatedAt(doc, row.id),
        pedido: row.pedido,
        criterio: row.criterio,
        ultimo_andamento: row.ultimo_andamento,
        ultimo_andamento_em: row.ultimo_andamento_em,
      }));
    return json(200, { tarefas: out, gerado_em: new Date(now()).toISOString() });
  }

  function decidir(body: Record<string, unknown>): MobileResponse {
    const { pedido, tarefa, lado } = body;
    if (typeof pedido !== 'string' || !UUID.test(pedido)) return erro(400, 'invalido', 'pedido: uuid v4 em minúsculas');
    if (typeof tarefa !== 'string' || !tarefa || tarefa.length > 200) return erro(400, 'invalido', 'tarefa');
    if (lado !== 'sim' && lado !== 'nao' && lado !== 'comentario') return erro(400, 'invalido', 'lado: sim, nao ou comentario');
    const opcao = textOrNull(body.opcao);
    const comentario = textOrNull(body.comentario);
    if (opcao !== null && opcao.length > 80) return erro(400, 'invalido', 'opcao até 80');
    if (comentario !== null && comentario.length > 2000) return erro(400, 'invalido', 'comentario até 2000');
    if (lado === 'comentario' && !comentario?.trim()) return erro(400, 'invalido', 'comentário vazio');
    const assinatura = textOrNull(body.assinatura);
    if (assinatura !== null && !/^[0-9a-f]{64}$/.test(assinatura)) return erro(400, 'invalido', 'assinatura');
    const entregaMs = typeof body.entrega_ms === 'number' && Number.isFinite(body.entrega_ms) ? body.entrega_ms : null;
    const doc = deps.doc();
    if (doc && !doc.tasks[tarefa]) return erro(404, 'nao-encontrada');
    const added = deps.store.addDecisao({
      pedido,
      tarefa,
      lado,
      opcao: opcao === null ? null : opcao.trim() || null,
      comentario: comentario === null ? null : comentario.trim() || null,
      paginas: Array.isArray(body.paginas) ? body.paginas : null,
      entrega_vista: iso(entregaMs),
      assinatura,
    });
    if (!added.ok) return erro(409, 'conflito', 'Este pedido já existe com outro conteúdo.');
    deps.kick?.('decisoes');
    return json(200, { ok: true, nova: added.nova });
  }

  function pedir(body: Record<string, unknown>): MobileResponse {
    const { pedido } = body;
    if (typeof pedido !== 'string' || !UUID.test(pedido)) return erro(400, 'invalido', 'pedido: uuid v4 em minúsculas');
    const titulo = typeof body.titulo === 'string' ? body.titulo.trim() : '';
    const texto = typeof body.texto === 'string' ? body.texto.trim() : '';
    const criterio = trimmedOrNull(body.criterio);
    const frente = trimmedOrNull(body.frente);
    const prazo = trimmedOrNull(body.prazo);
    if (titulo.length < 3 || titulo.length > 120) return erro(400, 'invalido', 'título com 3 a 120 caracteres');
    if (texto.length < 1 || texto.length > 2000) return erro(400, 'invalido', 'texto com 1 a 2000 caracteres');
    if (criterio && criterio.length > 1000) return erro(400, 'invalido', 'critério com até 1000 caracteres');
    if (frente && frente.length > 80) return erro(400, 'invalido', 'frente com até 80 caracteres');
    if (prazo && !/^\d{4}-\d{2}-\d{2}$/.test(prazo)) return erro(400, 'invalido', 'prazo AAAA-MM-DD');
    const added = deps.store.addPedida({ pedido, titulo, texto, criterio, prazo, frente });
    if (!added.ok) return erro(409, 'conflito', 'Este pedido já existe com outro conteúdo.');
    deps.kick?.('pedidas');
    return json(200, { ok: true, nova: added.nova });
  }

  function chatEnviar(body: Record<string, unknown>): MobileResponse {
    const { id, texto } = body;
    if (typeof id !== 'string' || !UUID.test(id)) return erro(400, 'invalido', 'id: uuid v4 em minúsculas');
    if (typeof texto !== 'string' || !texto.trim() || texto.length > 4000) return erro(400, 'invalido', 'texto com 1 a 4000 caracteres');
    const added = deps.store.addChat(id, texto);
    if (!added.ok) return erro(409, 'conflito', 'Esta mensagem já existe com outro texto.');
    deps.kick?.('chat');
    return json(200, { ok: true, nova: added.nova, estado: deps.store.chatEstado(id) });
  }

  /** Contract v1.2: the answer goes out as soon as the audio is on disk, never after the transcription. */
  function chatAudio(body: Record<string, unknown>): MobileResponse {
    const { id, mime, duracao_ms: duracao, audio_b64: b64 } = body;
    if (typeof id !== 'string' || !UUID.test(id)) return erro(400, 'corpo', 'id: uuid v4 em minúsculas');
    if (typeof mime !== 'string' || !Object.hasOwn(CHAT_AUDIO_MIMES, mime)) return erro(415, 'formato');
    if (typeof duracao !== 'number' || !Number.isInteger(duracao) || duracao < 1) return erro(400, 'corpo', 'duracao_ms');
    if (duracao > MAX_AUDIO_MS) return erro(413, 'grande-demais');
    if (typeof b64 !== 'string' || !isBase64(b64)) return erro(400, 'corpo', 'audio_b64: base64 padrão, sem quebras');
    const added = deps.store.addChatAudio(id, { mime, duracao_ms: duracao }, Buffer.from(b64, 'base64'));
    if (!added.ok) return erro(409, 'conflito', 'Esta mensagem já existe com outro conteúdo.');
    const estado = deps.store.audioEstado(id) === 'transcrevendo' ? 'transcrevendo' : deps.store.chatEstado(id);
    if (added.nova) deps.audio?.(id);
    return json(200, { ok: true, nova: added.nova, estado });
  }

  /** Contract v1.6: one part of a recording, on disk before the answer; the same `(id, n)` again is the same part. */
  function chatAudioParte(body: Record<string, unknown>): MobileResponse {
    const { id, n, mime, audio_b64: b64, continua } = body;
    if (typeof id !== 'string' || !UUID.test(id)) return erro(400, 'corpo', 'id: uuid v4 em minúsculas');
    if (continua !== undefined && (typeof continua !== 'string' || !UUID.test(continua))) return erro(400, 'corpo', 'continua: uuid v4 em minúsculas');
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 0) return erro(400, 'corpo', 'n: inteiro a partir de 0');
    if (mime === 'audio/mp4') return erro(415, 'formato-sem-partes', 'O mp4 não se emenda: mande inteiro (até 5 min) ou grave em webm.');
    if (typeof mime !== 'string' || !CHAT_AUDIO_PARTE_MIMES.includes(mime)) return erro(415, 'formato');
    if (n >= CHAT_AUDIO_MAX_PARTES) return erro(413, 'longo-demais', 'O áudio passou de 2 h.');
    if (typeof b64 !== 'string' || !isBase64(b64)) return erro(400, 'corpo', 'audio_b64: base64 padrão, sem quebras');
    const added = deps.store.addChatAudioParte(id, n, mime, Buffer.from(b64, 'base64'), continua);
    if (!added.ok) {
      // Contract v1.8: closed by the VPS after 30 min; the phone sends what it lacks as a new audio with `continua`.
      if (added.erro === 'fechado-auto') return json(409, { erro: 'fechado-auto', recebidas: added.recebidas });
      if (added.erro === 'ja-continuado') return json(409, { erro: 'ja-continuado', id: added.id });
      if (added.erro === 'continua-invalido') return erro(409, 'continua-invalido', CONTINUA_INVALIDO);
      return erro(409, 'conflito', added.erro === 'fechado' ? 'Este áudio já foi fechado.' : 'Esta parte já existe com outro conteúdo.');
    }
    return json(200, { ok: true, nova: added.nova, recebidas: added.recebidas });
  }

  /** Contract v1.6: the end of a recording in parts; from here on it is the v1.2 audio. */
  function chatAudioFim(body: Record<string, unknown>): MobileResponse {
    const { id, partes, duracao_ms: duracao, interrompido, cancelado, continua } = body;
    if (typeof id !== 'string' || !UUID.test(id)) return erro(400, 'corpo', 'id: uuid v4 em minúsculas');
    if (cancelado !== undefined && typeof cancelado !== 'boolean') return erro(400, 'corpo', 'cancelado: true ou false');
    if (cancelado === true) {
      // Contract v1.7: the owner threw it away. No faltam-partes (nothing to join); the parts leave the disk now.
      if (typeof partes !== 'number' || !Number.isInteger(partes) || partes < 0) return erro(400, 'corpo', 'partes: inteiro a partir de 0');
      const cancel = deps.store.cancelarAudio(id);
      if (!cancel.ok) return cancel.erro === 'ja-enviado' ? erro(409, 'ja-enviado', 'Este áudio já foi enviado ao Líder.') : erro(409, 'conflito', 'Este id não é de um áudio em partes.');
      if (cancel.nova) deps.log?.(`áudio ${id} cancelado pelo dono, ${cancel.apagadas} partes apagadas`);
      return json(200, { ok: true, nova: cancel.nova, estado: 'cancelado' });
    }
    if (typeof partes !== 'number' || !Number.isInteger(partes) || partes < 1) return erro(400, 'corpo', 'partes: inteiro a partir de 1');
    if (typeof duracao !== 'number' || !Number.isInteger(duracao) || duracao < 0) return erro(400, 'corpo', 'duracao_ms');
    if (typeof interrompido !== 'boolean') return erro(400, 'corpo', 'interrompido: true ou false');
    if (continua !== undefined && (typeof continua !== 'string' || !UUID.test(continua))) return erro(400, 'corpo', 'continua: uuid v4 em minúsculas');
    if (partes > CHAT_AUDIO_MAX_PARTES || duracao > CHAT_AUDIO_MAX_MS) return erro(413, 'longo-demais', 'O áudio passou de 2 h.');
    const closed = deps.store.fecharAudioPartes(id, { partes, duracao_ms: duracao, interrompido, ...(continua !== undefined ? { continua } : {}) });
    if (!closed.ok) {
      if (closed.erro === 'faltam-partes') return json(409, { erro: 'faltam-partes', faltam: closed.faltam });
      if (closed.erro === 'nao-encontrada') return erro(404, 'nao-encontrada');
      if (closed.erro === 'continua-invalido') return erro(409, 'continua-invalido', CONTINUA_INVALIDO);
      if (closed.erro === 'fechado-auto') return json(409, { erro: 'fechado-auto', recebidas: closed.recebidas });
      if (closed.erro === 'ja-continuado') return json(409, { erro: 'ja-continuado', id: closed.id });
      return erro(409, 'conflito', 'Este id não é de um áudio em partes, ou foi cancelado.');
    }
    if (closed.nova) {
      if (closed.estado === 'transcrevendo') deps.audio?.(id);
      else deps.kick?.('chat');
    }
    return json(200, { ok: true, nova: closed.nova, estado: closed.estado, ...(closed.fechado ? { fechado: closed.fechado } : {}) });
  }

  /** Contract v1.4: the file is on disk before the row, and the answer goes out at once. */
  function chatArquivo(body: Record<string, unknown>): MobileResponse {
    const { id, nome, mime, tamanho, arquivo_b64: b64, legenda } = body;
    if (typeof id !== 'string' || !UUID.test(id)) return erro(400, 'corpo', 'id: uuid v4 em minúsculas');
    if (typeof nome !== 'string' || !nome.trim() || nome.length > MAX_NOME) return erro(400, 'corpo', `nome com 1 a ${MAX_NOME} caracteres`);
    if (typeof mime !== 'string' || mime.length > MAX_MIME) return erro(400, 'corpo', 'mime');
    if (legenda !== undefined && legenda !== null && (typeof legenda !== 'string' || legenda.length > MAX_LEGENDA)) return erro(400, 'corpo', `legenda com até ${MAX_LEGENDA} caracteres`);
    if (typeof tamanho !== 'number' || !Number.isInteger(tamanho) || tamanho < 0) return erro(400, 'corpo', 'tamanho');
    if (tamanho > MAX_ARQUIVO_BYTES) return erro(413, 'grande-demais');
    if (typeof b64 !== 'string' || (b64 !== '' && !isBase64(b64))) return erro(400, 'corpo', 'arquivo_b64: base64 padrão, sem quebras');
    const bytes = Buffer.from(b64, 'base64');
    if (bytes.length !== tamanho) return erro(400, 'corpo', 'tamanho não bate com o arquivo');
    const added = deps.store.addChatArquivo(id, { nome, mime: mime.trim() || 'application/octet-stream', legenda: typeof legenda === 'string' ? legenda : '' }, bytes);
    if (!added.ok) return erro(409, 'conflito', 'Esta mensagem já existe com outro conteúdo.');
    if (added.nova) deps.kick?.('chat');
    return json(200, { ok: true, nova: added.nova, estado: deps.store.chatEstado(id) });
  }

  const glossarioResumo = (): GlossarioResumo => {
    try {
      return deps.glossario?.resumo() ?? { correcoes: 0, trocas: 0 };
    } catch {
      return { correcoes: 0, trocas: 0 };
    }
  };

  /** Contract v1.3: the line becomes the owner's text; the correction is one delivery to the Líder; the glossary learns. */
  function chatCorrecao(body: Record<string, unknown>): MobileResponse {
    const { id, audio, texto } = body;
    if (typeof id !== 'string' || !UUID.test(id)) return erro(400, 'invalido', 'id: uuid v4 em minúsculas');
    if (typeof audio !== 'string' || !UUID.test(audio)) return erro(400, 'invalido', 'audio: uuid v4 em minúsculas');
    if (typeof texto !== 'string' || !texto.trim() || texto.length > MAX_CORRECAO) return erro(400, 'invalido', `texto com 1 a ${MAX_CORRECAO} caracteres`);
    const result = deps.store.corrigirAudio(id, audio, texto.trim());
    if (!result.ok) {
      if (result.erro === 'nao-encontrada') return erro(404, 'nao-encontrada');
      if (result.erro === 'nao-e-audio') return erro(409, 'nao-e-audio', 'Só a transcrição de um áudio do dono se corrige.');
      return erro(409, 'conflito', 'Esta correção já existe com outro texto.');
    }
    let correcoes: number | null = null;
    if (result.nova) {
      // The correction is kept and goes to the Líder even if the glossary cannot be written now.
      try {
        if (deps.glossario) correcoes = deps.glossario.aprender(result.antes ?? '', texto.trim()).correcoes;
      } catch (error) {
        deps.log?.(`[glossario] correção ${id.slice(0, 8)} não aprendida: ${error instanceof Error ? error.message : String(error)}`);
      }
      deps.kick?.('chat');
    }
    return json(200, { ok: true, nova: result.nova, correcoes: correcoes ?? glossarioResumo().correcoes });
  }

  const PROJECT_SLUG = /^[a-z0-9][a-z0-9-]{0,62}$/;
  /** t-f091595a — `GET quadro` and `GET quadro/projeto?id=`: the board as it is, never a write. */
  async function quadro(projeto: string | null): Promise<MobileResponse> {
    if (projeto !== null && !PROJECT_SLUG.test(projeto)) return erro(400, 'invalido', 'id: o slug do projeto');
    const leitura = deps.quadro ? await deps.quadro() : ({ kind: 'desligado' } as const);
    if (leitura.kind === 'desligado') return erro(503, 'quadro-desligado', 'O quadro de tarefas não está ligado nesta VPS.');
    if (leitura.kind === 'invalido') return erro(503, 'quadro-invalido', 'A configuração do quadro de tarefas na VPS está inválida.');
    if (leitura.kind === 'indisponivel') return erro(503, 'quadro-indisponivel', 'O quadro de tarefas não pôde ser lido agora.');
    if (projeto === null) return json(200, visaoGeral(leitura.overview, now()));
    const places = deps.places?.();
    const answer = projetoDoQuadro(projeto, leitura, now(), (placeId) => places?.('', placeId)?.name);
    return answer ? json(200, answer) : erro(404, 'nao-encontrada');
  }

  function arvore(): MobileResponse {
    try {
      const raw = JSON.parse(readFileSync(deps.arvoreFile, 'utf8')) as unknown;
      if (typeof raw === 'object' && raw !== null && Array.isArray((raw as { nos?: unknown }).nos)) return json(200, raw);
    } catch {
      // no tree yet
    }
    return json(200, { nos: [], rodada: null });
  }

  function usoIa(): MobileResponse {
    if (!deps.usoIa?.flagOn()) return erro(404, 'desligada');
    try {
      return json(200, montarUsoIa(deps.usoIa, now(), deps.log));
    } catch (error) {
      deps.log?.(`[uso-ia] leitura falhou: ${error instanceof Error ? error.message : String(error)}`);
      return erro(500, 'falhou', 'Não deu para ler o uso de IA agora.');
    }
  }

  function homologacao(): MobileResponse {
    if (!deps.homologacao?.flagOn()) return erro(404, 'desligada');
    const leitura = lerHomologacao(deps.homologacao, now());
    if (leitura.kind === 'ausente') return erro(404, 'sem-copia', 'A cópia do painel de homologação ainda não existe nesta VPS.');
    if (leitura.kind === 'invalida') {
      deps.log?.(`[homologacao] cópia inválida: ${leitura.motivo}`);
      return erro(503, 'copia-invalida', 'A cópia do painel de homologação não pôde ser lida agora.');
    }
    return json(200, leitura.body);
  }

  return async (request) => {
    let url: URL;
    try {
      url = new URL(request.url, 'http://celular.invalid');
    } catch {
      return erro(400, 'invalido');
    }
    const auth = authorize(request);
    if ('denied' in auth) return auth.denied;
    const path = url.pathname.slice(V2_PREFIX.length);
    const method = request.method.toUpperCase();
    const isPost = method === 'POST';
    const isAudio = isPost && (path === CHAT_AUDIO_PATH || path === CHAT_AUDIO_PARTE_PATH);
    const isArquivo = isPost && path === CHAT_ARQUIVO_PATH;
    // t-c441e144 — the password's body never reaches parseBody nor any log here: it goes raw to its own module.
    if (isPost && path === CREDENCIAL_PATH) {
      if (!deps.credencial) return erro(404, 'nao-encontrada');
      return deps.credencial(request.body ?? '', (chatId, linha) => {
        const added = deps.store.addChat(chatId, linha);
        if (added.ok && added.nova) deps.kick?.('chat');
      });
    }
    const maxBody = isAudio ? MAX_AUDIO_BODY : isArquivo ? MAX_ARQUIVO_BODY : MAX_BODY;
    if ((isAudio || isArquivo) && (request.body ?? '').length > maxBody) return erro(413, 'grande-demais');
    const body = isPost ? parseBody(request.body ?? '', maxBody) : null;
    if (isPost && !body) return isAudio || isArquivo ? erro(400, 'corpo') : erro(400, 'invalido', 'corpo JSON');
    if (method === 'GET' && path === 'ping') return json(200, { ok: true, agora: new Date(now()).toISOString(), versao: 'v2' });
    if (method === 'GET' && path === 'cartas') return cartas();
    if (method === 'GET' && path === 'prova') return prova(url.searchParams);
    if (method === 'GET' && path === 'tarefas') return tarefas(url.searchParams);
    if (method === 'GET' && path === 'resultados' && flagOn(RESULTADOS_FLAG)) return resultados();
    if (method === 'GET' && path === 'resultado' && flagOn(RESULTADOS_FLAG)) return resultado(url.searchParams);
    if (isPost && path === 'decidir') return decidir(body!);
    if (isPost && path === 'tarefas-pedidas') return pedir(body!);
    if (method === 'GET' && path === 'tarefas-pedidas') return json(200, { pedidas: deps.store.pedidasView(100) });
    if (isPost && path === 'chat') return chatEnviar(body!);
    if (isAudio) return path === CHAT_AUDIO_PARTE_PATH ? chatAudioParte(body!) : chatAudio(body!);
    if (isPost && path === CHAT_AUDIO_FIM_PATH) return chatAudioFim(body!);
    if (isArquivo) return chatArquivo(body!);
    if (isPost && path === CHAT_CORRECAO_PATH) return chatCorrecao(body!);
    if (method === 'GET' && path === 'chat') {
      const limit = Math.min(400, Math.max(1, Number(url.searchParams.get('limite')) || 200));
      return json(200, { mensagens: deps.store.conversa(limit), glossario: glossarioResumo() });
    }
    if (method === 'GET' && path === 'arvore') return arvore();
    if (method === 'GET' && path === 'quadro') return quadro(null);
    if (method === 'GET' && path === 'quadro/projeto') return quadro(url.searchParams.get('id') ?? '');
    if (method === 'GET' && path === USO_IA_PATH) return usoIa();
    if (method === 'GET' && path === HOMOLOGACAO_PATH) return homologacao();
    if (method === 'GET' && path === AVISOS_PATH) {
      if (!deps.avisos) return erro(404, 'nao-encontrada');
      if (!flagOn(AVISOS_FLAG)) return erro(404, 'desligada');
      return json(200, await deps.avisos.atender(auth.device, url.searchParams));
    }
    return erro(404, 'nao-encontrada');
  };
}

/** Pure: whether a request is for this handler. */
export const isV2Path = (url: string): boolean => url.startsWith(V2_PREFIX);

