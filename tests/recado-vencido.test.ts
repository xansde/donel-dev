// Recado vencido (r-3ac3e0e4, 19/11) — what breaks without the owner noticing: an order hours old reaching a session
// that comes back and obeys it, a flood of stale notices to the Líder when the app reopens, an owner's word dropped
// for being late, and a sender never told its recado was cut (or told twice, or in a loop).
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createSystemConfigIoDeps } from '../src/main/config-store';
import type { OwnerMessage } from '../src/main/ledger-card-writer';
import type { MindscapeBoard, MindscapeCard } from '../src/shared/mindscape/model';
import type { BoardPicture, PictureSession } from '../src/oraculo/portao';
import { createGateRecados, type RecadosTmux } from '../src/oraculo/recados';
import { createRelay } from '../src/oraculo/relay';
import { STALE_MS } from '../src/oraculo/vencimento';

const io = createSystemConfigIoDeps();
const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const PROJECT = '/home/dono/seazone/atlas';
const DEV = 'place:dev';
const REV = 'place:rev';
const SID_DEV = '11111111-2222-4333-8444-555555555555';
const SID_REV = '66666666-2222-4333-8444-555555555555';
const START = Date.UTC(2026, 10, 18, 12); // 18/11 09:00 in São Paulo
const LATER = STALE_MS + 60 * 60_000;

const place = (id: string, roleId: string): MindscapeCard => ({ kind: 'session', id, roleId, previous: [], x: 0, y: 0 });
const BOARD: MindscapeBoard = {
  projectPath: PROJECT,
  pan: { x: 0, y: 0 },
  zoom: 1,
  cards: { [DEV]: place(DEV, 'dev'), [REV]: place(REV, 'revisor') },
  links: [{ id: 'l1', from: DEV, to: REV, arrow: true }],
  drawings: [],
};

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'vencido-'));
  dirs.push(dir);
  let clock = START;
  const states = new Map([
    [DEV, 'trabalhando'],
    [REV, 'parada'],
  ]);
  const listar = () => [...states].map(([id, estado]) => ({ id, papel: id === DEV ? 'dev' : 'revisor', estado }));
  const session = (lugar: string, papel: string): PictureSession => ({ quemSou: { nome: `${papel} · atlas`, pasta: PROJECT, lugar, papel, papelNome: papel }, listar: listar(), board: BOARD });
  const picture = (): BoardPicture => ({ at: clock, sessoes: { [SID_DEV]: session(DEV, 'Dev'), [SID_REV]: session(REV, 'Revisor') } });
  const live = new Set([SID_DEV, SID_REV]);
  const relayed: OwnerMessage[] = [];
  const typed: string[] = [];
  const tmux: RecadosTmux = {
    screen: async () => ({ inMode: false, text: 'esc to interrupt' }),
    type: async (_sid, text) => {
      typed.push(text);
      return true;
    },
    enter: async () => true,
    clear: async () => true,
  };
  const file = join(dir, 'recados.json');
  const make = () =>
    createGateRecados({
      file,
      io,
      ledger: () => null,
      picture,
      localSessions: async () => new Set(live),
      tmux,
      relay: async (message) => relayed.push(message),
      transcriptOf: async () => undefined,
      now: () => clock,
      log: () => undefined,
    });
  const endOfTurn = async (recados: ReturnType<typeof make>, sid: string): Promise<string> => {
    const answer = JSON.parse((await recados.hook('fim-de-turno', { 'x-donel-tmux': `donel-${sid}` }, JSON.stringify({ session_id: sid }))).body) as { reason?: string };
    return answer.reason ?? '';
  };
  const disk = () => (JSON.parse(readFileSync(file, 'utf8')) as { items: { id: string; estado: string; vencidoEm?: number; texto: string; para: { lugar: string } }[] }).items;
  return { file, live, states, relayed, typed, make, endOfTurn, disk, advance: (ms: number) => (clock += ms) };
}

