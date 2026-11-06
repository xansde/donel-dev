import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createSystemConfigIoDeps, sanitizeSlackAgentBotPrefs } from '../src/main/config-store';
import { buildSlackOfflineGuardScript } from '../src/main/hooks-settings';
import { createLedgerService, createSlackLetterGuard, nodeLedgerProofFs } from '../src/main/ledger-store';
import { AGENT_BOT_MARK, LEDGER_SCHEMA_VERSION, parseLedgerDoc, waitsForOwner } from '../src/shared/ledger/contract';

// Slack só com carta — the letter is for what goes out in the OWNER's name (owner, 06/11: "o envio de cartas era
// para eu validar as mensagens, agora ele me tornou gargalo"). The Theo West's own bot (its MCP, on the PC and on
// the VPS) posts with no letter and leaves a record in the Oráculo; every way out by the owner's account still
// needs one, and an unknown server is still refused.

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function service(): ReturnType<typeof createLedgerService> {
  const dir = mkdtempSync(join(tmpdir(), 'slack-bot-'));
  dirs.push(dir);
  let clock = Date.UTC(2026, 10, 6, 18);
  let n = 0;
  return createLedgerService({ filePath: join(dir, 'ledger.json'), io: createSystemConfigIoDeps(), proofFs: nodeLedgerProofFs, now: () => (clock += 1000), newId: () => `t-${++n}` });
}

const SENT = [{ type: 'text', text: JSON.stringify({ ok: true, channel: 'C0CGE4DSGCQ', ts: '1762450000.123456' }) }];
// The owner's config (`slackAgentBots.servers`): the code ships no bot.
const BOTS = ['theo-west-slack', 'theo-slack'];
const place = async () => ({ projectPath: '/w/bizops', placeId: 'place:theo' });
let use = 0;

async function send(guard: ReturnType<typeof createSlackLetterGuard>, tool: string, input: unknown): Promise<string | null> {
  const payload = { tool_name: tool, tool_input: input, tool_use_id: `toolu_${++use}` };
  const refusal = guard.before('pty-theo', payload);
  if (refusal === null) await guard.after('pty-theo', 'PostToolUse', { ...payload, tool_response: SENT });
  return refusal;
}

