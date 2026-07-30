import { describe, expect, it } from 'vitest';
import type { DevModeDiscoveries } from '../src/shared/devMode';
import type { DiscoveryTree, PhaseNode, PlanCardNode } from '../src/main/discovery-tree';
import type { PhaseStatus } from '../src/shared/phaseState';
import {
  discoveriesToClose,
  isCardLinked,
  localOnlyDiscoveryIds,
  resolveEntrySelection,
} from '../src/renderer/src/DevMode/devModeSelection';

// T311/T321 (003-modo-dev, Batch B) — decisões PURAS da Zona 1 (CA-2) e do
// encerramento automático (CA-23). Sem React, sem IPC: só o cruzamento entre
// os cards do board, os discoveries abertos (estado próprio, CA-21) e as
// árvores lidas do disco (CA-14/CA-17 — o mapa card→card-de-plano vem de
// `plan_cards[]`).

function phaseNode(status: PhaseStatus): PhaseNode {
  return {
    phase: 'concluir',
    status,
    artifacts: {
      ctxPath: '',
      resultPath: '',
      ctxExists: false,
      result: null,
      resultUnreadable: false,
      worktreePath: null,
      branch: null,
    },
    archivedSession: null,
  };
}

function planCard(cardId: string, concluirStatus: PhaseStatus): PlanCardNode {
  const node = phaseNode(concluirStatus);
  return {
    cardId,
    track: 'codigo',
    shadow: false,
    phases: {
      discovery: node,
      plano: node,
      implementar: node,
      validar: node,
      documentar: node,
      cliente: node,
      concluir: node,
    },
    fases: [],
  };
}

function tree(discoveryCardId: string, planCards: PlanCardNode[], allPlanCardsComplete: boolean): DiscoveryTree {
  return { discoveryCardId, planCards, focusedPlanCardId: null, allPlanCardsComplete, discoveryStatus: 'done' };
}

const DISCOVERIES: DevModeDiscoveries = {
  'SZI-100': { cardId: 'SZI-100', repoPath: 'C:/repo', epicId: null, openedAt: 1, closedAt: null },
};

const TREES: readonly DiscoveryTree[] = [
  tree('SZI-100', [planCard('SZI-101', 'done'), planCard('SZI-102', 'stuck')], false),
];

describe('resolveEntrySelection (CA-2)', () => {
  it('card que já tem discovery aberto traz aquele discovery ao foco, nunca cria outro', () => {
    expect(resolveEntrySelection({ cardId: 'SZI-100', discoveries: DISCOVERIES, trees: TREES })).toEqual({
      kind: 'focus',
      discoveryCardId: 'SZI-100',
    });
  });

  it('card de Plano resolve o discovery PAI (card de entrada), não um discovery novo', () => {
    expect(resolveEntrySelection({ cardId: 'SZI-102', discoveries: DISCOVERIES, trees: TREES })).toEqual({
      kind: 'focus',
      discoveryCardId: 'SZI-100',
    });
  });

  it('card sem vínculo nenhum vira criação de discovery novo', () => {
    expect(resolveEntrySelection({ cardId: 'SZI-777', discoveries: DISCOVERIES, trees: TREES })).toEqual({
      kind: 'create',
      cardId: 'SZI-777',
    });
  });

  it('discovery já encerrado (CA-23) não sequestra o card — o clique volta a ser criação', () => {
    const closed: DevModeDiscoveries = {
      'SZI-100': { cardId: 'SZI-100', repoPath: 'C:/repo', epicId: null, openedAt: 1, closedAt: 2 },
    };
    expect(resolveEntrySelection({ cardId: 'SZI-100', discoveries: closed, trees: [] })).toEqual({
      kind: 'create',
      cardId: 'SZI-100',
    });
  });
});

describe('isCardLinked (CA-2 — o card vinculado aparece marcado)', () => {
  it('marca o card de entrada de um discovery aberto', () => {
    expect(isCardLinked('SZI-100', DISCOVERIES, TREES)).toBe(true);
  });

  it('marca também o card de plano que pertence a um discovery aberto', () => {
    expect(isCardLinked('SZI-101', DISCOVERIES, TREES)).toBe(true);
  });

  it('não marca card sem vínculo', () => {
    expect(isCardLinked('SZI-777', DISCOVERIES, TREES)).toBe(false);
  });
});

// FIX (E2E 30/07, achado F8) — o modal "Abrir ou trocar discovery" só
// listava cards do board; um discovery aberto no disco/estado próprio que o
// board não trouxe (mock local, ou qualquer card fora da consulta) não tinha
// porta de volta.
describe('localOnlyDiscoveryIds (F8)', () => {
  it('discovery aberto que NÃO está nos cards do board entra na lista', () => {
    expect(localOnlyDiscoveryIds([], DISCOVERIES)).toEqual(['SZI-100']);
  });

  it('discovery aberto que JÁ está nos cards do board não duplica', () => {
    expect(localOnlyDiscoveryIds([{ cardId: 'SZI-100' }], DISCOVERIES)).toEqual([]);
  });

  it('discovery encerrado (CA-23) nunca entra — não é mais "aberto"', () => {
    const closed: DevModeDiscoveries = {
      'SZI-100': { cardId: 'SZI-100', repoPath: 'C:/repo', epicId: null, openedAt: 1, closedAt: 2 },
    };
    expect(localOnlyDiscoveryIds([], closed)).toEqual([]);
  });

  it('sem discoveries abertos nenhum → lista vazia', () => {
    expect(localOnlyDiscoveryIds([{ cardId: 'SZI-999' }], {})).toEqual([]);
  });
});

describe('discoveriesToClose (CA-23)', () => {
  it('devolve o discovery cujos cards de plano TODOS concluíram', () => {
    const complete = [tree('SZI-100', [planCard('SZI-101', 'done')], true)];
    expect(discoveriesToClose(complete, DISCOVERIES)).toEqual(['SZI-100']);
  });

  it('um card de plano pendente mantém o discovery aberto', () => {
    expect(discoveriesToClose(TREES, DISCOVERIES)).toEqual([]);
  });

  it('discovery já encerrado não é reencerrado (nenhum IPC repetido)', () => {
    const closed: DevModeDiscoveries = {
      'SZI-100': { cardId: 'SZI-100', repoPath: 'C:/repo', epicId: null, openedAt: 1, closedAt: 2 },
    };
    const complete = [tree('SZI-100', [planCard('SZI-101', 'done')], true)];
    expect(discoveriesToClose(complete, closed)).toEqual([]);
  });

  it('árvore sem card de plano nenhum nunca encerra (allPlanCardsComplete falso por construção)', () => {
    expect(discoveriesToClose([tree('SZI-100', [], false)], DISCOVERIES)).toEqual([]);
  });
});
