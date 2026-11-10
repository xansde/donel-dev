import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createSystemConfigIoDeps } from '../src/main/config-store';
import { createHookBridge } from '../src/main/hook-bridge';
import { createLedgerService, createSlackLetterGuard, nodeLedgerProofFs, runLedgerTool, type LedgerCaller } from '../src/main/ledger-store';
import { parseLedgerToolCall, type LedgerToolCall } from '../src/shared/ledger/tools';

// Slack letters (owner, 05/11) were a lock until 09/11: now a letter is an optional check by the owner and never
// refuses a post (owner, 09/11). Both sides, through the real ledger on disk.

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function service(): ReturnType<typeof createLedgerService> {
  const dir = mkdtempSync(join(tmpdir(), 'slack-guard-'));
  dirs.push(dir);
  let clock = Date.UTC(2026, 10, 5, 15);
  return createLedgerService({ filePath: join(dir, 'ledger.json'), io: createSystemConfigIoDeps(), proofFs: nodeLedgerProofFs, now: () => (clock += 1000) });
}

function call(name: string, args: unknown): LedgerToolCall {
  const parsed = parseLedgerToolCall(name, args);
  if (!parsed.ok) throw new Error(parsed.reason);
  return parsed.call;
}

// The bridge's two sides: `PreToolUse` frees (or refuses) the call and spends its letter, `PostToolUse` records the
// answer (only an explicit failure reopens it). `guardSlackSend` = a call whose send went through (both sides).
const guards = new WeakMap<object, ReturnType<typeof createSlackLetterGuard>>();
const guardOf = (ledger: ReturnType<typeof createLedgerService>) => {
  if (!guards.has(ledger)) guards.set(ledger, createSlackLetterGuard(() => ledger));
  return guards.get(ledger)!;
};
let nextUse = 0;
async function attempt(ledger: ReturnType<typeof createLedgerService>, tool: string, input: unknown): Promise<{ refusal: string | null; answer(event: string, response?: unknown): Promise<void> | void }> {
  const payload = { tool_name: tool, tool_input: input, tool_use_id: `toolu_${++nextUse}` };
  const refusal = await guardOf(ledger).before('pty-1', payload);
  return { refusal, answer: (event, response) => guardOf(ledger).after('pty-1', event, { ...payload, tool_response: response }) };
}
const SENT = [{ type: 'text', text: JSON.stringify({ ok: true, channel: 'C0123ABC', ts: '1730900000.123456' }) }];
async function guardSlackSend(ledger: ReturnType<typeof createLedgerService>, tool: string, input: unknown): Promise<string | null> {
  const call = await attempt(ledger, tool, input);
  if (call.refusal === null) await call.answer('PostToolUse', SENT);
  return call.refusal;
}

const dev: LedgerCaller = { projectPath: 'C:/p', placeId: 'place:dev', roleId: 'dev', boardPlaceIds: ['place:dev'] };
const TEXT = 'Deploy do "atlas" saiu.\nQualquer coisa me chamem — é só responder aqui.';

async function letter(ledger: ReturnType<typeof createLedgerService>, decide: 'aceitar' | 'rejeitar' | null, text = TEXT): Promise<string> {
  const created = await runLedgerTool(ledger, dev, call('carta_slack', { destino: 'C0123ABC', destinoNome: '#produto', thread: '1730.42', texto: text, motivo: 'avisar o time do deploy' }));
  expect(created.ok).toBe(true);
  const id = (JSON.parse(created.text) as { id: string }).id;
  if (decide === 'aceitar') expect((await ledger.apply({ kind: 'dono' }, { op: 'aceitar', id })).ok).toBe(true);
  if (decide === 'rejeitar') expect((await ledger.apply({ kind: 'dono' }, { op: 'rejeitar', id, reason: 'tira o travessão' })).ok).toBe(true);
  return id;
}

const slackMcp = (text: string, channel = 'C0123ABC') => ['mcp__claude_ai_Slack__slack_send_message', { channel_id: channel, thread_ts: '1730.42', message: text }] as const;
const composio = (text: string) =>
  ['mcp__composio__COMPOSIO_MULTI_EXECUTE_TOOL', { tools: [{ tool_slug: 'SLACK_SEND_MESSAGE', arguments: { channel: '#produto', thread_ts: '1730.42', markdown_text: text } }] }] as const;