describe('o bot do próprio agente posta sem carta', () => {
  it('mensagem e arquivo pelo bot (PC e VPS) passam e ficam registrados no Oráculo', async () => {
    const ledger = service();
    const guard = createSlackLetterGuard(() => ledger, { placeOf: place, agentBotServers: () => BOTS });
    expect(await send(guard, 'mcp__theo-west-slack__slack_post_message', { channel_id: 'C0CGE4DSGCQ', text: 'Bom dia, time.' })).toBeNull();
    expect(await send(guard, 'mcp__theo-west-slack__slack_reply_to_thread', { channel_id: 'C0CGE4DSGCQ', thread_ts: '1762440000.000100', text: 'Feito.' })).toBeNull();
    expect(await send(guard, 'mcp__theo-slack__slack_enviar_mensagem', { canal: 'C0CGE4DSGCQ', texto: 'Oi pela VPS.' })).toBeNull();
    expect(await send(guard, 'mcp__theo-slack__slack_enviar_arquivo', { canal: 'C0CGE4DSGCQ', caminho: '/tmp/print.png', comentario: 'Segue o print.' })).toBeNull();

    const { doc } = ledger.load();
    const records = Object.values(doc.tasks);
    expect(records).toHaveLength(4);
    for (const task of records) {
      expect(task.request.startsWith(AGENT_BOT_MARK)).toBe(true);
      expect(task.projectPath).toBe('/w/bizops');
      expect(task.ownerPlaceId).toBe('place:theo');
      expect(task.slack).toBeUndefined(); // not a letter: it frees nothing
      expect(waitsForOwner(doc, task)).toBe(false); // the owner sees it later, it never waits for him
    }
    const [first, reply, vps, file] = records;
    expect(first!.request).toContain('C0CGE4DSGCQ');
    expect(first!.events[1]!.proofs).toEqual([
      { kind: 'texto', text: 'Bom dia, time.' },
      { kind: 'link', url: 'https://slack.com/archives/C0CGE4DSGCQ/p1762450000123456' },
    ]);
    expect(first!.events[1]!.text).toBe(`${AGENT_BOT_MARK} o Slack confirmou.`);
    expect(reply!.events[1]!.proofs).toContainEqual({ kind: 'link', url: 'https://slack.com/archives/C0CGE4DSGCQ/p1762450000123456?thread_ts=1762440000.000100&cid=C0CGE4DSGCQ' });
    expect(vps!.events[1]!.proofs![0]).toEqual({ kind: 'texto', text: 'Oi pela VPS.' });
    expect(file!.events[1]!.proofs).toContainEqual({ kind: 'texto', text: 'Segue o print.' });
    expect(file!.events[1]!.proofs).toContainEqual({ kind: 'texto', text: 'Arquivo: /tmp/print.png' });

    // v4, no new version: only kinds and fields the installed Alfa knows, so it reads and rewrites the record intact.
    expect(doc.schemaVersion).toBe(LEDGER_SCHEMA_VERSION);
    expect(LEDGER_SCHEMA_VERSION).toBe(4);
    expect(parseLedgerDoc(JSON.parse(JSON.stringify(doc)))).toEqual(doc);
  });

  it('pela conta do dono continua barrado sem carta, e um MCP desconhecido também', async () => {
    const ledger = service();
    const guard = createSlackLetterGuard(() => ledger, { placeOf: place, agentBotServers: () => BOTS });
    const owner: ReadonlyArray<readonly [string, unknown]> = [
      ['mcp__composio__COMPOSIO_MULTI_EXECUTE_TOOL', { tools: [{ tool_slug: 'SLACK_SEND_MESSAGE', arguments: { channel: 'C0CGE4DSGCQ', markdown_text: 'Oi.' } }] }],
      ['mcp__composio__SLACK_SEND_MESSAGE', { channel: 'C0CGE4DSGCQ', text: 'Oi.' }],
      ['mcp__composio__SLACK_UPLOAD_OR_CREATE_A_FILE_IN_SLACK', { channels: 'C0CGE4DSGCQ', initial_comment: 'Oi.' }],
      ['mcp__slack__slack_post_message', { channel_id: 'C0CGE4DSGCQ', text: 'Oi.' }],
      ['mcp__claude_ai_Slack__slack_send_message', { channel_id: 'C0CGE4DSGCQ', message: 'Oi.' }],
      ['Bash', { command: `curl -s https://slack.com/api/chat.postMessage -H "Authorization: Bearer $SLACK_USER_TOKEN" -d channel=C0CGE4DSGCQ -d text=Oi` }],
      ['mcp__outro-bot-slack__slack_post_message', { channel_id: 'C0CGE4DSGCQ', text: 'Oi.' }],
      ['mcp__theo-west-slack-falso__slack_post_message', { channel_id: 'C0CGE4DSGCQ', text: 'Oi.' }],
    ];
    for (const [tool, input] of owner) expect(await send(guard, tool, input), tool).toMatch(/carta_slack/);
    expect(Object.keys(ledger.load().doc.tasks)).toHaveLength(0);

    // The list is the owner's, only from the config: by default (empty), the Theo West bot needs a letter too.
    const strict = createSlackLetterGuard(() => ledger, { placeOf: place });
    expect(await send(strict, 'mcp__theo-west-slack__slack_post_message', { channel_id: 'C0CGE4DSGCQ', text: 'Oi.' })).toMatch(/carta_slack/);
  });
});

