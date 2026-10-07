import { describe, expect, it } from 'vitest';
import {
  normalizeRepoScope,
  repoScopeWarning,
  scopeSummary,
  unknownRepos,
} from '../src/renderer/src/Esteira/repoScope';

// Achado do dogfooding de 06/08 — o card "Diario de Obra" nasceu com repo alvo
// `"spotsys e api-spotsys"`: uma FRASE digitada num campo livre, nomeando dois
// servicos. Ela nunca poderia bater com pasta nenhuma, entao a fase travou o
// card e so depois disse que nao abriria. Duas causas, as duas cobertas aqui:
//
// 1. **Alvo e escopo sao perguntas diferentes** (D-6, ja no store): `targetRepo`
//    responde ONDE a sessao senta (0..1) e `scopeRepos` responde O QUE a mudanca
//    toca (0..N). Trabalho em microsservicos atravessa repos por natureza — quem
//    nao tem onde declarar o segundo repo, escreve "e api-spotsys" no primeiro.
// 2. **O aviso vem ANTES do gesto**, nao depois da trava.

const projects = [
  { name: 'atlas', path: 'C:/dev/atlas' },
  { name: 'beacon', path: 'C:/dev/beacon' },
  { name: 'vega', path: 'C:/dev/vega' },
];

describe('normalizeRepoScope — a ancora sempre pertence ao escopo', () => {
  it('poe a ancora na frente do escopo, mesmo quando ninguem a listou', () => {
    expect(normalizeRepoScope({ targetRepo: 'atlas', scopeRepos: ['beacon'] })).toEqual({
      targetRepo: 'atlas',
      scopeRepos: ['atlas', 'beacon'],
    });
  });

  it('nao duplica a ancora quando ela ja estava no escopo — e a traz para a frente', () => {
    expect(normalizeRepoScope({ targetRepo: 'beacon', scopeRepos: ['atlas', 'beacon'] })).toEqual({
      targetRepo: 'beacon',
      scopeRepos: ['beacon', 'atlas'],
    });
  });

  it('apara, descarta vazio e deduplica ignorando caixa — preservando a grafia declarada', () => {
    expect(normalizeRepoScope({ targetRepo: '  atlas ', scopeRepos: ['  ', 'BEACON', 'beacon', 'atlas'] })).toEqual({
      targetRepo: 'atlas',
      scopeRepos: ['atlas', 'BEACON'],
    });
  });

  it('escopo sem ancora continua sem ancora — escolher o unico repo do escopo seria o palpite que a D-6 proibe', () => {
    expect(normalizeRepoScope({ targetRepo: null, scopeRepos: ['beacon'] })).toEqual({
      targetRepo: null,
      scopeRepos: ['beacon'],
    });
  });

  it('card sem repo nenhum e legitimo: discovery investiga problema, nao repositorio', () => {
    expect(normalizeRepoScope({ targetRepo: '   ', scopeRepos: [] })).toEqual({ targetRepo: null, scopeRepos: [] });
  });
});

describe('scopeSummary — o alcance dito em uma linha', () => {
  it('nomeia a ancora e o que mais a mudanca toca', () => {
    expect(scopeSummary({ targetRepo: 'atlas', scopeRepos: ['atlas', 'beacon'] })).toBe('atlas (âncora) · beacon');
  });

  it('um repo so nao vira "ancora de nada" — a palavra so aparece quando ha o que ancorar', () => {
    expect(scopeSummary({ targetRepo: 'atlas', scopeRepos: ['atlas'] })).toBe('atlas');
  });

  it('escopo sem ancora diz que ninguem escolheu onde a sessao senta', () => {
    expect(scopeSummary({ targetRepo: null, scopeRepos: ['atlas', 'beacon'] })).toBe('atlas, beacon — sem âncora');
  });

  it('sem repo nenhum, diz isso com todas as letras', () => {
    expect(scopeSummary({ targetRepo: null, scopeRepos: [] })).toBe('nenhum repo declarado');
  });
});

describe('unknownRepos — o que o app nao enxerga, dito pelo nome', () => {
  it('devolve os repos declarados que nao existem entre os projetos', () => {
    expect(unknownRepos({ targetRepo: 'atlas', scopeRepos: ['atlas', 'orion'] }, projects)).toEqual(['orion']);
  });

  it('usa a MESMA regra de correspondencia do disparo — nome ou caminho, ignorando caixa', () => {
    expect(unknownRepos({ targetRepo: 'ATLAS', scopeRepos: ['ATLAS', 'C:/dev/beacon'] }, projects)).toEqual([]);
  });

  it('a frase digitada a mao que originou o achado aparece inteira, como um repo so', () => {
    expect(unknownRepos({ targetRepo: 'atlas e beacon', scopeRepos: [] }, projects)).toEqual(['atlas e beacon']);
  });
});

describe('repoScopeWarning — o aviso ANTES do gesto, nunca depois da trava', () => {
  it('repo que o app nao conhece e o aviso mais grave: ele vem primeiro', () => {
    expect(repoScopeWarning({ targetRepo: 'atlas e beacon', scopeRepos: [] }, projects)).toBe(
      'O app não conhece "atlas e beacon" entre os projetos. A fase não abre num repo que ele não enxerga.',
    );
  });

  it('lista todos os desconhecidos, nao so o primeiro', () => {
    expect(repoScopeWarning({ targetRepo: null, scopeRepos: ['orion', 'lyra'] }, projects)).toBe(
      'O app não conhece "orion" nem "lyra" entre os projetos. A fase não abre num repo que ele não enxerga.',
    );
  });

  it('escopo multi-repo sem ancora avisa que falta dizer onde a sessao senta', () => {
    expect(repoScopeWarning({ targetRepo: null, scopeRepos: ['atlas', 'beacon'] }, projects)).toBe(
      'Este card toca 2 repos e não diz em qual a sessão senta. Escolha a âncora antes de preparar uma fase.',
    );
  });

  it('escopo de um repo so sem ancora tambem avisa — a fase precisa de um cwd, sempre', () => {
    expect(repoScopeWarning({ targetRepo: null, scopeRepos: ['atlas'] }, projects)).toBe(
      'Este card toca 1 repo e não diz em qual a sessão senta. Escolha a âncora antes de preparar uma fase.',
    );
  });

  it('card sem repo nenhum nao e defeito — discovery pode investigar problema, nao repositorio', () => {
    expect(repoScopeWarning({ targetRepo: null, scopeRepos: [] }, projects)).toBeNull();
  });

  it('ancora conhecida com escopo conhecido nao tem o que avisar', () => {
    expect(repoScopeWarning({ targetRepo: 'atlas', scopeRepos: ['atlas', 'beacon'] }, projects)).toBeNull();
  });
});
