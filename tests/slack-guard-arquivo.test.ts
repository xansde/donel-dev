import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createSystemConfigIoDeps } from '../src/main/config-store';
import { buildSlackOfflineGuardScript, SLACK_GUARD_FILE_LETTER_MARK, SLACK_OFFLINE_PATTERN } from '../src/main/hooks-settings';
import { createLedgerService, nodeLedgerProofFs, runLedgerTool, type LedgerCaller } from '../src/main/ledger-store';
import { applyLedgerOp, emptyLedgerDoc, LEDGER_SCHEMA_VERSION, parseLedgerDoc, type LedgerActor, type LedgerDoc, type LedgerOp, type SlackLetter } from '../src/shared/ledger/contract';
import { slackGuard } from '../src/shared/ledger/slack-guard';
import { parseLedgerToolCall, type LedgerToolCall } from '../src/shared/ledger/tools';

// Arquivo no Slack só com carta (owner, 06/11: "preciso que o theo west seja capaz de ler e enviar arquivos pelo
// slack") — an upload passes only with an accepted letter that carries the same file, destination, thread and
// comment. A letter with a file frees only an upload; one without frees only a message. Still ledger v4: an older
// app (Alfa 0.4.0, beta) reads a letter with a file as absent, never as a text letter.

const sess: LedgerActor = { kind: 'lugar', placeId: 'place:theo', roleId: 'theo-west' };
const UP = 'mcp__theo-slack__slack_enviar_arquivo';
const MSG = 'mcp__theo-slack__slack_reply_to_thread';
const PATH = '/home/x/theo-west/arquivos/print-07.png';
const COMMENT = 'Segue o print.';
const FILE_LETTER: SlackLetter = { destination: 'C0CGE4DSGCQ', thread: '1793.24', text: '', reason: 'mostrar o item 7', file: { path: PATH, name: 'print-07.png', comment: COMMENT } };
const upload = (over: Record<string, unknown> = {}) => ({ channel_id: 'C0CGE4DSGCQ', thread_ts: '1793.24', comentario: COMMENT, caminho: PATH, ...over });
const message = { channel_id: 'C0CGE4DSGCQ', thread_ts: '1793.24', text: COMMENT };

function run(doc: LedgerDoc, actor: LedgerActor, op: LedgerOp, id: string): LedgerDoc {
  const r = applyLedgerOp(doc, actor, op, { now: Date.UTC(2026, 10, 6, 20), newId: () => id });
  if (!r.ok) throw new Error(r.reason);
  return r.doc;
}
function accepted(slack: SlackLetter, id = 'c-1', doc = emptyLedgerDoc()): LedgerDoc {
  return run(run(doc, sess, { op: 'carta-slack', projectPath: '/w/bizops', slack }, id), { kind: 'dono' }, { op: 'aceitar', id }, id);
}

/**
 * The v4 rule of an older app (staging before this change, Alfa 0.4.0), copied as is: a letter without a
 * destination, text or reason, or with an empty text, is no letter.
 */
function v4ReadsLetter(raw: Record<string, unknown>): boolean {
  const str = (v: unknown): v is string => typeof v === 'string';
  return str(raw.destination) && str(raw.text) && str(raw.reason) && raw.destination.trim() !== '' && raw.text.trim() !== '' && raw.reason.trim() !== '';
}

