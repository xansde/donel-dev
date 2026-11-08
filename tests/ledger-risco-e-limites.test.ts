// Achados da revisão do BizOps (08/11) nas ferramentas do Oráculo: um motivo longo virava "motivo é obrigatório", um
// pedido longo era recusado sem o tamanho, e o risco baixo nunca valia na cadeia do Líder nem mudava ao transferir.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createSystemConfigIoDeps } from '../src/main/config-store';
import { createLedgerService, nodeLedgerProofFs, runLedgerTool, type LedgerCaller } from '../src/main/ledger-store';
import { MAX_REQUEST_CHARS } from '../src/shared/ledger/contract';
import { parseLedgerToolCall, type LedgerToolCall } from '../src/shared/ledger/tools';
import type { MindscapeBoard } from '../src/shared/mindscape/model';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function service(): ReturnType<typeof createLedgerService> {
  const dir = mkdtempSync(join(tmpdir(), 'ledger-risco-'));
  dirs.push(dir);
  let clock = Date.UTC(2026, 10, 8, 12);
  return createLedgerService({ filePath: join(dir, 'ledger.json'), io: createSystemConfigIoDeps(), proofFs: nodeLedgerProofFs, now: () => (clock += 60_000) });
}

function call(name: string, args: unknown): LedgerToolCall {
  const parsed = parseLedgerToolCall(name, args);
  if (!parsed.ok) throw new Error(parsed.reason);
  return parsed.call;
}

const places = ['place:lider', 'place:dev', 'place:revisor', 'place:rev-do-dev'];
const opened = (from: string, to: string) => ({ id: `${from}>${to}`, from, to, arrow: true, by: 'session' as const, opened: true as const });
const board: MindscapeBoard = {
  projectPath: 'C:/p',
  pan: { x: 0, y: 0 },
  zoom: 1,
  cards: {},
  links: [opened('place:lider', 'place:dev'), opened('place:lider', 'place:revisor'), opened('place:dev', 'place:rev-do-dev')],
  drawings: [],
};
const at = (placeId: string, roleId: string, withBoard = true): LedgerCaller => ({ projectPath: 'C:/p', placeId, roleId, boardPlaceIds: places, ...(withBoard ? { board } : {}) });
const task = (owner: string, risco: 'baixo' | 'alto') => call('tarefa_criar', { pedido: 'x', criterio: 'y', prazo: '2026-11-09', dono: owner, risco });
const created = (text: string) => JSON.parse(text) as { id: string; risco?: string; aviso?: string };

describe('limites com o tamanho', () => {
  it('a reason over the limit says the size and the limit, never "obrigatório"', () => {
    const long = 'a'.repeat(MAX_REQUEST_CHARS + 120);
    for (const tool of ['tarefa_rejeitar', 'tarefa_cancelar']) {
      const parsed = parseLedgerToolCall(tool, { id: 't-1', motivo: long });
      expect(parsed).toMatchObject({ ok: false });
      if (!parsed.ok) {
        expect(parsed.reason).not.toContain('obrigatório');
        expect(parsed.reason).toContain(`${MAX_REQUEST_CHARS + 120}`);
        expect(parsed.reason).toContain(`${MAX_REQUEST_CHARS}`);
      }
    }
    const transfer = parseLedgerToolCall('tarefa_transferir', { id: 't-1', para: 'place:dev', motivo: long });
    expect(transfer.ok ? '' : transfer.reason).toContain(`${MAX_REQUEST_CHARS + 120}`);
  });

  it('a request over the limit says how long it was', () => {
    const parsed = parseLedgerToolCall('tarefa_criar', { pedido: 'é'.repeat(MAX_REQUEST_CHARS + 1), criterio: 'y', prazo: '2026-11-09', risco: 'alto' });
    expect(parsed.ok ? '' : parsed.reason).toMatch(new RegExp(`${MAX_REQUEST_CHARS + 1}.*${MAX_REQUEST_CHARS}`));
  });
});

describe('risco baixo: o Líder reparte, não executa', () => {
  it('the Líder creates low for a place it opened, even when the board file could not be read', async () => {
    const ledger = service();
    const answer = await runLedgerTool(ledger, at('place:lider', 'lider', false), task('place:dev', 'baixo'));
    expect(answer.ok).toBe(true);
    expect(created(answer.text).aviso).toBeUndefined();
    expect(ledger.load().doc.tasks[created(answer.text).id]!.risk).toBe('baixo');
  });

  it('whoever was opened by the owner of the work still cannot ask for low', async () => {
    const ledger = service();
    const answer = await runLedgerTool(ledger, at('place:rev-do-dev', 'revisor'), task('place:dev', 'baixo'));
    expect(created(answer.text)).toMatchObject({ risco: 'alto' });
  });

  it('a transfer recalculates: into the creator\'s own chain it goes high, out of it a low that was forced high comes back', async () => {
    const ledger = service();
    const lider = at('place:lider', 'lider');
    // Low, then passed to the creator itself: the creator would do its own work.
    const low = created((await runLedgerTool(ledger, lider, task('place:dev', 'baixo'))).text).id;
    const toSelf = await runLedgerTool(ledger, lider, call('tarefa_transferir', { id: low, para: 'place:lider', motivo: 'eu faço' }));
    expect(toSelf.ok).toBe(true);
    expect(ledger.load().doc.tasks[low]!.risk).toBe('alto');
    // Asked low, forced high (the Dev's own Revisor for the Dev); the Líder passes it out of that chain.
    const forced = created((await runLedgerTool(ledger, at('place:rev-do-dev', 'revisor'), task('place:dev', 'baixo'))).text).id;
    expect(ledger.load().doc.tasks[forced]!.risk).toBe('alto');
    const out = await runLedgerTool(ledger, lider, call('tarefa_transferir', { id: forced, para: 'place:revisor', motivo: 'outro faz' }));
    expect(out.ok).toBe(true);
    expect(ledger.load().doc.tasks[forced]!.risk).toBe('baixo');
    // A task asked high stays high wherever it goes.
    const high = created((await runLedgerTool(ledger, lider, task('place:dev', 'alto'))).text).id;
    await runLedgerTool(ledger, lider, call('tarefa_transferir', { id: high, para: 'place:revisor', motivo: 'outro faz' }));
    expect(ledger.load().doc.tasks[high]!.risk).toBe('alto');
  });
});
