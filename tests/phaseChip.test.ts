import { describe, expect, it } from 'vitest';
import { ESTEIRA_PHASES, ESTEIRA_PHASE_LABEL_PT, isEsteiraPhase } from '@donel-dev/design-system';

// Achado da captura do batch n8 (tutorial-e2e, 05/08): o catálogo central
// (`PHASE_CATALOG` em esteiraView.ts) ganhou a fase `design` entre Plano e
// Implementar (E1), mas o `PhaseChip` do design-system — a fonte que decide
// quais fases desenham como chip colorido — nunca soube dela. A trilha do
// mapa (`DiscoveryMap.tsx`) e o painel de detalhe (`PhaseDetailsPanel.tsx`)
// cada um tinha sua PRÓPRIA cópia hardcoded de "quais fases têm chip", as
// duas esquecendo `design`: a tela mostrava "design" cru, minúsculo, sem cor —
// a MESMA degradação visual que uma fase desconhecida receberia — enquanto o
// catálogo de disparo já a tratava como cidadã de primeira classe.
//
// Este teste cobre a fonte única (`isEsteiraPhase`/`ESTEIRA_PHASES`, exportada
// pelo design-system) que os dois consumidores devem importar em vez de
// duplicar o Set local — é o padrão "o vocabulário mora numa função só" que o
// próprio DiscoveryMap.tsx já documentava para frases de estado.

describe('ESTEIRA_PHASES / isEsteiraPhase', () => {
  it('inclui `design`, a fase que entrou no catálogo entre plano e implementar (E1)', () => {
    expect(ESTEIRA_PHASES).toContain('design');
    expect(isEsteiraPhase('design')).toBe(true);
  });

  it('dá um rótulo em PT para `design`, como para as demais fases', () => {
    expect(ESTEIRA_PHASE_LABEL_PT.design).toBe('Design');
  });

  it('continua reconhecendo as fases que já tinham chip', () => {
    for (const phase of ['discovery', 'plano', 'implementar', 'validar', 'concluir', 'documentar']) {
      expect(isEsteiraPhase(phase)).toBe(true);
    }
  });

  it('recusa uma fase livre que não é do catálogo — `run.phase` continua string', () => {
    expect(isEsteiraPhase('etapa-inventada-pelo-usuario')).toBe(false);
  });
});
