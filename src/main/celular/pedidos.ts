// Pedir pelo Oráculo — o dono manda um pedido solto (sem carta) do celular para o Líder único. O pedido entra
// numa fila gravada em `<userData>/pedidos-do-dono.json` ANTES de o celular ouvir "recebido", e sai dela para
// o chat do Líder pelo mesmo motor de envio do `sessao_enviar` (`AgentBridge.deliverOwnerMessage`). Líder
// fechado, janela fechada ou app reiniciado: o pedido espera na fila e é entregue quando o Líder abrir.
//
// O que isto guarda (o que sumiria ou duplicaria sem o dono ver):
// - o mesmo pedido do celular (reenvio depois de a rede cair) entra uma vez só (`requestId`);
// - nada sai da fila sem ter entrado no chat do Líder; uma entrega que falhou tenta de novo depois;
// - o texto vai como DADO: a mensagem sempre começa com "◆ Pedido do dono…", então nunca é lida pelo CLI
//   como comando de barra (`/…`) nem como shell (`!…`).

import { randomBytes } from 'node:crypto';
import { dirname } from 'node:path';
import type { ConfigIoDeps } from '../config-store';
import type { TranscriptionJobs } from './transcrever';

export const PEDIDOS_SCHEMA_VERSION = 1;
/** O limite do texto de um pedido (o celular corta antes; aqui recusa). */
export const MAX_PEDIDO_CHARS = 4000;
/** A fila guarda os mais recentes; os entregues mais antigos caem primeiro. */
const MAX_STORED = 200;
/** Líder fechado: tenta de novo a cada tanto. */
export const PEDIDO_RETRY_MS = 20_000;

export interface PedidoTarefa {
  readonly id: string;
  readonly titulo: string;
}

export interface StoredPedido {
  /** `pd-<hex>`: o que o Líder passa em `pedidoDoDono` no `tarefa_criar`. */
  readonly id: string;
  /** O id do envio no celular: um reenvio do mesmo pedido não entra duas vezes. */
  readonly requestId: string;
  readonly texto: string;
  readonly criadoEm: string;
  /** Nome do arquivo do áudio (dentro da pasta dos áudios), se o pedido foi falado. */
  readonly audio?: string;
  readonly entregueEm?: string;
  readonly tarefa?: PedidoTarefa;
}

interface PedidosFile {
  readonly schemaVersion: number;
  readonly pedidos: readonly StoredPedido[];
}

const PEDIDO_ID = /^pd-[0-9a-f]{12}$/;
export const isPedidoId = (value: unknown): value is string => typeof value === 'string' && PEDIDO_ID.test(value);
const AUDIO_FILE = /^[0-9a-f]{24}\.wav$/;
export const isAudioFile = (value: unknown): value is string => typeof value === 'string' && AUDIO_FILE.test(value);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parsePedido(value: unknown): StoredPedido | null {
  if (!isRecord(value)) return null;
  const { id, requestId, texto, criadoEm, audio, entregueEm, tarefa } = value;
  if (!isPedidoId(id) || typeof requestId !== 'string' || typeof texto !== 'string' || typeof criadoEm !== 'string') return null;
  const task = isRecord(tarefa) && typeof tarefa.id === 'string' && typeof tarefa.titulo === 'string' ? { id: tarefa.id, titulo: tarefa.titulo } : undefined;
  return {
    id,
    requestId,
    texto,
    criadoEm,
    ...(isAudioFile(audio) ? { audio } : {}),
    ...(typeof entregueEm === 'string' ? { entregueEm } : {}),
    ...(task ? { tarefa: task } : {}),
  };
}

/** Tira caracteres de controle (menos quebra de linha e tab) e espaço sobrando nas pontas. */
export function cleanPedidoText(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b-\u001f\u007f\u2028\u2029]/g, '').trim();
}

export interface PedidosStoreDeps {
  readonly filePath: string;
  readonly io: ConfigIoDeps;
  readonly now?: () => number;
}

export interface PedidosStore {
  /** Grava o pedido (ou devolve o já gravado com o mesmo `requestId`). */
  add(input: { readonly requestId: string; readonly texto: string; readonly audio?: string }): StoredPedido;
  /** Os que ainda não entraram no chat do Líder, do mais antigo ao mais novo. */
  pending(): StoredPedido[];
  markDelivered(id: string): void;
  /** O Líder criou uma tarefa a partir do pedido. `false` = pedido desconhecido. */
  linkTask(id: string, tarefa: PedidoTarefa): boolean;
  /** Os mais recentes primeiro. */
  list(limit: number): StoredPedido[];
}

