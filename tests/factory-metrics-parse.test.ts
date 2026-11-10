import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseFactoryMetrics } from '../src/shared/homologacao/factoryMetrics';
import { buildRemoteFileScript, parseRemoteFileOutput } from '../src/shared/homologacao/remoteFile';

// Mindscape de homologação V1, fatia 1 (g) — the reader of `metricas-factory@1`. A number shown as "medido" when
// the factory did not say so misleads the owner without him noticing, so these rules are guarded here.

const REAL = readFileSync(join(__dirname, '..', 'docs', 'prototipos', 'mindscape-homologacao', 'metricas-exemplo-2026-11-07.json'), 'utf8');

function metric(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { id: 'm1', nome: 'Um número', pergunta: 'Quanto?', status: 'medido', texto: '1 de 2', origem: 'de algum lugar', ...overrides };
}

function file(metricas: unknown[], overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({ formato: 'metricas-factory@1', geradoEm: '2026-11-07T16:48:46.126Z', fontesLidas: [], metricas, ...overrides });
}

function ok(text: string) {
  const parsed = parseFactoryMetrics(text);
  if (parsed.kind !== 'ok') throw new Error(`expected ok, got ${parsed.kind}`);
  return parsed;
}

describe('parseFactoryMetrics — the real file of 07/11', () => {
  it('reads the 8 numbers in order, with the text exactly as written', () => {
    const parsed = ok(REAL);
    const raw = JSON.parse(REAL) as { metricas: { id: string; texto: string }[] };
    expect(parsed.metrics.map((m) => m.id)).toEqual(raw.metricas.map((m) => m.id));
    expect(parsed.metrics).toHaveLength(8);
    expect(parsed.metrics.map((m) => m.text)).toEqual(raw.metricas.map((m) => m.texto));
    expect(parsed.outOfContract).toEqual([]);
    expect(parsed.generatedAt).toBe(Date.parse('2026-11-07T16:48:46.126Z'));
  });

  it('marks the locks and the "only shown" number', () => {
    const parsed = ok(REAL);
    expect(parsed.metrics.filter((m) => m.lock).map((m) => m.id)).toEqual(['defeitos-plantados', 'passou-falso']);
    expect(parsed.metrics.filter((m) => m.displayOnly).map((m) => m.id)).toEqual(['tokens']);
  });

  it('lists the sources nobody writes yet', () => {
    expect(ok(REAL).sources.filter((s) => !s.exists).map((s) => s.id)).toEqual([
      'fonte-nova:avaliador-estado-final.jsonl',
      'fonte-nova:tokens.jsonl',
      'fonte-nova:revisoes.jsonl',
      'fonte-nova:passk.jsonl',
    ]);
  });
});

describe('parseFactoryMetrics — origin', () => {
  it('an unknown status never becomes "medido"', () => {
    for (const status of ['lido', 'MEDIDO', 'medido ', 'exemplo', '']) {
      const [shown] = ok(file([metric({ status })])).metrics;
      expect(shown.origin).toBe('sem-fonte');
      expect(shown.unknownOrigin).toBe(true);
    }
  });

  it('keeps the three known origins as they came', () => {
    const parsed = ok(file([metric({ id: 'a', status: 'medido' }), metric({ id: 'b', status: 'estimado' }), metric({ id: 'c', status: 'sem-fonte' })]));
    expect(parsed.metrics.map((m) => [m.origin, m.unknownOrigin])).toEqual([
      ['medido', false],
      ['estimado', false],
      ['sem-fonte', false],
    ]);
  });
});

describe('parseFactoryMetrics — a broken lock', () => {
  it('is a problem only when the factory wrote travaRompida: true', () => {
    const parsed = ok(
      file([
        metric({ id: 'rompida', trava: true, travaRompida: true }),
        metric({ id: 'inteira', trava: true, travaRompida: false }),
        metric({ id: 'texto', trava: true, travaRompida: 'true' }),
        metric({ id: 'ausente', trava: true }),
      ]),
    );
    expect(parsed.metrics.filter((m) => m.lockBroken).map((m) => m.id)).toEqual(['rompida']);
  });
});

describe('parseFactoryMetrics — the board band (fatia 4)', () => {
  it('only the numbers the factory marks with faixa: true go to the board band', () => {
    const parsed = ok(file([metric({ id: 'espera', faixa: true }), metric({ id: 'outro' }), metric({ id: 'texto', faixa: 'sim' })]));
    expect(parsed.metrics.filter((m) => m.band).map((m) => m.id)).toEqual(['espera']);
  });

  it('no number of the real file of 07/11 is in the band: the Donel never picks one by its id', () => {
    expect(ok(REAL).metrics.some((m) => m.band)).toBe(false);
  });
});

describe('parseFactoryMetrics — an item out of the contract', () => {
  it('drops only that item and names it; the others stay', () => {
    const parsed = ok(
      file([
        metric({ id: 'bom' }),
        metric({ id: 'sem-texto', texto: undefined }),
        metric({ id: 'nome-numero', nome: 3 }),
        metric({ id: 'status-numero', status: 1 }),
        metric({ id: 'outro-bom' }),
      ]),
    );
    expect(parsed.metrics.map((m) => m.id)).toEqual(['bom', 'outro-bom']);
    expect(parsed.outOfContract).toEqual(['sem-texto', 'nome-numero', 'status-numero']);
  });

  it('an optional field of the wrong type only hides that piece', () => {
    const [shown] = ok(file([metric({ unidade: 7, serie: 'x', trava: 'sim' })])).metrics;
    expect(shown.text).toBe('1 de 2');
    expect(shown.unit).toBeNull();
    expect(shown.series).toBeNull();
    expect(shown.lock).toBe(false);
  });

  it('ignores unknown fields', () => {
    expect(ok(file([metric({ novidade: { a: 1 } })], { outraCoisa: true })).metrics).toHaveLength(1);
  });
});

describe('parseFactoryMetrics — version', () => {
  it('refuses an unknown major and shows no number', () => {
    expect(parseFactoryMetrics(file([metric()], { formato: 'metricas-factory@2' }))).toEqual({ kind: 'unsupported', format: 'metricas-factory@2' });
  });

  it('refuses another format name or a missing one', () => {
    expect(parseFactoryMetrics(file([metric()], { formato: 'rigs-factory@1' })).kind).toBe('unsupported');
    expect(parseFactoryMetrics(file([metric()], { formato: undefined })).kind).toBe('unsupported');
  });

  it('a file that is not JSON is unreadable', () => {
    expect(parseFactoryMetrics('{ quase').kind).toBe('invalid');
  });
});

describe('parseRemoteFileOutput — the ssh answer', () => {
  it('reads the file between the markers', () => {
    const stdout = `motd do login\n${buildMarkers(file([metric()]))}`;
    expect(parseRemoteFileOutput(stdout)).toEqual({ found: true, text: file([metric()]) });
  });

  it('a missing file or a cut answer is no reading', () => {
    expect(parseRemoteFileOutput('DONEL_FILE missing\n')).toEqual({ found: false });
    expect(parseRemoteFileOutput(`DONEL_FILE begin\n{"formato"`)).toBeNull();
    expect(parseRemoteFileOutput('')).toBeNull();
  });

  it('quotes the path so it cannot run anything', () => {
    expect(buildRemoteFileScript("/root/a b/x'; rm -rf ~;'.json")).toContain(`'/root/a b/x'\\''; rm -rf ~;'\\''.json'`);
  });
});

function buildMarkers(text: string): string {
  return `DONEL_FILE begin\n${text}\nDONEL_FILE end\n`;
}
