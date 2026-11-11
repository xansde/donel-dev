// Faxineiro com gatilhos (t-b3b26e60) — the app wakes the Faxineiro of a board by itself and the Faxineiro closes
// sessions of its own board. Guarded here: a wake that must not happen (or must), the brakes that keep a full
// machine from getting four Faxineiros at once, and who the Faxineiro may never close.

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FAXINEIRO_CONFIG,
  emptyFaxineiroState,
  evaluateFaxineiro,
  FAXINEIRO_OPENER,
  faxineiroConfigSection,
  readFaxineiroConfig,
  type FaxineiroInput,
  type FaxineiroState,
  type MachineReading,
  type SessionView,
} from '../src/shared/faxineiro/triggers';
import { canFaxineiroClose } from '../src/shared/mindscape/reach';
import { addLink, addPlace, emptyMindscapeDoc, setPlaceConversation, type MindscapeDoc } from '../src/shared/mindscape/model';
import { FACTORY_ROLES, FAXINEIRO_ROLE_ID, LEADER_ROLE_ID, parseRoleFile, serializeRole, type SessionRole } from '../src/shared/roles';
import { AgentBridge, type AgentBridgePorts, type BridgeTab, type OpenSessionRequest } from '../src/renderer/src/Mindscape/agentBridge';

const MIN = 60_000;
const GB = 1024 ** 3;
const NOW = new Date(2026, 10, 7, 16, 0).getTime();

const vps = (over: Partial<MachineReading> = {}): MachineReading => ({
  id: 'vps',
  label: 'VPS',
  reachable: true,
  checkedAt: NOW,
  ramFreeRatio: 0.4,
  ramAvailableBytes: 4 * GB,
  swapUsedRatio: 0,
  swapInPerSec: 0,
  swapOutPerSec: 0,
  load5PerCpu: 0.5,
  diskUsedRatio: 0.5,
  ...over,
});

const session = (over: Partial<SessionView> = {}): SessionView => ({
  projectPath: '/p/atlas',
  placeId: 'place:dev',
  name: 'Dev',
  roleId: 'dev',
  machineId: 'vps',
  working: false,
  needsOwner: false,
  stateEnteredAt: NOW,
  openedBySession: true,
  ...over,
});

const input = (over: Partial<FaxineiroInput> = {}): FaxineiroInput => ({
  config: DEFAULT_FAXINEIRO_CONFIG,
  machines: [vps()],
  sessions: [session()],
  ...over,
});

// The daily round fires on the first round of the day; mark it done so the other triggers are seen alone.
const stateToday = (): FaxineiroState => ({ ...emptyFaxineiroState(), dailyDay: '2026-11-07' });

