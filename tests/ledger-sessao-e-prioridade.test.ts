import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createSystemConfigIoDeps } from '../src/main/config-store';
import { createLedgerService, nodeLedgerProofFs, runLedgerTool, type LedgerCaller } from '../src/main/ledger-store';
import { parseLedgerToolCall, type LedgerToolCall } from '../src/shared/ledger/tools';

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
