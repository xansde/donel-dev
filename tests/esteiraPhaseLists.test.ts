import { describe, expect, it } from 'vitest';
import { ESTEIRA_PHASES, ESTEIRA_PHASE_LABEL_PT, isEsteiraPhase } from '@donel-dev/design-system';
import { catalogPhasesFor } from '../src/renderer/src/Esteira/esteiraView';
import { sanitizePhaseDefaultsTable } from '../src/main/config-store';
import { DEFAULT_PHASE_DEFAULTS } from '../src/shared/devModeDefaults';

// Achado da captura do batch n8 (tutorial-e2e, 05/08): o catálogo central
// (`PHASE_CATALOG` em esteiraView.ts) ganhou a fase `design` entre Plano e
// Implementar (E1), mas o `PhaseChip` do design-system — a fonte que decide
// quais fases desenham como chip colorido — nunca soube dela. A tela mostrava
// "design" cru, sem cor, enquanto o catálogo de disparo já a tratava como
// cidadã de primeira classe.
//
// Há TRÊS listas de fases, cada uma com uma pergunta diferente:
// - o catálogo de disparo (`PHASE_CATALOG`, via `catalogPhasesFor`): o que a
//   tela OFERECE para rodar;
// - `ESTEIRA_PHASES` (design-system): quais fases desenham como chip;
// - `KNOWN_ESTEIRA_PHASES` (main/config-store, privada): quais fases a tabela de
//   defaults do Modo Dev exige. Observada pelo comportamento de
//   `sanitizePhaseDefaultsTable`, que cai no default inteiro se faltar uma delas.
//
// Elas NÃO são iguais, e as diferenças são decisão — este teste as nomeia. Se
// uma lista mudar sozinha, ele quebra e obriga a decidir sobre as outras.

const CATALOG_RUNS_ON = ['discovery', 'plan', 'work_item'] as const;

function catalogPhases(): string[] {
  return CATALOG_RUNS_ON.flatMap((runsOn) => catalogPhasesFor(runsOn).map((choice) => choice.phase));
}

/** Fases que a tabela de defaults exige, descobertas pelo efeito de tirá-las. */
function requiredDefaultPhases(): string[] {
  const candidates = new Set<string>([...ESTEIRA_PHASES, ...Object.keys(DEFAULT_PHASE_DEFAULTS)]);
  return [...candidates].filter((phase) => {
    const withoutPhase = { ...DEFAULT_PHASE_DEFAULTS, [phase]: undefined };
    return sanitizePhaseDefaultsTable(withoutPhase) === DEFAULT_PHASE_DEFAULTS;
  });
}

describe('as listas de fases concordam', () => {
  it('chip = catálogo de disparo + `documentar` (que vive dentro da Concluir, D-10, e só tem chip)', () => {
    expect([...ESTEIRA_PHASES].sort()).toEqual([...catalogPhases(), 'documentar'].sort());
  });

  it('defaults do Modo Dev = chip - `design` (sem default próprio) + `cliente` (sem chip)', () => {
    const expected: string[] = [...ESTEIRA_PHASES].filter((phase) => phase !== 'design');
    expected.push('cliente');
    expect(requiredDefaultPhases().sort()).toEqual(expected.sort());
  });

  it('toda fase do catálogo de disparo tem chip', () => {
    for (const phase of catalogPhases()) expect(isEsteiraPhase(phase)).toBe(true);
  });

  it('toda fase do chip tem rótulo em PT', () => {
    for (const phase of ESTEIRA_PHASES) expect(ESTEIRA_PHASE_LABEL_PT[phase]).toBeTruthy();
  });
});

describe('ESTEIRA_PHASES / isEsteiraPhase', () => {
  it('dá um rótulo em PT para `design`, como para as demais fases', () => {
    expect(ESTEIRA_PHASE_LABEL_PT.design).toBe('Design');
  });

  it('recusa uma fase livre que não é do catálogo — `run.phase` continua string', () => {
    expect(isEsteiraPhase('etapa-inventada-pelo-usuario')).toBe(false);
  });
});
