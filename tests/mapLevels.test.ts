import { describe, expect, it } from 'vitest';
import {
  buildFullTrilha,
  buildPlanCardTags,
  buildTrilha,
  canonicalLevelKeys,
  computeHomologationDeadline,
  formatDeadlineAbsolute,
  formatFaseCommand,
  moveLevelFocus,
  needsCarousel,
  nextLevelPreview,
  planCardToneColor,
  resolveCardDisplayTitle,
  resolvePlanCardTone,
  shouldPromoteClockToStatusBar,
} from '../src/shared/mapLevels';

// Lote 7 (009-modo-dev-v3) — lógica pura do carrossel de dois eixos
// (CA-9/CA-11/CA-13/CA-14) e da promoção do relógio de homologação (Decisão
// A do handoff v3). Nada aqui toca React/Electron/disco — é a mesma
// disciplina de `carouselGeometry.ts`/`homologationClock.ts` (design-system):
// testável sem montar componente nenhum.

describe('canonicalLevelKeys', () => {
  it('CA-14 — sempre discovery, mesmo sem card de plano nenhum', () => {
    expect(canonicalLevelKeys({ hasPlanCards: false, faseCount: 0 })).toEqual(['discovery']);
  });

  it('CA-10 — com cards de plano mas nenhuma fase declarada, só discovery+planos', () => {
    expect(canonicalLevelKeys({ hasPlanCards: true, faseCount: 0 })).toEqual(['discovery', 'planos']);
  });

  it('CA-11/CA-12 — com fases declaradas, implementação e validação entram JUNTAS, como níveis distintos', () => {
    expect(canonicalLevelKeys({ hasPlanCards: true, faseCount: 1 })).toEqual([
      'discovery',
      'planos',
      'implementacao',
      'validacao',
    ]);
    expect(canonicalLevelKeys({ hasPlanCards: true, faseCount: 2 })).toEqual([
      'discovery',
      'planos',
      'implementacao',
      'validacao',
    ]);
  });

  it('CA-14 — nível ausente não deixa buraco: nunca aparece implementacao/validacao sem planos', () => {
    // Caso defensivo (não deveria acontecer na prática — faseCount > 0 sem
    // plan cards é inconsistente — mas a função nunca fabrica um nível
    // órfão: sem card de plano focado, não há de onde as fases viriam).
    expect(canonicalLevelKeys({ hasPlanCards: false, faseCount: 2 })).toEqual(['discovery']);
  });
});

// FIX (rodada de feedback 30/07, item 4) — "abri um discovery e não tinha
// como avançar para a próxima etapa": discovery em foco SEM `plan_cards`
// ainda (discovery não rodou/não terminou, ou terminou mas não declarou
// planos) deixava o mapa mostrar SÓ o card de discovery, sem nenhum indício
// de que há um caminho adiante. `nextLevelPreview` decide a MENSAGEM do
// nível-preview fantasma que o mapa passa a desenhar (`DiscoveryMap.tsx`,
// geometria de nível fora de foco já existente — 124px/opacidade 0.22, sem
// token novo).
describe('nextLevelPreview', () => {
  it('já há card de plano: sem preview nenhum (o nível real já existe)', () => {
    expect(nextLevelPreview({ hasPlanCards: true, discoveryStatus: 'done' })).toBeNull();
  });

  it('sem plano ainda, discovery não iniciada/rodando/travada/falhou: hint aponta pra rodar o Discovery', () => {
    for (const discoveryStatus of ['not-started', 'running', 'stuck', 'failed'] as const) {
      expect(nextLevelPreview({ hasPlanCards: false, discoveryStatus })).toEqual({
        key: 'planos',
        label: 'PLANOS',
        hint: 'nascem do discovery — rode a etapa Discovery',
      });
    }
  });

  it('discovery já concluída mas sem plan_cards (dado incompleto) — degrada por omissão, sem fabricar motivo', () => {
    expect(nextLevelPreview({ hasPlanCards: false, discoveryStatus: 'done' })).toEqual({
      key: 'planos',
      label: 'PLANOS',
      hint: null,
    });
  });
});

// FIX (E2E 30/07, achado F1) — eixo vertical navega nos dois sentidos.
describe('moveLevelFocus', () => {
  const LEVELS = ['discovery', 'planos', 'implementacao', 'validacao'] as const;

  it('desce um nível (mesma direção que já funcionava)', () => {
    expect(moveLevelFocus(LEVELS, 'planos', 1)).toBe('implementacao');
  });

  it('sobe um nível — o eixo que estava travado só descendo (F1)', () => {
    expect(moveLevelFocus(LEVELS, 'planos', -1)).toBe('discovery');
    expect(moveLevelFocus(LEVELS, 'implementacao', -1)).toBe('planos');
  });

  it('clampa nas pontas, nunca dá a volta', () => {
    expect(moveLevelFocus(LEVELS, 'discovery', -1)).toBe('discovery');
    expect(moveLevelFocus(LEVELS, 'validacao', 1)).toBe('validacao');
  });

  it('nível atual fora da lista (ex.: card sem fase ainda) devolve ele mesmo, sem lançar', () => {
    expect(moveLevelFocus(['discovery', 'planos'], 'validacao', -1)).toBe('validacao');
  });
});

