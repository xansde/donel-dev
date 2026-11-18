// Canal do Donel fora do PC (t-e195b35c, item 13) — whom the "para" of a `sessao_enviar` means, from the saved board
// and the list of places (what the VPS gate has). Pure. The reach rules stay in reach.ts; this only names the target:
//
// - a place id of the board; a closed one whose successor (`successorOf`: same role, same opener, the only live one)
//   is known means that successor, said in `renovadoDe` (the old ids of renewed places, item 13);
// - "lider-quadro" (`BOARD_LEADER`): the Líder of the caller's board (`boardLeaders`), a live one first;
// - "quem-me-abriu" (`MY_OPENER`): the place that opened the caller (`openersOf`, then `abertaPor` of the list);
// - "lider" (`LEADER_OF_ALL`): the Líder único, which has no place;
// - a role id ("revisor", or a board's own role such as "dalton"): the ONE live place with that role on the board.
//   Several live = an error listing them (never a guess); none = an error. No name is fixed here.

import { LEADER_OF_ALL } from './leader';
import type { MindscapeBoard } from './model';
import { BOARD_LEADER, boardLeaders, isBoardLeader, isLiveListedPlace, listedRoleOf, MY_OPENER, openersOf, successorOf, type ListedPlace } from './reach';

export type AddressResult = { readonly placeId: string; readonly renovadoDe?: string } | { readonly liderUnico: true } | { readonly erro: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The places of a `sessao_listar` answer (what the PC pictured), keeping only what the address needs. */
export function listedPlaces(listar: readonly unknown[]): ListedPlace[] {
  return listar.flatMap((place) => {
    if (!isRecord(place) || typeof place.id !== 'string') return [];
    return [
      {
        id: place.id,
        ...(typeof place.papel === 'string' ? { papel: place.papel } : {}),
        ...(typeof place.estado === 'string' ? { estado: place.estado } : {}),
        ...(typeof place.abertaPor === 'string' ? { abertaPor: place.abertaPor } : {}),
      },
    ];
  });
}

export function resolveAddress(board: MindscapeBoard | undefined, places: readonly ListedPlace[], fromPlaceId: string, para: string): AddressResult {
  const raw = para.trim();
  const word = raw.toLowerCase();
  const live = (id: string): boolean => isLiveListedPlace(places.find((place) => place.id === id));

  if (word === LEADER_OF_ALL) return { liderUnico: true };
  if (word === BOARD_LEADER) {
    const leaders = boardLeaders(board).filter((id) => id !== fromPlaceId);
    if (leaders.length === 0 && isBoardLeader(board, fromPlaceId)) return { erro: `Não mandei: você é o Líder deste quadro, e "${BOARD_LEADER}" é você mesmo. Para falar com o Líder único, "para": "${LEADER_OF_ALL}".` };
    if (leaders.length === 0) return { erro: 'Este quadro não tem Líder. Fale com quem está acima de você pelas setas (ou "lider", se o Líder único abriu você).' };
    return { placeId: leaders.find(live) ?? leaders[0]! };
  }
  if (word === MY_OPENER) {
    const opener = openersOf(board, fromPlaceId)[0] ?? places.find((place) => place.id === fromPlaceId)?.abertaPor;
    if (opener === LEADER_OF_ALL) return { liderUnico: true };
    if (!opener) return { erro: `Ninguém abriu você por sessao_abrir (foi o dono). Fale com o Líder do quadro ("para": "${BOARD_LEADER}") ou com quem está acima de você pelas setas.` };
    return { placeId: opener };
  }
  const isPlace = board?.cards[raw]?.kind === 'session' || places.some((place) => place.id === raw);
  if (isPlace) {
    if (raw === fromPlaceId) return { erro: 'Não mandei: este é o seu próprio lugar.' };
    const successor = places.find((place) => place.id === raw)?.estado === 'fechada' ? successorOf(board, places, raw) : undefined;
    return successor && successor !== fromPlaceId ? { placeId: successor, renovadoDe: raw } : { placeId: raw };
  }

  // A role id: the one live place with it (never the caller itself).
  const ids = new Set([...places.map((place) => place.id), ...Object.keys(board?.cards ?? {})]);
  const withRole = [...ids].filter((id) => id !== fromPlaceId && listedRoleOf(board, places, id)?.toLowerCase() === word);
  const liveWithRole = withRole.filter(live);
  if (liveWithRole.length === 1) return { placeId: liveWithRole[0]! };
  if (liveWithRole.length > 1) return { erro: `"${raw}" é o papel de mais de um lugar vivo (${liveWithRole.join(', ')}); diga o id do lugar em "para".` };
  if (withRole.length > 0) return { erro: `Nenhum lugar vivo com o papel "${raw}" agora (${withRole.join(', ')} fechado ou sem começar). Registre no Oráculo e siga.` };
  return { erro: `"${raw}" não é um lugar do quadro nem o papel de um lugar vivo (veja sessao_listar).` };
}
