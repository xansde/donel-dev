import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createSystemConfigIoDeps } from '../src/main/config-store';
import { SLACK_OFFLINE_PATTERN } from '../src/main/hooks-settings';
import { createLedgerService, guardSlackSend, nodeLedgerProofFs, runLedgerTool, type LedgerCaller } from '../src/main/ledger-store';
import { applyLedgerOp, emptyLedgerDoc, parseLedgerDoc, type LedgerActor, type LedgerDoc, type LedgerOp, type SlackLetter } from '../src/shared/ledger/contract';
import { slackGuard } from '../src/shared/ledger/slack-guard';
import { parseLedgerToolCall } from '../src/shared/ledger/tools';

// Arquivo no Slack só com carta (owner, 06/11: "preciso que o theo west seja capaz de ler e enviar arquivos pelo
// slack") — an upload passes only with an accepted letter that carries the same file, destination, thread and
// comment, once. A letter with a file frees only an upload; one without frees only a message.

const sess: LedgerActor = { kind: 'lugar', placeId: 'place:theo', roleId: 'theo-west' };
const UP = 'mcp__theo-slack__slack_enviar_arquivo';
const MSG = 'mcp__theo-slack__slack_reply_to_thread';
const PATH = '/home/x/theo-west/arquivos/print-07.png';
const FILE_LETTER: SlackLetter = { destination: 'C0CGE4DSGCQ', thread: '1793.24', text: 'Segue o print.', reason: 'mostrar o item 7', file: { path: PATH, name: 'print-07.png' } };
const upload = (over: Record<string, unknown> = {}) => ({ channel_id: 'C0CGE4DSGCQ', thread_ts: '1793.24', comentario: 'Segue o print.', caminho: PATH, ...over });

function run(doc: LedgerDoc, actor: LedgerActor, op: LedgerOp, id: string): LedgerDoc {
  const r = applyLedgerOp(doc, actor, op, { now: Date.UTC(2026, 10, 6, 20), newId: () => id });
  if (!r.ok) throw new Error(r.reason);
  return r.doc;
}
function accepted(slack: SlackLetter, id = 'c-1', doc = emptyLedgerDoc()): LedgerDoc {
  return run(run(doc, sess, { op: 'carta-slack', projectPath: '/w/bizops', slack }, id), { kind: 'dono' }, { op: 'aceitar', id }, id);
}

describe('arquivo no Slack: a trava reconhece', () => {
  const none = emptyLedgerDoc();
  it('o upload em português, sem carta, é recusado', () => {
    const verdict = slackGuard(none, UP, upload());
    expect(verdict.kind).toBe('deny');
    expect(verdict.kind === 'deny' && verdict.reason).toMatch(/carta_slack/);
  });
  it('envio de mensagem com nome em português também', () => {
    for (const name of ['slack_enviar_mensagem', 'slack_responder_thread', 'slack_postar_no_canal', 'slack_mandar_arquivo', 'slack_subir_arquivo'])
      expect(slackGuard(none, `mcp__theo-slack__${name}`, { channel_id: 'C1', text: 'oi' }).kind, name).toBe('deny');
  });
  it('baixar e ler não são envio', () => {
    expect(slackGuard(none, 'mcp__theo-slack__slack_baixar_arquivo', { arquivo: 'F0123' }).kind).toBe('not-slack');
    expect(slackGuard(none, 'mcp__theo-slack__slack_get_channel_history', { channel_id: 'C1' }).kind).toBe('not-slack');
    expect(slackGuard(none, 'mcp__theo-slack__slack_add_reaction', { channel_id: 'C1', timestamp: '1.2', reaction: 'eyes' }).kind).toBe('not-slack');
  });
});