describe('needsCarousel', () => {
  it('CA-11 — 0 ou 1 card: sem ornamento de carrossel', () => {
    expect(needsCarousel(0)).toBe(false);
    expect(needsCarousel(1)).toBe(false);
  });

  it('CA-11 — mais de 1 card: carrossel nasce', () => {
    expect(needsCarousel(2)).toBe(true);
    expect(needsCarousel(5)).toBe(true);
  });
});

describe('buildTrilha', () => {
  it('CA-13 — todas concluídas: a trilha inteira aparece, sem "próxima"', () => {
    const steps = [
      { id: 'discovery', status: 'done' as const },
      { id: 'plano', status: 'done' as const },
    ];
    expect(buildTrilha(steps)).toEqual([
      { id: 'discovery', status: 'done', isNext: false },
      { id: 'plano', status: 'done', isNext: false },
    ]);
  });

  it('CA-13 — etapas já rodadas + a PRÓXIMA, nada além', () => {
    const steps = [
      { id: 'discovery', status: 'done' as const },
      { id: 'plano', status: 'done' as const },
      { id: 'impl-1', status: 'done' as const },
      { id: 'val-1', status: 'not-started' as const },
      { id: 'impl-2', status: 'not-started' as const },
    ];
    const trilha = buildTrilha(steps);
    expect(trilha.map((s) => s.id)).toEqual(['discovery', 'plano', 'impl-1', 'val-1']);
    expect(trilha.at(-1)).toEqual({ id: 'val-1', status: 'not-started', isNext: true });
  });

  it('CA-13 — running/failed/stuck contam como "já teve sessão" (aparecem por inteiro, não param a trilha)', () => {
    const steps = [
      { id: 'discovery', status: 'done' as const },
      { id: 'plano', status: 'failed' as const },
      { id: 'plano-retry', status: 'not-started' as const },
    ];
    const trilha = buildTrilha(steps);
    expect(trilha.map((s) => s.id)).toEqual(['discovery', 'plano', 'plano-retry']);
    expect(trilha.find((s) => s.id === 'plano')?.isNext).toBe(false);
  });

  it('lista vazia → trilha vazia, nunca lança', () => {
    expect(buildTrilha([])).toEqual([]);
  });
});

describe('buildFullTrilha (issue #35 — trilha sintética)', () => {
  it('nenhuma etapa realizada: TODAS aparecem, sem truncar na primeira not-started — só a 1ª ganha isNext', () => {
    const steps = [
      { id: 'discovery', status: 'not-started' as const },
      { id: 'plano', status: 'not-started' as const },
      { id: 'implementar', status: 'not-started' as const },
      { id: 'validar', status: 'not-started' as const },
    ];
    const trilha = buildFullTrilha(steps);
    expect(trilha.map((s) => s.id)).toEqual(['discovery', 'plano', 'implementar', 'validar']);
    expect(trilha.every((s) => s.realized === false)).toBe(true);
    expect(trilha.map((s) => s.isNext)).toEqual([true, false, false, false]);
  });

  it('card focado direto em Validar: anteriores não realizadas continuam na lista (revisitáveis), validar aparece realizado', () => {
    const steps = [
      { id: 'discovery', status: 'not-started' as const },
      { id: 'plano', status: 'not-started' as const },
      { id: 'implementar', status: 'not-started' as const },
      { id: 'validar', status: 'running' as const },
    ];
    const trilha = buildFullTrilha(steps);
    expect(trilha).toHaveLength(4);
    expect(trilha.map((s) => s.realized)).toEqual([false, false, false, true]);
    // A "próxima" continua sendo a 1ª não realizada, não a validar (já em curso).
    expect(trilha.find((s) => s.isNext)?.id).toBe('discovery');
  });

  it('etapas com manifesto real (done/failed/stuck) marcam realized=true, sem afetar as demais', () => {
    const steps = [
      { id: 'discovery', status: 'done' as const },
      { id: 'plano', status: 'failed' as const },
      { id: 'implementar', status: 'not-started' as const },
      { id: 'validar', status: 'not-started' as const },
    ];
    const trilha = buildFullTrilha(steps);
    expect(trilha.map((s) => s.realized)).toEqual([true, true, false, false]);
    expect(trilha.map((s) => s.isNext)).toEqual([false, false, true, false]);
  });

  it('lista vazia → trilha vazia, nunca lança', () => {
    expect(buildFullTrilha([])).toEqual([]);
  });
});

