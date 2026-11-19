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
import type { LedgerDoc } from '../shared/ledger/contract';
import { cartaRows, tarefaRows, type CartaProvaRef, type PlaceInfoOf, type TarefaRow } from '../shared/ledger/mirror';
import { prepareProof, type ProofReader } from '../main/ledger-mirror/cartas';
import type { MobileRequest, MobileResponse } from '../main/celular/server';
import { CHAT_AUDIO_MAX_MS, CHAT_AUDIO_MAX_PARTES, CHAT_AUDIO_MIMES, CHAT_AUDIO_PARTE_MIMES, type CelularLocalStore } from './celular-local';
import { MAX_ARQUIVO_BODY, MAX_ARQUIVO_BYTES } from './chat-arquivo';
import type { GlossarioResumo, GlossarioStore } from './glossario';
import { CREDENCIAL_PATH, type CredencialHandler } from './credencial';

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
/** t-a1ad1ca2 — the owner's file (`POST chat/arquivo`, contract v1.4): the only route with ~20 MB of body. */
export const CHAT_ARQUIVO_PATH = 'chat/arquivo';
const MAX_NOME = 255;
const MAX_MIME = 255;
const MAX_LEGENDA = 4000;
/** t-753e8199 — the owner corrects an audio's transcription (contract v1.3). */
export const CHAT_CORRECAO_PATH = 'chat/correcao';
const MAX_CORRECAO = 4000;

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
  readonly log?: (line: string) => void;
  readonly now?: () => number;
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
  /** A proof's prepared form, by file: the hash of a print is read once, not at every list. */
  const prepared = new Map<string, Awaited<ReturnType<typeof prepareProof>>>();

  function authorize(request: MobileRequest): MobileResponse | null {
    const match = /^Donel-HMAC\s+(\d{10,16})\.([0-9a-f]{64})$/.exec(request.authorization?.trim() ?? '');
    if (!match) return erro(401, 'nao-pareado');
    const ts = match[1]!;
    if (Math.abs(now() - Number(ts)) > CLOCK_WINDOW_MS) return erro(401, 'relogio', 'O relógio do celular está fora da hora da VPS.');
    const device = deps.verify(signedMessage(request.method, request.url, ts, request.body ?? ''), match[2]!);
    return device ? null : erro(401, 'nao-pareado');
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
    const card = doc ? cartaRows(doc).rows.find((row) => row.id === tarefa) : undefined;
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
    const { id, n, mime, audio_b64: b64 } = body;
    if (typeof id !== 'string' || !UUID.test(id)) return erro(400, 'corpo', 'id: uuid v4 em minúsculas');
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 0) return erro(400, 'corpo', 'n: inteiro a partir de 0');
    if (mime === 'audio/mp4') return erro(415, 'formato-sem-partes', 'O mp4 não se emenda: mande inteiro (até 5 min) ou grave em webm.');
    if (typeof mime !== 'string' || !CHAT_AUDIO_PARTE_MIMES.includes(mime)) return erro(415, 'formato');
    if (n >= CHAT_AUDIO_MAX_PARTES) return erro(413, 'longo-demais', 'O áudio passou de 2 h.');
    if (typeof b64 !== 'string' || !isBase64(b64)) return erro(400, 'corpo', 'audio_b64: base64 padrão, sem quebras');
    const added = deps.store.addChatAudioParte(id, n, mime, Buffer.from(b64, 'base64'));
    if (!added.ok) return erro(409, 'conflito', added.erro === 'fechado' ? 'Este áudio já foi fechado.' : 'Esta parte já existe com outro conteúdo.');
    return json(200, { ok: true, nova: added.nova, recebidas: added.recebidas });
  }

  /** Contract v1.6: the end of a recording in parts; from here on it is the v1.2 audio. */
  function chatAudioFim(body: Record<string, unknown>): MobileResponse {
    const { id, partes, duracao_ms: duracao, interrompido, cancelado } = body;
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
    if (partes > CHAT_AUDIO_MAX_PARTES || duracao > CHAT_AUDIO_MAX_MS) return erro(413, 'longo-demais', 'O áudio passou de 2 h.');
    const closed = deps.store.fecharAudioPartes(id, { partes, duracao_ms: duracao, interrompido });
    if (!closed.ok) {
      if (closed.erro === 'faltam-partes') return json(409, { erro: 'faltam-partes', faltam: closed.faltam });
      if (closed.erro === 'nao-encontrada') return erro(404, 'nao-encontrada');
      return erro(409, 'conflito', 'Este id não é de um áudio em partes, ou foi cancelado.');
    }
    if (closed.nova) {
      if (closed.estado === 'transcrevendo') deps.audio?.(closed.linha);
      else deps.kick?.('chat');
    }
    return json(200, { ok: true, nova: closed.nova, estado: closed.estado });
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

  function arvore(): MobileResponse {
    try {
      const raw = JSON.parse(readFileSync(deps.arvoreFile, 'utf8')) as unknown;
      if (typeof raw === 'object' && raw !== null && Array.isArray((raw as { nos?: unknown }).nos)) return json(200, raw);
    } catch {
      // no tree yet
    }
    return json(200, { nos: [], rodada: null });
  }

  return async (request) => {
    let url: URL;
    try {
      url = new URL(request.url, 'http://celular.invalid');
    } catch {
      return erro(400, 'invalido');
    }
    const denied = authorize(request);
    if (denied) return denied;
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
    return erro(404, 'nao-encontrada');
  };
}

/** Pure: whether a request is for this handler. */
export const isV2Path = (url: string): boolean => url.startsWith(V2_PREFIX);

