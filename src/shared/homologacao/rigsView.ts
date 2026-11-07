// Mindscape de homologação — what each chair of the factory's rigs shows: kind, health, who sits and its line.
// Agent chairs take their live state from the Donel (the board's places with the chair's role, as the Cadeiras lens
// reads them); code and queue chairs take it from the file, and turn "sem sinal" when the file stops.
// Pure: no React, no Electron. Nothing here writes anything.

import { CHAIR_HEALTHS, NO_ROLE_CHAIR, type Chair, type ChairHealth } from '../mindscape/chairs';
import type { SessionAxes } from '../mindscape/sessionAxes';
import { RIGS_STALE_MS, type RigChairKind, type RigsShape } from './rigs';

/** Prefix of the chairs of roles the file does not draw ("fora do desenho"). */
export const OUTSIDE_DRAWING_PREFIX = '\u0000fora:';

export interface RigChairView {
  readonly id: string;
  readonly nome: string;
  readonly tipo: RigChairKind;
  /** Agent chairs only: the Donel role whose places sit here. */
  readonly papel?: string;
  readonly health: ChairHealth;
  /** Places whose session is open now (agent chairs). */
  readonly seated: readonly string[];
  /** The line under the node ("39 itens segurando o selo", "1 precisa de você · permissão"). */
  readonly line?: string;
  /** A role of the board that no chair of the file holds: it shows up anyway, so nothing that runs disappears. */
  readonly outsideDrawing?: boolean;
}

export interface RigsView {
  readonly chairs: readonly RigChairView[];
  readonly counts: Readonly<Record<ChairHealth, number>>;
  /** The ids of the "fora do desenho" chairs, in the board's order. */
  readonly outsideDrawing: readonly string[];
}

export interface RigsLiveInput {
  /** The board's chairs, one per role (`deriveChairs`). */
  readonly roleChairs: readonly Chair[];
  readonly axesOf: (placeId: string) => SessionAxes | undefined;
  readonly roleName: (roleId: string) => string;
  readonly now: number;
}

export function countHealths(chairs: readonly { readonly health: ChairHealth }[]): Record<ChairHealth, number> {
  const counts = Object.fromEntries(CHAIR_HEALTHS.map((health) => [health, 0])) as Record<ChairHealth, number>;
  for (const chair of chairs) counts[chair.health] += 1;
  return counts;
}

/** What the seated places are doing now, in one short line. */
function agentLine(seated: readonly string[], axesOf: (placeId: string) => SessionAxes | undefined): string | undefined {
  if (seated.length === 0) return undefined;
  const axes = seated.flatMap((placeId) => axesOf(placeId) ?? []);
  const needing = axes.filter((entry) => entry.needs.length > 0);
  if (needing.length > 0) return `${needing.length} precisa${needing.length > 1 ? 'm' : ''} de você · ${[...new Set(needing.flatMap((entry) => entry.needs))].join(', ')}`;
  const working = axes.filter((entry) => entry.activity === 'trabalhando').length;
  return working > 0 ? `${working} trabalhando` : 'parada, esperando trabalho';
}

/** The chairs as the file draws them, with the live state of the Donel's places and the freshness of the file. */
export function deriveRigsView(shape: RigsShape, live?: RigsLiveInput): RigsView {
  const stale = live ? live.now - shape.geradoEmMs > RIGS_STALE_MS : false;
  const byRole = new Map((live?.roleChairs ?? []).flatMap((chair) => (chair.roleId ? [[chair.roleId, chair] as const] : [])));
  const drawnRoles = new Set(shape.cadeiras.flatMap((chair) => (chair.tipo === 'agente' && chair.papel ? [chair.papel] : [])));

  const chairs: RigChairView[] = shape.cadeiras.map((chair) => {
    if (chair.tipo === 'agente') {
      const roleChair = chair.papel ? byRole.get(chair.papel) : undefined;
      const seated = roleChair?.seated ?? [];
      const line = live ? agentLine(seated, live.axesOf) : undefined;
      return {
        id: chair.id,
        nome: chair.nome,
        tipo: chair.tipo,
        ...(chair.papel ? { papel: chair.papel } : {}),
        health: roleChair?.health ?? 'sem-sinal',
        seated,
        ...(line ? { line } : {}),
      };
    }
    return {
      id: chair.id,
      nome: chair.nome,
      tipo: chair.tipo,
      // The file stopped: what it says may be old, so the chair has no signal (the line stays, as the last word).
      health: stale ? 'sem-sinal' : (chair.estado?.saude ?? 'sem-sinal'),
      seated: [],
      ...(chair.estado?.linha ? { line: chair.estado.linha } : {}),
    };
  });

  const outside: string[] = [];
  for (const roleChair of live?.roleChairs ?? []) {
    // The places with no role are their own chair too: no file draws them, and they must not vanish.
    if (roleChair.roleId && drawnRoles.has(roleChair.roleId)) continue;
    const id = `${OUTSIDE_DRAWING_PREFIX}${roleChair.roleId ?? NO_ROLE_CHAIR}`;
    outside.push(id);
    chairs.push({
      id,
      nome: roleChair.roleId ? live!.roleName(roleChair.roleId) : 'Sem papel',
      tipo: 'agente',
      ...(roleChair.roleId ? { papel: roleChair.roleId } : {}),
      health: roleChair.health,
      seated: roleChair.seated,
      line: agentLine(roleChair.seated, live!.axesOf) ?? 'fora do desenho',
      outsideDrawing: true,
    });
  }
  return { chairs, counts: countHealths(chairs), outsideDrawing: outside };
}