describe('evaluateFaxineiro — triggers', () => {
  it('a healthy machine and a busy board wake nobody', () => {
    const round = evaluateFaxineiro(input({ sessions: [session({ working: true })] }), stateToday(), NOW);
    expect(round.wakes).toEqual([]);
  });

  it('each machine limit wakes the board with sessions there, avoiding that machine', () => {
    for (const machine of [vps({ ramFreeRatio: 0.1 }), vps({ swapUsedRatio: 0.2, swapOutPerSec: 5, ramAvailableBytes: 0.5 * GB }), vps({ load5PerCpu: 2.5 }), vps({ diskUsedRatio: 0.9 })]) {
      const round = evaluateFaxineiro(input({ machines: [machine] }), stateToday(), NOW);
      expect(round.wakes).toHaveLength(1);
      expect(round.wakes[0]).toMatchObject({ projectPath: '/p/atlas', avoidMachine: 'vps' });
    }
  });

  it('swap parked (no paging, RAM to spare) is not a trigger, nor a full machine: the 08/11 reading, swap 18% with si/so 0 and 3,6 GB free', () => {
    const parked = vps({ swapUsedRatio: 0.18, ramAvailableBytes: 3.6 * GB });
    const round = evaluateFaxineiro(input({ machines: [parked] }), stateToday(), NOW);
    expect(round.wakes).toEqual([]);
    expect(round.fullMachines).toEqual({});
  });

  it('swap paging in or out with little RAM wakes the Faxineiro', () => {
    for (const machine of [vps({ swapUsedRatio: 0.18, swapInPerSec: 3, ramAvailableBytes: 0.5 * GB }), vps({ swapUsedRatio: 0.18, swapOutPerSec: 3, ramAvailableBytes: 0.5 * GB })]) {
      const round = evaluateFaxineiro(input({ machines: [machine] }), stateToday(), NOW);
      expect(round.wakes).toHaveLength(1);
      expect(round.wakes[0]?.reasons.join(' ')).toContain('troca ativa');
    }
  });

  // t-89f14324 — seis aberturas ficaram na fila da Homologações com 22 a 25 GB livres por causa de paginação.
  it('swap paginando com 20 GB livres não marca a máquina cheia; com 500 MB livres, marca', () => {
    const roomy = vps({ swapUsedRatio: 0.05, swapInPerSec: 40, swapOutPerSec: 12, ramFreeRatio: 0.65, ramAvailableBytes: 20 * GB });
    let round = evaluateFaxineiro(input({ machines: [roomy] }), stateToday(), NOW);
    expect(round.wakes).toEqual([]);
    expect(round.fullMachines).toEqual({});
    const tight = vps({ swapUsedRatio: 0.05, swapInPerSec: 40, swapOutPerSec: 12, ramFreeRatio: 0.3, ramAvailableBytes: 0.5 * GB });
    round = evaluateFaxineiro(input({ machines: [tight] }), stateToday(), NOW);
    expect(round.fullMachines.vps?.join(' ')).toContain('troca ativa');
  });

  it('swap in use with little RAM available wakes the Faxineiro', () => {
    const round = evaluateFaxineiro(input({ machines: [vps({ swapUsedRatio: 0.18, ramAvailableBytes: 0.5 * GB })] }), stateToday(), NOW);
    expect(round.wakes).toHaveLength(1);
    expect(round.wakes[0]?.reasons.join(' ')).toContain('RAM disponível');
  });

  it('both swap limits come from the faxineiro section of config.json', () => {
    const config = readFaxineiroConfig({ trocaAtivaMinimaPaginasPorSeg: 10, swapRamDisponivelMinimaMb: 256 });
    const machines = [vps({ swapUsedRatio: 0.18, swapOutPerSec: 5, ramAvailableBytes: 0.5 * GB })];
    expect(evaluateFaxineiro(input({ config, machines }), stateToday(), NOW).wakes).toEqual([]);
    expect(faxineiroConfigSection()).toMatchObject({ trocaAtivaMinimaPaginasPorSeg: 0, swapRamDisponivelMinimaMb: 1024 });
  });

  it('"sem sinal" wakes only after two reads in a row without answer, and stale numbers never count', () => {
    let state = stateToday();
    const down = (at: number) => vps({ reachable: false, checkedAt: at, ramFreeRatio: 0.01 });
    let round = evaluateFaxineiro(input({ machines: [down(NOW)] }), state, NOW);
    expect(round.wakes).toEqual([]);
    state = round.state;
    // the same read seen again is not a second read
    round = evaluateFaxineiro(input({ machines: [down(NOW)] }), state, NOW + MIN);
    expect(round.wakes).toEqual([]);
    round = evaluateFaxineiro(input({ machines: [down(NOW + MIN)] }), round.state, NOW + MIN);
    expect(round.wakes).toHaveLength(1);
    expect(round.wakes[0]!.reasons.join(' ')).toContain('sem sinal');
    expect(round.wakes[0]!.reasons.join(' ')).not.toContain('RAM');
  });

  it('a stopped session wakes its board after 30 min, once per stop, and never for the Líder, a hand-opened tab or one that needs the owner', () => {
    const old = NOW - 31 * MIN;
    const sessions = [
      session({ stateEnteredAt: old }),
      session({ placeId: 'place:lider', roleId: LEADER_ROLE_ID, stateEnteredAt: old }),
      session({ placeId: 'place:mao', openedBySession: false, stateEnteredAt: old }),
      session({ placeId: 'place:pede', needsOwner: true, stateEnteredAt: old }),
    ];
    const round = evaluateFaxineiro(input({ sessions }), stateToday(), NOW);
    expect(round.wakes).toHaveLength(1);
    const text = round.wakes[0]!.reasons.join(' ');
    expect(text).toContain('place:dev');
    expect(text).not.toMatch(/place:(lider|mao|pede)/);
    // same stop, past the interval: already told
    const again = evaluateFaxineiro(input({ sessions }), round.state, NOW + 60 * MIN);
    expect(again.wakes).toEqual([]);
    // it worked and stopped again: a new stop
    const restopped = evaluateFaxineiro(input({ sessions: [session({ stateEnteredAt: NOW + 10 * MIN })] }), round.state, NOW + 41 * MIN);
    expect(restopped.wakes).toHaveLength(1);
  });

  it('a stopped session under 30 min is not a trigger', () => {
    expect(evaluateFaxineiro(input({ sessions: [session({ stateEnteredAt: NOW - 29 * MIN })] }), stateToday(), NOW).wakes).toEqual([]);
  });

  it('the daily round wakes each board once a day, one at a time, after the hour', () => {
    const early = new Date(2026, 10, 8, 5, 0).getTime();
    const sessions = [session({ working: true }), session({ projectPath: '/p/beacon', placeId: 'place:b', working: true })];
    expect(evaluateFaxineiro(input({ sessions }), stateToday(), early).wakes).toEqual([]);
    const at = new Date(2026, 10, 8, 6, 5).getTime();
    const first = evaluateFaxineiro(input({ sessions }), stateToday(), at);
    expect(first.wakes.map((wake) => wake.projectPath)).toEqual(['/p/atlas']);
    // the Faxineiro of atlas is working: beacon waits
    const busy = [...sessions, session({ placeId: 'place:fax', roleId: FAXINEIRO_ROLE_ID, working: true, machineId: 'pc' })];
    expect(evaluateFaxineiro(input({ sessions: busy }), first.state, at + MIN).wakes).toEqual([]);
    const second = evaluateFaxineiro(input({ sessions }), first.state, at + 2 * MIN);
    expect(second.wakes.map((wake) => wake.projectPath)).toEqual(['/p/beacon']);
    expect(evaluateFaxineiro(input({ sessions }), second.state, at + 3 * MIN).wakes).toEqual([]);
  });

  it('is off with "ligado: false"', () => {
    const round = evaluateFaxineiro(input({ config: { ...DEFAULT_FAXINEIRO_CONFIG, enabled: false }, machines: [vps({ ramFreeRatio: 0.01 })] }), emptyFaxineiroState(), NOW);
    expect(round.wakes).toEqual([]);
  });
});

