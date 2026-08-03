import { describe, expect, it } from 'vitest';
import {
  LIFECYCLE_BY_ITEM_TYPE,
  parseEventLine,
  parseStoreHeader,
  storeCompatibility,
  STORE_SCHEMA_VERSION,
  type WorkItemType,
} from '../src/shared/esteira/store/storeFormat';

// Spec 010 (D-9) — o FORMATO do store. O que se testa aqui e a promessa que o
// cabecalho carrega: um canal que nao entende a versao le o que consegue e NAO
// escreve. E a regra que impede o cenario de 28/07 (canal antigo sanitizando
// chave que so o canal novo conhece) de se repetir com o historico do trabalho.

const HEADER = JSON.stringify({
  kind: 'esteira.store.header',
  schema_version: STORE_SCHEMA_VERSION,
  created_at: '2026-08-03T12:00:00.000Z',
  created_by_channel: 'alfa',
});

describe('parseStoreHeader', () => {
  it('le o cabecalho valido', () => {
    const header = parseStoreHeader(HEADER);
    expect(header?.schema_version).toBe(STORE_SCHEMA_VERSION);
    expect(header?.created_by_channel).toBe('alfa');
  });

  it('canal ausente vira null, nunca erro', () => {
    const header = parseStoreHeader(JSON.stringify({ kind: 'esteira.store.header', schema_version: '1.0.0', created_at: 'x' }));
    expect(header?.created_by_channel).toBeNull();
  });

  it('devolve null para linha vazia, JSON quebrado, kind errado ou versao invalida', () => {
    expect(parseStoreHeader('')).toBeNull();
    expect(parseStoreHeader(null)).toBeNull();
    expect(parseStoreHeader('{ "kind": ')).toBeNull();
    expect(parseStoreHeader('[]')).toBeNull();
    expect(parseStoreHeader(JSON.stringify({ kind: 'outro', schema_version: '1.0.0', created_at: 'x' }))).toBeNull();
    expect(parseStoreHeader(JSON.stringify({ kind: 'esteira.store.header', schema_version: 'v1', created_at: 'x' }))).toBeNull();
  });
});

describe('storeCompatibility', () => {
  it('mesmo major libera escrita', () => {
    expect(storeCompatibility(parseStoreHeader(HEADER), '1.4.2')).toBe('read-write');
  });

  it('arquivo de major a frente e SOMENTE leitura', () => {
    const future = JSON.stringify({ kind: 'esteira.store.header', schema_version: '2.0.0', created_at: 'x' });
    expect(storeCompatibility(parseStoreHeader(future), '1.0.0')).toBe('read-only');
  });

  it('arquivo de major atras exige migracao explicita antes de escrever', () => {
    const old = JSON.stringify({ kind: 'esteira.store.header', schema_version: '1.0.0', created_at: 'x' });
    expect(storeCompatibility(parseStoreHeader(old), '2.0.0')).toBe('needs-migration');
  });

  it('cabecalho ilegivel nao autoriza escrita', () => {
    expect(storeCompatibility(null)).toBe('unreadable');
  });
});

describe('parseEventLine', () => {
  const event = {
    seq: 1,
    event_id: 'evt-1',
    at: '2026-08-03T12:00:01.000Z',
    type: 'discovery.created',
    source: { kind: 'ingest', run_id: 'run-1', result_path: 'C:/x/result.json' },
    dedupe_key: 'run-1:discovery.recorded:dsc-1',
    payload: { id: 'dsc-1' },
  };

  it('le um evento completo', () => {
    const parsed = parseEventLine(JSON.stringify(event));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.event.seq).toBe(1);
    expect(parsed.event.source).toEqual({ kind: 'ingest', run_id: 'run-1', result_path: 'C:/x/result.json' });
    expect(parsed.event.dedupe_key).toBe('run-1:discovery.recorded:dsc-1');
  });

  it('aceita as origens app e seed', () => {
    for (const kind of ['app', 'seed']) {
      const parsed = parseEventLine(JSON.stringify({ ...event, source: { kind } }));
      expect(parsed.ok).toBe(true);
    }
  });

  it('origem ingest sem run_id e recusada — sem ela nao ha idempotencia', () => {
    const parsed = parseEventLine(JSON.stringify({ ...event, source: { kind: 'ingest', result_path: 'x' } }));
    expect(parsed).toEqual({ ok: false, reason: 'not_an_event' });
  });

  it('linha em branco, JSON quebrado e nao-objeto sao pulados sem erro', () => {
    expect(parseEventLine('   ')).toEqual({ ok: false, reason: 'blank' });
    expect(parseEventLine('{ nao json')).toEqual({ ok: false, reason: 'invalid_json' });
    expect(parseEventLine('[1,2]')).toEqual({ ok: false, reason: 'not_an_event' });
  });

  it('envelope incompleto e recusado (seq, event_id, at, type sao obrigatorios)', () => {
    for (const key of ['seq', 'event_id', 'at', 'type']) {
      const broken: Record<string, unknown> = { ...event };
      delete broken[key];
      expect(parseEventLine(JSON.stringify(broken)).ok).toBe(false);
    }
  });

  it('evento de tipo desconhecido e LIDO — o formato preserva o que nao entende', () => {
    const parsed = parseEventLine(JSON.stringify({ ...event, type: 'tipo.que.so.o.canal.novo.conhece' }));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.event.type).toBe('tipo.que.so.o.canal.novo.conhece');
  });

  it('payload ausente ou malformado degrada para objeto vazio, nunca lanca', () => {
    const parsed = parseEventLine(JSON.stringify({ ...event, payload: 'texto solto' }));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.event.payload).toEqual({});
  });

  it('nunca lanca, seja qual for a linha', () => {
    for (const line of ['', 'null', 'undefined', '{}', '"texto"', '\u0000']) {
      expect(() => parseEventLine(line)).not.toThrow();
    }
  });
});

describe('ciclos de vida (D-4)', () => {
  it('todo tipo de item tem exatamente um ciclo', () => {
    const types: WorkItemType[] = ['issue', 'spec', 'process-map', 'adr', 'prototype', 'spike', 'eval'];
    for (const type of types) {
      expect(LIFECYCLE_BY_ITEM_TYPE[type]).toBeTruthy();
    }
    expect(Object.keys(LIFECYCLE_BY_ITEM_TYPE)).toHaveLength(types.length);
  });

  it('spike e prototype terminam por resposta, nao por PR', () => {
    expect(LIFECYCLE_BY_ITEM_TYPE.spike).toBe('answered-question');
    expect(LIFECYCLE_BY_ITEM_TYPE.prototype).toBe('answered-question');
    expect(LIFECYCLE_BY_ITEM_TYPE.issue).toBe('code-delivery');
  });
});
