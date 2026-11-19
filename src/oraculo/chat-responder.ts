// Saída iii — the Líder único answers the owner's phone from a script of this machine (chat_lider.py, donel-celular),
// through the gate's loopback route `/local/celular/chat-responder`, with no Supabase. Pure: the route only parses and
// hands the input here.
//
// `em_resposta_a`: 8+ characters of the owner's line it answers, `"ultima"` (his newest line), or null/absent (a loose
// line of the Líder, the script's `puxar`). No id from the script: one made of what it answers and the text, so a retry
// after a timeout is the same line, never a second one.

import { createHash } from 'node:crypto';
import { isBlankReply } from '../shared/lider/blankReply';
import type { CelularLocalStore } from './celular-local';

export interface ChatResponderAnswer {
  readonly status: number;
  readonly body: Record<string, unknown>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function derivedId(seed: string): string {
  const h = createHash('sha256').update(seed, 'utf8').digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

export function chatResponder(store: CelularLocalStore, input: Record<string, unknown>): ChatResponderAnswer {
  const texto = typeof input.texto === 'string' ? input.texto.trim() : '';
  // Empty or a lone "-" (the script's stdin placeholder) is never a message to the owner (t-d461e003).
  if (isBlankReply(texto) || texto.length > 8000) return { status: 400, body: { erro: 'texto com 1 a 8000 caracteres (nem vazio, nem só "-")' } };
  const asked = input.em_resposta_a;
  let alvo: string | null = null;
  if (asked !== null && asked !== undefined) {
    if (typeof asked !== 'string') return { status: 400, body: { erro: 'em_resposta_a: 8+ caracteres do id, "ultima" ou null' } };
    const curto = asked.trim().toLowerCase();
    const donos = store.conversa(2000).filter((line) => line.autor === 'dono');
    if (curto === 'ultima') {
      const last = donos[donos.length - 1];
      if (!last) return { status: 404, body: { erro: 'o dono ainda não escreveu' } };
      alvo = last.id;
    } else {
      if (curto.length < 8) return { status: 400, body: { erro: 'em_resposta_a: 8+ caracteres do id, "ultima" ou null' } };
      const found = donos.filter((line) => line.id.startsWith(curto));
      if (found.length !== 1) return { status: 404, body: { erro: found.length ? 'id ambíguo' : 'mensagem não encontrada' } };
      alvo = found[0]!.id;
    }
  }
  const id = typeof input.id === 'string' && UUID.test(input.id) ? input.id : derivedId(`${alvo ?? 'solta'}\n${texto}`);
  store.liderDiz(id, alvo, texto);
  return { status: 200, body: { ok: true, id, em_resposta_a: alvo } };
}
