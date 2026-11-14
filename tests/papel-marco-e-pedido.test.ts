import { describe, expect, it } from 'vitest';
import { factoryRole, FACTORY_ROLES, LEADER_OF_ALL_GUIDANCE } from '../src/shared/roles';

// Faixa preta, ambiente (t-746bfb9d, 13/11): quem executa deixa uma linha de texto a cada marco (um recado que chega no meio
// abre turno novo, e o turno anterior fica sem nada que diga o que foi feito), e todo pedido entre sessões traz o objetivo e o
// critério no começo, com o contexto longo num arquivo citado (quem lê o pedido, gente ou registro, lê o começo).

const MARCO = /a cada marco, escreva uma linha de texto com o que ficou feito/;
const PEDIDO = /critério logo no começo; contexto longo vai num arquivo citado pelo caminho, não colado/;

describe('papéis de fábrica: linha de marco e pedido com o critério no começo', () => {
  it('Dev, Revisor e Pesquisa (quem executa) pedem a linha de marco', () => {
    for (const id of ['dev', 'revisor', 'pesquisa']) expect(factoryRole(id)!.guidance, id).toMatch(MARCO);
  });

  it('o Líder reparte e não ganha a linha de marco', () => {
    expect(factoryRole('lider')!.guidance).not.toMatch(MARCO);
  });

  it('todo papel e o Líder único pedem o objetivo e o critério no começo do pedido entre sessões', () => {
    for (const role of FACTORY_ROLES) expect(role.guidance, role.id).toMatch(PEDIDO);
    expect(LEADER_OF_ALL_GUIDANCE).toMatch(PEDIDO);
  });
});
