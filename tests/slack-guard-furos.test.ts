import { describe, expect, it } from 'vitest';
import { applyLedgerOp, emptyLedgerDoc, type LedgerActor, type LedgerDoc, type LedgerOp } from '../src/shared/ledger/contract';
import { slackGuard } from '../src/shared/ledger/slack-guard';

// Slack só com carta — the Revisor's probe on #241 ("tente furar"), kept as the test: with an accepted letter
// { destino: "produto", texto: "oi" }, every one of these must be refused; the controls must keep their promise.

const sess: LedgerActor = { kind: 'lugar', placeId: 'place:dev', roleId: 'dev' };
function run(doc: LedgerDoc, actor: LedgerActor, op: LedgerOp, id = 'c-1'): LedgerDoc {
  const r = applyLedgerOp(doc, actor, op, { now: Date.UTC(2026, 10, 5, 20), newId: () => id });
  if (!r.ok) throw new Error(r.reason);
  return r.doc;
}
let doc = run(emptyLedgerDoc(), sess, { op: 'carta-slack', projectPath: '/w/atlas', slack: { destination: 'produto', text: 'oi', reason: 'teste' } });
doc = run(doc, { kind: 'dono' }, { op: 'aceitar', id: 'c-1' });
const API = 'https://slack.com/api/chat.postMessage';
const v = (tool: string, input: unknown) => slackGuard(doc, tool, input).kind;
const bash = (command: string) => v('Bash', { command });
const slack = 'mcp__claude_ai_Slack__slack_send_message';

describe('furar a trava (tem de recusar)', () => {
  it('A shell: texto aceito como isca, outro texto no envio', () => expect(bash(`X='oi'; curl ${API} -d '{"channel":"produto","text":"OUTRA COISA"}'`)).toBe('deny'));
  it('B shell: destino com prefixo igual (produto-geral)', () => expect(bash(`curl ${API} -d '{"channel":"produto-geral","text":"oi"}'`)).toBe('deny'));
  it('C shell: uma carta, 3 envios num laço', () => expect(bash(`for i in 1 2 3; do curl ${API} -d '{"channel":"produto","text":"oi"}'; done`)).toBe('deny'));
  it('E Composio workbench com código', () =>
    expect(v('mcp__composio__COMPOSIO_REMOTE_WORKBENCH', { code_to_execute: "run_composio_tool('SLACK_SEND_MESSAGE', {'channel':'geral','text':'x'})" })).toBe('deny'));
  it('F MCP: text aceito + blocks com outro conteúdo', () =>
    expect(v(slack, { channel_id: 'produto', text: 'oi', blocks: [{ type: 'section', text: { type: 'mrkdwn', text: 'OUTRA COISA' } }] })).toBe('deny'));
  it('F2 MCP: text aceito + attachments', () => expect(v(slack, { channel_id: 'produto', text: 'oi', attachments: [{ text: 'OUTRA COISA' }] })).toBe('deny'));
  it('F3 MCP: dois campos de texto diferentes', () => expect(v(slack, { channel_id: 'produto', text: 'oi', message: 'OUTRA COISA' })).toBe('deny'));
  it('F4 MCP: resposta que também vai ao canal', () => expect(v(slack, { channel_id: 'produto', message: 'oi', reply_broadcast: true })).toBe('deny'));
  it('G1 Composio: upload de arquivo com comentário', () =>
    expect(v('mcp__composio__SLACK_UPLOAD_OR_CREATE_A_FILE_IN_SLACK', { channels: 'geral', initial_comment: 'x', content: 'y' })).toBe('deny'));
  it('G2 shell: files.completeUploadExternal com initial_comment', () =>
    expect(bash(`curl https://slack.com/api/files.completeUploadExternal -d 'channel_id=geral&initial_comment=x'`)).toBe('deny'));
  it('J1 canal-produto com subcomando entre aspas', () => expect(bash('node canal-produto.js "postar" geral "x"')).toBe('deny'));
  it('J2 canal-produto com subcomando em variável', () => expect(bash('C=postar; node canal-produto.js $C geral "x"')).toBe('deny'));
  it('K endpoint montado em pedaços', () => expect(bash(`M=postMessage; curl https://slack.com/api/chat.$M -d '{"channel":"geral","text":"x"}'`)).toBe('deny'));
  it('L arquivo compartilhado ou subido por código continua recusado', () => {
    expect(v('mcp__composio__COMPOSIO_REMOTE_WORKBENCH', { code_to_execute: "run_composio_tool('SLACK_SHARE_A_REMOTE_FILE', {'channels':'geral'})" })).toBe('deny');
    expect(bash(`python run.py SLACK_UPLOAD_OR_CREATE_A_FILE_IN_SLACK geral`)).toBe('deny');
  });
});

describe('o que a trava promete (controle)', () => {
  it('H um caractere diferente recusa', () => expect(v(slack, { channel_id: 'produto', message: 'oi!' })).toBe('deny'));
  it('H2 mesmo texto passa', () => expect(v(slack, { channel_id: 'produto', message: 'oi' })).toBe('allow'));
  it('H3 opção que não muda o que o dono lê passa', () => expect(v(slack, { channel_id: 'produto', message: 'oi', unfurl_links: false })).toBe('allow'));
  it('I carta usada não libera de novo', () => {
    const used = run(doc, sess, { op: 'slack-enviada', id: 'c-1' });
    expect(slackGuard(used, slack, { channel_id: 'produto', message: 'oi' }).kind).toBe('deny');
  });
  it('leitura não é envio', () => {
    expect(bash(`curl -s https://slack.com/api/conversations.history?channel=produto`)).toBe('not-slack');
    expect(v('mcp__claude_ai_Slack__slack_read_channel', { channel_id: 'produto' })).toBe('not-slack');
    expect(v('mcp__composio__COMPOSIO_SEARCH_TOOLS', { queries: [{ use_case: 'SLACK_SEND_MESSAGE' }] })).toBe('not-slack');
  });
  it('ler um arquivo do Slack não é envio, nem quando o slug só aparece num comando', () => {
    const read = 'SLACK_RETRIEVE_DETAILED_INFORMATION_ABOUT_A_FILE';
    expect(v('mcp__composio__COMPOSIO_MULTI_EXECUTE_TOOL', { tools: [{ tool_slug: read, arguments: { file: 'F1' } }] })).toBe('not-slack');
    expect(v('mcp__composio__COMPOSIO_REMOTE_WORKBENCH', { code_to_execute: `run_composio_tool('${read}', {'file':'F1'})` })).toBe('not-slack');
    expect(bash(`grep -n ${read} notas.md`)).toBe('not-slack');
  });
});
