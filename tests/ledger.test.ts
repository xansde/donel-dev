import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createSystemConfigIoDeps } from '../src/main/config-store';
import { createLedgerService, runLedgerBatch, leaderTransferNotice, ledgerProofsDir, NOT_STARTED_GRACE_MS, nodeLedgerProofFs, passOnTasks, runLedgerTool, type LedgerCaller, type LedgerProofFs } from '../src/main/ledger-store';
import type { MindscapeBoard } from '../src/shared/mindscape/model';
import { eventNote, findCode, frenteOf, LEDGER_SCHEMA_VERSION, MAX_FRENTE_CHARS, parseLedgerDoc, requestedByOf } from '../src/shared/ledger/contract';
import { LEADER_OF_ALL } from '../src/shared/mindscape/leader';
import * as v4 from './fixtures/ledger/contract-v4';
import { createCardWriter, decisionMessage, type OwnerMessage } from '../src/main/ledger-card-writer';
import { createLedgerMobilePort } from '../src/main/celular/ledger-port';
import { buildRemoteProofCommand, fetchRemoteProof } from '../src/main/ledger-remote-proof';
import { askedByRefusal, parseLedgerToolCall, type LedgerToolCall } from '../src/shared/ledger/tools';
import { slackGuard } from '../src/shared/ledger/slack-guard';
import { deliveryNote } from '../src/shared/ledger/labels';
import { createFaxinaRunner } from '../src/main/rotinas/oraculo-faxina';
import { oldOrphans, ORPHAN_AGE_MS, type PrRef } from '../src/shared/ledger/faxina';
import { addLink, addPlace, emptyMindscapeDoc, setPlaceConversation } from '../src/shared/mindscape/model';

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
    expect(await service().apply({ kind: 'lugar', placeId: 'place:dev' }, { op: 'entregar', id, proofs: [] })).toMatchObject({ ok: false });

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

  it('opens a v2 ledger without losing anything and writes it back with the current version', async () => {
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
    await runLedgerTool(service(), lider, call('tarefa_criar', { pedido: 'x', criterio: 'y', prazo: '2026-11-06', dono: 'place:dev', risco: 'alto', titulo: 'Outra tarefa' }));
    const written = JSON.parse(readFileSync(file, 'utf8')) as { schemaVersion: number; tasks: Record<string, unknown> };
    expect(written.schemaVersion).toBe(LEDGER_SCHEMA_VERSION);
    expect(written.tasks['t-0000aaaa']).toEqual(task);
  });

  it('finds code in the owner text, and not in plain Portuguese with numbers', async () => {
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
    expect(await service().apply({ kind: 'dono' }, { op: 'aceitar', id, option: 'Voltar ao azul' })).toMatchObject({ ok: false });
    expect(await service().apply({ kind: 'dono' }, { op: 'rejeitar', id, reason: '', option: 'Voltar ao azul' })).toMatchObject({ ok: true });
    expect(service().load().doc.tasks[id]!.events.at(-1)).toMatchObject({ kind: 'rejeitada', option: 'Voltar ao azul', text: 'Voltar ao azul' });
  });

  it('what the owner writes on a card is sent once per request and recorded once; only then the owner place may deliver again', async () => {
    const { service } = setup();
    const created = await runLedgerTool(service(), lider, call('tarefa_criar', { pedido: 'Põe o botão verde', criterio: 'saída do teste', prazo: '2026-11-06', dono: 'place:dev', risco: 'baixo' }));
    const id = (JSON.parse(created.text) as { id: string }).id;
    await runLedgerTool(service(), dev, call('tarefa_assumir', { id }));
    const deliver = () => runLedgerTool(service(), dev, call('tarefa_entregar', { id, provas: [{ tipo: 'texto', texto: '4 passed' }] }));
    expect(await deliver()).toMatchObject({ ok: true });
    // Delivered: no second delivery until the owner writes on the card.
    expect(await deliver()).toMatchObject({ ok: false, text: expect.stringContaining('escreveu na carta') });

    const sent: OwnerMessage[] = [];
    let release: () => void = () => undefined;
    const writer = createCardWriter({
      service,
      deliver: (message) => {
        sent.push(message);
        return new Promise((resolve) => (release = () => resolve({ placeId: 'place:dev' })));
      },
    });
    // Two clicks (or the phone resending) while the first is still on its way, then once more after it landed.
    const first = writer.write({ id, text: 'E o botão de cancelar?', requestId: 'pedido-abc12345' });
    const second = writer.write({ id, text: 'E o botão de cancelar?', requestId: 'pedido-abc12345' });
    release();
    expect(await first).toMatchObject({ ok: true, deliveredTo: { placeId: 'place:dev' } });
    expect(await second).toEqual(await first);
    expect(await writer.write({ id, text: 'E o botão de cancelar?', requestId: 'pedido-abc12345' })).toMatchObject({ ok: true, deliveredTo: { placeId: 'place:dev' } });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.text).toMatch(/^◆ Do dono, na carta «Põe o botão verde»: E o botão de cancelar\?/);
    const notes = service().load().doc.tasks[id]!.events.filter((event) => event.kind === 'comentada');
    expect(notes).toEqual([expect.objectContaining({ by: { kind: 'dono' }, text: 'E o botão de cancelar?', deliveredTo: { placeId: 'place:dev' } })]);
    // Nobody open: recorded with deliveredTo null (the card says it is kept).
    const nobody = createCardWriter({ service, deliver: async () => null });
    expect(await nobody.write({ id, text: 'Outra coisa', requestId: 'pedido-def67890' })).toMatchObject({ ok: true, deliveredTo: null });
    // A place never writes on the card as the owner.
    expect(await service().apply({ kind: 'lugar', placeId: 'place:revisor', roleId: 'revisor' }, { op: 'comentar', id, text: 'x', deliveredTo: null })).toMatchObject({ ok: false });

    expect(await deliver()).toMatchObject({ ok: true });
    expect(service().load().doc.tasks[id]!.state).toBe('entregue');
  });

  it('a proof file of a session on the VPS is read through its ssh with the path as a quoted argument, and lands in the proofs', async () => {
    const hostile = "/home/x/a'; rm -rf ~; echo '.html";
    const command = buildRemoteProofCommand(hostile, 2 * 1024 * 1024);
    // The agent's path is never part of the script: it goes as one single-quoted argument at the end.
    expect(command.endsWith(` donel-prova '/home/x/a'\\''; rm -rf ~; echo '\\''.html' 2097152`)).toBe(true);
    const asked: string[] = [];
    const run = (code: number, out = '') => async (_target: string, line: string) => (asked.push(line), { code, stdout: Buffer.from(out) });
    expect(await fetchRemoteProof('vps', 'relativo.html', run(0))).toMatchObject({ ok: false, error: expect.stringContaining('absoluto') });
    expect(await fetchRemoteProof('vps', '/x/segredo.txt', run(0))).toMatchObject({ ok: false });
    expect(asked).toHaveLength(0); // refused before any ssh
    expect(await fetchRemoteProof('vps', '/x/a.html', run(3))).toMatchObject({ ok: false, error: expect.stringContaining('link simbólico') });
    expect(await fetchRemoteProof('vps', '/x/a.html', run(5))).toMatchObject({ ok: false, error: expect.stringContaining('2 MB') });

    const { dir, service } = setup();
    const created = await runLedgerTool(service(), lider, call('tarefa_criar', { pedido: 'x', criterio: 'y', prazo: '2026-11-06', dono: 'place:dev', risco: 'baixo' }));
    const id = (JSON.parse(created.text) as { id: string }).id;
    await runLedgerTool(service(), dev, call('tarefa_assumir', { id }));
    const remote = (path: string) => fetchRemoteProof('vps', path, run(0, '<p>protótipo</p>'));
    expect(await runLedgerTool(service(), dev, call('tarefa_entregar', { id, provas: [{ tipo: 'arquivo', caminho: '/home/dev/proto.html' }] }), remote)).toMatchObject({ ok: true });
    const proof = service().load().doc.tasks[id]!.events.at(-1)!.proofs![0]!;
    expect(proof).toMatchObject({ kind: 'arquivo', mediaType: 'text/html' });
    if (proof.kind === 'arquivo') expect(readFileSync(join(ledgerProofsDir(join(dir, 'ledger.json')), proof.file), 'utf8')).toBe('<p>protótipo</p>');
  });

  it('passes a task stuck on a gone place to another one, and records who passed it from whom to whom', async () => {
    const { service } = setup();
    const created = await runLedgerTool(service(), lider, call('tarefa_criar', { pedido: 'Corrige o envio', criterio: 'saída do teste', prazo: '2026-11-06', dono: 'place:dev', risco: 'baixo' }));
    const id = (JSON.parse(created.text) as { id: string }).id;
    await runLedgerTool(service(), dev, call('tarefa_assumir', { id }));
    const theo = (estadoDoDev: string | null): LedgerCaller => {
      const states = new Map(board.map((place) => [place, 'parada']));
      if (estadoDoDev === null) states.delete('place:dev');
      else states.set('place:dev', estadoDoDev);
      return { ...at('place:revisor', 'revisor'), placeStates: new Map([['C:/p', states]]) };
    };
    // The owner place alive: nobody else takes it to itself.
    expect(await runLedgerTool(service(), theo('parada'), call('tarefa_transferir', { id, para: 'seu', motivo: 'eu faço' }))).toMatchObject({ ok: false });
    // Closed: the place that does the work takes it, the running task goes back to open for it to take.
    expect(await runLedgerTool(service(), theo('fechada'), call('tarefa_transferir', { id, para: 'seu', motivo: 'o Dev fechou' }))).toMatchObject({ ok: true });
    let task = service().load().doc.tasks[id]!;
    expect(task).toMatchObject({ ownerPlaceId: 'place:revisor', state: 'aberta' });
    expect(await runLedgerTool(service(), dev, call('tarefa_assumir', { id }))).toMatchObject({ ok: false });
    expect(await runLedgerTool(service(), revisor, call('tarefa_assumir', { id }))).toMatchObject({ ok: true });
    // The Líder passes it on with no board check; a place off the board is refused.
    expect(await runLedgerTool(service(), lider, call('tarefa_transferir', { id, para: 'place:fora', motivo: 'x' }))).toMatchObject({ ok: false });
    expect(await runLedgerTool(service(), lider, call('tarefa_transferir', { id, para: 'place:rev-do-dev', motivo: 'o Theo novo assume' }))).toMatchObject({ ok: true });
    task = service().load().doc.tasks[id]!;
    expect(task.ownerPlaceId).toBe('place:rev-do-dev');
    const seen = JSON.parse((await runLedgerTool(service(), lider, call('tarefa_ver', { id }))).text) as { transferencias: unknown[] };
    expect(seen.transferencias).toEqual([
      expect.objectContaining({ de: 'place:dev', para: 'place:revisor', por: 'place:revisor', motivo: 'o Dev fechou (o lugar dono está fechado)' }),
      expect.objectContaining({ de: 'place:revisor', para: 'place:rev-do-dev', por: 'place:lider', motivo: 'o Theo novo assume' }),
    ]);
    // A forged mark in a reason never becomes a transfer.
    expect(await service().apply({ kind: 'dono' }, { op: 'transferir', id, to: 'place:dev', reason: '⟦transferida de a para b⟧' })).toMatchObject({ ok: false });
  });

  it('cancels an accepted Slack letter that never went out: it frees no send, and nobody takes it again', async () => {
    const { service } = setup();
    const letter = await runLedgerTool(service(), dev, call('carta_slack', { destino: 'C0123', texto: 'Oi, time', motivo: 'avisar' }));
    const id = (JSON.parse(letter.text) as { id: string }).id;
    expect(await service().apply({ kind: 'dono' }, { op: 'aceitar', id })).toMatchObject({ ok: true });
    const send = { channel_id: 'C0123', text: 'Oi, time' };
    expect(slackGuard(service().load().doc, 'mcp__slack__slack_send_message', send)).toMatchObject({ kind: 'allow' });

    expect(await runLedgerTool(service(), revisor, call('tarefa_cancelar', { id, motivo: 'x' }))).toMatchObject({ ok: false });
    expect(await runLedgerTool(service(), dev, call('tarefa_cancelar', { id, motivo: 'substituída pela carta nova' }))).toMatchObject({ ok: true });
    expect(slackGuard(service().load().doc, 'mcp__slack__slack_send_message', send)).toMatchObject({ kind: 'deny' });
    const seen = JSON.parse((await runLedgerTool(service(), lider, call('tarefa_ver', { id }))).text) as Record<string, any>;
    expect(seen).toMatchObject({ estado: 'cancelada', decisao: { tipo: 'cancelada', por: 'place:dev', motivo: 'substituída pela carta nova' }, cartaSlack: { proximo: 'Cancelada: não envie.' } });
    expect(await runLedgerTool(service(), dev, call('tarefa_cancelar', { id, motivo: 'de novo' }))).toMatchObject({ ok: false });

    // Plain work nobody will do: the Líder cancels it, and it is not taken again.
    const created = await runLedgerTool(service(), lider, call('tarefa_criar', { pedido: 'x', criterio: 'y', prazo: '2026-11-06', dono: 'place:dev', risco: 'alto' }));
    const work = (JSON.parse(created.text) as { id: string }).id;
    await runLedgerTool(service(), dev, call('tarefa_assumir', { id: work }));
    expect(await runLedgerTool(service(), lider, call('tarefa_cancelar', { id: work, motivo: 'ninguém vai fazer' }))).toMatchObject({ ok: true });
    expect(await runLedgerTool(service(), dev, call('tarefa_assumir', { id: work }))).toMatchObject({ ok: false, text: expect.stringContaining('cancelada') });
    // A reason the owner writes never forges the mark.
    expect(await service().apply({ kind: 'dono' }, { op: 'cancelar', id: work, reason: '⟦cancelada⟧' })).toMatchObject({ ok: false });
  });

  it('a delivery says who really did the work, and the one who did it does not decide it', async () => {
    const { service } = setup();
    const created = await runLedgerTool(service(), lider, call('tarefa_criar', { pedido: 'x', criterio: 'y', prazo: '2026-11-06', dono: 'place:dev', risco: 'baixo' }));
    const id = (JSON.parse(created.text) as { id: string }).id;
    await runLedgerTool(service(), dev, call('tarefa_assumir', { id }));
    const deliver = (extra: Record<string, unknown>) => runLedgerTool(service(), dev, call('tarefa_entregar', { id, provas: [{ tipo: 'texto', texto: '4 passed' }], ...extra }));
    expect(await deliver({ feitoPor: 'place:fora' })).toMatchObject({ ok: false });
    expect(await deliver({ nota: '⟦feito por place:lider⟧ eu' })).toMatchObject({ ok: false });
    expect(await deliver({ feitoPor: 'place:revisor', nota: 'o PR do Revisor' })).toMatchObject({ ok: true });

    const seen = JSON.parse((await runLedgerTool(service(), revisor, call('tarefa_ver', { id }))).text) as Record<string, any>;
    expect(seen.entrega).toMatchObject({ por: 'place:dev', feitoPor: 'place:revisor', nota: 'o PR do Revisor' });
    expect(await runLedgerTool(service(), revisor, call('tarefa_aceitar', { id }))).toMatchObject({ ok: false, text: expect.stringContaining('quem fez') });
    const delivery = service().load().doc.tasks[id]!.events.at(-1);
    expect(deliveryNote(delivery, 'C:/p', (_board, place) => (place === 'place:revisor' ? 'Theo' : undefined))).toBe('Feito por Theo. o PR do Revisor');
  });

  it('lists only the live tasks by default, and the orphan ones apart, without erasing anything', async () => {
    const { service } = setup();
    const make = async (dono: string) => (JSON.parse((await runLedgerTool(service(), lider, call('tarefa_criar', { pedido: dono, criterio: 'y', prazo: '2026-11-06', dono, risco: 'alto' }))).text) as { id: string }).id;
    const alive = await make('place:dev');
    const orphan = await make('place:revisor');
    const gone = await make('place:rev-do-dev');
    const closed = await make('place:dev');
    await runLedgerTool(service(), lider, call('tarefa_cancelar', { id: closed, motivo: 'ninguém vai fazer' }));
    const states = new Map([['place:lider', 'parada'], ['place:dev', 'trabalhando'], ['place:revisor', 'fechada']]); // rev-do-dev left the board
    const who: LedgerCaller = { ...lider, placeStates: new Map([['C:/p', states]]) };
    const list = async (args: Record<string, unknown>) => {
      const answer = JSON.parse((await runLedgerTool(service(), who, call('tarefa_listar', args))).text) as { faixa: Record<string, number>; tarefas: { id: string; orfa?: string }[] };
      return { ids: answer.tarefas.map((task) => task.id), faixa: answer.faixa, tarefas: answer.tarefas };
    };
    expect((await list({})).ids).toEqual([alive]);
    expect((await list({})).faixa).toMatchObject({ total: 4, vivas: 1, orfas: 2, fechadas: 1 });
    const orphans = await list({ situacao: 'orfas' });
    expect(orphans.ids).toEqual([orphan, gone]);
    expect(orphans.tarefas[0]!.orfa).toContain('fechado');
    expect(orphans.tarefas[1]!.orfa).toContain('saiu do quadro');
    expect((await list({ situacao: 'todas' })).ids).toEqual([alive, orphan, gone, closed]);
    expect((await list({ estado: 'cancelada' })).ids).toEqual([closed]);
    // A board the main could not read is unknown: nothing there is orphan.
    expect(JSON.parse((await runLedgerTool(service(), lider, call('tarefa_listar', {}))).text).tarefas).toHaveLength(3);
  });

  it('counts an accepted Slack letter never sent as waiting for its send, never as orphan, and it still frees the send', async () => {
    const { service } = setup();
    const id = (JSON.parse((await runLedgerTool(service(), dev, call('carta_slack', { destino: 'C0123', texto: 'Oi, time', motivo: 'avisar' }))).text) as { id: string }).id;
    expect(await service().apply({ kind: 'dono' }, { op: 'aceitar', id })).toMatchObject({ ok: true });
    const who: LedgerCaller = { ...lider, placeStates: new Map([['C:/p', new Map([['place:lider', 'parada'], ['place:dev', 'fechada']])]]) };
    const list = async (args: Record<string, unknown>) => JSON.parse((await runLedgerTool(service(), who, call('tarefa_listar', args))).text) as { faixa: Record<string, number>; tarefas: { id: string; orfa?: string }[] };

    expect((await list({})).faixa).toMatchObject({ total: 1, vivas: 0, orfas: 0, fechadas: 0, esperandoEnvio: 1 });
    expect((await list({ situacao: 'orfas' })).tarefas).toEqual([]);
    expect((await list({ situacao: 'todas' })).tarefas.map((task) => task.id)).toEqual([id]);
    expect(slackGuard(service().load().doc, 'mcp__slack__slack_send_message', { channel_id: 'C0123', text: 'Oi, time' })).toMatchObject({ kind: 'allow' });
  });

  it('what the current code writes, the v4 code of the installed Alfa reads and rewrites without losing or blocking anything', async () => {
    const { file, service } = setup();
    const create = async (dono: string) => (JSON.parse((await runLedgerTool(service(), lider, call('tarefa_criar', { pedido: 'x', criterio: 'y', prazo: '2026-11-06', dono, risco: 'alto' }))).text) as { id: string }).id;
    const moved = await create('place:dev');
    await runLedgerTool(service(), lider, call('tarefa_transferir', { id: moved, para: 'place:revisor', motivo: 'o Dev fechou' }));
    const done = await create('place:dev');
    await runLedgerTool(service(), dev, call('tarefa_assumir', { id: done }));
    const paraODono = {
      pergunta: 'Ficou pronto. Aceito?',
      resumo: 'O Revisor fez e o Dev entregou.',
      opcoes: [
        { rotulo: 'Aceitar', efeito: 'Fecha.', fecha: 'aceita', recomendada: true },
        { rotulo: 'Refazer', efeito: 'Volta.', fecha: 'rejeitada' },
      ],
      porque: 'A saída do teste mostra.',
      risco: 'Baixo.',
    };
    await runLedgerTool(service(), dev, call('tarefa_entregar', { id: done, provas: [{ tipo: 'texto', texto: '4 passed' }], feitoPor: 'place:revisor', nota: 'o PR', paraODono }));
    const letter = (JSON.parse((await runLedgerTool(service(), dev, call('carta_slack', { destino: 'C0123', texto: 'Oi', motivo: 'avisar' }))).text) as { id: string }).id;
    await service().apply({ kind: 'dono' }, { op: 'aceitar', id: letter });
    await runLedgerTool(service(), dev, call('tarefa_cancelar', { id: letter, motivo: 'substituída' }));
    const replaced = await create('place:dev');
    const replacer = (JSON.parse((await runLedgerTool(service(), lider, call('tarefa_criar', { pedido: 'x2', criterio: 'y', prazo: '2026-11-06', dono: 'place:dev', risco: 'alto', substitui: replaced }))).text) as { id: string }).id;
    const written = readFileSync(file, 'utf8');
    expect(JSON.parse(written).schemaVersion).toBe(4);

    // The v4 code reads it as its own (not read-only), with every task and event, and rewrites it after its own write.
    expect(v4.isNewerLedger(JSON.parse(written))).toBe(false);
    const asV4 = v4.parseLedgerDoc(JSON.parse(written));
    expect(asV4).toEqual(parseLedgerDoc(JSON.parse(written)));
    const next = v4.applyLedgerOp(asV4, { kind: 'dono' }, { op: 'criar', projectPath: 'C:/p', request: 'z', doneWhen: 'z', due: '2026-11-07', ownerPlaceId: 'place:dev', risk: 'alto' }, { now: 9e12, newId: () => 't-0000ffff' });
    if (!next.ok) throw new Error(next.reason);
    writeFileSync(file, JSON.stringify(next.doc, null, 2));
    for (const id of [moved, done, letter, replaced, replacer]) expect(service().load().doc.tasks[id]).toEqual(asV4.tasks[id]);

    // And the current code still reads every fact back.
    const view = async (id: string) => JSON.parse((await runLedgerTool(service(), lider, call('tarefa_ver', { id }))).text) as Record<string, any>;
    expect((await view(moved)).transferencias).toEqual([expect.objectContaining({ de: 'place:dev', para: 'place:revisor', motivo: 'o Dev fechou' })]);
    expect((await view(done)).entrega).toMatchObject({ por: 'place:dev', feitoPor: 'place:revisor', nota: 'o PR' });
    expect(await view(letter)).toMatchObject({ estado: 'cancelada' });
    expect(await view(replaced)).toMatchObject({ estado: 'cancelada', decisao: { motivo: `substituída pela ${replacer}` } });
    expect(await view(replacer)).toMatchObject({ estado: 'aberta', substitui: replaced });

    // Nothing blocks in v4: the new owner takes the moved task; the cancelled letter frees no send there either.
    const doc = service().load().doc;
    expect(v4.applyLedgerOp(doc, { kind: 'lugar', placeId: 'place:revisor' }, { op: 'assumir', id: moved }, { now: 9e12, newId: () => 'x' })).toMatchObject({ ok: true });
    expect(v4.applyLedgerOp(doc, { kind: 'lugar', placeId: 'place:dev' }, { op: 'slack-enviada', id: letter }, { now: 9e12, newId: () => 'x' })).toMatchObject({ ok: false });
    expect(slackGuard(doc, 'mcp__slack__slack_send_message', { channel_id: 'C0123', text: 'Oi' })).toMatchObject({ kind: 'deny' });
  });

  it('a decision of the owner by the button, with no words, tells the session that owns it, and the Líder when it is closed', async () => {
    const { service } = setup();
    const sent: OwnerMessage[] = [];
    const writer = createCardWriter({ service, deliver: async (message) => (sent.push(message), { placeId: message.placeId }) });
    const phone = createLedgerMobilePort(service, undefined, () => writer);
    // t-c19912b4: the owner accepted a letter on the phone, nobody was told, and it stayed unsent.
    const letter = (JSON.parse((await runLedgerTool(service(), dev, call('carta_slack', { destino: 'C0123', texto: 'Oi', motivo: 'avisar' }))).text) as { id: string }).id;
    expect(await phone.decidir({ pedidoId: 'pedido-a1234567', itemId: letter, decisao: 'aceitar', motivo: null, opcao: 'Enviar' })).toMatchObject({ ok: true });
    // A retry of the same request records and tells nothing again.
    expect(await phone.decidir({ pedidoId: 'pedido-a1234567', itemId: letter, decisao: 'aceitar', motivo: null, opcao: 'Enviar' })).toMatchObject({ ok: true });
    await Promise.resolve();
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ placeId: 'place:dev', text: expect.stringContaining('aceitou a carta de Slack') });
    expect(sent[0]!.text).toContain('Envie agora');
    expect(sent[0]!.leaderText).toContain('que está fechada');

    // The desktop path (same writer): a reject by the button says why and what not to do.
    const other = (JSON.parse((await runLedgerTool(service(), dev, call('carta_slack', { destino: 'C0123', texto: 'Oi de novo', motivo: 'avisar' }))).text) as { id: string }).id;
    const rejected = await service().apply({ kind: 'dono' }, { op: 'rejeitar', id: other, reason: '', option: 'Não enviar' });
    if (!rejected.ok) throw new Error(rejected.reason);
    await writer.tellDecision(rejected.task);
    expect(sent[1]!.text).toMatch(/rejeitou a carta de Slack .*Não enviar.*Não envie/);
    // A letter of the Líder único (no place) goes straight to it.
    expect(decisionMessage({ ...rejected.task, ownerPlaceId: 'lider' }, undefined)).toMatchObject({ placeId: '', leaderText: expect.not.stringContaining('fechada') });
  });

  it('the Líder único owns a task passed to it: alive, never orphan, and it takes it', async () => {
    const { service } = setup();
    const id = (JSON.parse((await runLedgerTool(service(), lider, call('tarefa_criar', { pedido: 'x', criterio: 'y', prazo: '2026-11-06', dono: 'place:dev', risco: 'alto' }))).text) as { id: string }).id;
    expect(await runLedgerTool(service(), dev, call('tarefa_transferir', { id, para: 'lider', motivo: 'só o Líder decide isso' }))).toMatchObject({ ok: true });
    expect(service().load().doc.tasks[id]).toMatchObject({ ownerPlaceId: 'lider', state: 'aberta' });
    // Every place of the board is known and "lider" is none of them: still alive, not orphan.
    const states = new Map(board.map((place) => [place, 'parada']));
    const who: LedgerCaller = { ...dev, placeStates: new Map([['C:/p', states]]) };
    const listed = JSON.parse((await runLedgerTool(service(), who, call('tarefa_listar', {}))).text) as { faixa: Record<string, number>; tarefas: { id: string; dono: string; orfa?: string; desconhecida?: string }[] };
    expect(listed.tarefas).toEqual([expect.objectContaining({ id, dono: 'lider' })]);
    expect(listed.tarefas[0]!.orfa).toBeUndefined();
    expect(listed.faixa).toMatchObject({ vivas: 1, orfas: 0, desconhecidas: 0 });
    // Its board did not answer: the Líder único is no place of it, so the task is still alive, not unknown.
    const blind = JSON.parse((await runLedgerTool(service(), dev, call('tarefa_listar', {}))).text) as { faixa: Record<string, number>; tarefas: { desconhecida?: string }[] };
    expect(blind.faixa).toMatchObject({ vivas: 1, orfas: 0, desconhecidas: 0 });
    expect(blind.tarefas[0]!.desconhecida).toBeUndefined();
    const liderUnico: LedgerCaller = { projectPath: 'C:/p', placeId: 'lider', roleId: 'lider', boardPlaceIds: ['place:dev'] };
    expect(await runLedgerTool(service(), liderUnico, call('tarefa_assumir', { id }))).toMatchObject({ ok: true });
    // A place that is not on the board is still refused.
    expect(await runLedgerTool(service(), liderUnico, call('tarefa_transferir', { id, para: 'place:fora', motivo: 'x' }))).toMatchObject({ ok: false });
  });

  it('a place that closed passes its open, running and rejected tasks up, with the record; a delivered one stays', async () => {
    const { file, service } = setup();
    const make = async () => (JSON.parse((await runLedgerTool(service(), lider, call('tarefa_criar', { pedido: 'x', criterio: 'y', prazo: '2026-11-06', dono: 'place:dev', risco: 'baixo' }))).text) as { id: string }).id;
    const open = await make();
    const running = await make();
    await runLedgerTool(service(), dev, call('tarefa_assumir', { id: running }));
    const delivered = await make();
    await runLedgerTool(service(), dev, call('tarefa_assumir', { id: delivered }));
    await runLedgerTool(service(), dev, call('tarefa_entregar', { id: delivered, provas: [{ tipo: 'texto', texto: 'ok' }] }));
    const rejected = await make();
    await runLedgerTool(service(), dev, call('tarefa_assumir', { id: rejected }));
    await runLedgerTool(service(), dev, call('tarefa_entregar', { id: rejected, provas: [{ tipo: 'texto', texto: 'ok' }] }));
    await service().apply({ kind: 'dono' }, { op: 'rejeitar', id: rejected, reason: 'falta o print' });

    // The first live place above is a Líder (`registersForOthers`): it may receive by transfer, the rule is only on creation.
    const passed = await passOnTasks(service(), [{ projectPath: 'C:/p', placeId: 'place:dev', gone: 'fechada', to: 'place:lider' }]);
    expect(passed).toEqual([{ projectPath: 'C:/p', placeId: 'place:dev', to: 'place:lider', tasks: [{ id: open }, { id: running }, { id: rejected }] }]);
    const doc = service().load().doc;
    expect(doc.tasks[open]).toMatchObject({ ownerPlaceId: 'place:lider', state: 'aberta' });
    expect(doc.tasks[running]).toMatchObject({ ownerPlaceId: 'place:lider', state: 'aberta' });
    expect(doc.tasks[rejected]).toMatchObject({ ownerPlaceId: 'place:lider', state: 'rejeitada' });
    expect(doc.tasks[delivered]).toMatchObject({ ownerPlaceId: 'place:dev', state: 'entregue' });
    const seen = JSON.parse((await runLedgerTool(service(), lider, call('tarefa_ver', { id: running }))).text) as { transferencias: unknown[] };
    expect(seen.transferencias).toEqual([expect.objectContaining({ de: 'place:dev', para: 'place:lider', por: 'place:dev', motivo: 'passada sozinha: o lugar place:dev fechou' })]);
    // Nothing orphan left on the board with the Dev closed.
    const states = new Map([['place:lider', 'parada'], ['place:dev', 'fechada'], ['place:revisor', 'parada'], ['place:rev-do-dev', 'parada']]);
    const orphans = JSON.parse((await runLedgerTool(service(), { ...lider, placeStates: new Map([['C:/p', states]]) }, call('tarefa_listar', { situacao: 'orfas' }))).text) as { tarefas: unknown[] };
    expect(orphans.tarefas).toEqual([]);
    // Asked again, nothing moves twice; the file stays v4 and reads the same in the v4 code of the installed Alfa.
    expect(await passOnTasks(service(), [{ projectPath: 'C:/p', placeId: 'place:dev', gone: 'fechada', to: 'place:lider' }])).toEqual([]);
    const raw = JSON.parse(readFileSync(file, 'utf8'));
    expect(raw.schemaVersion).toBe(4);
    expect(v4.parseLedgerDoc(raw)).toEqual(parseLedgerDoc(raw));
  });

  it('with nobody live above, the work goes to the Líder único; a place that never started passes only after the grace', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ledger-'));
    dirs.push(dir);
    let clock = Date.UTC(2026, 10, 6, 12);
    const service = createLedgerService({ filePath: join(dir, 'ledger.json'), io: createSystemConfigIoDeps(), proofFs: nodeLedgerProofFs, now: () => clock });
    const id = (JSON.parse((await runLedgerTool(service, lider, call('tarefa_criar', { pedido: 'x', criterio: 'y', prazo: '2026-11-06', dono: 'place:dev', risco: 'alto' }))).text) as { id: string }).id;
    const request = { projectPath: 'C:/p', placeId: 'place:dev', gone: 'nao-comecou' as const, to: 'lider' };
    clock += NOT_STARTED_GRACE_MS - 60_000;
    expect(await passOnTasks(service, [request])).toEqual([]);
    clock += 120_000;
    expect(await passOnTasks(service, [request])).toMatchObject([{ to: 'lider', tasks: [{ id }] }]);
    expect(service.load().doc.tasks[id]).toMatchObject({ ownerPlaceId: 'lider', state: 'aberta' });
    expect(JSON.parse((await runLedgerTool(service, lider, call('tarefa_ver', { id }))).text).transferencias[0].motivo).toBe('passada sozinha: o lugar place:dev não começou');
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

describe('órfãs e substituição (06/11)', () => {
  const idOf = (answer: { text: string }): string => (JSON.parse(answer.text) as { id: string }).id;
  const make = async (service: () => ReturnType<typeof createLedgerService>, who: LedgerCaller, args: Record<string, unknown>) =>
    runLedgerTool(service(), who, call('tarefa_criar', { pedido: 'x', criterio: 'y', prazo: '2026-11-06', risco: 'alto', ...args }));

  it('counts the same for a session and for the Líder único, and a board that did not answer apart, never as alive', async () => {
    const { service } = setup();
    const outroLider: LedgerCaller = { projectPath: 'C:/q', placeId: 'place:q-lider', roleId: 'lider', boardPlaceIds: ['place:q-lider', 'place:q-dev'] };
    const alive = idOf(await make(service, lider, { dono: 'place:dev' }));
    const orphan = idOf(await make(service, lider, { dono: 'place:revisor' }));
    const unknown = idOf(await make(service, outroLider, { dono: 'place:q-dev' }));
    // C:/p answered; C:/q did not. The main hands every caller of `todos` the same states (index.ts, `withEveryBoard`).
    const states = new Map([['C:/p', new Map([['place:lider', 'parada'], ['place:dev', 'trabalhando'], ['place:revisor', 'fechada']])]]);
    const session: LedgerCaller = { ...dev, placeStates: states };
    const leaderOfAll: LedgerCaller = { projectPath: '', placeId: LEADER_OF_ALL, roleId: 'lider', boardPlaceIds: [], placeStates: states };
    const list = async (who: LedgerCaller) => JSON.parse((await runLedgerTool(service(), who, call('tarefa_listar', { todos: true }))).text) as { faixa: Record<string, number>; tarefas: Record<string, unknown>[] };
    const fromSession = await list(session);
    const fromLeader = await list(leaderOfAll);
    expect(fromSession.faixa).toMatchObject({ total: 3, vivas: 1, orfas: 1, fechadas: 0, desconhecidas: 1 });
    expect(fromLeader.faixa).toEqual(fromSession.faixa);
    // The unknown one stays visible, marked, so nothing vanishes from the list.
    expect(fromSession.tarefas.map((task) => task.id)).toEqual([alive, unknown]);
    expect(fromSession.tarefas[1]).toMatchObject({ desconhecida: expect.stringContaining('não respondeu') });
    expect(fromSession.tarefas[0]).not.toHaveProperty('desconhecida');
    expect((await list(session)).tarefas.map((task) => task.id)).not.toContain(orphan);
  });

  it('a new task cancels the one it replaces in the same write, and with no right to cancel nothing is created', async () => {
    const { service } = setup();
    const old = idOf(await make(service, lider, { dono: 'place:dev' }));
    const created = await make(service, lider, { dono: 'place:dev', substitui: old });
    expect(created.ok).toBe(true);
    const next = idOf(created);
    const view = async (id: string) => JSON.parse((await runLedgerTool(service(), lider, call('tarefa_ver', { id }))).text) as Record<string, any>;
    expect(await view(old)).toMatchObject({ estado: 'cancelada', decisao: { tipo: 'cancelada', por: 'place:lider', motivo: `substituída pela ${next}` } });
    expect(await view(next)).toMatchObject({ estado: 'aberta', substitui: old });

    // The Revisor may not cancel the Dev's task: refused, it says why, and no task is born.
    const mine = idOf(await make(service, dev, { dono: 'place:dev' }));
    const before = Object.keys(service().load().doc.tasks).length;
    const refused = await make(service, revisor, { dono: 'place:dev', substitui: mine });
    expect(refused).toMatchObject({ ok: false, text: expect.stringContaining('Não criei') });
    expect(refused.text).toContain('Só o Líder, o dono ou o lugar dono');
    expect(Object.keys(service().load().doc.tasks)).toHaveLength(before);
    expect(service().load().doc.tasks[mine]!.state).toBe('aberta');
    // A task that does not exist, or one already closed, is not replaced either.
    expect(await make(service, lider, { dono: 'place:dev', substitui: 't-nao-existe' })).toMatchObject({ ok: false });
    expect(await make(service, lider, { dono: 'place:dev', substitui: old })).toMatchObject({ ok: false, text: expect.stringContaining('fechada') });
  });

  it('keeps who asked (a person, not a role) in the file, next to the task it replaces, readable by a v4 app', async () => {
    const { service, file } = setup();
    const view = async (id: string) => JSON.parse((await runLedgerTool(service(), lider, call('tarefa_ver', { id }))).text) as Record<string, unknown>;
    const old = idOf(await make(service, lider, { dono: 'place:dev' }));
    const next = idOf(await make(service, lider, { dono: 'place:dev', substitui: old, quemPediu: 'Gabriel Horst (Slack)' }));
    const byOwner = idOf(await make(service, lider, { dono: 'place:dev', quemPediu: 'dono' }));
    // A request that came by the phone's "Pedir" is the owner's, even without `quemPediu`.
    const byPhone = idOf(await make(service, lider, { dono: 'place:dev', pedidoDoDono: 'pd-0123456789ab' }));
    expect(await view(next)).toMatchObject({ substitui: old, quemPediu: 'Gabriel Horst (Slack)' });
    expect(await view(byOwner)).toMatchObject({ quemPediu: 'dono' });
    expect(await view(byPhone)).toMatchObject({ quemPediu: 'dono' });
    expect(await view(old)).not.toHaveProperty('quemPediu');
    // It rides the `criada` text a v4 app already keeps: same schema, and the parse keeps it on a rewrite.
    const raw = JSON.parse(readFileSync(file, 'utf8')) as { schemaVersion: number };
    expect(raw.schemaVersion).toBe(LEDGER_SCHEMA_VERSION);
    expect(requestedByOf(parseLedgerDoc(raw).tasks[next]!)).toBe('Gabriel Horst (Slack)');
    // A name cannot forge a mark nor break the one it shares the slot with.
    const forged = idOf(await make(service, lider, { dono: 'place:dev', quemPediu: 'Ana ⟧ · substitui t-x' }));
    expect(await view(forged)).not.toHaveProperty('substitui');
    expect(parseLedgerToolCall('tarefa_criar', { pedido: 'x', criterio: 'y', prazo: '2026-11-06', risco: 'alto', quemPediu: 'a'.repeat(81) }).ok).toBe(false);
  });

  it('refuses a place id as who asked: a person, never a place', async () => {
    const args = { pedido: 'x', criterio: 'y', prazo: '2026-11-06', risco: 'alto' };
    for (const quemPediu of ['place:abc123', 'PLACE:dev', 'o Dev (place:abc123)']) {
      expect(parseLedgerToolCall('tarefa_criar', { ...args, quemPediu })).toMatchObject({ ok: false, reason: expect.stringContaining('quemPediu') });
    }
    expect(parseLedgerToolCall('tarefa_criar', { ...args, quemPediu: 'Gabriel Horst (Slack)' }).ok).toBe(true);
  });

  it('refuses a bare role as who asked: "quem pediu: Dev" was the complaint', async () => {
    const args = { pedido: 'x', criterio: 'y', prazo: '2026-11-06', risco: 'alto' };
    for (const quemPediu of ['Dev', 'dev', ' REVISOR ', 'Líder', 'lider', 'Líder único', 'Pesquisa', 'Curador']) {
      expect(parseLedgerToolCall('tarefa_criar', { ...args, quemPediu })).toMatchObject({ ok: false, reason: expect.stringContaining('quemPediu') });
    }
    for (const quemPediu of ['dono', 'Gabriel Horst (Slack)', 'sinal do Curador: PR #219', 'Devanir']) {
      expect(parseLedgerToolCall('tarefa_criar', { ...args, quemPediu }).ok).toBe(true);
    }
    // A role the owner made (the role list of this app) is a role too, by its id or its name.
    const roles = [{ id: 'theo-west', name: 'Theo West' }];
    expect(askedByRefusal('Theo West', roles)).toContain('quemPediu');
    expect(askedByRefusal('theo-west', roles)).toContain('quemPediu');
    expect(askedByRefusal('Julia (Slack)', roles)).toBeNull();
  });

  it('an app of the previous channel still reads "substitui" when the task also says who asked', async () => {
    const { service, file } = setup();
    const old = idOf(await make(service, lider, { dono: 'place:dev' }));
    const next = idOf(await make(service, lider, { dono: 'place:dev', substitui: old, quemPediu: 'Ana' }));
    const birth = (JSON.parse(readFileSync(file, 'utf8')) as { tasks: Record<string, { events: Array<{ text?: string }> }> }).tasks[next]!.events[0]!.text;
    // The reading of the alfa/beta before 07/11 (staging's `replacesOf`): the first mark, whole, is "substitui <id>".
    const previousReplacesOf = (text: string | undefined) => /^substitui (\S+)$/.exec(/^⟦([^⟧\n]{1,240})⟧ ?/.exec(text ?? '')?.[1] ?? '')?.[1];
    expect(previousReplacesOf(birth)).toBe(old);
    const task = parseLedgerDoc(JSON.parse(readFileSync(file, 'utf8'))).tasks[next]!;
    expect(requestedByOf(task)).toBe('Ana');
    expect(eventNote(task.events[0]!)).toBeUndefined();
  });

  it('Líder, Curador and Pesquisa name the place that does the work, never their own', async () => {
    const { service } = setup();
    const curador = at('place:rev-do-dev', 'curador');
    const pesquisa = at('place:revisor', 'pesquisa');
    for (const [who, args] of [[curador, {}], [pesquisa, { dono: 'place:revisor' }], [lider, { dono: 'seu' }]] as const) {
      expect(await make(service, who, args)).toMatchObject({ ok: false, text: expect.stringContaining('diga em "dono" o lugar que faz o trabalho') });
    }
    expect(Object.keys(service().load().doc.tasks)).toHaveLength(0);
    expect(await make(service, pesquisa, { dono: 'place:dev' })).toMatchObject({ ok: true });
    // Every other role keeps the default: the task is its own.
    expect(await make(service, dev, {})).toMatchObject({ ok: true });
  });

  it('the nightly cleanup: low risk with a merged PR ends done, high risk and no PR stay; 3 nights in shadow, then it acts', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ledger-'));
    dirs.push(dir);
    let clock = new Date(2026, 10, 7, 10).getTime(); // 10:00 local: past the night's hour
    const service = createLedgerService({ filePath: join(dir, 'ledger.json'), io: createSystemConfigIoDeps(), proofFs: nodeLedgerProofFs, now: () => clock });
    const deliver = async (risco: 'baixo' | 'alto', provas: unknown[], reject: boolean) => {
      const id = (JSON.parse((await runLedgerTool(service, lider, call('tarefa_criar', { pedido: risco, criterio: 'y', prazo: '2026-11-06', dono: 'place:dev', risco }))).text) as { id: string }).id;
      await runLedgerTool(service, dev, call('tarefa_assumir', { id }));
      const paraODono = { pergunta: 'Aceito?', resumo: 'Feito.', opcoes: [{ rotulo: 'Aceitar', efeito: 'Fecha.', fecha: 'aceita', recomendada: true }, { rotulo: 'Refazer', efeito: 'Volta.', fecha: 'rejeitada' }], porque: 'Testes.', risco: 'Baixo.' };
      expect(await runLedgerTool(service, dev, call('tarefa_entregar', { id, provas, ...(risco === 'alto' ? { paraODono } : {}) }))).toMatchObject({ ok: true });
      if (reject) await service.apply({ kind: 'dono' }, { op: 'rejeitar', id, reason: 'falta o print' });
      return id;
    };
    const lowMerged = await deliver('baixo', [{ tipo: 'link', url: 'https://github.com/acme/atlas/pull/255' }], true);
    const highMerged = await deliver('alto', [{ tipo: 'texto', texto: 'PR https://github.com/acme/atlas/pull/257 e 4 passed' }], true);
    const lowOpenPr = await deliver('baixo', [{ tipo: 'link', url: 'https://github.com/acme/atlas/pull/258' }], false);
    const noPr = await deliver('baixo', [{ tipo: 'texto', texto: '4 passed' }], true);
    // A PR only cited in a text (the base of a stacked PR) is not the delivery's: its own PR is still open.
    const stacked = await deliver('baixo', [{ tipo: 'link', url: 'https://github.com/acme/atlas/pull/258' }, { tipo: 'texto', texto: 'Empilhado no https://github.com/acme/atlas/pull/255' }], true);
    const citedOnly = await deliver('baixo', [{ tipo: 'texto', texto: 'Base https://github.com/acme/atlas/pull/255, este https://github.com/acme/atlas/pull/258' }], true);
    // An old orphan: its place closed (started, no live session), nobody touched it for more than a day.
    const orphan = (JSON.parse((await runLedgerTool(service, lider, call('tarefa_criar', { pedido: 'velha', criterio: 'y', prazo: '2026-11-06', dono: 'place:revisor', risco: 'alto' }))).text) as { id: string }).id;
    let boards = addPlace(emptyMindscapeDoc(), 'C:/p', { id: 'place:lider', roleId: 'lider' });
    for (const id of ['place:dev', 'place:revisor']) boards = addPlace(boards, 'C:/p', { id, roleId: 'dev' });
    boards = setPlaceConversation(boards, 'C:/p', 'place:revisor', 'conv-revisor');
    boards = addLink(boards, 'C:/p', { id: 'l1', from: 'place:dev', to: 'place:revisor', arrow: true, by: 'session', opened: true });
    boards = setPlaceConversation(boards, 'C:/p', 'place:dev', 'conv-dev');
    const asked: string[] = [];
    const told: { to: string; text: string }[] = [];
    const runner = createFaxinaRunner({
      dir: join(dir, 'rotinas'),
      ledger: () => service,
      loadBoards: () => boards,
      liveSessionIds: () => new Set(['conv-dev']),
      prState: async (pr: PrRef) => (asked.push(pr.url), pr.number === 258 ? { merged: false } : { merged: true, mergedAt: '2026-11-05T18:00:00Z' }),
      tell: (_board, to, text) => told.push({ to, text }),
      now: () => clock,
    });
    clock += ORPHAN_AGE_MS + 60_000;

    // Three nights in shadow: everything written, nothing changed.
    for (let night = 1; night <= 3; night += 1) {
      const entries = await runner.runNight();
      expect(entries.find((entry) => entry.tarefa === lowMerged)).toMatchObject({ acao: 'cancelaria', sombra: true, motivo: 'concluída: PR #255 mesclado em 2026-11-05' });
      expect(entries.find((entry) => entry.tarefa === highMerged)).toMatchObject({ acao: 'fica-risco-alto' });
      expect(entries.find((entry) => entry.tarefa === orphan)).toMatchObject({ acao: 'passaria', de: 'place:revisor', para: 'place:dev' });
      expect(entries.some((entry) => [lowOpenPr, noPr, stacked, citedOnly].includes(entry.tarefa ?? ''))).toBe(false);
      expect(await runner.runNight()).toEqual([]); // once a night
      clock += 24 * 60 * 60 * 1000;
    }
    expect(service.load().doc.tasks[lowMerged]).toMatchObject({ state: 'rejeitada', ownerPlaceId: 'place:dev' });
    expect(service.load().doc.tasks[orphan]).toMatchObject({ ownerPlaceId: 'place:revisor' });
    expect(told).toEqual([]);
    expect(readFileSync(join(dir, 'rotinas', 'faxina.log'), 'utf8').trim().split('\n').filter((line) => line.includes('"resumo"'))).toHaveLength(3);

    // The fourth night acts.
    const entries = await runner.runNight();
    expect(entries.find((entry) => entry.tarefa === lowMerged)).toMatchObject({ acao: 'cancelada', sombra: false });
    const view = async (id: string) => JSON.parse((await runLedgerTool(service, lider, call('tarefa_ver', { id }))).text) as Record<string, any>;
    expect(await view(lowMerged)).toMatchObject({ estado: 'cancelada', decisao: { tipo: 'cancelada', motivo: 'concluída: PR #255 mesclado em 2026-11-05' } });
    expect((await view(highMerged)).estado).toBe('rejeitada');
    expect((await view(lowOpenPr)).estado).toBe('entregue');
    expect((await view(noPr)).estado).toBe('rejeitada');
    expect((await view(stacked)).estado).toBe('rejeitada');
    expect((await view(citedOnly)).estado).toBe('rejeitada');
    expect(await view(orphan)).toMatchObject({ dono: 'place:dev', transferencias: [expect.objectContaining({ de: 'place:revisor', para: 'place:dev', motivo: expect.stringContaining('passada sozinha pela faxina') })] });
    expect(told).toEqual([{ to: 'place:dev', text: expect.stringContaining(orphan) }]);
    expect(new Set(asked)).toEqual(new Set(['https://github.com/acme/atlas/pull/255', 'https://github.com/acme/atlas/pull/257', 'https://github.com/acme/atlas/pull/258']));
  });

  it('a task passed to the Líder único by hand tells it who passed what and why', async () => {
    const { service } = setup();
    const id = (JSON.parse((await runLedgerTool(service(), lider, call('tarefa_criar', { titulo: 'Corrige o envio', pedido: 'x', criterio: 'y', prazo: '2026-11-06', dono: 'place:dev', risco: 'alto' }))).text) as { id: string }).id;
    const moved = await runLedgerTool(service(), dev, call('tarefa_transferir', { id, para: 'lider', motivo: 'precisa de decisão' }));
    const notice = leaderTransferNotice(service(), 'place:dev', moved.text, 'precisa de decisão');
    expect(notice).toContain(`place:dev passou para você a tarefa ${id} «Corrige o envio» (quadro p)`);
    expect(notice).toContain('precisa de decisão');
    // To another place: no line to the Líder.
    const back = await runLedgerTool(service(), lider, call('tarefa_transferir', { id, para: 'place:revisor', motivo: 'x' }));
    expect(leaderTransferNotice(service(), 'lider', back.text, 'x')).toBeNull();
  });
});

