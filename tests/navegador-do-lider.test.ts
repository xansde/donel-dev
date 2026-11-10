import { describe, expect, it } from 'vitest';
import { buildBrowserDirectory, leaderTargetForRequest, type BrowserDirectorySession } from '../src/shared/browser/directory';
import type { BrowserControlState, BrowserPanelState } from '../src/shared/browser/ipc';

// Navegador do Líder (t-31e2b949): o dono, pela aba do Líder, alcança o navegador de qualquer sessão. O que quebraria
// sem ele perceber: um pedido de mão de uma sessão aberta por outra (fora da barra de abas) que não aparece em lugar
// nenhum — foi o que aconteceu com o login do GitHub do Dev G5 em 10/11.

const state = (ptyId: string, url: string): BrowserPanelState => ({ ptyId, url, title: url, loading: false, canGoBack: false, canGoForward: false, tabs: [] });
const asking = (ptyId: string, reason: string): BrowserControlState => ({ ptyId, owner: 'human', generation: 2, reason, requestedByAgent: true });

const SESSIONS: readonly BrowserDirectorySession[] = [
  { ptyId: 'p-lider', name: 'Líder', board: 'Donel Dev', place: 'VPS' },
  { ptyId: 'p-dev', name: 'Dev · proxy', board: 'Donel Dev', place: 'VPS' },
  { ptyId: 'p-g5', name: 'Dev · achados Fable G5', board: 'Homologação', place: 'Homologações' },
  { ptyId: 'p-sem-navegador', name: 'Revisor', board: 'Homologação', place: 'Homologações' },
];

describe('navegadores vistos pela aba do Líder', () => {
  it('lista os navegadores de todas as sessões, menos o do próprio Líder, com o pedido de mão primeiro', () => {
    const entries = buildBrowserDirectory({
      leaderPtyId: 'p-lider',
      sessions: SESSIONS,
      states: [state('p-lider', 'https://a.example'), state('p-dev', 'https://b.example'), state('p-g5', 'https://github.com/login')],
      controls: [asking('p-g5', 'Entre no GitHub com a conta do rig')],
    });
    expect(entries.map((entry) => [entry.ptyId, entry.name, entry.board, entry.place, entry.url, entry.help])).toEqual([
      ['p-g5', 'Dev · achados Fable G5', 'Homologação', 'Homologações', 'https://github.com/login', 'Entre no GitHub com a conta do rig'],
      ['p-dev', 'Dev · proxy', 'Donel Dev', 'VPS', 'https://b.example', null],
    ]);
  });

  it('mostra o navegador que pede mão mesmo sem sessão conhecida na tela', () => {
    const entries = buildBrowserDirectory({ leaderPtyId: 'p-lider', sessions: [], states: [], controls: [asking('p-x', 'captcha')] });
    expect(entries).toEqual([{ ptyId: 'p-x', name: 'Sessão sem aba', board: null, place: null, url: '', title: '', help: 'captcha', ownerDriving: true }]);
  });

  it('o pedido de mão de outra sessão vira o navegador mostrado na aba do Líder', () => {
    expect(leaderTargetForRequest('p-lider', 'p-g5')).toBe('p-g5');
    expect(leaderTargetForRequest('p-lider', 'p-lider')).toBeNull();
    expect(leaderTargetForRequest(null, 'p-g5')).toBeNull();
  });
});
