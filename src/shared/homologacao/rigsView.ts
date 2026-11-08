// Mindscape de homologação — what each chair of the factory's rigs shows: kind, health, who sits and its line.
// Pure: no React, no Electron. Nothing here writes anything.

import { CHAIR_HEALTHS, type ChairHealth } from '../mindscape/chairs';
import type { RigChairKind, RigsShape } from './rigs';

export interface RigChairView {
  readonly id: string;
  readonly nome: string;
  readonly tipo: RigChairKind;
  /** Agent chairs only: the Donel role whose places sit here. */
  readonly papel?: string;
  readonly health: ChairHealth;
  /** Places whose session is open now (agent chairs). */
  readonly seated: readonly string[];
  /** The line under the node ("39 itens segurando o selo"). */
  readonly line?: string;
}

export interface RigsView {
  readonly chairs: readonly RigChairView[];
  readonly counts: Readonly<Record<ChairHealth, number>>;
}

export function countHealths(chairs: readonly { readonly health: ChairHealth }[]): Record<ChairHealth, number> {
  const counts = Object.fromEntries(CHAIR_HEALTHS.map((health) => [health, 0])) as Record<ChairHealth, number>;
  for (const chair of chairs) counts[chair.health] += 1;
  return counts;
}

/** The chairs as the file draws them: code and queue carry the factory's state, agents have no signal yet. */
export function deriveRigsView(shape: RigsShape): RigsView {
  const chairs: RigChairView[] = shape.cadeiras.map((chair) => {
    if (chair.tipo === 'agente') return { id: chair.id, nome: chair.nome, tipo: chair.tipo, ...(chair.papel ? { papel: chair.papel } : {}), health: 'sem-sinal', seated: [] };
    return {
      id: chair.id,
      nome: chair.nome,
      tipo: chair.tipo,
      health: chair.estado?.saude ?? 'sem-sinal',
      seated: [],
      ...(chair.estado?.linha ? { line: chair.estado.linha } : {}),
    };
  });
  return { chairs, counts: countHealths(chairs) };
}