const sendDevToRev = async (recados: ReturnType<ReturnType<typeof setup>['make']>, texto: string): Promise<string> => {
  const mine: PictureSession = { quemSou: { nome: 'Dev · atlas', pasta: PROJECT, lugar: DEV, papel: 'dev', papelNome: 'Dev' }, listar: [], board: BOARD };
  const outcome = await recados.enviar(SID_DEV, { ...mine, listar: [{ id: DEV, papel: 'dev', estado: 'trabalhando' }, { id: REV, papel: 'revisor', estado: 'parada' }] }, { tool: 'sessao_enviar', para: REV, texto }, 'desligado');
  if (outcome === 'repassar' || outcome.kind !== 'text') throw new Error(`não enfileirou: ${JSON.stringify(outcome)}`);
  return (JSON.parse(outcome.text) as { id: string }).id;
};

describe('Recado vencido nos recados da máquina', () => {
  it('um recado novo é entregue como sempre', async () => {
    const g = setup();
    const recados = g.make();
    await sendDevToRev(recados, 'pode revisar o PR 12?');
    g.advance(60 * 60_000);
    expect(await g.endOfTurn(recados, SID_REV)).toContain('pode revisar o PR 12?');
  });

  it('velho não é entregue, vira vencido e quem mandou ouve uma vez só (também depois de reiniciar)', async () => {
    const g = setup();
    const recados = g.make();
    const id = await sendDevToRev(recados, 'termine o passo atual e grave esperando');
    g.advance(LATER);
    expect(await g.endOfTurn(recados, SID_REV), 'o fim de turno não entrega o vencido').toBe('');
    await recados.tick();
    expect(g.disk().find((item) => item.id === id)).toMatchObject({ estado: 'devolvido', vencidoEm: expect.any(Number) });
    expect(await g.endOfTurn(recados, SID_REV), 'nem depois de vencido').toBe('');
    // A restart (and its ticks) never tells again.
    const after = g.make();
    await after.tick();
    await after.tick();
    expect(g.disk().filter((item) => item.texto.includes('venceu sem entrega'))).toHaveLength(1);
    // The sender hears it, with the target and when it was sent.
    const told = await g.endOfTurn(after, SID_DEV);
    expect(told).toContain(`seu recado para ${REV} venceu sem entrega (enviado 18/11 09:00)`);
    expect(told).toContain('termine o passo atual');
    expect(g.typed.join(' ')).not.toContain('termine o passo atual');
  });

  it('o aviso de vencimento que também vence não gera outro aviso', async () => {
    const g = setup();
    const recados = g.make();
    await sendDevToRev(recados, 'termine o passo atual');
    g.advance(LATER);
    await recados.tick();
    expect(g.disk()).toHaveLength(2); // the recado (vencido) and the notice to the Dev, never read
    g.advance(LATER);
    await recados.tick();
    await recados.tick();
    expect(g.disk()).toHaveLength(2);
    expect(g.disk().every((item) => item.estado === 'devolvido')).toBe(true);
    expect(g.relayed).toHaveLength(0);
  });

  it('com quem mandou fechado, o aviso vai ao Líder único', async () => {
    const g = setup();
    const recados = g.make();
    await sendDevToRev(recados, 'termine o passo atual');
    g.live.delete(SID_DEV);
    g.states.set(DEV, 'fechada');
    g.advance(LATER);
    await recados.tick();
    expect(g.relayed).toHaveLength(1);
    expect(g.relayed[0]).toMatchObject({ placeId: '', key: expect.stringMatching(/^vencido:/) });
    expect(g.relayed[0]!.text).toContain(`o recado de ${DEV} para ${REV} venceu sem entrega`);
    await g.make().tick();
    expect(g.relayed, 'idempotente: um aviso por recado').toHaveLength(1);
  });

  it('a palavra do dono atrasada além do limite é entregue, marcada como atrasada', async () => {
    const g = setup();
    const recados = g.make();
    const message: OwnerMessage = { projectPath: PROJECT, placeId: REV, text: '◆ O dono aceitou a tarefa «X».', leaderText: '◆ O dono aceitou a tarefa «X». Era para o Revisor.', key: 'decisao:t-1:123' };
    expect(await recados.deliverLocal(message)).toEqual({ placeId: REV });
    g.advance(LATER);
    await recados.tick();
    const reason = await g.endOfTurn(recados, SID_REV);
    expect(reason).toContain('O dono aceitou a tarefa «X». (atrasada: enviada 18/11 09:00)');
    expect(g.relayed).toHaveLength(0);
  });

  it('o corte vale na carga do arquivo: um recado de ontem guardado na fila vence ao subir', async () => {
    const g = setup();
    const criado = START - 24 * 60 * 60_000;
    writeFileSync(
      g.file,
      JSON.stringify({
        items: [
          { id: 'r-a21059e0', chave: 'c'.repeat(32), de: { lugar: 'place:lider-bizops', nome: 'Líder', sid: 'aaaaaaaa-0000-4000-8000-000000000000' }, para: { lugar: REV, sid: SID_REV }, texto: '◆ Recado r-a21059e0 de Líder (place:lider-bizops): termine o passo atual', criado, estado: 'fila', tentativas: 0 },
        ],
      }),
    );
    const recados = g.make();
    expect(await g.endOfTurn(recados, SID_REV)).toBe('');
    await recados.tick();
    expect(g.disk()[0]).toMatchObject({ id: 'r-a21059e0', estado: 'devolvido', vencidoEm: START });
    expect(g.relayed).toHaveLength(1);
    expect(g.relayed[0]).toMatchObject({ placeId: '' });
    expect(g.relayed[0]!.text).toContain('place:lider-bizops');
  });
});

