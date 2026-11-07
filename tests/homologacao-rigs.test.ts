// Mindscape de homologação, fatia 2 — the parser of `rigs.json` (rigs-factory@1). It decides what the owner sees as
// the shape of the factory: an arrow out of "Você" would put him in the path of the seal, and one bad chair must
// never take the whole drawing down with it.

import { describe, expect, it } from 'vitest';
import { parseRigsFile } from '../src/shared/homologacao/rigs';

function file(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    formato: 'rigs-factory@1',
    geradoEm: '2026-11-07T16:50:00Z',
    rigs: [
      { id: 'rig1', nome: 'Fábrica padrão', missao: 'Homologa apps', pods: [{ id: 'rodada', nome: 'Rodada', cadeiras: ['vega', 'portao'] }] },
      { id: 'rig2', nome: 'Esteiras', pods: [] },
    ],
    foraDosRigs: ['revisor'],
    cadeiras: [
      { id: 'vega', nome: 'Vega', tipo: 'agente', papel: 'atlas-conferente' },
      { id: 'portao', nome: 'Portão', tipo: 'codigo', estado: { saude: 'bem', linha: '12 itens segurando o selo' } },
      { id: 'revisor', nome: 'Revisor', tipo: 'agente', papel: 'revisor' },
    ],
    ligacoes: [
      { de: 'vega', para: 'portao', tipo: 'verifica' },
      { de: 'portao', para: 'dono', tipo: 'escala', rotulo: 'selo' },
    ],
    ...overrides,
  });
}

describe('parseRigsFile', () => {
  it('reads the rigs, pods, chairs and links of a file in the contract', () => {
    const result = parseRigsFile(file());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.shape.rigs.map((rig) => rig.id)).toEqual(['rig1', 'rig2']);
    expect(result.shape.rigs[0]!.pods[0]!.cadeiras).toEqual(['vega', 'portao']);
    expect(result.shape.cadeiras.map((chair) => [chair.id, chair.tipo])).toEqual([
      ['vega', 'agente'],
      ['portao', 'codigo'],
      ['revisor', 'agente'],
    ]);
    expect(result.shape.ligacoes).toHaveLength(2);
    expect(result.shape.foraDoContrato).toEqual([]);
  });

  it('refuses an arrow that leaves the owner, and keeps the rest', () => {
    const result = parseRigsFile(
      file({
        ligacoes: [
          { de: 'dono', para: 'vega', tipo: 'delega' },
          { de: 'vega', para: 'portao', tipo: 'verifica' },
        ],
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.shape.ligacoes).toEqual([{ de: 'vega', para: 'portao', tipo: 'verifica' }]);
    expect(result.shape.ligacoes.some((link) => link.de === 'dono')).toBe(false);
    expect(result.shape.foraDoContrato).toEqual(['ligação dono → vega']);
  });

  it('drops a chair without a type and keeps the others (and the pods without it)', () => {
    const result = parseRigsFile(
      file({
        cadeiras: [
          { id: 'vega', nome: 'Vega', papel: 'atlas-conferente' },
          { id: 'portao', nome: 'Portão', tipo: 'codigo' },
          { id: 'revisor', nome: 'Revisor', tipo: 'pessoa' },
        ],
        ligacoes: [{ de: 'vega', para: 'portao', tipo: 'verifica' }],
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.shape.cadeiras.map((chair) => chair.id)).toEqual(['portao']);
    expect(result.shape.rigs[0]!.pods[0]!.cadeiras).toEqual(['portao']);
    expect(result.shape.foraDosRigs).toEqual([]);
    // The link to a chair that left is out of the contract too: it never points at nothing.
    expect(result.shape.ligacoes).toEqual([]);
    expect(result.shape.foraDoContrato).toEqual(['vega', 'revisor', 'ligação vega → portao']);
  });

  it('warns about a pod (or the middle) that names a chair the file does not have', () => {
    const result = parseRigsFile(
      file({
        rigs: [{ id: 'rig1', nome: 'Fábrica', pods: [{ id: 'rodada', nome: 'Rodada', cadeiras: ['vega', 'fantasma'] }] }],
        foraDosRigs: ['revisor', 'sumida'],
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.shape.rigs[0]!.pods[0]!.cadeiras).toEqual(['vega']);
    expect(result.shape.foraDoContrato).toEqual(['cadeira fantasma do pod Rodada não existe no arquivo', 'cadeira sumida de foraDosRigs não existe no arquivo']);
  });

  it('refuses an unknown major version and shows nothing of it', () => {
    const result = parseRigsFile(file({ formato: 'rigs-factory@2' }));
    expect(result).toEqual({ ok: false, reason: 'formato', message: 'formato rigs-factory@2: este Donel lê até @1' });
  });

  it('refuses what is not JSON or not this contract', () => {
    expect(parseRigsFile('{ não é json').ok).toBe(false);
    expect(parseRigsFile(file({ formato: 'metricas-factory@1' })).ok).toBe(false);
    expect(parseRigsFile(file({ geradoEm: 'ontem' })).ok).toBe(false);
  });
});

describe('parseRigsFile never throws', () => {
  // The remote reader keeps the last read when the parser throws: a bad file must become a refusal, never an error.
  it('turns any malformed file into a refusal or a partial shape', () => {
    const junk: unknown[] = [
      null,
      42,
      'texto',
      [],
      { formato: 'rigs-factory@1' },
      { formato: 'rigs-factory@1', geradoEm: '2026-11-07T16:50:00Z', rigs: 'x' },
      { formato: 'rigs-factory@1', geradoEm: '2026-11-07T16:50:00Z', rigs: [null, 1, { id: 'r', nome: 'R', pods: [null, { id: 'p', nome: 'P', cadeiras: [null, 3, {}] }] }] },
      {
        formato: 'rigs-factory@1',
        geradoEm: '2026-11-07T16:50:00Z',
        rigs: [{ id: 'r', nome: 'R', pods: 'x' }],
        foraDosRigs: [null, {}, 'x'],
        cadeiras: [null, 1, 'x', { id: 1 }, { id: 'a', nome: 'A', tipo: 'codigo', estado: 'quebrado' }, { id: 'b', nome: 'B', tipo: 'fila', estado: { saude: 'x' } }],
        ligacoes: [null, 'x', { de: 1, para: [], tipo: {} }, { de: 'a', para: 'b', tipo: 'delega', rotulo: 5 }],
      },
    ];
    for (const value of junk) expect(() => parseRigsFile(JSON.stringify(value))).not.toThrow();
    expect(() => parseRigsFile('')).not.toThrow();
    expect(() => parseRigsFile('\u0000')).not.toThrow();
  });
});
