import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createSystemConfigIoDeps } from '../src/main/config-store';
import { createLedgerService, nodeLedgerProofFs, runLedgerTool, type LedgerCaller } from '../src/main/ledger-store';
import { parseLedgerToolCall, type LedgerToolCall } from '../src/shared/ledger/tools';
import { ledgerSessionsOfDoc, liveSessionOf } from '../src/shared/ledger/mirror';
import { sessionCell } from '../src/shared/ledger/table';

// t-5c0df1df (dono, 09/11: "Mantenha o status de cada tarefa e uma coluna indicando um identificador da tarefa. Assim
// poderá botar um watchdog verificando se aquelas sessões estão acordadas ou não."). What breaks without the owner
// seeing it: a task whose session nobody can find (the watchdog and the Líder look at the wrong conversation).

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function service(): ReturnType<typeof createLedgerService> {
  const dir = mkdtempSync(join(tmpdir(), 'ledger-sessao-'));
  dirs.push(dir);
  let clock = Date.UTC(2026, 10, 9, 12);
  return createLedgerService({ filePath: join(dir, 'ledger.json'), io: createSystemConfigIoDeps(), proofFs: nodeLedgerProofFs, now: () => (clock += 60_000) });
}

function call(name: string, args: unknown): LedgerToolCall {
  const parsed = parseLedgerToolCall(name, args);
  if (!parsed.ok) throw new Error(parsed.reason);
  return parsed.call;
}

const BOARD = 'C:/proj/atlas';
const PLACES = ['place:lider', 'place:dev', 'place:novo', 'place:rev'];
/** The conversation of the moment of each place, as the board has it; `place:novo` has not started yet. */
const SESSIONS: Record<string, string> = { 'place:lider': 'conv-lider', 'place:dev': 'conv-dev', 'place:rev': 'conv-rev' };
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

// Item (1), a coluna (Líder único, 09/11: "a coluna visível entra"): the table of the Oráculo reads the same session of
// each task as the tools, from one map built in the main; a closed task (accepted, cancelled) has none.
describe('a coluna Sessão da tabela do Oráculo', () => {
  it('o mapa dá a conversa do lugar dono de cada tarefa viva; aceita e cancelada ficam de fora', async () => {
    const s = service();
    const running = await create(s, 'place:dev', 'Parte do Dev');
    const waiting = await create(s, 'place:novo', 'Parte do novo');
    const done = await create(s, 'place:rev', 'Já aceita');
    const dropped = await create(s, 'place:rev', 'Cancelada');
    await runLedgerTool(s, at('place:lider', 'lider'), call('tarefa_cancelar', { id: dropped, motivo: 'não vai sair' }));
    const doc = s.load().doc;
    const accepted = { ...doc, tasks: { ...doc.tasks, [done]: { ...doc.tasks[done]!, state: 'aceita' as const } } };

    const map = ledgerSessionsOfDoc(accepted, (projectPath, id) => (projectPath === BOARD ? SESSIONS[id] : undefined));
    expect(map).toEqual({ [BOARD]: { 'place:dev': 'conv-dev' } });
    expect(liveSessionOf(accepted.tasks[running]!, (_p, id) => SESSIONS[id])).toBe('conv-dev');
    expect(liveSessionOf(accepted.tasks[waiting]!, (_p, id) => SESSIONS[id])).toBeUndefined();
    expect(liveSessionOf(accepted.tasks[done]!, (_p, id) => SESSIONS[id])).toBeUndefined();
    expect(sessionCell(accepted.tasks[running]!, map)).toEqual({ text: 'conv-dev', full: 'conv-dev' });
    expect(sessionCell(accepted.tasks[done]!, map)).toEqual({ text: '—', full: '' });
  });
});