export function createPedidosStore(deps: PedidosStoreDeps): PedidosStore {
  const now = deps.now ?? Date.now;
  let readOnly = false;

  function load(): PedidosFile {
    let raw: unknown;
    try {
      const text = deps.io.readFileText(deps.filePath);
      raw = text === null ? null : JSON.parse(text);
    } catch {
      raw = null;
    }
    if (!isRecord(raw)) return { schemaVersion: PEDIDOS_SCHEMA_VERSION, pedidos: [] };
    // Um canal mais novo gravou: este só lê, para não apagar o que não conhece.
    if (typeof raw.schemaVersion === 'number' && raw.schemaVersion > PEDIDOS_SCHEMA_VERSION) readOnly = true;
    const pedidos = Array.isArray(raw.pedidos) ? raw.pedidos.map(parsePedido).filter((p): p is StoredPedido => p !== null) : [];
    return { schemaVersion: PEDIDOS_SCHEMA_VERSION, pedidos };
  }

  let file = load();

  function save(pedidos: StoredPedido[]): void {
    if (readOnly) throw new Error('A fila de pedidos foi gravada por uma versão mais nova do Donel Dev.');
    // Corta os mais antigos já entregues; um pedido na fila nunca cai.
    let trimmed = pedidos;
    while (trimmed.length > MAX_STORED) {
      const index = trimmed.findIndex((p) => p.entregueEm !== undefined);
      if (index === -1) break;
      trimmed = [...trimmed.slice(0, index), ...trimmed.slice(index + 1)];
    }
    const next: PedidosFile = { schemaVersion: PEDIDOS_SCHEMA_VERSION, pedidos: trimmed };
    const tmp = `${deps.filePath}.tmp-${process.pid}-${now()}-${Math.random().toString(36).slice(2)}`;
    try {
      const dir = dirname(deps.filePath);
      if (!deps.io.existsSync(dir)) deps.io.mkdirSync(dir);
      deps.io.writeFileText(tmp, JSON.stringify(next, null, 2));
      deps.io.renameFile(tmp, deps.filePath);
    } catch (error) {
      deps.io.unlinkFile(tmp);
      throw error;
    }
    file = next;
  }

  function update(id: string, change: (p: StoredPedido) => StoredPedido): boolean {
    const index = file.pedidos.findIndex((p) => p.id === id);
    if (index === -1) return false;
    const next = [...file.pedidos];
    next[index] = change(next[index]);
    save(next);
    return true;
  }

  return {
    add(input) {
      const existing = file.pedidos.find((p) => p.requestId === input.requestId);
      if (existing) return existing;
      const pedido: StoredPedido = {
        id: `pd-${randomBytes(6).toString('hex')}`,
        requestId: input.requestId,
        texto: input.texto,
        criadoEm: new Date(now()).toISOString(),
        ...(input.audio ? { audio: input.audio } : {}),
      };
      save([...file.pedidos, pedido]);
      return pedido;
    },
    pending: () => file.pedidos.filter((p) => p.entregueEm === undefined),
    markDelivered(id) {
      update(id, (p) => ({ ...p, entregueEm: new Date(now()).toISOString() }));
    },
    linkTask(id, tarefa) {
      // Virar tarefa prova que o Líder recebeu (a entrega pode ter respondido tarde).
      return update(id, (p) => ({ ...p, tarefa, entregueEm: p.entregueEm ?? new Date(now()).toISOString() }));
    },
    list: (limit) => file.pedidos.slice(-limit).reverse(),
  };
}

// ---------------------------------------------------------------------------------------------------------------
// A mensagem que o Líder recebe.

function hora(iso: string): string {
  const date = new Date(iso);
  const two = (n: number): string => String(n).padStart(2, '0');
  return `${two(date.getDate())}/${two(date.getMonth() + 1)} ${two(date.getHours())}:${two(date.getMinutes())}`;
}

export function leaderMessageFor(pedido: StoredPedido, audioPath?: string): string {
  const lines = [
    `◆ Pedido do dono pelo Oráculo (celular, ${hora(pedido.criadoEm)}): ${pedido.texto}`,
    `(Ele mandou pelo botão Pedir, fora do chat; trate como uma mensagem dele. Se virar tarefa, passe pedidoDoDono: "${pedido.id}" no tarefa_criar, para ele ver no celular.)`,
  ];
  if (audioPath) lines.push(`Áudio original (o texto acima é a transcrição, revisada por ele): ${audioPath}`);
  return lines.join('\n');
}

// ---------------------------------------------------------------------------------------------------------------
// A fila andando.

export interface PedidoRouterDeps {
  readonly store: PedidosStore;
  /** Entrega ao Líder único; `true` = entrou (ou está entrando) no chat dele. */
  readonly deliver: (text: string) => Promise<boolean>;
  /** O caminho do áudio no PC, para o link na mensagem. */
  readonly audioPath?: (file: string) => string;
  readonly retryMs?: number;
}

export interface PedidoRouter {
  /** Grava o pedido e tenta entregar já. Lança se não gravou (o celular ouve o erro e reenvia). */
  submit(input: { readonly requestId: string; readonly texto: string; readonly audio?: string }): StoredPedido;
  /** Entrega o que está na fila, em ordem; para no primeiro que não entrou. */
  flush(): Promise<void>;
  dispose(): void;
}

