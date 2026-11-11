// t-89f14324 — o lugar de uma sessão nova sai de regra fixa da config, não do modelo. Um "onde" explícito nunca
// transborda; sem regra, vale o comportamento de antes.
import { describe, expect, it } from 'vitest';
import { routePlace, type RouteInput, type RoutingRules } from '../src/shared/placeRouter';

const FULL = ['RAM livre 5%'];
const RULES: RoutingRules = {
  enabled: true,
  defaultPlace: 'beacon',
  projects: [{ match: 'Homologacao', place: 'vega' }],
  pcWhenRequestHas: ['PowerShell', '%APPDATA%'],
};

const input = (over: Partial<RouteInput> = {}): RouteInput => ({
  callerMachine: 'r-beacon',
  roleAnyPlace: false,
  projectPath: '/home/x/seazone/atlas',
  projectName: 'atlas',
  request: 'revise o PR 7',
  machines: [
    { id: 'pc', label: 'este computador' },
    { id: 'r-beacon', label: 'beacon', roomSessions: 2 },
    { id: 'r-vega', label: 'vega', roomSessions: 20 },
  ],
  rules: RULES,
  ...over,
});

const fullOn = (ids: string[], base = input().machines) => base.map((m) => (ids.includes(m.id) ? { ...m, waitReasons: FULL } : m));

describe('roteador de lugar', () => {
  it('lugar explícito cheio espera na fila lá, mesmo com papel que aceita qualquer lugar', () => {
    const route = routePlace(input({ explicit: 'pc', roleAnyPlace: true, machines: fullOn(['pc']) }));
    expect(route).toMatchObject({ machine: 'pc', queue: true });
    expect(route.overflowFrom).toBeUndefined();
  });

  it('sem regra ligada, abre onde quem pede roda e transborda para a primeira remota livre, como antes', () => {
    const off = routePlace(input({ rules: { ...RULES, enabled: false }, request: 'rode no PowerShell' }));
    expect(off).toMatchObject({ machine: 'r-beacon', queue: false });
    const machines = fullOn(['r-beacon'], [{ id: 'pc', label: 'este computador' }, { id: 'r-beacon', label: 'beacon' }, { id: 'r-x', label: 'x', roomSessions: 1 }, { id: 'r-vega', label: 'vega', roomSessions: 20 }]);
    expect(routePlace(input({ rules: null, roleAnyPlace: true, machines }))).toMatchObject({ machine: 'r-x', queue: false, overflowFrom: 'beacon' });
    expect(routePlace(input({ rules: null, roleAnyPlace: false, machines }))).toMatchObject({ machine: 'r-beacon', queue: true });
  });

  it('projeto com regra própria abre no lugar dela', () => {
    const route = routePlace(input({ projectPath: '/home/x/seazone/Homologação', projectName: 'Homologação' }));
    expect(route).toMatchObject({ machine: 'r-vega', queue: false });
    expect(route.reason).toContain('Homologacao');
  });

  it('pedido que só o PC atende vai para o PC', () => {
    const route = routePlace(input({ callerMachine: 'r-vega', request: 'Gere o instalador com o powershell' }));
    expect(route).toMatchObject({ machine: 'pc', queue: false });
  });

  it('lugar padrão cheio, com papel que aceita qualquer lugar, vai para a remota de mais vaga e nunca para o PC', () => {
    const machines = [{ id: 'pc', label: 'este computador', roomSessions: 99 }, { id: 'r-beacon', label: 'beacon', waitReasons: FULL }, { id: 'r-x', label: 'x', roomSessions: 1 }, { id: 'r-vega', label: 'vega', roomSessions: 20 }];
    const route = routePlace(input({ roleAnyPlace: true, machines }));
    expect(route).toMatchObject({ machine: 'r-vega', queue: false, overflowFrom: 'beacon' });
  });

  it('nenhuma remota livre: espera na fila do lugar da regra', () => {
    const route = routePlace(input({ roleAnyPlace: true, machines: fullOn(['r-beacon', 'r-vega']) }));
    expect(route).toMatchObject({ machine: 'r-beacon', queue: true });
  });
});
