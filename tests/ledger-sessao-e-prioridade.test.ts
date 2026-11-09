import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createSystemConfigIoDeps } from '../src/main/config-store';
import { createLedgerService, nodeLedgerProofFs, prioritizeAsks, runLedgerTool, type LedgerCaller } from '../src/main/ledger-store';
import { parseLedgerToolCall, type LedgerToolCall } from '../src/shared/ledger/tools';
import { parseLedgerDoc, priorityOf } from '../src/shared/ledger/contract';
import { priorityWrites } from '../src/shared/ledger/prioridade';
import { jobuProgress, movedFrontOrder, movedOrder } from '../src/shared/pet/progress';
import * as v4 from './fixtures/ledger/contract-v4';

// t-5c0df1df (dono, 09/11: "Mantenha o status de cada tarefa e uma coluna indicando um identificador da tarefa. Assim
// poderá botar um watchdog verificando se aquelas sessões estão acordadas ou não."). What breaks without the owner
// seeing it: a task whose session nobody can find (the watchdog and the Líder look at the wrong conversation).

const dirs: string[] = [];
const files = new WeakMap<object, string>();
const file = (s: object): string => files.get(s)!;
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function service(): ReturnType<typeof createLedgerService> {
  const dir = mkdtempSync(join(tmpdir(), 'ledger-sessao-'));
  dirs.push(dir);
  let clock = Date.UTC(2026, 10, 9, 12);
  const filePath = join(dir, 'ledger.json');
  const created = createLedgerService({ filePath, io: createSystemConfigIoDeps(), proofFs: nodeLedgerProofFs, now: () => (clock += 60_000) });
  files.set(created, filePath);
  return created;
}

function call(name: string, args: unknown): LedgerToolCall {
  const parsed = parseLedgerToolCall(name, args);
  if (!parsed.ok) throw new Error(parsed.reason);
  return parsed.call;
}

const BOARD = 'C:/proj/atlas';
const PLACES = ['place:lider', 'place:dev', 'place:novo'];
/** The conversation of the moment of each place, as the board has it; `place:novo` has not started yet. */
const SESSIONS: Record<string, string> = { 'place:lider': 'conv-lider', 'place:dev': 'conv-dev' };
const at = (placeId: string, roleId: string): LedgerCaller => ({
  projectPath: BOARD,
  placeId,
  roleId,
  boardPlaceIds: PLACES,
  sessionOf: (projectPath, id) => (projectPath === BOARD ? SESSIONS[id] : undefined),
});

async function create(s: ReturnType<typeof createLedgerService>, dono: string, titulo: string): Promise<string> {
  const created = await runLedgerTool(s, at('place:lider', 'lider'), call('tarefa_criar', { pedido: titulo, criterio: 'teste verde', prazo: '2026-11-10', dono, risco: 'baixo', titulo }));
  return (JSON.parse(created.text) as { id: string }).id;
}

describe('cada tarefa mostra a sessão que a executa', () => {
  it('tarefa_listar e tarefa_ver dão a conversa do lugar dono; sem conversa ainda, nada', async () => {
    const s = service();
    const running = await create(s, 'place:dev', 'Parte do Dev');
    const waiting = await create(s, 'place:novo', 'Parte do novo');
    await runLedgerTool(s, at('place:dev', 'dev'), call('tarefa_assumir', { id: running }));

    const listed = JSON.parse((await runLedgerTool(s, at('place:lider', 'lider'), call('tarefa_listar', {}))).text) as { tarefas: { id: string; dono: string; sessao?: string }[] };
    expect(listed.tarefas.find((task) => task.id === running)).toMatchObject({ dono: 'place:dev', sessao: 'conv-dev' });
    expect(listed.tarefas.find((task) => task.id === waiting)).not.toHaveProperty('sessao');

    const seen = JSON.parse((await runLedgerTool(s, at('place:dev', 'dev'), call('tarefa_ver', { id: running }))).text) as { sessao?: string };
    expect(seen.sessao).toBe('conv-dev');
  });
});

// t-5c0df1df, item 3 (dono: "o líder de cada board busca novas demandas lá, de acordo com a prioridade dada"). The
// owner orders his asks in "Seus pedidos"; the Líder of the board reads the next one by that order. What breaks
// without him seeing it: an order that an Alfa v4 open beside erases, or a Líder reading another order.

