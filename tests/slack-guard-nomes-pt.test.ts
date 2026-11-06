import { describe, expect, it } from 'vitest';
import { SLACK_OFFLINE_PATTERN } from '../src/main/hooks-settings';
import { applyLedgerOp, emptyLedgerDoc, type LedgerActor, type LedgerDoc, type LedgerOp } from '../src/shared/ledger/contract';
import { slackGuard } from '../src/shared/ledger/slack-guard';

// Slack só com carta — tool names in Portuguese (owner, 06/11: the Theo West MCP has `slack_enviar_arquivo`).
// Before, `slack_enviar_mensagem` and `slack_enviar_arquivo` went out WITHOUT a letter: the guard knew only
// English verbs. A message now needs the letter; a file is refused (a letter carries no file); reading is free.

const sess: LedgerActor = { kind: 'lugar', placeId: 'place:theo', roleId: 'theo-west' };
function run(doc: LedgerDoc, actor: LedgerActor, op: LedgerOp): LedgerDoc {
  const r = applyLedgerOp(doc, actor, op, { now: Date.UTC(2026, 10, 6, 20), newId: () => 'c-1' });
  if (!r.ok) throw new Error(r.reason);
  return r.doc;
}
const none = emptyLedgerDoc();
const accepted = run(run(none, sess, { op: 'carta-slack', projectPath: '/w/bizops', slack: { destination: 'C0CGE4DSGCQ', thread: '1793.24', text: 'Segue o print.', reason: 'x' } }), { kind: 'dono' }, { op: 'aceitar', id: 'c-1' });
// A Slack MCP with Portuguese names that is NOT an agent's own bot (those pass without a letter, owner 06/11:
// tests/slack-guard-bot-do-agente.test.ts): what posts in the owner's name still needs the letter.
const theo = (name: string) => `mcp__slack-do-dono__${name}`;

describe('nomes em português na trava do app', () => {
  it('mensagem sem carta é recusada; com a carta aceita, passa uma vez', () => {
    for (const name of ['slack_enviar_mensagem', 'slack_responder_thread', 'slack_postar_no_canal', 'enviar_mensagem'])
      expect(slackGuard(none, theo(name), { channel_id: 'C0CGE4DSGCQ', thread_ts: '1793.24', text: 'Segue o print.' }).kind, name).toBe('deny');
    expect(slackGuard(accepted, theo('slack_enviar_mensagem'), { channel_id: 'C0CGE4DSGCQ', thread_ts: '1793.24', text: 'Segue o print.' }).kind).toBe('allow');
  });
  it('arquivo é sempre recusado, mesmo com carta aceita do mesmo texto', () => {
    for (const name of ['slack_enviar_arquivo', 'slack_mandar_arquivo', 'slack_subir_arquivo', 'slack_enviar_imagem']) {
      const verdict = slackGuard(accepted, theo(name), { channel_id: 'C0CGE4DSGCQ', thread_ts: '1793.24', comentario: 'Segue o print.', caminho: '/tmp/p.png' });
      expect(verdict.kind, name).toBe('deny');
      expect(verdict.kind === 'deny' && verdict.reason, name).toMatch(/arquivo/);
    }
  });
  it('ler não é envio', () => {
    for (const name of ['slack_baixar_arquivo', 'slack_get_channel_history', 'slack_get_thread_replies', 'slack_add_reaction', 'slack_list_channels'])
      expect(slackGuard(none, theo(name), { channel_id: 'C1', arquivo: 'F0123' }).kind, name).toBe('not-slack');
  });
});

describe('nomes em português na trava de fora do ar', () => {
  const offline = new RegExp(SLACK_OFFLINE_PATTERN, 'i');
  const payload = (tool: string) => JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: tool, tool_input: { channel_id: 'C1' } });
  it('pega o envio e o upload em português', () => {
    for (const name of ['slack_enviar_mensagem', 'slack_enviar_arquivo', 'slack_responder_thread']) expect(offline.test(payload(theo(name))), name).toBe(true);
  });
  it('deixa baixar e ler', () => {
    for (const name of ['slack_baixar_arquivo', 'slack_get_channel_history']) expect(offline.test(payload(theo(name))), name).toBe(false);
  });
});
