import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createSystemConfigIoDeps } from '../src/main/config-store';
import { createLedgerService, ledgerProofsDir, nodeLedgerProofFs, runLedgerTool, type LedgerCaller, type LedgerProofFs } from '../src/main/ledger-store';
import type { MindscapeBoard } from '../src/shared/mindscape/model';
import { findCode, LEDGER_SCHEMA_VERSION } from '../src/shared/ledger/contract';
import { parseLedgerToolCall, type LedgerToolCall } from '../src/shared/ledger/tools';

// Ledger com prova (item 19) — persisted data a channel could erase, and the two rules that live in code:
// no delivery without proof, and whoever delivered never accepts. Through the MCP port, round trip on disk.

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function setup(proofFs: LedgerProofFs = nodeLedgerProofFs): { file: string; dir: string; service: () => ReturnType<typeof createLedgerService> } {
  const dir = mkdtempSync(join(tmpdir(), 'ledger-'));
  dirs.push(dir);
  const file = join(dir, 'ledger.json');
  let clock = Date.UTC(2026, 10, 5, 12);
  // One service, as in the main: what a session saw with tarefa_ver lives in it.
  const service = createLedgerService({ filePath: file, io: createSystemConfigIoDeps(), proofFs, now: () => (clock += 60_000) });
  return { file, dir, service: () => service };
}

function call(name: string, args: unknown): LedgerToolCall {
  const parsed = parseLedgerToolCall(name, args);
  if (!parsed.ok) throw new Error(parsed.reason);
  return parsed.call;
}

const board = ['place:lider', 'place:dev', 'place:revisor', 'place:rev-do-dev'];
// The Líder opened the Dev and the Revisor; the Dev opened its own Revisor.
const opened = (from: string, to: string) => ({ id: `${from}>${to}`, from, to, arrow: true, by: 'session' as const, opened: true as const });
const mindscape: MindscapeBoard = {
  projectPath: 'C:/p',
  pan: { x: 0, y: 0 },
  zoom: 1,
  cards: {},
  links: [opened('place:lider', 'place:dev'), opened('place:lider', 'place:revisor'), opened('place:dev', 'place:rev-do-dev')],
  drawings: [],
};
const at = (placeId: string, roleId: string): LedgerCaller => ({ projectPath: 'C:/p', placeId, roleId, boardPlaceIds: board, board: mindscape });
const lider = at('place:lider', 'lider');
const dev = at('place:dev', 'dev');
const revisor = at('place:revisor', 'revisor');
const revisorDoDev = at('place:rev-do-dev', 'revisor');
const revisorDeOutroQuadro: LedgerCaller = { projectPath: 'C:/outro', placeId: 'place:rev-x', roleId: 'revisor', boardPlaceIds: ['place:rev-x'], board: { ...mindscape, projectPath: 'C:/outro', links: [] } };

