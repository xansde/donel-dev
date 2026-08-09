import { describe, expect, it } from 'vitest';
import { catalogPhasesFor } from '../src/renderer/src/Esteira/esteiraView';

// Spec 012 — `specs/012-esteira-4/catalogo.md`, secao 3 e secao 9.
//
// O catalogo das seis fases e CONTEUDO: ele vive numa spec, e a tela so
// OFERECE o que ele nomeia. Um catalogo que so existe em prosa volta a
// divergir do codigo na primeira semana — foi assim que a Documentar
// sobreviveu como linha de menu depois de dissolvida na Concluir.
//
// Este teste pina a regra "a oferta da tela espelha o catalogo": as seis
// fases, na ordem do grafo canonico, cada uma no seu assunto, e a
// Documentar AUSENTE como linha independente (D-10 — ela e um segundo
// `phase.completed` dentro da Concluir, nao uma escolha do painel).
//
// Quebrou? Nao conserte o teste primeiro: ou a spec mudou e este arquivo a
// segue, ou o codigo passou a oferecer o que o catalogo nao promete.

const CATALOGO_012: readonly { readonly runsOn: 'discovery' | 'plan' | 'work_item'; readonly phases: readonly string[] }[] = [
  { runsOn: 'discovery', phases: ['discovery'] },
  { runsOn: 'plan', phases: ['plano'] },
  { runsOn: 'work_item', phases: ['design', 'implementar', 'validar', 'concluir'] },
];

describe('catalogo das seis fases (spec 012)', () => {
  it('oferece exatamente as seis fases da spec, na ordem do grafo canonico', () => {
    for (const { runsOn, phases } of CATALOGO_012) {
      expect(catalogPhasesFor(runsOn).map((choice) => choice.phase)).toEqual(phases);
    }
  });

  it('soma seis fases no total — nem uma a mais, nem uma a menos', () => {
    const todas = CATALOGO_012.flatMap(({ runsOn }) => catalogPhasesFor(runsOn).map((choice) => choice.phase));
    expect(todas).toHaveLength(6);
    expect(new Set(todas).size).toBe(6);
  });

  it('nao oferece "documentar" como linha propria — ela vive dentro da Concluir (D-10)', () => {
    const todas = CATALOGO_012.flatMap(({ runsOn }) => catalogPhasesFor(runsOn).map((choice) => choice.phase));
    expect(todas).not.toContain('documentar');
  });

  it('da rotulo a toda fase oferecida — linha sem nome e linha que ninguem sabe disparar', () => {
    for (const { runsOn } of CATALOGO_012) {
      for (const choice of catalogPhasesFor(runsOn)) {
        expect(choice.label.trim()).not.toBe('');
      }
    }
  });
});
