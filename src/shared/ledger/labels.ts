// Cartas forma A — how a place is named to the owner: by its name on the board, never by its id
// ("Dev · painel do Jobu"; without a name, the role: "Dev"). Shared by the phone and the desktop cards.

import { naipeDoTipo, type Naipe } from '../celular';
import type { LedgerActor, LedgerDeliveredTo, SlackLetter } from './contract';

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
  return 'Ninguém aberto para ler agora; fica guardado na carta.';
}

/** Where a Slack letter goes, in the owner's words (no "DM", no "thread"): the card's first line. */
export interface SlackRecipient {
  /** The person or the channel, as the session named it. */
  readonly name: string;
  readonly kind: 'pessoa' | 'canal' | 'grupo';
  /** "Conversa particular", "Canal", "Conversa em grupo". */
  readonly kindLabel: string;
  /** An answer inside a conversation that already exists (a thread), or a new message. */
  readonly inConversation: boolean;
  readonly conversationLabel: string;
}

export function slackRecipient(slack: SlackLetter): SlackRecipient {
  const raw = slack.destinationLabel?.trim() || slack.destination;
  const id = slack.destination.trim();
  const kind = /^[DUW][A-Z0-9]{6,}$/.test(id) || /\(DM\)\s*$/i.test(raw) ? 'pessoa' : /^G[A-Z0-9]{6,}$/.test(id) ? 'grupo' : 'canal';
  const name = raw.replace(/\s*\(DM\)\s*$/i, '').trim() || raw;
  const inConversation = Boolean(slack.thread);
  return {
    name,
    kind,
    kindLabel: kind === 'pessoa' ? 'Conversa particular' : kind === 'grupo' ? 'Conversa em grupo' : 'Canal',
    inConversation,
    conversationLabel: inConversation ? 'Resposta dentro de uma conversa que já existe' : 'Mensagem nova',
  };
}
