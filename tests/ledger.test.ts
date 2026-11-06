import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createSystemConfigIoDeps } from '../src/main/config-store';
import { createLedgerService, ledgerProofsDir, nodeLedgerProofFs, runLedgerTool, type LedgerCaller, type LedgerProofFs } from '../src/main/ledger-store';
import type { MindscapeBoard } from '../src/shared/mindscape/model';
import { findCode, LEDGER_SCHEMA_VERSION } from '../src/shared/ledger/contract';
import { createCardWriter, type OwnerMessage } from '../src/main/ledger-card-writer';
import { buildRemoteProofCommand, fetchRemoteProof } from '../src/main/ledger-remote-proof';
import { parseLedgerToolCall, type LedgerToolCall } from '../src/shared/ledger/tools';
import { slackGuard } from '../src/shared/ledger/slack-guard';
import { deliveryNote } from '../src/shared/ledger/labels';

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
    await runLedgerTool(service(), lider, call('tarefa_criar', { pedido: 'x', criterio: 'y', prazo: '2026-11-06', risco: 'alto', titulo: 'Outra tarefa' }));
    const written = JSON.parse(readFileSync(file, 'utf8')) as { schemaVersion: number; tasks: Record<string, unknown> };
    expect(written.schemaVersion).toBe(LEDGER_SCHEMA_VERSION);
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
    expect(service().apply({ kind: 'lugar', placeId: 'place:revisor', roleId: 'revisor' }, { op: 'comentar', id, text: 'x', deliveredTo: null })).toMatchObject({ ok: false });

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
    expect(service().apply({ kind: 'dono' }, { op: 'transferir', id, to: 'place:dev', reason: '⟦transferida de a para b⟧' })).toMatchObject({ ok: false });
  });

  it('cancels an accepted Slack letter that never went out: it frees no send, and nobody takes it again', async () => {
    const { service } = setup();
    const letter = await runLedgerTool(service(), dev, call('carta_slack', { destino: 'C0123', texto: 'Oi, time', motivo: 'avisar' }));
    const id = (JSON.parse(letter.text) as { id: string }).id;
    expect(service().apply({ kind: 'dono' }, { op: 'aceitar', id })).toMatchObject({ ok: true });
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
    expect(service().apply({ kind: 'dono' }, { op: 'cancelar', id: work, reason: '⟦cancelada⟧' })).toMatchObject({ ok: false });
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