describe('frente da tarefa (07/11)', () => {
  const idOf = (answer: { text: string }): string => (JSON.parse(answer.text) as { id: string }).id;
  const make = async (service: () => ReturnType<typeof createLedgerService>, who: LedgerCaller, args: Record<string, unknown>) =>
    runLedgerTool(service(), who, call('tarefa_criar', { pedido: 'x', criterio: 'y', prazo: '2026-11-06', risco: 'alto', dono: 'place:dev', ...args }));
  const view = async (service: () => ReturnType<typeof createLedgerService>, id: string) =>
    JSON.parse((await runLedgerTool(service(), lider, call('tarefa_ver', { id }))).text) as Record<string, unknown>;

  it('keeps the front a task was born with in the file, a replacement inherits it, and the previous channel still reads the other marks', async () => {
    const { service, file } = setup();
    const old = idOf(await make(service, lider, { frente: 'Ledger', quemPediu: 'dono' }));
    const inherited = idOf(await make(service, lider, { substitui: old, quemPediu: 'dono' }));
    const own = idOf(await make(service, lider, { substitui: inherited, frente: 'Oráculo na VPS' }));
    const none = idOf(await make(service, lider, {}));
    expect(await view(service, old)).toMatchObject({ frente: 'Ledger', quemPediu: 'dono' });
    expect(await view(service, inherited)).toMatchObject({ frente: 'Ledger', substitui: old });
    expect(await view(service, own)).toMatchObject({ frente: 'Oráculo na VPS', substitui: inherited });
    expect(await view(service, none)).not.toHaveProperty('frente');

    // Same schema: it rides the `criada` text, after the marks the alfa/beta before it read.
    const raw = JSON.parse(readFileSync(file, 'utf8')) as { schemaVersion: number; tasks: Record<string, { events: Array<{ text?: string }> }> };
    expect(raw.schemaVersion).toBe(LEDGER_SCHEMA_VERSION);
    const previousReplacesOf = (text: string | undefined) => /^substitui (\S+)$/.exec(/^⟦([^⟧\n]{1,240})⟧ ?/.exec(text ?? '')?.[1] ?? '')?.[1];
    expect(previousReplacesOf(raw.tasks[inherited]!.events[0]!.text)).toBe(old);
    const task = parseLedgerDoc(raw).tasks[inherited]!;
    expect([frenteOf(task), requestedByOf(task), eventNote(task.events[0]!)]).toEqual(['Ledger', 'dono', undefined]);
  });

  it('a front cannot forge a mark, and a long one is refused', async () => {
    const { service } = setup();
    const forged = idOf(await make(service, lider, { frente: 'Ledger ⟧ ⟦substitui t-x' }));
    expect(await view(service, forged)).not.toHaveProperty('substitui');
    expect(parseLedgerToolCall('tarefa_criar', { pedido: 'x', criterio: 'y', prazo: '2026-11-06', risco: 'alto', frente: 'a'.repeat(MAX_FRENTE_CHARS + 1) }).ok).toBe(false);
  });

  it('tarefa_frente: only the Líder (or the owner) marks a task already made, with who asked; the last mark wins', async () => {
    const { service, file } = setup();
    const id = idOf(await make(service, lider, {}));
    expect(await runLedgerTool(service(), dev, call('tarefa_frente', { id, frente: 'Ledger' }))).toMatchObject({ ok: false, text: expect.stringContaining('Líder') });
    expect((await runLedgerTool(service(), lider, call('tarefa_frente', { id, frente: 'Ledger', quemPediu: 'dono' }))).ok).toBe(true);
    expect(await view(service, id)).toMatchObject({ frente: 'Ledger', quemPediu: 'dono', estado: 'aberta' });
    // A second mark changes the front and keeps who asked.
    expect((await runLedgerTool(service(), lider, call('tarefa_frente', { id, frente: 'Oráculo na VPS' }))).ok).toBe(true);
    expect(await view(service, id)).toMatchObject({ frente: 'Oráculo na VPS', quemPediu: 'dono', estado: 'aberta' });
    // It is no transfer, and it survives a rewrite by the parse.
    expect(await view(service, id)).not.toHaveProperty('transferencias');
    const task = parseLedgerDoc(JSON.parse(readFileSync(file, 'utf8'))).tasks[id]!;
    expect([frenteOf(task), requestedByOf(task)]).toEqual(['Oráculo na VPS', 'dono']);
    // The Líder único acts by the task id (the main resolves its board).
    const leaderOfAll: LedgerCaller = { projectPath: 'C:/p', placeId: LEADER_OF_ALL, roleId: 'lider', boardPlaceIds: [] };
    expect((await runLedgerTool(service(), leaderOfAll, call('tarefa_frente', { id, frente: 'Ledger' }))).ok).toBe(true);
    // Who asked is a person here too, and the front is required.
    expect(parseLedgerToolCall('tarefa_frente', { id, frente: 'Ledger', quemPediu: 'Dev' }).ok).toBe(false);
    expect(parseLedgerToolCall('tarefa_frente', { id }).ok).toBe(false);
  });
});

