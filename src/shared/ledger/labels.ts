// Cartas forma A — how a place is named to the owner: by its name on the board, never by its id
// ("Dev · painel do Jobu"; without a name, the role: "Dev"). Shared by the phone and the desktop cards.

import { naipeDoTipo, type Naipe } from '../celular';
import type { LedgerActor } from './contract';

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
