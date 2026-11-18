// t-5839d76b — the vigia filed its lock cards on the projects' folder ("C:\Users\compu\seazone"), which is nobody's
// board: nobody saw them, and not even the Líder único could cancel them. What breaks without the owner noticing: a
// card born on a board that does not exist (or on a different board each round), and a task nobody can close.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createSystemConfigIoDeps } from '../src/main/config-store';
import { createLedgerService, leaderCallerOffBoard, nodeLedgerProofFs, runLedgerTool } from '../src/main/ledger-store';
import { isCancelled } from '../src/shared/ledger/contract';
import { addPlace, emptyMindscapeDoc, type MindscapeDoc } from '../src/shared/mindscape/model';
import { LEADER_OF_ALL } from '../src/shared/mindscape/leader';
import { LEADER_ROLE_ID } from '../src/shared/roles';
import { vigiaBoardOf } from '../src/shared/vigia/board';
import { detectTravas, type PlaceProbe } from '../src/shared/vigia/travas';
import type { RemoteHealthReport } from '../src/shared/health/remote';
import type { RemoteSessionReading } from '../src/shared/health/remoteSessions';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function boards(spec: Record<string, { leader?: 'dono' | 'sessao'; places: number }>): MindscapeDoc['boards'] {
  let doc = emptyMindscapeDoc();
  for (const [folder, { leader, places }] of Object.entries(spec)) {
    if (leader) doc = addPlace(doc, folder, { id: `place:lider-${folder}`, roleId: LEADER_ROLE_ID, ...(leader === 'sessao' ? { by: 'session' as const } : {}) });
    for (let i = 0; i < places; i += 1) doc = addPlace(doc, folder, { id: `place:dev-${folder}-${i}`, roleId: 'dev' });
  }
  return doc.boards;
}

describe('quadro das cartas do vigia', () => {
  it('a config, se for um quadro; senão o de Líder posto pelo dono com mais lugares, desempatado pelo nome; nenhum = sem carta', () => {
    const b = boards({ 'C:/s/Beta': { leader: 'dono', places: 3 }, 'C:/s/Alfa': { leader: 'dono', places: 3 }, 'C:/s/Vega': { leader: 'sessao', places: 9 }, 'C:/s/Atlas': { places: 12 } });
    expect(vigiaBoardOf(b, 'C:/s/Vega')).toBe('C:/s/Vega');
    // the projects' folder is no board: it is never chosen, configured or not
    expect(vigiaBoardOf(b, 'C:/s')).toBe('C:/s/Alfa');
    expect(vigiaBoardOf(b, null)).toBe('C:/s/Alfa');
    // the same answer whatever the order the boards were made in
    const reversed = Object.fromEntries(Object.entries(b).reverse());
    expect(vigiaBoardOf(reversed, null)).toBe('C:/s/Alfa');
    expect(vigiaBoardOf(boards({ 'C:/s/Beta': { leader: 'dono', places: 5 }, 'C:/s/Alfa': { leader: 'dono', places: 2 } }), null)).toBe('C:/s/Beta');
    expect(vigiaBoardOf(boards({ 'C:/s/Atlas': { places: 4 }, 'C:/s/Vega': { leader: 'sessao', places: 1 } }), null)).toBeNull();
  });

  it('a carta das sessões em laço diz o quadro de cada uma, já que sai num só', () => {
    const MIN = 60_000;
    const NOW = 1_800_000_000_000;
    const stuck = (sid: string): RemoteSessionReading =>
      ({ sid, name: sid, rssBytes: 1, cpuTicks: 1, clkTck: 100, pane: 'login', paneActivityAt: NOW - 15 * MIN, transcript: true, lastAt: NOW - 15 * MIN, turn: 'ended', last: 'reply' }) as unknown as RemoteSessionReading;
    const report = { id: 'vps', label: 'VPS', status: 'ok', checkedAt: NOW, lastOkAt: NOW, severity: 'ok', reading: { readAt: NOW, sessionDetails: [stuck('a'), stuck('b'), stuck('c')] } } as unknown as RemoteHealthReport;
    const probe: PlaceProbe = { placeId: 'vps', label: 'VPS', reached: true };
    const [trava] = detectTravas({ probes: [probe], reports: [report], now: NOW, boardOfSession: (sid) => ({ a: 'Donel Dev', b: 'BizOps', c: 'Donel Dev' })[sid] });
    expect(trava?.detail).toContain('(quadros BizOps, Donel Dev)');
    expect(trava?.key).toBe('sessoes:vps');
  });
});

describe('Líder único em tarefa de quadro que não existe', () => {
  it('cancela a tarefa presa na pasta dos projetos; criar e listar seguem pedindo um quadro', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'vigia-quadro-'));
    dirs.push(dir);
    const ledger = createLedgerService({ filePath: join(dir, 'ledger.json'), io: createSystemConfigIoDeps(), proofFs: nodeLedgerProofFs, now: () => 1_800_000_000_000 });
    const vigia = { kind: 'lugar', placeId: 'servico:vigia', roleId: 'servico' } as const;
    const made = await ledger.apply(vigia, { op: 'criar', projectPath: 'C:\\Users\\compu\\seazone', title: 'Trava: VPS fora do ar', request: 'aviso', doneWhen: 'x', due: '2026-11-20', ownerPlaceId: 'servico:vigia', risk: 'alto' });
    if (!made.ok) throw new Error(made.reason);
    const base = { placeId: LEADER_OF_ALL, roleId: LEADER_ROLE_ID };
    expect(leaderCallerOffBoard(base, made.task.projectPath, 'tarefa_criar')).toBeNull();
    const caller = leaderCallerOffBoard(base, made.task.projectPath, 'tarefa_cancelar')!;
    const result = await runLedgerTool(ledger, caller, { tool: 'tarefa_cancelar', id: made.task.id, motivo: 'alerta de trava que já passou' });
    expect(result.ok).toBe(true);
    expect(isCancelled((await ledger.load()).doc.tasks[made.task.id]!)).toBe(true);
  });
});