export function createPedidoRouter(deps: PedidoRouterDeps): PedidoRouter {
  let running: Promise<void> | null = null;
  let again = false;

  async function drain(): Promise<void> {
    do {
      again = false;
      for (const pedido of deps.store.pending()) {
        const audioPath = pedido.audio && deps.audioPath ? deps.audioPath(pedido.audio) : undefined;
        let ok = false;
        try {
          ok = await deps.deliver(leaderMessageFor(pedido, audioPath));
        } catch {
          ok = false;
        }
        if (!ok) return; // Líder fechado: a fila espera, na ordem
        deps.store.markDelivered(pedido.id);
      }
    } while (again);
  }

  function flush(): Promise<void> {
    if (running) {
      again = true;
      return running;
    }
    running = drain()
      .catch((error) => console.error('[donel-dev] pedidos: a fila não andou:', error))
      .finally(() => {
        running = null;
      });
    return running;
  }

  const timer = setInterval(() => {
    if (deps.store.pending().length > 0) void flush();
  }, deps.retryMs ?? PEDIDO_RETRY_MS);
  timer.unref?.();

  return {
    submit(input) {
      const pedido = deps.store.add(input);
      void flush();
      return pedido;
    },
    flush,
    dispose: () => clearInterval(timer),
  };
}

// ---------------------------------------------------------------------------------------------------------------
// O que o celular vê (lista "Seus pedidos").

export type PedidoEstadoCelular = 'na-fila' | 'entregue' | 'tarefa';

export interface PedidoCelular {
  readonly id: string;
  readonly texto: string;
  readonly criadoEm: string;
  readonly estado: PedidoEstadoCelular;
  /** O nome humano da tarefa (e onde ela anda), quando o Líder criou uma a partir do pedido. */
  readonly tarefa?: { readonly titulo: string; readonly estado?: string };
  readonly falado: boolean;
}

export type CriarPedidoResult = { readonly ok: true; readonly pedido: PedidoCelular } | { readonly ok: false; readonly mensagem: string };

/** O que o servidor do celular precisa dos pedidos. */
export interface MobilePedidosPort {
  listar(): PedidoCelular[];
  criar(input: { readonly pedidoId: string; readonly texto: string; readonly audioId?: string }): CriarPedidoResult;
  /** Guarda o áudio e começa a transcrever. */
  transcrever(wav: Uint8Array): { readonly ok: true; readonly audioId: string } | { readonly ok: false; readonly mensagem: string };
  transcricao(audioId: string): { readonly estado: 'transcrevendo' } | { readonly estado: 'pronto'; readonly texto: string } | { readonly estado: 'falhou'; readonly mensagem: string } | null;
}

export function pedidoCelular(pedido: StoredPedido, taskState?: (taskId: string) => string | undefined): PedidoCelular {
  const estado: PedidoEstadoCelular = pedido.tarefa ? 'tarefa' : pedido.entregueEm ? 'entregue' : 'na-fila';
  const taskEstado = pedido.tarefa ? taskState?.(pedido.tarefa.id) : undefined;
  return {
    id: pedido.id,
    texto: pedido.texto,
    criadoEm: pedido.criadoEm,
    estado,
    ...(pedido.tarefa ? { tarefa: { titulo: pedido.tarefa.titulo, ...(taskEstado ? { estado: taskEstado } : {}) } } : {}),
    falado: pedido.audio !== undefined,
  };
}

/**
 * Os pedidos como o servidor do celular os vê: a fila, o roteador até o Líder e os áudios transcritos no PC.
 * Um pedido falado só entra apontando para um áudio que o PC guardou.
 */
export function createMobilePedidosPort(deps: {
  readonly store: PedidosStore;
  readonly router: PedidoRouter;
  readonly audio: TranscriptionJobs;
  readonly taskState?: (taskId: string) => string | undefined;
}): MobilePedidosPort {
  return {
    listar: () => deps.store.list(20).map((pedido) => pedidoCelular(pedido, deps.taskState)),
    criar(input) {
      const texto = cleanPedidoText(input.texto);
      if (!texto) return { ok: false, mensagem: 'O pedido está vazio.' };
      if (input.audioId && !deps.audio.has(input.audioId)) return { ok: false, mensagem: 'O áudio deste pedido não está no PC.' };
      try {
        const pedido = deps.router.submit({ requestId: input.pedidoId, texto, ...(input.audioId ? { audio: `${input.audioId}.wav` } : {}) });
        return { ok: true, pedido: pedidoCelular(pedido, deps.taskState) };
      } catch (error) {
        console.error('[donel-dev] pedidos: não gravou:', error);
        return { ok: false, mensagem: 'O PC não conseguiu guardar o pedido. Tente de novo.' };
      }
    },
    transcrever: (wav) => deps.audio.start(wav),
    transcricao: (audioId) => deps.audio.status(audioId),
  };
}
