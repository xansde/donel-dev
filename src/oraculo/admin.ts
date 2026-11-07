// Oráculo na VPS — the routes only the PC calls besides the ledger (same token): the phone's server that lives here
// (Preferences → Celular on the PC forward to these) and the relay of what only the PC can deliver.

import type { LedgerDeliveredTo } from '../shared/ledger/contract';
import type { CelularCore } from '../main/celular/service';
import type { OracleRequest, OracleResponse } from './api';
import type { Relay } from './relay';
import type { BoardPicture } from './portao';

const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } as const;
const json = (status: number, value: unknown): OracleResponse => ({ status, headers: JSON_HEADERS, body: JSON.stringify(value) });

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function bodyOf(request: OracleRequest): Record<string, unknown> {
  try {
    const value = JSON.parse(request.body) as unknown;
    return isRecord(value) ? value : {};
  } catch {
    return {};
  }
}

function deliveredToOf(value: unknown): LedgerDeliveredTo {
  if (value === 'lider') return 'lider';
  return isRecord(value) && typeof value.placeId === 'string' ? { placeId: value.placeId } : null;
}

export type OracleExtraRoutes = (request: OracleRequest, path: string) => Promise<OracleResponse | null>;

export function createOracleAdminRoutes(deps: { readonly celular: CelularCore; readonly relay: Relay; readonly setPicture?: (picture: BoardPicture) => void }): OracleExtraRoutes {
  const { celular, relay } = deps;
  return async (request, path) => {
    const { method } = request;
    if (method === 'GET' && path === '/v1/celular') {
      await celular.reconcile();
      return json(200, celular.state());
    }
    if (method === 'POST' && path === '/v1/celular/ligar') return json(200, await celular.setEnabled(bodyOf(request).enabled === true));
    if (method === 'POST' && path === '/v1/celular/parear') return json(200, await celular.pair());
    if (method === 'POST' && path === '/v1/celular/revogar') {
      const id = bodyOf(request).deviceId;
      return json(200, typeof id === 'string' ? celular.revoke(id) : celular.state());
    }
    if (method === 'POST' && path === '/v1/celular/pedido-tarefa') {
      const body = bodyOf(request);
      const tarefa = body.tarefa;
      if (typeof body.pedidoId !== 'string' || !isRecord(tarefa) || typeof tarefa.id !== 'string' || typeof tarefa.titulo !== 'string') return json(400, { error: 'pedido inválido' });
      return json(200, { ok: celular.linkPedido(body.pedidoId, { id: tarefa.id, titulo: tarefa.titulo }) });
    }
    // Fatia 4: the PC's picture of the VPS's sessions on its board (who each is, its board), for the MCP gate.
    if (method === 'POST' && path === '/v1/retrato') {
      const body = bodyOf(request);
      if (typeof body.at !== 'number' || !isRecord(body.sessoes) || !deps.setPicture) return json(400, { error: 'retrato inválido' });
      const sessoes: BoardPicture['sessoes'] = Object.fromEntries(
        Object.entries(body.sessoes).filter((entry): entry is [string, BoardPicture['sessoes'][string]] => {
          const value = entry[1];
          return isRecord(value) && isRecord(value.quemSou) && Array.isArray(value.listar);
        }),
      );
      deps.setPicture({ at: body.at, sessoes });
      return json(200, { ok: true, sessoes: Object.keys(sessoes).length });
    }
    if (method === 'GET' && path === '/v1/fila') return json(200, { itens: relay.pending().map((item) => ({ id: item.id, message: item.message })) });
    if (method === 'POST' && path === '/v1/fila/ack') {
      const body = bodyOf(request);
      if (typeof body.id !== 'string') return json(400, { error: 'id' });
      return json(200, { ok: relay.ack(body.id, deliveredToOf(body.deliveredTo)) });
    }
    return null;
  };
}
