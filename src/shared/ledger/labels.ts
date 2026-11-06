// Cartas forma A — how a place is named to the owner: by its name on the board, never by its id
// ("Dev · painel do Jobu"; without a name, the role: "Dev"). Shared by the phone and the desktop cards.

import { naipeDoTipo, type Naipe } from '../celular';
import { lastDelivery, type LedgerActor, type LedgerDeliveredTo, type LedgerTask } from './contract';
import type { LedgerCommentResult } from './channels';

const ROLE_LABELS: Readonly<Record<string, string>> = {
  dev: 'Dev',
  revisor: 'Revisor',
  pesquisa: 'Pesquisa',
  lider: 'Líder',
};

export function roleLabel(roleId: string | undefined): string {
  const role = roleId ?? '';
  return ROLE_LABELS[role] ?? ROLE_LABELS[role.split('-')[0] ?? ''] ?? (role || 'um lugar');
}

/** The name of a place on its board (its session's name), when known. */
export type PlaceNameOf = (projectPath: string, placeId: string) => string | undefined;

/** "você", "Dev · painel do Jobu" or "Dev". */
export function actorLabel(actor: LedgerActor | undefined, projectPath: string, placeName: PlaceNameOf | undefined): string {
  if (!actor) return 'alguém';
  if (actor.kind === 'dono') return 'você';
  const role = roleLabel(actor.roleId);
  const name = placeName?.(projectPath, actor.placeId)?.trim();
  return name ? `${role} · ${name}` : role;
}

/** O contrato ainda não tem tipo de trabalho: o naipe da carta sai do papel de quem entregou. */
export function naipeDoPapel(roleId: string | undefined): Naipe {
  const role = (roleId ?? '').split('-')[0];
  if (role === 'pesquisa') return naipeDoTipo('pesquisa');
  if (role === 'revisor') return naipeDoTipo('revisao');
  if (role === 'lider') return naipeDoTipo('decisao');
  if (role === 'seguranca') return naipeDoTipo('seguranca');
  if (role === 'correcao' || role === 'fix') return naipeDoTipo('correcao');
  return naipeDoTipo('construcao');
}

/** The receipt of what the owner wrote on a card, by where it went (`deliveredTo`). */
export function reciboDe(deliveredTo: LedgerDeliveredTo | undefined, quem: string, at: number): string {
  const hora = new Date(at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  if (deliveredTo === 'lider') return `A sessão de ${quem} estava fechada: foi ao Líder, às ${hora}.`;
  if (deliveredTo) return `Enviado a ${quem}, às ${hora}.`;
  return `Não chegou a ninguém: a sessão de ${quem} e o Líder estão fechados; fica guardado na carta até um deles abrir.`;
}

/** What the owner wrote on the card since its last delivery, on the FRONT of the card, with where each one went. */
export function notasDaFrente(task: LedgerTask, quem: string): { readonly text: string; readonly receipt: string; readonly delivered: boolean }[] {
  const since = lastDelivery(task)?.at ?? 0;
  return task.events.flatMap((event) =>
    event.kind === 'comentada' && event.by.kind === 'dono' && event.text && event.at >= since
      ? [{ text: event.text, receipt: reciboDe(event.deliveredTo, quem, event.at), delivered: Boolean(event.deliveredTo) }]
      : [],
  );
}

/**
 * One "Mandar à sessão" from the card, never silent (t-8fed1d77): a call that throws, rejects, answers nothing or
 * does not answer within `deadlineMs` comes back as a reason the card shows, with the text kept.
 */
export async function mandarDaCarta(
  call: () => Promise<LedgerCommentResult>,
  deadlineMs: number,
): Promise<{ readonly ok: true } | { readonly ok: false; readonly reason: string }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<'prazo'>((resolve) => {
    timer = setTimeout(() => resolve('prazo'), deadlineMs);
  });
  try {
    const result = await Promise.race([Promise.resolve().then(call), late]);
    if (result === 'prazo') return { ok: false, reason: `o app não confirmou em ${Math.round(deadlineMs / 1000)} s. O texto continua aqui; mandar de novo não duplica.` };
    if (!result || typeof result !== 'object') return { ok: false, reason: 'o app não respondeu. O texto continua aqui.' };
    return result.ok ? { ok: true } : { ok: false, reason: result.reason };
  } catch (error) {
    return { ok: false, reason: `o app recusou (${error instanceof Error ? error.message : String(error)}). O texto continua aqui.` };
  } finally {
    clearTimeout(timer);
  }
}