describe('shouldPromoteClockToStatusBar', () => {
  it('Decisão A — degrau urgente + card fora de foco: promove', () => {
    expect(shouldPromoteClockToStatusBar('urgente', false)).toBe(true);
  });

  it('Decisão A — degrau urgente + card EM foco: nunca duplica (não promove)', () => {
    expect(shouldPromoteClockToStatusBar('urgente', true)).toBe(false);
  });

  it('outros degraus nunca promovem, focado ou não', () => {
    expect(shouldPromoteClockToStatusBar('tranquilo', false)).toBe(false);
    expect(shouldPromoteClockToStatusBar('atencao', false)).toBe(false);
    expect(shouldPromoteClockToStatusBar('estourado', false)).toBe(false);
  });
});

describe('formatFaseCommand', () => {
  it('D-V4 — acrescenta --fase=n com "=", nunca espaço', () => {
    expect(formatFaseCommand('/esteira-validar PRJ-143', 2)).toBe('/esteira-validar PRJ-143 --fase=2');
  });

  it('comando sem faseNum não é tocado', () => {
    expect(formatFaseCommand('/esteira-plano PRJ-143', null)).toBe('/esteira-plano PRJ-143');
    expect(formatFaseCommand('/esteira-plano PRJ-143', undefined)).toBe('/esteira-plano PRJ-143');
  });
});

describe('formatDeadlineAbsolute', () => {
  const now = new Date('2026-07-29T12:00:00');

  it('mesmo dia → "hoje · HH:mm"', () => {
    const deadline = new Date('2026-07-29T21:00:00');
    expect(formatDeadlineAbsolute(deadline, now)).toBe('hoje · 21:00');
  });

  it('dia seguinte → "amanhã (DD/MM) · HH:mm"', () => {
    const deadline = new Date('2026-07-30T09:00:00');
    expect(formatDeadlineAbsolute(deadline, now)).toBe('amanhã (30/07) · 09:00');
  });

  it('mais de 1 dia adiante → "DD/MM · HH:mm"', () => {
    const deadline = new Date('2026-08-02T09:00:00');
    expect(formatDeadlineAbsolute(deadline, now)).toBe('02/08 · 09:00');
  });
});

describe('computeHomologationDeadline', () => {
  it('sem PR (null) → sem prazo', () => {
    expect(computeHomologationDeadline(null)).toBeNull();
  });

  it('PR mergeado, ainda não homologado nem revertido → deadline = mergedAt + 24h (a janela começa a contar no merge)', () => {
    const mergedAt = '2026-07-29T03:12:00.000Z';
    const deadline = computeHomologationDeadline({ mergedAt, homologado: false, revertidoCiclo: false });
    expect(deadline).toBe(Date.parse(mergedAt) + 24 * 60 * 60 * 1000);
  });

  it('PR ainda não mergeado (mergedAt null) → sem prazo', () => {
    expect(computeHomologationDeadline({ mergedAt: null, homologado: false, revertidoCiclo: false })).toBeNull();
  });

  it('já homologado → janela fechada, sem prazo (o fato vira "homologado", não mais um relógio correndo)', () => {
    expect(computeHomologationDeadline({ mergedAt: '2026-07-29T03:12:00.000Z', homologado: true, revertidoCiclo: false })).toBeNull();
  });

  it('já revertido no ciclo → janela encerrada, sem prazo', () => {
    expect(computeHomologationDeadline({ mergedAt: '2026-07-29T03:12:00.000Z', homologado: false, revertidoCiclo: true })).toBeNull();
  });

  it('mergedAt ilegível → sem prazo, nunca lança', () => {
    expect(computeHomologationDeadline({ mergedAt: 'não é uma data', homologado: false, revertidoCiclo: false })).toBeNull();
  });
});

