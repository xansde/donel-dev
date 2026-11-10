import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createSystemConfigIoDeps, sanitizeSlackAgentBotPrefs } from '../src/main/config-store';
import { createLedgerService, createSlackLetterGuard, nodeLedgerProofFs } from '../src/main/ledger-store';
import { AGENT_BOT_MARK, LEDGER_SCHEMA_VERSION, parseLedgerDoc, waitsForOwner } from '../src/shared/ledger/contract';

// The agent's own bot — the Theo West's own bot (its MCP, on the PC and on the VPS) posts and leaves a record in the
// Oráculo for the owner to see later. Since 09/11 no post to Slack needs a letter (owner: "Não quero que cartas
// travem nada também"); what stays guarded is the record itself: a session cannot forge the bot's mark.

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
  const refusal = await guard.before('pty-theo', payload);
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

  it('a marca do bot não se forja: uma sessão não cria tarefa que se passe por registro do bot', async () => {
    const ledger = service();
    // A task a session creates cannot pass for a bot record (which the owner's strip hides).
    const forged = await ledger.apply({ kind: 'lugar', placeId: 'place:theo' }, { op: 'criar', projectPath: '/w/bizops', request: `${AGENT_BOT_MARK} Mensagem no Slack`, doneWhen: 'x', due: '2026-11-07', ownerPlaceId: 'place:theo', risk: 'baixo' });
    expect(forged.ok).toBe(false);
    expect(Object.keys(ledger.load().doc.tasks)).toHaveLength(0);
  });
});

describe('a lista de bots vem só da config', () => {
  it('config quebrada ou ausente = nenhum bot (padrão vazio)', async () => {
    for (const broken of [undefined, null, 'theo-slack', ['theo-slack'], { servers: 'theo-slack' }]) expect(sanitizeSlackAgentBotPrefs(broken)).toEqual({ servers: [] });
    expect(sanitizeSlackAgentBotPrefs({ servers: [' theo-slack ', 'theo-slack', 'x;rm -rf', 3] })).toEqual({ servers: ['theo-slack'] });
  });
});