describe('ledger com prova', () => {
  it('creates, refuses a delivery without proof, copies the proof in, refuses the self-accept and takes the Revisor accept', async () => {
    const { file, dir, service } = setup();
    const created = await runLedgerTool(service(), lider, call('tarefa_criar', { pedido: 'Põe o botão verde', criterio: 'print do botão', prazo: '2026-11-06', dono: 'place:dev', risco: 'baixo' }));
    expect(created.ok).toBe(true);
    const id = (JSON.parse(created.text) as { id: string }).id;
    expect((await runLedgerTool(service(), dev, call('tarefa_assumir', { id }))).ok).toBe(true);

    // No proof: refused by the tool and, below it, by the contract.
    expect(parseLedgerToolCall('tarefa_entregar', { id, provas: [] }).ok).toBe(false);
    expect(service().apply({ kind: 'lugar', placeId: 'place:dev' }, { op: 'entregar', id, proofs: [] })).toMatchObject({ ok: false });

    mkdirSync(join(dir, 'fora'));
    const print = join(dir, 'fora', 'print.png');
    writeFileSync(print, 'png-bytes');
    const delivered = await runLedgerTool(service(), dev, call('tarefa_entregar', { id, provas: [{ tipo: 'arquivo', caminho: print }, { tipo: 'link', url: 'https://ci.example/run/1' }] }));
    expect(delivered.ok).toBe(true);

    expect(await runLedgerTool(service(), dev, call('tarefa_aceitar', { id }))).toMatchObject({ ok: false });
    // The Revisor reads the proof before deciding; one of another board, or in the Dev's chain, never decides.
    expect((await runLedgerTool(service(), revisor, call('tarefa_aceitar', { id }))).text).toContain('tarefa_ver');
    for (const [outsider, why] of [[revisorDeOutroQuadro, 'outro quadro'], [revisorDoDev, 'cadeia']] as const) {
      await runLedgerTool(service(), outsider, call('tarefa_ver', { id }));
      expect(await runLedgerTool(service(), outsider, call('tarefa_aceitar', { id }))).toMatchObject({ ok: false, text: expect.stringContaining(why) });
    }
    const seen = await runLedgerTool(service(), revisor, call('tarefa_ver', { id }));
    expect(seen.text).toContain('https://ci.example/run/1');
    expect(seen.image?.base64).toBe(Buffer.from('png-bytes').toString('base64'));
    expect(await runLedgerTool(service(), revisor, call('tarefa_aceitar', { id }))).toMatchObject({ ok: true });

    // Round trip on disk: a fresh service reads what the first one wrote.
    const task = service().load().doc.tasks[id]!;
    expect(task.state).toBe('aceita');
    expect(task.request).toBe('Põe o botão verde');
    expect(task.events.map((event) => event.kind)).toEqual(['criada', 'assumida', 'entregue', 'aceita']);
    expect(task.events[3]!.by).toEqual({ kind: 'lugar', placeId: 'place:revisor', roleId: 'revisor' });
    const proof = task.events[2]!.proofs![0]!;
    expect(proof.kind).toBe('arquivo');
    if (proof.kind !== 'arquivo') return;
    expect(proof.file).not.toContain('/');
    expect(readFileSync(join(ledgerProofsDir(file), proof.file), 'utf8')).toBe('png-bytes');
  });

  it('low risk waits for the owner when whoever creates is the owner of the work or was opened by it', async () => {
    const { service } = setup();
    for (const [who, owner] of [[dev, undefined], [revisorDoDev, 'place:dev']] as const) {
      const created = await runLedgerTool(service(), who, call('tarefa_criar', { pedido: 'x', criterio: 'y', prazo: '2026-11-06', risco: 'baixo', ...(owner ? { dono: owner } : {}) }));
      const id = (JSON.parse(created.text) as { id: string }).id;
      expect(service().load().doc.tasks[id]!.risk).toBe('alto');
    }
  });

  it('refuses a proof file that is a symbolic link', async () => {
    const { dir, service } = setup({ ...nodeLedgerProofFs, lstat: async () => ({ isSymbolicLink: () => true }) });
    const created = await runLedgerTool(service(), lider, call('tarefa_criar', { pedido: 'x', criterio: 'y', prazo: '2026-11-06', dono: 'place:dev', risco: 'alto' }));
    const id = (JSON.parse(created.text) as { id: string }).id;
    await runLedgerTool(service(), dev, call('tarefa_assumir', { id }));
    const link = join(dir, 'segredo.png');
    writeFileSync(link, 'x');
    expect(await runLedgerTool(service(), dev, call('tarefa_entregar', { id, provas: [{ tipo: 'arquivo', caminho: link }] }))).toMatchObject({ ok: false, text: expect.stringContaining('link simbólico') });
    expect(existsSync(ledgerProofsDir(join(dir, 'ledger.json')))).toBe(false);
  });

  it('opens a v2 ledger without losing anything and writes it back as v3', async () => {
    const { file, service } = setup();
    const v2 = {
      schemaVersion: 2,
      startedAt: 1,
      tasks: {
        't-0000aaaa': {
          projectPath: 'C:/p', request: 'Põe o botão verde', doneWhen: 'print', due: '2026-11-06', ownerPlaceId: 'place:dev', risk: 'alto', state: 'aceita', createdAt: 1,
          events: [
            { kind: 'criada', at: 1, by: { kind: 'lugar', placeId: 'place:lider' } },
            { kind: 'assumida', at: 2, by: { kind: 'lugar', placeId: 'place:dev', roleId: 'dev' } },
            { kind: 'entregue', at: 3, by: { kind: 'lugar', placeId: 'place:dev', roleId: 'dev' }, proofs: [{ kind: 'texto', text: '4 passed' }], text: 'feito' },
            { kind: 'aceita', at: 4, by: { kind: 'dono' }, requestId: 'pedido-12345678' },
          ],
        },
      },
    };
    writeFileSync(file, JSON.stringify(v2));
    const task = { ...v2.tasks['t-0000aaaa'], id: 't-0000aaaa' };
    expect(service().load()).toEqual({ doc: { ...v2, schemaVersion: LEDGER_SCHEMA_VERSION, tasks: { 't-0000aaaa': task } }, readOnly: false });
    await runLedgerTool(service(), lider, call('tarefa_criar', { pedido: 'x', criterio: 'y', prazo: '2026-11-06', risco: 'alto', titulo: 'Outra tarefa' }));
    const written = JSON.parse(readFileSync(file, 'utf8')) as { schemaVersion: number; tasks: Record<string, unknown> };
    expect(written.schemaVersion).toBe(3);
    expect(written.tasks['t-0000aaaa']).toEqual(task);
  });

  it('finds code in the owner text, and not in plain Portuguese with numbers', () => {
    for (const code of ['t-1b6c1a95', 'place:4fd365dd-77', '2a98f2f', 'PR #105', 'o #12', '/pull/7', 'feat/homologacao-v1', 'src/main/x.ts', 'C:\\Users\\x', '`npm test`', 'https://github.com/x'])
      expect(findCode(`Veja ${code} aqui`), code).not.toBeNull();
    for (const plain of ['Faltam 44 h', '5 de 5 checagens passaram', 'Até 07/11.', 'Aceito a fase 2 e/ou a 3?', 'A VPS já tem os acessos.']) expect(findCode(plain), plain).toBeNull();
  });

  it('refuses a high-risk delivery without the owner block or with code in it, and records the option the owner picks', async () => {
    const { dir, service } = setup();
    const created = await runLedgerTool(service(), lider, call('tarefa_criar', { pedido: 'Põe o botão verde', criterio: 'print do botão', prazo: '2026-11-06', dono: 'place:dev', risco: 'alto' }));
    const id = (JSON.parse(created.text) as { id: string }).id;
    await runLedgerTool(service(), dev, call('tarefa_assumir', { id }));
    const print = join(dir, 'print.png');
    writeFileSync(print, 'png-bytes');
    const paraODono = {
      pergunta: 'O botão ficou verde. Aceito assim?',
      resumo: 'Troquei a cor do botão de salvar; o resto da tela não mudou.',
      opcoes: [
        { rotulo: 'Aceitar', efeito: 'O botão verde vai para o alfa hoje.', fecha: 'aceita', recomendada: true },
        { rotulo: 'Voltar ao azul', efeito: 'Desfaço a troca.', risco: 'O pedido fica sem atender.', fecha: 'rejeitada' },
      ],
      porque: 'É exatamente o que você pediu e o print mostra.',
      risco: 'Baixo: só cor.',
      visual: { prova: 1 },
    };
    const deliver = (block?: unknown) => runLedgerTool(service(), dev, call('tarefa_entregar', { id, provas: [{ tipo: 'arquivo', caminho: print }], ...(block ? { paraODono: block } : {}) }));
    expect(await deliver()).toMatchObject({ ok: false, text: expect.stringContaining('paraODono') });
    expect(await deliver({ ...paraODono, pergunta: `Aceito a ${id}?` })).toMatchObject({ ok: false, text: expect.stringContaining('Escreva para um humano') });
    expect(service().load().doc.tasks[id]!.state).toBe('em-execucao');

    expect(await deliver(paraODono)).toMatchObject({ ok: true });
    expect(JSON.parse((await runLedgerTool(service(), revisor, call('tarefa_ver', { id }))).text).entrega.paraODono).toMatchObject({ pergunta: paraODono.pergunta, visual: { prova: 1 } });
    // The option must exist and close the way the owner's decision does; a rejecting option is its own reason.
    expect(service().apply({ kind: 'dono' }, { op: 'aceitar', id, option: 'Voltar ao azul' })).toMatchObject({ ok: false });
    expect(service().apply({ kind: 'dono' }, { op: 'rejeitar', id, reason: '', option: 'Voltar ao azul' })).toMatchObject({ ok: true });
    expect(service().load().doc.tasks[id]!.events.at(-1)).toMatchObject({ kind: 'rejeitada', option: 'Voltar ao azul', text: 'Voltar ao azul' });
  });

  it('reads a ledger written by a newer channel and never writes over it', async () => {
    const { file, service } = setup();
    const newer = JSON.stringify({ schemaVersion: LEDGER_SCHEMA_VERSION + 1, startedAt: null, tasks: {}, novo: true });
    writeFileSync(file, newer);
    expect(service().load().readOnly).toBe(true);
    expect(await runLedgerTool(service(), lider, call('tarefa_criar', { pedido: 'x', criterio: 'y', prazo: '2026-11-06', risco: 'alto' }))).toMatchObject({ ok: false });
    expect(readFileSync(file, 'utf8')).toBe(newer);
    expect(existsSync(`${file}.tmp`)).toBe(false);
  });
});