// t-147e6783, item (2) (dono, 08/11: "organizar o ledger como um BOM ledger"): dezenas de órfãs e entregues paradas
// ganham destino com motivo num gesto do Líder, sem apagar nada. What breaks without the owner seeing it: half a batch
// applied and the other half lost, or one refused item stopping the rest.
describe('tarefa_lote: o Líder dá destino a várias tarefas num gesto', () => {
  it('cada item é transferido ou cancelado com o seu motivo; um item recusado não para os outros, e nada se apaga', async () => {
    const { file, service } = setup();
    const ids: string[] = [];
    for (const titulo of ['Órfã A', 'Órfã B', 'Velha C']) {
      const created = await runLedgerTool(service(), lider, call('tarefa_criar', { pedido: titulo, criterio: 'teste verde', prazo: '2026-11-09', dono: 'place:dev', risco: 'baixo', titulo }));
      ids.push((JSON.parse(created.text) as { id: string }).id);
    }
    const parsed = parseLedgerToolCall('tarefa_lote', {
      itens: [
        { id: ids[0], acao: 'transferir', para: 'place:revisor', motivo: 'o dono fechou; o Revisor segue' },
        { id: 'tarefa-que-nao-existe', acao: 'cancelar', motivo: 'x' },
        { id: ids[1], acao: 'cancelar', motivo: 'repetida da A' },
        { id: ids[2], acao: 'transferir', para: 'lider', motivo: 'aberta há 3 dias sem dono vivo' },
      ],
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok || parsed.call.tool !== 'tarefa_lote') throw new Error('parse');
    const result = await runLedgerBatch(parsed.call, (item) => runLedgerTool(service(), lider, item));
    const answer = JSON.parse(result.text) as { aplicados: number; recusados: number; itens: { id: string; ok: boolean }[] };
    expect(answer).toMatchObject({ aplicados: 3, recusados: 1 });
    expect(answer.itens.map((item) => item.ok)).toEqual([true, false, true, true]);

    const doc = parseLedgerDoc(JSON.parse(readFileSync(file, 'utf8')))!;
    expect(Object.keys(doc.tasks)).toHaveLength(3); // nothing deleted
    expect(doc.tasks[ids[0]!]!.ownerPlaceId).toBe('place:revisor');
    expect(doc.tasks[ids[2]!]!.ownerPlaceId).toBe(LEADER_OF_ALL);
    expect(doc.tasks[ids[1]!]!.events.map((event) => eventNote(event) ?? '').join(' ')).toContain('repetida da A');

    // A Dev cannot cancel a task that is not its own: the same rule as one call, item by item.
    const asDev = await runLedgerBatch(
      { tool: 'tarefa_lote', itens: [{ id: ids[0]!, acao: 'cancelar', motivo: 'não é minha' }] },
      (item) => runLedgerTool(service(), dev, item),
    );
    expect(JSON.parse(asDev.text)).toMatchObject({ aplicados: 0, recusados: 1 });
    expect(parseLedgerToolCall('tarefa_lote', { itens: [] }).ok).toBe(false);
  });
});

// Revisor do #370: a faxina noturna dava às órfãs uma segunda regra de destino (acima vivo, senão o Líder único) e
// pulava o Líder do quadro. Agora é a mesma regra dos avisos, `whoHears`.
describe('faxina noturna: órfã velha segue as setas do quadro', () => {
  it('sem ninguém vivo acima, a órfã vai ao Líder do quadro vivo, não ao Líder único', async () => {
    const { service } = setup();
    const id = (JSON.parse((await runLedgerTool(service(), lider, call('tarefa_criar', { pedido: 'velha', criterio: 'y', prazo: '2026-11-06', dono: 'place:dev', risco: 'alto' }))).text) as { id: string }).id;
    let boards = addPlace(emptyMindscapeDoc(), 'C:/p', { id: 'place:lider', roleId: 'lider' });
    boards = setPlaceConversation(boards, 'C:/p', 'place:lider', 'conv-lider');
    boards = setPlaceConversation(addPlace(boards, 'C:/p', { id: 'place:dev', roleId: 'dev', by: 'session' }), 'C:/p', 'place:dev', 'conv-dev');
    const doc = service().load().doc;
    const later = Date.now() + ORPHAN_AGE_MS * 10;
    expect(oldOrphans(doc, boards, new Set(['conv-lider']), later)).toEqual([expect.objectContaining({ task: expect.objectContaining({ id }), to: 'place:lider' })]);
    expect(oldOrphans(doc, boards, new Set(), later)).toEqual([expect.objectContaining({ to: LEADER_OF_ALL })]);
  });
});