describe('prioridade do dono, lida pelo Líder do quadro', () => {
  it('o dono ordena; tarefa_listar põe as abertas na ordem dele com a posição; o último vale; um Alfa v4 não apaga', async () => {
    const s = service();
    const a = await create(s, 'place:dev', 'A');
    const b = await create(s, 'place:dev', 'B');
    const c = await create(s, 'place:novo', 'C');
    const taken = await create(s, 'place:dev', 'Já assumida');
    await runLedgerTool(s, at('place:dev', 'dev'), call('tarefa_assumir', { id: taken }));

    const order = async (ids: string[]): Promise<void> => {
      expect(await prioritizeAsks(s, ids)).toMatchObject({ ok: true });
    };
    const queue = async (): Promise<{ id: string; posicao?: number }[]> =>
      (JSON.parse((await runLedgerTool(s, at('place:lider', 'lider'), call('tarefa_listar', {}))).text) as { tarefas: { id: string; posicao?: number }[] }).tarefas;

    // Nobody ordered yet: the open ones oldest first, each with its place in the queue.
    expect((await queue()).map((task) => [task.id, task.posicao])).toEqual([[a, 1], [b, 2], [c, 3], [taken, undefined]]);

    await order([c, a, b, taken]);
    expect((await queue()).map((task) => [task.id, task.posicao])).toEqual([[c, 1], [a, 2], [b, 3], [taken, undefined]]);

    // Moving one again writes only what changed, and the last write wins.
    expect(priorityWrites(s.load().doc, [c, b, a, taken])).toEqual([{ id: b, posicao: 2 }, { id: a, posicao: 3 }]);
    await order([c, b, a, taken]);
    expect((await queue()).map((task) => task.id)).toEqual([c, b, a, taken]);

    // Only the owner orders.
    expect(await s.apply({ kind: 'lugar', placeId: 'place:lider', roleId: 'lider' }, { op: 'priorizar', id: a, posicao: 1 })).toMatchObject({ ok: false });

    // An Alfa v4 open beside reads and rewrites the file: the order stays.
    const raw = JSON.parse(readFileSync(file(s), 'utf8')) as unknown;
    const rewritten = parseLedgerDoc(JSON.parse(JSON.stringify(v4.parseLedgerDoc(raw))) as unknown);
    expect([a, b, c].map((id) => priorityOf(rewritten.tasks[id]!))).toEqual([3, 2, 1]);
  });

  it('subir e descer em "Seus pedidos" grava a ordem que o dono vê, e ela sobrevive à releitura', async () => {
    const s = service();
    const ids: string[] = [];
    for (const titulo of ['Um', 'Dois', 'Três']) {
      const created = await runLedgerTool(s, at('place:lider', 'lider'), call('tarefa_criar', { pedido: titulo, criterio: 'ok', prazo: '2026-11-10', dono: 'place:dev', risco: 'baixo', titulo, quemPediu: 'dono', frente: 'Ledger' }));
      ids.push((JSON.parse(created.text) as { id: string }).id);
    }
    const shown = (): string[] => jobuProgress(s.load().doc, Date.UTC(2026, 10, 9, 13)).fronts[0]!.tasks.map((task) => task.title);
    const [first, second, third] = shown() as [string, string, string]; // nobody ordered yet: by state, deadline, id

    const move = async (title: string, direction: 'subir' | 'descer'): Promise<void> => {
      const progress = jobuProgress(s.load().doc, Date.UTC(2026, 10, 9, 13));
      const id = progress.fronts[0]!.tasks.find((task) => task.title === title)!.id;
      expect(await prioritizeAsks(s, movedOrder(progress, id, direction)!)).toMatchObject({ ok: true });
    };
    await move(third, 'subir');
    expect(shown()).toEqual([first, third, second]);
    await move(first, 'descer');
    expect(shown()).toEqual([third, first, second]);
    const last = jobuProgress(s.load().doc, Date.UTC(2026, 10, 9, 13)).fronts[0]!.tasks.at(-1)!;
    expect(movedOrder(jobuProgress(s.load().doc, Date.UTC(2026, 10, 9, 13)), last.id, 'descer')).toBeNull();
    expect(ids).toContain(last.id);
  });

  it('reordenar não leva o andamento da sessão para a tarefa que o dono mexeu', async () => {
    const s = service();
    const x = await create(s, 'place:dev', 'X');
    const y = await create(s, 'place:dev', 'Y');
    await runLedgerTool(s, at('place:dev', 'dev'), call('tarefa_assumir', { id: x }));
    await runLedgerTool(s, at('place:dev', 'dev'), call('tarefa_andamento', { id: x, estado: 'trabalhando' }));
    await prioritizeAsks(s, [y]); // only Y gets a mark, after X's last record
    const recorded = JSON.parse((await runLedgerTool(s, at('place:dev', 'dev'), call('tarefa_andamento', { estado: 'esperando' }))).text) as { id: string };
    expect(recorded.id).toBe(x);
  });

  it('uma ordem só: o painel de cima para baixo é a fila do quadro, mesmo com duas frentes, e o dono move a frente inteira', async () => {
    const s = service();
    const ask = async (titulo: string, frente: string): Promise<string> => {
      const created = await runLedgerTool(s, at('place:lider', 'lider'), call('tarefa_criar', { pedido: titulo, criterio: 'ok', prazo: '2026-11-10', dono: 'place:dev', risco: 'baixo', titulo, quemPediu: 'dono', frente }));
      return (JSON.parse(created.text) as { id: string }).id;
    };
    await ask('A1', 'Alfa');
    await ask('B1', 'Beta');
    await ask('A2', 'Alfa');
    const now = Date.UTC(2026, 10, 9, 13);
    const panel = (): string[] => jobuProgress(s.load().doc, now).fronts.flatMap((front) => front.tasks.map((task) => task.title));
    const queue = async (): Promise<string[]> =>
      (JSON.parse((await runLedgerTool(s, at('place:lider', 'lider'), call('tarefa_listar', {}))).text) as { tarefas: { titulo: string; posicao?: number }[] }).tarefas
        .filter((task) => task.posicao !== undefined)
        .map((task) => task.titulo);

    // The first move fixes the whole list as the owner sees it; from then on the Líder's queue is the panel, top down.
    const first = jobuProgress(s.load().doc, now);
    await prioritizeAsks(s, movedOrder(first, first.fronts[0]!.tasks.at(-1)!.id, 'subir')!);
    expect(await queue()).toEqual(panel());

    // Moving a front moves all its asks: the other front's first ask becomes position 1 of the board.
    const before = jobuProgress(s.load().doc, now);
    const second = before.fronts[1]!;
    await prioritizeAsks(s, movedFrontOrder(before, second.name, 'subir')!);
    expect(panel().slice(0, second.tasks.length)).toEqual(second.tasks.map((task) => task.title));
    expect(await queue()).toEqual(panel());
    expect(movedFrontOrder(jobuProgress(s.load().doc, now), second.name, 'subir')).toBeNull();
  });
});