describe('trava de fora do ar (VPS)', () => {
  // The real script, run by `sh` with the app down (nothing listens on port 1): only the top-level `tool_name`,
  // read by a JSON parser, lets the bot through; with no parser on the machine, nothing passes.
  const COMPOSIO = 'mcp__composio__COMPOSIO_MULTI_EXECUTE_TOOL';
  const composioSend = { tools: [{ tool_slug: 'SLACK_SEND_MESSAGE', arguments: { channel: 'C0CGE4DSGCQ', markdown_text: 'Oi.' } }] };
  const which = (bin: string): string | null => {
    const found = spawnSync('sh', ['-c', `command -v ${bin}`], { encoding: 'utf8' });
    return found.status === 0 && found.stdout.trim() ? found.stdout.trim() : null;
  };

  function run(payload: unknown, opts: { servers?: readonly string[]; path?: readonly string[] } = {}): string {
    const dir = mkdtempSync(join(tmpdir(), 'slack-offline-'));
    dirs.push(dir);
    const script = join(dir, 'slack-guard.sh');
    writeFileSync(script, buildSlackOfflineGuardScript({ port: 1, token: 'tok', agentBotServers: opts.servers ?? BOTS }));
    let env: NodeJS.ProcessEnv = process.env;
    if (opts.path) {
      // A PATH with only these tools: a VPS without node (or without any JSON parser).
      const bin = join(dir, 'bin');
      mkdirSync(bin);
      for (const tool of ['cat', 'grep', 'curl', ...opts.path]) symlinkSync(which(tool)!, join(bin, tool));
      env = { PATH: bin };
    }
    const out = spawnSync(which('sh')!, [script], { input: JSON.stringify(payload), env, encoding: 'utf8' });
    expect(out.status).toBe(0);
    return out.stdout;
  }
  const denied = (out: string): boolean => out.includes('"permissionDecision":"deny"');

  it.skipIf(process.platform === 'win32' || !which('curl'))('só o tool_name do topo deixa o bot passar, nunca um campo plantado nos parâmetros', () => {
    const bot = { tool_name: 'mcp__theo-slack__slack_enviar_mensagem', tool_input: { canal: 'C0CGE4DSGCQ', texto: 'Oi.' } };
    // The reviewer's attack: the same Composio send, with a "tool_name" object field inside the parameters.
    const planted = [
      { tool_name: COMPOSIO, tool_input: { ...composioSend, tool_name: 'mcp__theo-slack__x' } },
      { tool_name: COMPOSIO, tool_input: { tools: [{ ...composioSend.tools[0]!, arguments: { ...composioSend.tools[0]!.arguments, tool_name: 'mcp__theo-slack__x' } }] } },
      { tool_name: 'Bash', tool_input: { command: 'curl https://slack.com/api/chat.postMessage -d text=Oi', tool_name: 'mcp__theo-west-slack__x' } },
    ];

    expect(denied(run({ tool_name: COMPOSIO, tool_input: composioSend }))).toBe(true);
    for (const payload of planted) expect(denied(run(payload)), JSON.stringify(payload)).toBe(true);
    expect(run(bot)).toBe('');
    expect(run({ tool_name: 'mcp__theo-west-slack__slack_post_message', tool_input: { channel_id: 'C1', text: 'Oi.' } })).toBe('');

    // With python3 and no node, the same answers.
    if (which('python3')) {
      expect(run(bot, { path: ['python3'] })).toBe('');
      for (const payload of planted) expect(denied(run(payload, { path: ['python3'] })), JSON.stringify(payload)).toBe(true);
    }
    // No JSON parser on the machine: nothing passes as the bot, the guard stays closed.
    expect(denied(run(bot, { path: [] }))).toBe(true);
    // No bot in the config (the default): the bot needs a letter too.
    expect(denied(run(bot, { servers: [] }))).toBe(true);
  });

  it('config quebrada ou ausente = nenhum bot (padrão vazio)', () => {
    for (const broken of [undefined, null, 'theo-slack', ['theo-slack'], { servers: 'theo-slack' }]) expect(sanitizeSlackAgentBotPrefs(broken)).toEqual({ servers: [] });
    expect(sanitizeSlackAgentBotPrefs({ servers: [' theo-slack ', 'theo-slack', 'x;rm -rf', 3] })).toEqual({ servers: ['theo-slack'] });
  });
});
