// t-1a3f7150, fatia 5 — a VPS abre uma sessão com o PC desligado (pasta com `abertaSemPc` no meta e tmux vivo, lugar
// `session:<sid>`). Ao voltar, o PC a adota: um cartão só no quadro, sem mexer no que o dono arrumou, e uma aba só.
import { describe, expect, it } from 'vitest';
import { adoptSessionOpenedWithoutPc, emptyMindscapeDoc, moveCard, placeSessionCards } from '../src/shared/mindscape/model';
import { parseDiscoverOutput, remoteAliveFromMeta } from '../src/main/remote-session';
import { remoteSessionsToOpen, remoteTabSessionIds } from '../src/shared/remoteBoot';

const ATLAS = 'C:/atlas';
const sid = 'aaaaaaaa-1111-4111-8111-111111111111';
const other = 'bbbbbbbb-2222-4222-8222-222222222222';

const sessionCards = (doc: ReturnType<typeof emptyMindscapeDoc>) =>
  Object.values(doc.boards[ATLAS]?.cards ?? {}).filter((card) => card.kind === 'session');

describe('o quadro adota a sessão aberta sem o PC', () => {
  it('importar duas vezes (e a colocação da aba depois) dá um cartão só, session:<sid>, feito por sessão', () => {
    let doc = adoptSessionOpenedWithoutPc(emptyMindscapeDoc(), ATLAS, sid, 'dev');
    doc = adoptSessionOpenedWithoutPc(doc, ATLAS, sid, 'dev');
    doc = placeSessionCards(doc, [{ projectPath: ATLAS, sessionId: sid, roleId: 'dev' }]);
    const cards = sessionCards(doc);
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({ id: `session:${sid}`, sessionId: sid, roleId: 'dev', by: 'session', previous: [] });
  });

  it('um cartão session:<sid> criado antes por um canal antigo (sem by) não duplica nem muda de dono', () => {
    const before = placeSessionCards(emptyMindscapeDoc(), [{ projectPath: ATLAS, sessionId: sid, roleId: 'dev' }]);
    const after = adoptSessionOpenedWithoutPc(before, ATLAS, sid, 'dev');
    expect(after).toBe(before);
    expect(sessionCards(after)).toHaveLength(1);
    expect(sessionCards(after)[0]).not.toHaveProperty('by');
  });

  it('o cartão que o dono moveu fica onde ele pôs; a conversa que já seguiu adiante (/clear) também não ganha cartão', () => {
    let doc = adoptSessionOpenedWithoutPc(emptyMindscapeDoc(), ATLAS, sid, 'dev');
    doc = moveCard(doc, ATLAS, `session:${sid}`, 777, 333);
    doc = adoptSessionOpenedWithoutPc(doc, ATLAS, sid, 'dev');
    doc = placeSessionCards(doc, [{ projectPath: ATLAS, sessionId: sid }]);
    expect(sessionCards(doc)).toEqual([expect.objectContaining({ id: `session:${sid}`, x: 777, y: 333 })]);

    // O lugar foi adiante para outra conversa: a velha está no `previous`, e a importação não a separa num cartão novo.
    const moved = placeSessionCards(emptyMindscapeDoc(), [{ projectPath: ATLAS, sessionId: other }]);
    const card = sessionCards(moved)[0]!;
    const withPrevious = { ...moved, boards: { [ATLAS]: { ...moved.boards[ATLAS]!, cards: { [card.id]: { ...card, previous: [sid] } } } } };
    expect(adoptSessionOpenedWithoutPc(withPrevious, ATLAS, sid, 'dev')).toBe(withPrevious);
  });
});

describe('a busca de novo das sessões remotas', () => {
  const meta = (extra: Record<string, unknown>) =>
    `DONEL_META ${JSON.stringify({ sid, hookToken: 't', hookPort: 1, mcpToken: null, mcpPort: null, localCwd: ATLAS, projectName: 'atlas', name: 'dev', launchArgs: [], createdAt: '', ...extra })}`;

  it('a marca abertaSemPc do meta chega à aba; meta sem ela (app antigo) não ganha a marca', () => {
    const [marked] = parseDiscoverOutput(`${meta({ abertaSemPc: true, roleId: 'dev' })}\n`);
    expect(remoteAliveFromMeta('vps', marked!)).toMatchObject({ sessionId: sid, roleId: 'dev', openedWithoutPc: true });
    const [plain] = parseDiscoverOutput(`${meta({})}\n`);
    expect(remoteAliveFromMeta('vps', plain!)).not.toHaveProperty('openedWithoutPc');
  });

  it('nunca abre segunda aba: sessão já aberta, já trazida, cuja aba o dono fechou, ou repetida na mesma resposta', () => {
    const alive = [{ sessionId: sid }, { sessionId: other }, { sessionId: other }];
    // aberta numa aba (ainda conectando, só com o -r)
    expect(remoteSessionsToOpen(alive, [{ launchArgs: ['-r', sid] }], new Set())).toEqual([{ sessionId: other }]);
    // a aba do dono foi fechada antes desta rodada (o tmux pode ainda estar vivo uns segundos): o id ficou conhecido
    const known = new Set(remoteTabSessionIds({ claudeSessionId: other, remoteAttachFolder: sid }));
    expect(remoteSessionsToOpen(alive, [], known)).toEqual([]);
  });
});