describe('evaluateFaxineiro — brakes', () => {
  it('the same machine does not wake again within the interval', () => {
    const full = input({ machines: [vps({ ramFreeRatio: 0.05 })] });
    const first = evaluateFaxineiro(full, stateToday(), NOW);
    expect(first.wakes).toHaveLength(1);
    expect(evaluateFaxineiro(full, first.state, NOW + 29 * MIN).wakes).toEqual([]);
    expect(evaluateFaxineiro(full, first.state, NOW + 31 * MIN).wakes).toHaveLength(1);
  });

  it('a full machine wakes one board at a time: the next only after the first Faxineiro stops working', () => {
    const sessions = [session({ working: true }), session({ projectPath: '/p/beacon', placeId: 'place:b1', working: true }), session({ projectPath: '/p/beacon', placeId: 'place:b2', working: true })];
    const full = input({ machines: [vps({ ramFreeRatio: 0.05 })], sessions });
    const first = evaluateFaxineiro(full, stateToday(), NOW);
    expect(first.wakes.map((wake) => wake.projectPath)).toEqual(['/p/beacon']); // most sessions there first
    const working = { ...full, sessions: [...sessions, session({ projectPath: '/p/beacon', placeId: 'place:fax', roleId: FAXINEIRO_ROLE_ID, working: true, machineId: 'pc' })] };
    expect(evaluateFaxineiro(working, first.state, NOW + 31 * MIN).wakes).toEqual([]);
    const next = evaluateFaxineiro(full, first.state, NOW + 32 * MIN);
    expect(next.wakes.map((wake) => wake.projectPath)).toEqual(['/p/atlas']);
  });

  it('never more wakes in an hour than the cap', () => {
    const machines = Array.from({ length: 6 }, (_, index) => vps({ id: `vps${index}`, label: `VPS ${index}`, ramFreeRatio: 0.05 }));
    const sessions = machines.map((machine, index) => session({ projectPath: `/p/${index}`, placeId: `place:${index}`, machineId: machine.id }));
    const round = evaluateFaxineiro(input({ machines, sessions }), stateToday(), NOW);
    expect(round.wakes).toHaveLength(DEFAULT_FAXINEIRO_CONFIG.maxWakesPerHour);
  });

  it('closes the Faxineiro the app opened once it sits stopped past the limit, never one the owner opened', () => {
    const fax = (over: Partial<SessionView>) => session({ placeId: 'place:fax', roleId: FAXINEIRO_ROLE_ID, machineId: 'pc', ...over });
    const appOpened = fax({ openedBy: FAXINEIRO_OPENER, stateEnteredAt: NOW - 11 * MIN });
    expect(evaluateFaxineiro(input({ sessions: [appOpened] }), stateToday(), NOW).closeIdle).toEqual([{ projectPath: '/p/atlas', placeId: 'place:fax' }]);
    expect(evaluateFaxineiro(input({ sessions: [fax({ openedBy: FAXINEIRO_OPENER, stateEnteredAt: NOW - 9 * MIN })] }), stateToday(), NOW).closeIdle).toEqual([]);
    expect(evaluateFaxineiro(input({ sessions: [fax({ openedBySession: false, stateEnteredAt: NOW - 60 * MIN })] }), stateToday(), NOW).closeIdle).toEqual([]);
  });
});