describe('Recado vencido no relay (fila.json, avisos-pendentes.json, filas das outras máquinas)', () => {
  const at = Date.UTC(2026, 10, 19, 13, 59); // 19/11 10:59 in São Paulo
  const base = { projectPath: PROJECT, leaderText: '◆ para o Líder' };

  function relayAt(file: string, clock: { now: number }) {
    return createRelay({ filePath: file, io, now: () => clock.now, log: () => undefined });
  }

  it('aviso velho não sai e fica vencido; recado de sessão velho avisa quem mandou; o do dono sai marcado; o novo sai normal', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'vencido-relay-'));
    dirs.push(dir);
    const file = join(dir, 'fila.json');
    const clock = { now: at };
    const relay = relayAt(file, clock);
    await relay.send({ ...base, placeId: '', text: '◆ Oráculo: caixa parada', key: 'caixa:s1' }, 0);
    await relay.send({ ...base, placeId: REV, text: '◆ Recado de Dev (place:dev): termine o passo', key: `recado:${DEV}:${'a'.repeat(32)}` }, 0);
    await relay.send({ ...base, placeId: REV, text: '◆ O dono rejeitou a tarefa «Y».', key: 'decisao:t-2:9' }, 0);
    clock.now += LATER;
    await relay.send({ ...base, placeId: REV, text: '◆ Oráculo: novo', key: 'aviso:novo' }, 0);

    // A boot hours later: the queue as it was left.
    const reopened = relayAt(file, clock);
    const pending = reopened.pending();
    const texts = pending.map((item) => item.message.text);
    expect(texts).not.toContain('◆ Oráculo: caixa parada');
    expect(texts.some((text) => text.startsWith('◆ Recado de Dev'))).toBe(false);
    expect(texts).toContain('◆ O dono rejeitou a tarefa «Y». (atrasada: enviada 19/11 10:59)');
    expect(texts).toContain('◆ Oráculo: novo');
    const notices = pending.filter((item) => item.key.startsWith('vencido:'));
    expect(notices).toHaveLength(1); // the Oráculo's own notice tells nobody
    expect(notices[0]!.message).toMatchObject({ placeId: DEV });
    expect(notices[0]!.message.text).toContain(`seu recado para ${REV} venceu sem entrega (enviado 19/11 10:59)`);

    const saved = (JSON.parse(readFileSync(file, 'utf8')) as { items: { key: string; vencidoEm?: number }[] }).items;
    expect(saved.find((item) => item.key === 'caixa:s1')?.vencidoEm).toBe(clock.now);
    // A retry of the stale key does not revive it, and a third opening adds no second notice.
    expect(await reopened.send({ ...base, placeId: '', text: '◆ Oráculo: caixa parada', key: 'caixa:s1' }, 0)).toBe('pendente');
    clock.now += LATER;
    const third = relayAt(file, clock).pending();
    expect(third.some((item) => item.message.text === '◆ Oráculo: caixa parada')).toBe(false);
    expect(third.filter((item) => item.key.startsWith('vencido:'))).toHaveLength(0); // the notice went stale too, with no notice of its own
    const all = (JSON.parse(readFileSync(file, 'utf8')) as { items: { key: string }[] }).items;
    expect(all.filter((item) => item.key.startsWith('vencido:'))).toHaveLength(1);
  });
});
