import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createSystemConfigIoDeps } from '../src/main/config-store';
import { createHookBridge } from '../src/main/hook-bridge';
import { createLedgerService, createSlackLetterGuard, LETTER_IN_FLIGHT_MS, nodeLedgerProofFs, runLedgerTool, type LedgerCaller } from '../src/main/ledger-store';
import { parseLedgerToolCall, type LedgerToolCall } from '../src/shared/ledger/tools';

// Slack só com carta (owner, 05/11) — a message to Slack in the owner's name leaves only with an accepted letter
// of the same destination, thread and exact text, once. Both sides, through the real ledger on disk.

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

describe('Slack só com carta', () => {
  it('refuses every way of posting without a letter, and teaches the session to write one', async () => {
    const ledger = service();
    for (const [tool, input] of [slackMcp(TEXT), composio(TEXT), curl(TEXT), script(TEXT), ['mcp__composio__SLACK_SEND_MESSAGE', { channel: 'C0123ABC', text: TEXT }] as const]) {
      const refusal = await guardSlackSend(ledger, tool, input);
      expect(refusal, tool).toMatch(/carta_slack/);
    }
    // A letter still waiting for the owner, or rejected, frees nothing.
    await letter(ledger, null);
    await letter(ledger, 'rejeitar');
    expect(await guardSlackSend(ledger, ...slackMcp(TEXT))).toMatch(/bloqueado/);
    // Reading Slack, a draft, or any other tool is not a post.
    expect(await guardSlackSend(ledger, 'mcp__claude_ai_Slack__slack_read_channel', { channel_id: 'C0123ABC' })).toBeNull();
    expect(await guardSlackSend(ledger, 'mcp__claude_ai_Slack__slack_send_message_draft', { channel_id: 'C0123ABC', message: 'x' })).toBeNull();
    expect(await guardSlackSend(ledger, 'Bash', { command: 'git status' })).toBeNull();
  });

  it('an accepted letter frees exactly one structured send of the same text to the same destination and thread', async () => {
    const ways: ReadonlyArray<(text: string) => readonly [string, unknown]> = [slackMcp, composio];
    for (const send of ways) {
      const ledger = service();
      if (send === composio) {
        const created = await runLedgerTool(ledger, dev, call('carta_slack', { destino: '#produto', thread: '1730.42', texto: TEXT, motivo: 'avisar' }));
        await ledger.apply({ kind: 'dono' }, { op: 'aceitar', id: (JSON.parse(created.text) as { id: string }).id });
      } else await letter(ledger, 'aceitar');
      expect(await guardSlackSend(ledger, ...send(`${TEXT} `)), 'different text').toMatch(/bloqueado/);
      expect(await guardSlackSend(ledger, ...send(TEXT)), 'same text').toBeNull();
      expect(await guardSlackSend(ledger, ...send(TEXT)), 'second send').toMatch(/bloqueado/);
      const seen = await runLedgerTool(ledger, dev, call('tarefa_listar', { situacao: 'todas' }));
      expect(seen.text).toContain('"enviada": true');
    }
    const ledger = service();
    await letter(ledger, 'aceitar');
    expect(await guardSlackSend(ledger, ...slackMcp(TEXT, 'C9999')), 'other channel').toMatch(/bloqueado/);
    // The terminal never approves a post, even with the accepted text in it: it cannot be read field by field.
    expect(await guardSlackSend(ledger, ...curl(TEXT))).toMatch(/terminal/);
    expect(await guardSlackSend(ledger, ...script(TEXT))).toMatch(/canal-produto/);
    expect(await guardSlackSend(ledger, ...slackMcp(TEXT)), 'the letter is still unused').toBeNull();
  });

  // t-8119864a: the MCP answered "fetch failed" and the letter was spent. Only an EXPLICIT failure gives it back,
  // and only once; a doubt (no answer, an answer that shows nothing) spends it. Review of #266: 4 of 4 sends passed.
  const view = async (ledger: ReturnType<typeof createLedgerService>, id: string) =>
    (JSON.parse((await runLedgerTool(ledger, dev, call('tarefa_ver', { id }))).text) as { cartaSlack: { enviada: boolean; envio?: string } }).cartaSlack;

  it('t-8119864a: an explicit failure frees one resend; the third send is refused', async () => {
    for (const failure of [
      async (send: Awaited<ReturnType<typeof attempt>>) => await send.answer('PostToolUse', [{ type: 'text', text: 'Error: fetch failed' }]),
      async (send: Awaited<ReturnType<typeof attempt>>) => await send.answer('PostToolUseFailure'),
      async (send: Awaited<ReturnType<typeof attempt>>) => await send.answer('PostToolUse', { isError: true, content: [{ type: 'text', text: 'connect ECONNREFUSED 127.0.0.1:443' }] }),
      async (send: Awaited<ReturnType<typeof attempt>>) => await send.answer('PostToolUse', { ok: false, error: 'channel_not_found' }),
      async (send: Awaited<ReturnType<typeof attempt>>) => await send.answer('PostToolUse', { successful: false, error: 'Slack API error' }),
    ]) {
      const ledger = service();
      const id = await letter(ledger, 'aceitar');
      const first = await attempt(ledger, ...slackMcp(TEXT));
      expect(first.refusal).toBeNull();
      expect((await attempt(ledger, ...slackMcp(TEXT))).refusal, 'a second send while the first is in flight').toMatch(/bloqueado/);
      await failure(first);
      expect(await view(ledger, id)).toMatchObject({ enviada: false, envio: expect.stringMatching(/falhou/) });

      const resend = await attempt(ledger, ...slackMcp(TEXT));
      expect(resend.refusal, 'the one resend').toBeNull();
      await resend.answer('PostToolUse', SENT);
      expect(await view(ledger, id)).toMatchObject({ enviada: true, envio: expect.stringMatching(/confirmado/) });
      expect((await attempt(ledger, ...slackMcp(TEXT))).refusal, 'third send').toMatch(/bloqueado/);
    }
    // Two explicit failures in a row: the letter is used up, never a third try.
    const ledger = service();
    const id = await letter(ledger, 'aceitar');
    for (let i = 0; i < 2; i++) {
      const send = await attempt(ledger, ...slackMcp(TEXT));
      expect(send.refusal).toBeNull();
      await send.answer('PostToolUseFailure');
    }
    expect((await attempt(ledger, ...slackMcp(TEXT))).refusal).toMatch(/bloqueado/);
    expect((await view(ledger, id)).envio).toMatch(/esgotou/);
  });

  it('a success that shows only in text spends the letter, and a doubt spends it too ("envio sem confirmação")', async () => {
    const answers: Array<[unknown, RegExp]> = [
      [[{ type: 'text', text: 'Message sent successfully to #produto. Link: https://seazone.slack.com/archives/C0123ABC/p1730900000123456' }], /confirmado/],
      [[{ type: 'text', text: 'Mensagem enviada (ts 1730900000.123456)' }], /confirmado/],
      [[{ type: 'text', text: 'Message sent successfully to #produto.' }], /sem confirmação/],
      [undefined, /sem confirmação/],
      [{ ok: true, warning: 'fetch failed on unfurl' }, /sem confirmação/], // success and failure at once: a doubt
    ];
    for (const [response, label] of answers) {
      const ledger = service();
      const id = await letter(ledger, 'aceitar');
      const send = await attempt(ledger, ...slackMcp(TEXT));
      expect(send.refusal).toBeNull();
      await send.answer('PostToolUse', response);
      expect(await view(ledger, id)).toMatchObject({ enviada: true, envio: expect.stringMatching(label) });
      expect((await attempt(ledger, ...slackMcp(TEXT))).refusal, `second send after ${JSON.stringify(response)}`).toMatch(/bloqueado/);
    }
  });

  it('a PostToolUse that never comes spends the letter: past the deadline, after a restart, never freed', async () => {
    const ledger = service();
    const id = await letter(ledger, 'aceitar');
    let clock = 0;
    const guard = createSlackLetterGuard(() => ledger, () => clock);
    const payload = { tool_name: slackMcp(TEXT)[0], tool_input: slackMcp(TEXT)[1], tool_use_id: 'toolu_lost' };
    expect(await guard.before('pty-1', payload)).toBeNull();
    clock += LETTER_IN_FLIGHT_MS + 1;
    expect(await guard.before('pty-1', { ...payload, tool_use_id: 'toolu_late' }), 'past the deadline').toMatch(/bloqueado/);
    // The failure that arrives too late, or reaches an app that restarted, reopens nothing.
    guard.after('pty-1', 'PostToolUseFailure', payload);
    const restarted = createSlackLetterGuard(() => ledger, () => clock);
    restarted.after('pty-1', 'PostToolUseFailure', payload);
    for (let i = 0; i < 4; i++) expect(await restarted.before('pty-1', { ...payload, tool_use_id: `toolu_again_${i}` })).toMatch(/bloqueado/);
    expect(await view(ledger, id)).toMatchObject({ enviada: true, envio: expect.stringMatching(/sem confirmação/) });
  });

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
    expect(await guardSlackSend(ledger, ...slackMcp(TEXT))).toMatch(/bloqueado/);
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