describe('canFaxineiroClose', () => {
  const board = '/p/atlas';
  const doc = (): MindscapeDoc => {
    let next = emptyMindscapeDoc();
    next = addPlace(next, board, { id: 'place:lider', roleId: LEADER_ROLE_ID });
    next = addPlace(next, board, { id: 'place:fax', roleId: FAXINEIRO_ROLE_ID, by: 'session' });
    next = addPlace(next, board, { id: 'place:dev', roleId: 'dev', by: 'session' });
    next = addLink(next, board, { id: 'l1', from: 'place:lider', to: 'place:dev', arrow: true, by: 'session', opened: true });
    next = addPlace(next, '/p/beacon', { id: 'place:other', roleId: 'dev', by: 'session' });
    return next;
  };
  const from = { projectPath: board, placeId: 'place:fax' };
  const idle = { working: false, needsOwner: false, openedBySession: true };

  it('closes a finished session of its own board, with no arrow to it', () => {
    expect(canFaxineiroClose(doc(), from, { projectPath: board, placeId: 'place:dev' }, idle)).toEqual({ ok: true });
  });

  it('never: another board, itself, the Líder, a session working, one waiting for the owner, a tab the owner opened by hand', () => {
    const refusals = [
      canFaxineiroClose(doc(), from, { projectPath: '/p/beacon', placeId: 'place:other' }, idle),
      canFaxineiroClose(doc(), from, from, idle),
      canFaxineiroClose(doc(), from, { projectPath: board, placeId: 'place:lider' }, idle),
      canFaxineiroClose(doc(), from, { projectPath: board, placeId: 'place:dev' }, { ...idle, working: true }),
      canFaxineiroClose(doc(), from, { projectPath: board, placeId: 'place:dev' }, { ...idle, needsOwner: true }),
      canFaxineiroClose(doc(), from, { projectPath: board, placeId: 'place:dev' }, { ...idle, openedBySession: false }),
    ];
    for (const verdict of refusals) expect(verdict.ok).toBe(false);
  });

  it('only a Faxineiro place has this reach', () => {
    const dev = { projectPath: board, placeId: 'place:dev' };
    expect(canFaxineiroClose(doc(), dev, { projectPath: board, placeId: 'place:fax' }, idle).ok).toBe(false);
  });
});

describe('máquina cheia para abrir sessão', () => {
  it('fica cheia com RAM, swap, carga ou sem sinal, e só sai depois de 2 leituras seguidas abaixo dos limites', () => {
    let round = evaluateFaxineiro(input({ machines: [vps({ ramFreeRatio: 0.05 })] }), stateToday(), NOW);
    expect(round.fullMachines.vps?.join(' ')).toContain('RAM');
    round = evaluateFaxineiro(input({ machines: [vps({ checkedAt: NOW + MIN })] }), round.state, NOW + MIN);
    expect(round.fullMachines.vps).toBeDefined();
    // the same read again is not a second one
    round = evaluateFaxineiro(input({ machines: [vps({ checkedAt: NOW + MIN })] }), round.state, NOW + 90_000);
    expect(round.fullMachines.vps).toBeDefined();
    round = evaluateFaxineiro(input({ machines: [vps({ checkedAt: NOW + 2 * MIN })] }), round.state, NOW + 2 * MIN);
    expect(round.fullMachines.vps).toBeUndefined();
  });

  it('disco cheio não segura abertura', () => {
    expect(evaluateFaxineiro(input({ machines: [vps({ diskUsedRatio: 0.95 })] }), stateToday(), NOW).fullMachines).toEqual({});
  });
});