describe('arquivo no Slack: a carta com o arquivo libera um upload', () => {
  const doc = accepted(FILE_LETTER);
  const v = (tool: string, input: unknown, d = doc) => slackGuard(d, tool, input).kind;

  it('o mesmo arquivo, destino, thread e comentário passa (nome vindo do fim do caminho ou dito igual)', () => {
    expect(v(UP, upload())).toBe('allow');
    expect(v(UP, upload({ nome: 'print-07.png' }))).toBe('allow');
    expect(v(UP, { channel_id: 'C0CGE4DSGCQ', thread_ts: '1793.24', initial_comment: 'Segue o print.', file_path: PATH })).toBe('allow');
  });
  it('qualquer diferença recusa', () => {
    expect(v(UP, upload({ caminho: '/home/x/theo-west/arquivos/outro.png' })), 'outro arquivo').toBe('deny');
    expect(v(UP, upload({ nome: 'outro-nome.png' })), 'outro nome no Slack').toBe('deny');
    expect(v(UP, upload({ comentario: 'Segue o print!' })), 'outro comentário').toBe('deny');
    expect(v(UP, upload({ thread_ts: undefined })), 'fora da thread').toBe('deny');
    expect(v(UP, upload({ channel_id: 'C999' })), 'outro canal').toBe('deny');
    expect(v(UP, upload({ caminho: undefined })), 'sem caminho').toBe('deny');
    expect(v(UP, upload({ conteudo: 'base64...' })), 'campo que a carta não mostra').toBe('deny');
    expect(v(UP, upload({ path: '/tmp/outro.png' })), 'dois caminhos que discordam').toBe('deny');
  });
  it('a carta com arquivo não libera mensagem só com o comentário, e a de texto não libera upload', () => {
    expect(v(MSG, { channel_id: 'C0CGE4DSGCQ', thread_ts: '1793.24', text: 'Segue o print.' })).toBe('deny');
    const textOnly = accepted({ destination: 'C0CGE4DSGCQ', thread: '1793.24', text: 'Segue o print.', reason: 'x' }, 'c-2');
    expect(v(UP, upload(), textOnly)).toBe('deny');
    expect(v(MSG, { channel_id: 'C0CGE4DSGCQ', thread_ts: '1793.24', text: 'Segue o print.' }, textOnly)).toBe('allow');
  });
  it('upload do Composio, com o conteúdo dentro da chamada, segue recusado mesmo com carta', () => {
    expect(v('mcp__composio__SLACK_UPLOAD_OR_CREATE_A_FILE_IN_SLACK', { channels: 'C0CGE4DSGCQ', thread_ts: '1793.24', initial_comment: 'Segue o print.', content: 'y' })).toBe('deny');
  });
  it('carta usada não libera de novo', () => {
    const used = run(doc, sess, { op: 'slack-enviada', id: 'c-1' }, 'c-1');
    expect(v(UP, upload(), used)).toBe('deny');
  });
  it('o arquivo sobrevive à gravação, e um arquivo ilegível derruba a carta inteira', () => {
    const again = parseLedgerDoc(JSON.parse(JSON.stringify(doc)) as unknown);
    expect(again.tasks['c-1']?.slack?.file).toEqual({ path: PATH, name: 'print-07.png' });
    const broken = JSON.parse(JSON.stringify(doc)) as { tasks: Record<string, { slack: { file: unknown } }> };
    broken.tasks['c-1']!.slack.file = { path: '' };
    expect(parseLedgerDoc(broken as unknown).tasks['c-1']?.slack).toBeUndefined();
  });
});

describe('arquivo no Slack: pela ferramenta carta_slack', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });
  const caller: LedgerCaller = { projectPath: '/w/bizops', placeId: 'place:theo', roleId: 'theo-west', boardPlaceIds: ['place:theo'] };

  it('a carta leva o caminho e o nome, o dono lê que vai um arquivo, e aceita libera um upload só', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'slack-arquivo-'));
    dirs.push(dir);
    let clock = Date.UTC(2026, 10, 6, 20);
    const ledger = createLedgerService({ filePath: join(dir, 'ledger.json'), io: createSystemConfigIoDeps(), proofFs: nodeLedgerProofFs, now: () => (clock += 1000) });
    expect(parseLedgerToolCall('carta_slack', { destino: 'C1', texto: 'x', motivo: 'y', arquivoNome: 'a.png' }).ok).toBe(false);
    const parsed = parseLedgerToolCall('carta_slack', { destino: 'C0CGE4DSGCQ', destinoNome: '#retiro-ai', thread: '1793.24', texto: 'Segue o print.', motivo: 'mostrar o item 7', arquivo: PATH });
    if (!parsed.ok) throw new Error(parsed.reason);
    const created = await runLedgerTool(ledger, caller, parsed.call);
    const id = (JSON.parse(created.text) as { id: string }).id;
    const task = ledger.load().doc.tasks[id]!;
    expect(task.slack?.file).toEqual({ path: PATH, name: 'print-07.png' });
    expect(task.title).toBe('Arquivo no Slack para #retiro-ai');
    const delivery = task.events.at(-1)!;
    expect(delivery.forOwner?.question).toBe('Posso mandar este arquivo no Slack em seu nome?');
    expect(delivery.proofs?.map((proof) => (proof.kind === 'texto' ? proof.text : ''))).toEqual(['Segue o print.', expect.stringContaining('print-07.png')]);

    expect(guardSlackSend(ledger, UP, upload())).toMatch(/bloqueado/);
    expect(ledger.apply({ kind: 'dono' }, { op: 'aceitar', id }).ok).toBe(true);
    expect(guardSlackSend(ledger, UP, upload())).toBeNull();
    expect(guardSlackSend(ledger, UP, upload())).toMatch(/bloqueado/);
    const seen = await runLedgerTool(ledger, caller, { tool: 'tarefa_ver', id });
    expect(seen.text).toContain('"arquivoNome": "print-07.png"');
  });
});

describe('arquivo no Slack: com o app fora do ar', () => {
  it('o padrão da trava de fora do ar pega o upload e o envio em português, e deixa baixar', () => {
    const offline = new RegExp(SLACK_OFFLINE_PATTERN, 'i');
    const payload = (tool: string) => JSON.stringify({ tool_name: tool, tool_input: {} });
    expect(offline.test(payload(UP))).toBe(true);
    expect(offline.test(payload('mcp__theo-slack__slack_enviar_mensagem'))).toBe(true);
    expect(offline.test(payload('mcp__theo-slack__slack_baixar_arquivo'))).toBe(false);
  });
});