describe('arquivo no Slack: a trava confere o upload', () => {
  const doc = accepted(FILE_LETTER);
  const v = (tool: string, input: unknown, d = doc) => slackGuard(d, tool, input).kind;

  it('sem carta é recusado; baixar não é envio', async () => {
    expect(v(UP, upload(), emptyLedgerDoc())).toBe('deny');
    expect(v('mcp__theo-slack__slack_baixar_arquivo', { arquivo: 'F0123' }, emptyLedgerDoc())).toBe('not-slack');
  });
  it('o mesmo arquivo, destino, thread e comentário passa', async () => {
    expect(v(UP, upload())).toBe('allow');
    expect(v(UP, upload({ nome: 'print-07.png' }))).toBe('allow');
    expect(v(UP, { channel_id: 'C0CGE4DSGCQ', thread_ts: '1793.24', initial_comment: COMMENT, file_path: PATH })).toBe('allow');
    expect(v(UP, { channel_id: 'C0CGE4DSGCQ', thread_ts: '1793.24', comment: COMMENT, path: PATH })).toBe('allow');
  });
  it('qualquer diferença recusa', async () => {
    expect(v(UP, upload({ caminho: '/home/x/theo-west/arquivos/outro.png' })), 'outro arquivo').toBe('deny');
    expect(v(UP, upload({ nome: 'outro-nome.png' })), 'outro nome no Slack').toBe('deny');
    expect(v(UP, upload({ comentario: 'Segue o print!' })), 'outro comentário').toBe('deny');
    expect(v(UP, upload({ thread_ts: undefined })), 'fora da thread').toBe('deny');
    expect(v(UP, upload({ channel_id: 'C999' })), 'outro canal').toBe('deny');
    expect(v(UP, upload({ caminho: undefined })), 'sem caminho').toBe('deny');
    expect(v(UP, upload({ path: '/tmp/outro.png' })), 'dois caminhos que discordam').toBe('deny');
  });
  it('só comment, initial_comment e comentario são o comentário: content, body, text e message recusam', async () => {
    for (const key of ['content', 'body', 'text', 'message', 'markdown_text', 'blocks'])
      expect(v(UP, upload({ [key]: key === 'blocks' ? [{ type: 'section' }] : COMMENT })), `${key} junto do comentário`).toBe('deny');
    expect(v(UP, { channel_id: 'C0CGE4DSGCQ', thread_ts: '1793.24', text: COMMENT, caminho: PATH }), 'text no lugar do comentário').toBe('deny');
    expect(v(UP, { channel_id: 'C0CGE4DSGCQ', thread_ts: '1793.24', body: COMMENT, caminho: PATH }), 'body no lugar do comentário').toBe('deny');
  });
  it('carta com arquivo não libera mensagem com o comentário, e carta de texto não libera upload', async () => {
    expect(v(MSG, message)).toBe('deny');
    const textOnly = accepted({ destination: 'C0CGE4DSGCQ', thread: '1793.24', text: COMMENT, reason: 'x' }, 'c-2');
    expect(v(UP, upload(), textOnly)).toBe('deny');
    expect(v(MSG, message, textOnly)).toBe('allow');
  });
  it('upload do Composio, com o conteúdo na chamada, segue recusado mesmo com carta', async () => {
    expect(v('mcp__composio__SLACK_UPLOAD_OR_CREATE_A_FILE_IN_SLACK', { channels: 'C0CGE4DSGCQ', thread_ts: '1793.24', initial_comment: COMMENT, content: 'y' })).toBe('deny');
  });
});

describe('arquivo no Slack: sem mudar a versão do Oráculo (v4)', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it('grava v4, com o comentário no arquivo e o texto vazio, que um app v4 lê como carta nenhuma', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'slack-arquivo-v4-'));
    dirs.push(dir);
    const filePath = join(dir, 'ledger.json');
    let clock = Date.UTC(2026, 10, 6, 20);
    const open = () => createLedgerService({ filePath, io: createSystemConfigIoDeps(), proofFs: nodeLedgerProofFs, now: () => (clock += 1000) });
    const ledger = open();
    const created = await ledger.apply(sess, { op: 'carta-slack', projectPath: '/w/bizops', slack: FILE_LETTER });
    if (!created.ok) throw new Error(created.reason);
    const id = created.task.id;
    expect((await ledger.apply({ kind: 'dono' }, { op: 'aceitar', id })).ok).toBe(true);

    expect(LEDGER_SCHEMA_VERSION).toBe(4);
    const written = JSON.parse(readFileSync(filePath, 'utf8')) as { schemaVersion: number; tasks: Record<string, { slack?: Record<string, unknown>; state: string }> };
    expect(written.schemaVersion).toBe(4);
    expect(written.tasks[id]!.slack).toMatchObject({ text: '', file: { path: PATH, name: 'print-07.png', comment: COMMENT } });
    // The older app's rule: no letter here. Its guard frees nothing for it: neither the upload nor the comment.
    expect(v4ReadsLetter(written.tasks[id]!.slack!)).toBe(false);

    // The older app rewrites the file (any write): the letter it could not read is gone, the task stays.
    delete written.tasks[id]!.slack;
    writeFileSync(filePath, JSON.stringify(written));
    const after = open().load().doc;
    expect(after.tasks[id]?.state).toBe('aceita');
    expect(after.tasks[id]?.slack).toBeUndefined();
    expect(slackGuard(after, UP, upload()).kind, 'o upload não passa').toBe('deny');
    expect(slackGuard(after, MSG, message).kind, 'nem o comentário como mensagem').toBe('deny');
  });

  it('se o arquivo sumir da carta e sobrar só o texto vazio, a carta é descartada inteira: o upload não passa', async () => {
    const doc = accepted(FILE_LETTER);
    const raw = JSON.parse(JSON.stringify(doc)) as { tasks: Record<string, { slack: Record<string, unknown> }> };
    delete raw.tasks['c-1']!.slack.file;
    const reread = parseLedgerDoc(raw as unknown);
    expect(reread.tasks['c-1']?.slack).toBeUndefined();
    expect(slackGuard(reread, UP, upload()).kind).toBe('deny');
    expect(slackGuard(reread, MSG, message).kind).toBe('deny');
    // A file that cannot be read also drops the letter, and a round trip keeps a good one.
    const broken = JSON.parse(JSON.stringify(doc)) as { tasks: Record<string, { slack: { file: unknown } }> };
    broken.tasks['c-1']!.slack.file = { path: PATH, name: 'print-07.png' };
    expect(parseLedgerDoc(broken as unknown).tasks['c-1']?.slack).toBeUndefined();
    expect(parseLedgerDoc(JSON.parse(JSON.stringify(doc)) as unknown).tasks['c-1']?.slack?.file).toEqual(FILE_LETTER.file);
  });

  it('uma carta com arquivo e texto não vazio é recusada (é a que um app v4 leria como de texto)', async () => {
    const r = applyLedgerOp(emptyLedgerDoc(), sess, { op: 'carta-slack', projectPath: '/w', slack: { ...FILE_LETTER, text: COMMENT } }, { now: 1, newId: () => 'c-1' });
    expect(r.ok).toBe(false);
  });
});