describe('fila de abertura', () => {
  const BOARD = '/p/atlas';
  const setupQueue = (extraRoles: SessionRole[] = []) => {
    let doc = addPlace(emptyMindscapeDoc(), BOARD, { id: 'place:dev', roleId: 'dev' });
    doc = setPlaceConversation(doc, BOARD, 'place:dev', 'conv-dev');
    const opened: OpenSessionRequest[] = [];
    const tabs: BridgeTab[] = [{ id: 'tab-dev', name: 'Dev', cwd: BOARD, claudeSessionId: 'conv-dev', remoteId: 'vps', sessionType: 'claude' }];
    const ports: AgentBridgePorts = {
      loaded: true,
      doc: () => doc,
      applyGesture: (_path, reducer) => {
        doc = reducer(doc);
      },
      tabs: () => tabs,
      tabOfPty: (ptyId) => tabs.find((tab) => tab.id === `tab-${ptyId}`),
      stateOf: () => 'waiting',
      roles: () => [...FACTORY_ROLES, ...extraRoles],
      openSession: (request) => {
        opened.push(request);
        return `tab-new-${opened.length}`;
      },
      closeTab: () => undefined,
      sendLine: () => undefined,
      deliverLine: async () => ({ kind: 'entrou' }),
      permissionOnScreen: () => false,
      unconfirmed: () => false,
      startTrouble: () => null,
      askOwner: async () => true,
      remoteLabel: (id) => id.toUpperCase(),
      remotes: () => [
        { id: 'vps', label: 'VPS' },
        { id: 'vps2', label: 'VPS 2' },
      ],
      projects: () => [{ path: BOARD, name: 'atlas' }],
    };
    const bridge = new AgentBridge(ports);
    return { bridge, opened, doc: () => doc };
  };

  it('com a máquina cheia, o pedido espera vaga e abre uma vez só quando ela libera', async () => {
    const { bridge, opened, doc } = setupQueue();
    bridge.setFullMachines({ vps: ['VPS: RAM livre 5% (limite 15%)'] });
    const answer = await bridge.handle('dev', { tool: 'sessao_abrir', papel: 'revisor', pedido: 'revise o PR 7' });
    expect(answer.ok).toBe(true);
    expect(answer.text).toContain('fila');
    expect(opened).toEqual([]);
    const placeId = JSON.parse(answer.text).lugar as string;
    expect(doc().boards[BOARD]?.cards[placeId]?.kind).toBe('session');

    bridge.drainQueue(); // still full
    expect(opened).toEqual([]);
    bridge.setFullMachines({});
    bridge.drainQueue();
    expect(opened).toHaveLength(1);
    expect(opened[0]).toMatchObject({ placeId, firstMessage: 'revise o PR 7', remoteId: 'vps' });
    bridge.drainQueue();
    expect(opened).toHaveLength(1);
  });

  it('papel com "lugar: qualquer" vai para a outra VPS em vez de esperar', async () => {
    const free: SessionRole = { id: 'pesquisa-livre', name: 'Pesquisa livre', color: 'discovery', anyPlace: true, guidance: 'lê' };
    const { bridge, opened } = setupQueue([free]);
    bridge.setFullMachines({ vps: ['VPS: carga'] });
    const answer = await bridge.handle('dev', { tool: 'sessao_abrir', papel: 'pesquisa-livre', pedido: 'leia X' });
    expect(answer.ok).toBe(true);
    expect(opened).toHaveLength(1);
    expect(opened[0]!.remoteId).toBe('vps2');
  });

  // t-d1f072fd — a leitura de memória é de 60 s: sem contar o que abriu depois dela, quatro aberturas no mesmo minuto
  // passavam do limite e levavam a VPS pessoal ao swap antes da leitura seguinte.
  it('rajada: com vaga para 2 sessões, a terceira abertura do mesmo minuto espera na fila', async () => {
    const { bridge, opened } = setupQueue();
    bridge.setFullMachines({}, { vps: { sessions: 2, checkedAt: Date.now() } });
    for (const pedido of ['a', 'b']) {
      const answer = await bridge.handle('dev', { tool: 'sessao_abrir', papel: 'revisor', pedido });
      expect(answer.ok).toBe(true);
    }
    expect(opened).toHaveLength(2);
    const third = await bridge.handle('dev', { tool: 'sessao_abrir', papel: 'revisor', pedido: 'c' });
    expect(third.ok).toBe(true);
    expect(third.text).toContain('fila');
    expect(third.text).toContain('2 aberturas desde a última leitura');
    expect(opened).toHaveLength(2);

    bridge.drainQueue(); // same reading: still no room
    expect(opened).toHaveLength(2);
    // a newer reading already sees the two sessions in the RAM it reports
    bridge.setFullMachines({}, { vps: { sessions: 1, checkedAt: Date.now() + 2 * MIN } });
    bridge.drainQueue();
    expect(opened).toHaveLength(3);
    expect(opened[2]).toMatchObject({ firstMessage: 'c', remoteId: 'vps' });
  });

  it('rajada: sem vaga nenhuma na leitura, a primeira abertura já espera', async () => {
    const { bridge, opened } = setupQueue();
    bridge.setFullMachines({}, { vps: { sessions: 0, checkedAt: Date.now() } });
    const answer = await bridge.handle('dev', { tool: 'sessao_abrir', papel: 'revisor', pedido: 'a' });
    expect(answer.text).toContain('fila');
    expect(opened).toEqual([]);
  });

  it('rajada: papel com "lugar: qualquer" vai para a outra VPS quando a sua não tem vaga', async () => {
    const free: SessionRole = { id: 'pesquisa-livre', name: 'Pesquisa livre', color: 'discovery', anyPlace: true, guidance: 'lê' };
    const { bridge, opened } = setupQueue([free]);
    bridge.setFullMachines({}, { vps: { sessions: 0, checkedAt: Date.now() }, vps2: { sessions: 3, checkedAt: Date.now() } });
    await bridge.handle('dev', { tool: 'sessao_abrir', papel: 'pesquisa-livre', pedido: 'leia X' });
    expect(opened).toHaveLength(1);
    expect(opened[0]!.remoteId).toBe('vps2');
  });
});