describe('buildPlanCardTags', () => {
  it('sem boardFacts nenhum: nenhuma etiqueta (degradação por omissão, achado 12)', () => {
    expect(
      buildPlanCardTags({
        boardColumn: null,
        columnDivergence: null,
        lockedPhase: null,
        attentionLabels: [],
        homologationDeadlineLabel: null,
      }),
    ).toEqual([]);
  });

  it('Decisão B — coluna concorda com o disco: etiqueta muted', () => {
    const tags = buildPlanCardTags({
      boardColumn: 'Implementar',
      columnDivergence: null,
      lockedPhase: null,
      attentionLabels: [],
      homologationDeadlineLabel: null,
    });
    expect(tags).toEqual([{ text: 'board: Implementar', tone: 'muted' }]);
  });

  it('Decisão B — coluna diverge do disco: marcador error com os DOIS fatos', () => {
    const tags = buildPlanCardTags({
      boardColumn: 'Plano',
      columnDivergence: { diskStatus: 'done', boardColumn: 'Plano' },
      lockedPhase: null,
      attentionLabels: [],
      homologationDeadlineLabel: null,
    });
    expect(tags).toEqual([{ text: '⇄ disco: done · board: Plano', tone: 'error' }]);
  });

  it('Decisão B — as 4 etiquetas juntas, na ordem: coluna, trava, atenção, prazo', () => {
    const tags = buildPlanCardTags({
      boardColumn: 'Implementar',
      columnDivergence: null,
      lockedPhase: 'implementar',
      attentionLabels: ['esteira:escalado'],
      homologationDeadlineLabel: 'amanhã (30/07) · 09:00',
    });
    expect(tags).toEqual([
      { text: 'board: Implementar', tone: 'muted' },
      { text: 'trava: esteira:em-andamento:implementar', tone: 'lock' },
      { text: 'esteira:escalado', tone: 'warn' },
      { text: '◷ homologar até amanhã (30/07) · 09:00', tone: 'accent' },
    ]);
  });

  it('URL de PR / "PR sem aprovação" nunca aparecem (mortos na Decisão B) — só os 4 fatos', () => {
    const tags = buildPlanCardTags({
      boardColumn: 'Validar',
      columnDivergence: null,
      lockedPhase: null,
      attentionLabels: [],
      homologationDeadlineLabel: null,
    });
    for (const tag of tags) {
      expect(tag.text).not.toMatch(/http|PR /);
    }
  });
});

// Rodada de forma (fix/009-board-real-e-modal, item 7) — o border-top do
// card de plano precisa refletir o estado real, não ficar sempre verde.
describe('resolvePlanCardTone', () => {
  it('divergência vence tudo — vira error mesmo com trava/execução também presentes', () => {
    expect(resolvePlanCardTone({ hasDivergence: true, isLocked: true, statusLabel: 'em execução' })).toBe('error');
  });

  it('trava (board ou disco "travada") vira lock quando não há divergência', () => {
    expect(resolvePlanCardTone({ hasDivergence: false, isLocked: true, statusLabel: 'em plano' })).toBe('lock');
    expect(resolvePlanCardTone({ hasDivergence: false, isLocked: false, statusLabel: 'travada' })).toBe('lock');
  });

  it('em execução vira accent', () => {
    expect(resolvePlanCardTone({ hasDivergence: false, isLocked: false, statusLabel: 'em execução' })).toBe('accent');
  });

  it('aguardando homologação vira warn (o caso relatado — laranja, não verde)', () => {
    expect(resolvePlanCardTone({ hasDivergence: false, isLocked: false, statusLabel: 'aguardando homologação' })).toBe('warn');
  });

  it('homologado/concluído vira ok', () => {
    expect(resolvePlanCardTone({ hasDivergence: false, isLocked: false, statusLabel: 'homologado' })).toBe('ok');
    expect(resolvePlanCardTone({ hasDivergence: false, isLocked: false, statusLabel: 'concluído' })).toBe('ok');
  });

  it('em plano (neutro) vira muted', () => {
    expect(resolvePlanCardTone({ hasDivergence: false, isLocked: false, statusLabel: 'em plano' })).toBe('muted');
  });

  it('planCardToneColor usa só tokens já existentes em tokens.css — nenhum hex novo', () => {
    expect(planCardToneColor('ok')).toBe('var(--zone-ok)');
    expect(planCardToneColor('warn')).toBe('var(--state-waiting)');
    expect(planCardToneColor('error')).toBe('var(--state-permission)');
    expect(planCardToneColor('lock')).toBe('var(--state-error)');
    expect(planCardToneColor('accent')).toBe('var(--accent)');
    expect(planCardToneColor('muted')).toBe('var(--text-muted)');
  });
});

// #27a (rodada de polimento) — o card de plano mostrava id + título
// duplicados ("SZI-DEMO-A SZI-DEMO-A") sempre que o board não tinha título
// distinto (fallback antigo `title || cardId` repetia o id; título igual ao
// id, por coincidência, causava a mesma repetição).
describe('resolveCardDisplayTitle', () => {
  it('título ausente — nunca fabrica um segundo texto igual ao id', () => {
    expect(resolveCardDisplayTitle('SZI-DEMO-A', null)).toBeNull();
    expect(resolveCardDisplayTitle('SZI-DEMO-A', undefined)).toBeNull();
    expect(resolveCardDisplayTitle('SZI-DEMO-A', '')).toBeNull();
  });

  it('título igual ao id — mesma repetição, mesma correção: null', () => {
    expect(resolveCardDisplayTitle('SZI-DEMO-A', 'SZI-DEMO-A')).toBeNull();
  });

  it('título distinto do id — aparece por inteiro', () => {
    expect(resolveCardDisplayTitle('SZI-902', 'Conciliação de divergência')).toBe('Conciliação de divergência');
  });
});
