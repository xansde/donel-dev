import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createSystemConfigIoDeps } from '../src/main/config-store';
import { createHookBridge } from '../src/main/hook-bridge';
import { createLedgerService, guardSlackSend, nodeLedgerProofFs, runLedgerTool, type LedgerCaller } from '../src/main/ledger-store';
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

const dev: LedgerCaller = { projectPath: 'C:/p', placeId: 'place:dev', roleId: 'dev', boardPlaceIds: ['place:dev'] };
const TEXT = 'Deploy do "atlas" saiu.\nQualquer coisa me chamem — é só responder aqui.';

async function letter(ledger: ReturnType<typeof createLedgerService>, decide: 'aceitar' | 'rejeitar' | null, text = TEXT): Promise<string> {
  const created = await runLedgerTool(ledger, dev, call('carta_slack', { destino: 'C0123ABC', destinoNome: '#produto', thread: '1730.42', texto: text, motivo: 'avisar o time do deploy' }));
  expect(created.ok).toBe(true);
  const id = (JSON.parse(created.text) as { id: string }).id;
  if (decide === 'aceitar') expect(ledger.apply({ kind: 'dono' }, { op: 'aceitar', id }).ok).toBe(true);
  if (decide === 'rejeitar') expect(ledger.apply({ kind: 'dono' }, { op: 'rejeitar', id, reason: 'tira o travessão' }).ok).toBe(true);
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
      const refusal = guardSlackSend(ledger, tool, input);
      expect(refusal, tool).toMatch(/carta_slack/);
    }
    // A letter still waiting for the owner, or rejected, frees nothing.
    await letter(ledger, null);
    await letter(ledger, 'rejeitar');
    expect(guardSlackSend(ledger, ...slackMcp(TEXT))).toMatch(/bloqueado/);
    // Reading Slack, a draft, or any other tool is not a post.
    expect(guardSlackSend(ledger, 'mcp__claude_ai_Slack__slack_read_channel', { channel_id: 'C0123ABC' })).toBeNull();
    expect(guardSlackSend(ledger, 'mcp__claude_ai_Slack__slack_send_message_draft', { channel_id: 'C0123ABC', message: 'x' })).toBeNull();
    expect(guardSlackSend(ledger, 'Bash', { command: 'git status' })).toBeNull();
  });

  it('an accepted letter frees exactly one structured send of the same text to the same destination and thread', async () => {
    const ways: ReadonlyArray<(text: string) => readonly [string, unknown]> = [slackMcp, composio];
    for (const send of ways) {
      const ledger = service();
      if (send === composio) {
        const created = await runLedgerTool(ledger, dev, call('carta_slack', { destino: '#produto', thread: '1730.42', texto: TEXT, motivo: 'avisar' }));
        ledger.apply({ kind: 'dono' }, { op: 'aceitar', id: (JSON.parse(created.text) as { id: string }).id });
      } else await letter(ledger, 'aceitar');
      expect(guardSlackSend(ledger, ...send(`${TEXT} `)), 'different text').toMatch(/bloqueado/);
      expect(guardSlackSend(ledger, ...send(TEXT)), 'same text').toBeNull();
      expect(guardSlackSend(ledger, ...send(TEXT)), 'second send').toMatch(/bloqueado/);
      const seen = await runLedgerTool(ledger, dev, call('tarefa_listar', { situacao: 'todas' }));
      expect(seen.text).toContain('"enviada": true');
    }
    const ledger = service();
    await letter(ledger, 'aceitar');
    expect(guardSlackSend(ledger, ...slackMcp(TEXT, 'C9999')), 'other channel').toMatch(/bloqueado/);
    // The terminal never approves a post, even with the accepted text in it: it cannot be read field by field.
    expect(guardSlackSend(ledger, ...curl(TEXT))).toMatch(/terminal/);
    expect(guardSlackSend(ledger, ...script(TEXT))).toMatch(/canal-produto/);
    expect(guardSlackSend(ledger, ...slackMcp(TEXT)), 'the letter is still unused').toBeNull();
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
    expect(ledger.apply({ kind: 'dono' }, { op: 'rejeitar', id, reason: '', option: 'Não enviar' }).ok).toBe(true);
    expect(guardSlackSend(ledger, ...slackMcp(TEXT))).toMatch(/bloqueado/);
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