describe('vaga para abrir sessão (t-d1f072fd)', () => {
  // VPS pessoal: 7,6 GiB; o limite de 15% de RAM livre fica em 1,14 GiB.
  const personal = (availableGb: number): MachineReading => vps({ ramAvailableBytes: availableGb * GB, ramFreeRatio: availableGb / 7.6 });

  it('conta quantas sessões de 400 MB cabem antes do limite de RAM livre', () => {
    const round = evaluateFaxineiro(input({ machines: [personal(3.6)] }), stateToday(), NOW);
    expect(round.fullMachines).toEqual({});
    expect(round.openingRoom.vps).toEqual({ sessions: 6, checkedAt: NOW });
  });

  it('perto do limite (1,2 GiB disponíveis) não cabe nenhuma', () => {
    const round = evaluateFaxineiro(input({ machines: [personal(1.2)] }), stateToday(), NOW);
    expect(round.fullMachines).toEqual({});
    expect(round.openingRoom.vps?.sessions).toBe(0);
  });

  it('máquina sem sinal ou sem leitura de RAM não tem vaga calculada', () => {
    const round = evaluateFaxineiro(input({ machines: [vps({ reachable: false }), vps({ id: 'pc', label: 'PC', ramFreeRatio: null, ramAvailableBytes: null })] }), stateToday(), NOW);
    expect(round.openingRoom).toEqual({});
  });
});

describe('papel com lugar: qualquer', () => {
  it('a chave sobrevive a salvar o papel', () => {
    const role = parseRoleFile('pesquisa-livre', '---\nnome: Pesquisa livre\ncor: discovery\nlugar: qualquer\n---\nlê')!;
    expect(role.anyPlace).toBe(true);
    expect(parseRoleFile('pesquisa-livre', serializeRole(role))?.anyPlace).toBe(true);
  });
});