describe('arquivo no Slack: pela ferramenta carta_slack e a resposta do upload', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });
  const caller: LedgerCaller = { projectPath: '/w/bizops', placeId: 'place:theo', roleId: 'theo-west', boardPlaceIds: ['place:theo'] };
  const call = (name: string, args: unknown): LedgerToolCall => {
    const parsed = parseLedgerToolCall(name, args);
    if (!parsed.ok) throw new Error(parsed.reason);
    return parsed.call;
  };
  function service() {
    const dir = mkdtempSync(join(tmpdir(), 'slack-arquivo-'));
    dirs.push(dir);
    let clock = Date.UTC(2026, 10, 6, 20);
    return createLedgerService({ filePath: join(dir, 'ledger.json'), io: createSystemConfigIoDeps(), proofFs: nodeLedgerProofFs, now: () => (clock += 1000) });
  }
  async function fileLetter(ledger: ReturnType<typeof service>, accept: boolean): Promise<string> {
    const created = await runLedgerTool(ledger, caller, call('carta_slack', { destino: 'C0CGE4DSGCQ', destinoNome: '#retiro-ai', thread: '1793.24', texto: COMMENT, motivo: 'mostrar o item 7', arquivo: PATH }));
    const id = (JSON.parse(created.text) as { id: string }).id;
    if (accept) expect((await ledger.apply({ kind: 'dono' }, { op: 'aceitar', id })).ok).toBe(true);
    return id;
  }
  const view = async (ledger: ReturnType<typeof service>, id: string) =>
    (JSON.parse((await runLedgerTool(ledger, caller, call('tarefa_ver', { id }))).text) as { cartaSlack: Record<string, unknown> }).cartaSlack;
  it('a carta leva caminho, nome e comentário, e o dono lê que vai um arquivo', async () => {
    const ledger = service();
    expect(parseLedgerToolCall('carta_slack', { destino: 'C1', texto: 'x', motivo: 'y', arquivoNome: 'a.png' }).ok).toBe(false);
    const id = await fileLetter(ledger, false);
    const task = ledger.load().doc.tasks[id]!;
    expect(task.slack).toMatchObject({ text: '', file: { path: PATH, name: 'print-07.png', comment: COMMENT } });
    expect(task.title).toBe('Arquivo no Slack para #retiro-ai');
    const delivery = task.events.at(-1)!;
    expect(delivery.forOwner?.question).toBe('Posso mandar este arquivo no Slack em seu nome?');
    expect(delivery.proofs?.map((proof) => (proof.kind === 'texto' ? proof.text : ''))).toEqual([COMMENT, expect.stringContaining('print-07.png')]);
    expect(await view(ledger, id)).toMatchObject({ texto: COMMENT, arquivo: PATH, arquivoNome: 'print-07.png' });
  });
});

describe('arquivo no Slack: com o app fora do ar', () => {
  it('o script da trava diz que confere carta com arquivo, e o padrão pega o upload e deixa baixar', async () => {
    expect(buildSlackOfflineGuardScript({ port: 1, tokenHeaderPath: '/x/hook-header' }).split('\n')).toContain(`# ${SLACK_GUARD_FILE_LETTER_MARK}`);
    const offline = new RegExp(SLACK_OFFLINE_PATTERN, 'i');
    const payload = (tool: string) => JSON.stringify({ tool_name: tool, tool_input: {} });
    expect(offline.test(payload(UP))).toBe(true);
    expect(offline.test(payload('mcp__theo-slack__slack_baixar_arquivo'))).toBe(false);
  });
});