const curl = (text: string) =>
  ['Bash', { command: `curl -s -X POST https://slack.com/api/chat.postMessage -H "Authorization: Bearer $T" -H 'Content-type: application/json' -d '${JSON.stringify({ channel: 'C0123ABC', thread_ts: '1730.42', text }).replaceAll("'", `'\\''`)}'` }] as const;
const script = (text: string) => ['Bash', { command: `node scripts/canal-produto.js responder C0123ABC 1730.42 "${text.replaceAll('"', '\\"')}"` }] as const;

describe('Slack sem trava de carta', () => {
  // Owner, 09/11: "Não quero que cartas travem nada também." No post to Slack is refused for lack of a letter: not by
  // the MCP of Slack, not by Composio (direct or inside an execute call), not by the terminal, with no letter, with
  // one still waiting, with one rejected, or with an accepted one already spent.
  it('never refuses a post to Slack, with or without a letter', async () => {
    const ledger = service();
    const ways = [slackMcp(TEXT), composio(TEXT), curl(TEXT), script(TEXT), ['mcp__composio__SLACK_SEND_MESSAGE', { channel: 'C0123ABC', text: TEXT }] as const];
    for (const [tool, input] of ways) expect(await guardSlackSend(ledger, tool, input), tool).toBeNull();
    await letter(ledger, null);
    await letter(ledger, 'rejeitar');
    for (const [tool, input] of ways) expect(await guardSlackSend(ledger, tool, input), `${tool} with letters`).toBeNull();
    const id = await letter(ledger, 'aceitar');
    for (let i = 0; i < 3; i++) expect(await guardSlackSend(ledger, ...slackMcp(TEXT)), `send ${i + 1}`).toBeNull();
    // An accepted letter is still marked as sent by the matching send.
    expect(await view(ledger, id)).toMatchObject({ enviada: true });
  });

  const view = async (ledger: ReturnType<typeof createLedgerService>, id: string) =>
    (JSON.parse((await runLedgerTool(ledger, dev, call('tarefa_ver', { id }))).text) as { cartaSlack: { enviada: boolean; envio?: string } }).cartaSlack;

  it('the answers of a send stay in the v4 format: an Alfa 0.4.0 on the same ledger.json reads, rewrites and keeps them', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'slack-guard-v4-'));
    dirs.push(dir);
    const filePath = join(dir, 'ledger.json');
    let clock = Date.UTC(2026, 10, 6, 15);
    const open = () => createLedgerService({ filePath, io: createSystemConfigIoDeps(), proofFs: nodeLedgerProofFs, now: () => (clock += 1000) });
    const ledger = open();
    const confirmed = await letter(ledger, 'aceitar'); // failed, resent, confirmed
    const failed = await letter(ledger, 'aceitar', `${TEXT}!`); // failed once: frees the resend here
    const unconfirmed = await letter(ledger, 'aceitar', `${TEXT}?`); // a doubt
    const first = await attempt(ledger, ...slackMcp(TEXT));
    await first.answer('PostToolUse', [{ type: 'text', text: 'Error: fetch failed' }]);
    await (await attempt(ledger, ...slackMcp(TEXT))).answer('PostToolUse', SENT);
    await (await attempt(ledger, ...slackMcp(`${TEXT}!`))).answer('PostToolUseFailure');
    await (await attempt(ledger, ...slackMcp(`${TEXT}?`))).answer('PostToolUse', [{ type: 'text', text: 'Message sent.' }]);

    // What v4 knows (staging before this PR, Alfa 0.4.0): the version, the event kinds, the event fields.
    const V4_KINDS = ['criada', 'assumida', 'entregue', 'aceita', 'rejeitada', 'conferida', 'comentada', 'enviada'];
    const V4_FIELDS = ['kind', 'at', 'by', 'proofs', 'text', 'requestId', 'forOwner', 'option', 'deliveredTo'];
    const written = JSON.parse(readFileSync(filePath, 'utf8')) as { schemaVersion: number; tasks: Record<string, { events: Array<Record<string, unknown>> }> };
    expect(written.schemaVersion).toBe(4);
    for (const task of Object.values(written.tasks))
      for (const event of task.events) {
        expect(V4_KINDS).toContain(event.kind);
        for (const field of Object.keys(event)) expect(V4_FIELDS).toContain(field);
      }
    // The v4 rule (any `enviada` = spent) never frees a send this code would not: an Alfa can only be stricter.
    for (const id of [confirmed, failed, unconfirmed]) expect(written.tasks[id]!.events.some((event) => event.kind === 'enviada')).toBe(true);

    // Another app reads and rewrites the file (any write: here a new letter); nothing of the letters is lost.
    await runLedgerTool(open(), dev, call('carta_slack', { destino: 'C0123ABC', texto: 'outra', motivo: 'reescrever o arquivo' }));
    const rewritten = JSON.parse(readFileSync(filePath, 'utf8')) as typeof written;
    for (const id of [confirmed, failed, unconfirmed]) expect(rewritten.tasks[id]).toEqual(written.tasks[id]);
    const reread = open();
    expect(await view(reread, confirmed)).toMatchObject({ enviada: true, envio: expect.stringMatching(/confirmado/) });
    expect(await view(reread, failed)).toMatchObject({ enviada: false, envio: expect.stringMatching(/falhou/) });
    expect(await view(reread, unconfirmed)).toMatchObject({ enviada: true, envio: expect.stringMatching(/sem confirmação/) });
  });

  it('the letter of a Slack message is a card A the owner sends or not', async () => {
    const ledger = service();
    const id = await letter(ledger, null);
    const task = ledger.load().doc.tasks[id]!;
    expect(task.title).toBe('Mensagem no Slack para #produto');
    expect(task.events.at(-1)?.forOwner?.options.map((option) => [option.label, option.closes])).toEqual([
      ['Enviar', 'aceita'],
      ['Não enviar', 'rejeitada'],
    ]);
    expect((await ledger.apply({ kind: 'dono' }, { op: 'rejeitar', id, reason: '', option: 'Não enviar' })).ok).toBe(true);
  });

  it('the hook bridge answers deny to a refused PreToolUse and never dispatches it', async () => {
    const bridge = createHookBridge({ preToolUseGuard: (_pty, payload) => (payload.tool_name === 'mcp__slack__send_message' ? 'sem carta' : null) });
    const { port } = await bridge.start();
    const token = bridge.registerSession('pty-1');
    const seen: string[] = [];
    bridge.on('pty-1', (event) => seen.push(event.type));
    const post = async (tool: string) =>
      (await fetch(`http://127.0.0.1:${port}/h/PreToolUse`, { method: 'POST', headers: { 'X-Donel-Token': token }, body: JSON.stringify({ tool_name: tool, tool_input: {} }) })).json();
    expect(await post('mcp__slack__send_message')).toEqual({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: 'sem carta' } });
    expect(seen).toEqual([]);
    expect(await post('Read')).toEqual({});
    expect(seen).toEqual(['hook']);
    await bridge.close();
  });
});
