// t-89f14324 — o lugar de uma sessão nova sai de regra fixa da config, não do modelo. Um "onde" explícito nunca
// transborda; sem regra, vale o comportamento de antes.
import { describe, expect, it } from 'vitest';
import { routePlace, type RouteInput, type RoutingRules } from '../src/shared/placeRouter';

const FULL = ['RAM livre 5%'];
const RULES: RoutingRules = {
  enabled: true,
  defaultPlace: 'beacon',
  projects: [{ match: 'Laboratorio', place: 'vega' }],
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
    const route = routePlace(input({ projectPath: '/home/x/seazone/Laboratório', projectName: 'Laboratório' }));
    expect(route).toMatchObject({ machine: 'r-vega', queue: false });
    expect(route.reason).toContain('Laboratorio');
  });

  it('pedido que só o PC atende vai para o PC', () => {
    const route = routePlace(input({ callerMachine: 'r-vega', request: 'Gere o instalador com o powershell' }));
    expect(route).toMatchObject({ machine: 'pc', queue: false });
  });

  // Revisor 7aaec9b8 (A1): o lugar reservado a um projeto nunca recebe o transbordo de outro, e o PC também não.
  it('lugar padrão cheio, com papel que aceita qualquer lugar, vai para a remota livre de mais vaga, nunca para o PC nem para o lugar de outro projeto', () => {
    const machines = [{ id: 'pc', label: 'este computador', roomSessions: 99 }, { id: 'r-beacon', label: 'beacon', waitReasons: FULL }, { id: 'r-x', label: 'x', roomSessions: 1 }, { id: 'r-y', label: 'y' }, { id: 'r-vega', label: 'vega', roomSessions: 20 }];
    const route = routePlace(input({ roleAnyPlace: true, machines }));
    expect(route).toMatchObject({ machine: 'r-x', queue: false, overflowFrom: 'beacon' });
  });

  it('nenhuma remota livre (a única com vaga é de outro projeto, ou não tem leitura de memória): espera na fila do lugar da regra', () => {
    const machines = [{ id: 'pc', label: 'este computador', roomSessions: 99 }, { id: 'r-beacon', label: 'beacon', waitReasons: FULL }, { id: 'r-y', label: 'y' }, { id: 'r-vega', label: 'vega', roomSessions: 30 }];
    expect(routePlace(input({ roleAnyPlace: true, machines }))).toMatchObject({ machine: 'r-beacon', queue: true });
    expect(routePlace(input({ roleAnyPlace: true, machines: fullOn(['r-beacon', 'r-vega']) }))).toMatchObject({ machine: 'r-beacon', queue: true });
  });
});

// Líder, 11/11 (Revisor 7aaec9b8, B1/B2): sem config nenhuma, a máquina de homologação só recebe projeto de
// homologação (pelo nome ou pasta do projeto, ou papel homol-*); o resto vai para a outra remota ou espera vaga nela.
describe('roteador de lugar sem config: a máquina de homologação é só da homologação', () => {
  const machines = [
    { id: 'pc', label: 'este computador', roomSessions: 99 },
    { id: 'r-vps', label: 'VPS', roomSessions: 3 },
    { id: 'r-hom', label: 'Homologações', roomSessions: 30 },
  ];
  const bare = (over: Partial<RouteInput> = {}): RouteInput => input({ rules: null, machines, projectPath: '/x/seazone/atlas', projectName: 'atlas', ...over });

  it('B1: quem roda na homologação abre sessão de outro projeto, sem "onde": vai para a outra remota', () => {
    expect(routePlace(bare({ callerMachine: 'r-hom' }))).toMatchObject({ machine: 'r-vps', queue: false });
    const full = machines.map((m) => (m.id === 'r-vps' ? { ...m, waitReasons: FULL } : m));
    expect(routePlace(bare({ callerMachine: 'r-hom', roleAnyPlace: true, machines: full }))).toMatchObject({ machine: 'r-vps', queue: true });
  });

  it('B2: VPS cheia com papel que aceita qualquer lugar espera vaga nela, nunca vai para a homologação', () => {
    const full = machines.map((m) => (m.id === 'r-vps' ? { ...m, waitReasons: FULL } : m));
    expect(routePlace(bare({ callerMachine: 'r-vps', roleAnyPlace: true, machines: full }))).toMatchObject({ machine: 'r-vps', queue: true });
  });

  it('projeto ou papel de homologação vai para a máquina de homologação', () => {
    expect(routePlace(bare({ callerMachine: 'r-vps', projectPath: '/x/seazone/Homologacao-beacon', projectName: 'Homologacao-beacon' }))).toMatchObject({ machine: 'r-hom' });
    expect(routePlace(bare({ callerMachine: 'r-vps', roleId: 'homol-atestador' }))).toMatchObject({ machine: 'r-hom' });
  });
});

// Líder, 11/11 (ressalvas R1/R2 do Revisor 7aaec9b8 no #397): o PC só recebe com "onde" explícito, e a máquina de
// homologação pedida pelo nome para outro trabalho é recusada com erro claro, nunca redirecionada em silêncio.
describe('roteador de lugar: PC só com pedido explícito e homologação recusada', () => {
  const machines = [
    { id: 'pc', label: 'este computador', roomSessions: 99 },
    { id: 'r-vps', label: 'VPS', roomSessions: 3 },
    { id: 'r-hom', label: 'Homologações', roomSessions: 30 },
  ];
  const bare = (over: Partial<RouteInput> = {}): RouteInput => input({ rules: null, machines, projectPath: '/x/seazone/atlas', projectName: 'atlas', ...over });

  it('sem config, quem roda no PC e abre sem "onde": a sessão nasce na VPS, ou espera vaga nela', () => {
    expect(routePlace(bare({ callerMachine: 'pc' }))).toMatchObject({ machine: 'r-vps', queue: false });
    const full = machines.map((m) => (m.id === 'r-vps' ? { ...m, waitReasons: FULL } : m));
    expect(routePlace(bare({ callerMachine: 'pc', roleAnyPlace: true, machines: full }))).toMatchObject({ machine: 'r-vps', queue: true });
    expect(routePlace(bare({ callerMachine: 'pc', explicit: 'pc' }))).toMatchObject({ machine: 'pc', queue: false });
  });

  it('"onde" apontando a homologação para outro projeto é recusado com erro claro', () => {
    const route = routePlace(bare({ callerMachine: 'r-vps', explicit: 'r-hom' }));
    expect(route.refused).toContain('Homologações é só para homologação');
    expect(route.refused).toContain('use VPS');
    expect(routePlace(bare({ explicit: 'r-hom', projectPath: '/x/seazone/Homologacao-beacon', projectName: 'Homologacao-beacon' })).refused).toBeUndefined();
  });
});
