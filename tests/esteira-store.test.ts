import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, appendFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ESTEIRA_STORE_DIR_ENV_VAR,
  esteiraStoreDir,
  openEsteiraStore,
  storeEventsPath,
  storeSnapshotPath,
} from '../src/main/esteira-store';
import { STORE_SCHEMA_VERSION } from '../src/shared/esteira/store/storeFormat';

// Spec 010 (D-9) — vertical pequeno, passo 2: o WRITER do store. Testa contra
// fs REAL (tmpdir), porque o que se prova aqui e comportamento de disco:
//
// - `events.jsonl` e APPEND-ONLY: nunca reescrito, nunca truncado. O conteudo
//   anterior e sempre prefixo do novo — o teste verifica isso byte a byte.
// - cabecalho de major a frente (canal mais novo escreveu ali) => NAO ESCREVE.
//   E a promessa que fecha o risco aceito em 28/07 (userData compartilhado
//   pelos tres canais): canal antigo nao reescreve o que nao entende.
// - `snapshot.json` e derivado e descartavel: apagar forca reconstrucao do log.

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'donel-esteira-store-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const DRAFT = {
  type: 'discovery.created' as const,
  at: '2026-08-03T12:00:00.000Z',
  dedupe_key: 'run-1:discovery.recorded:dsc-1',
  payload: { id: 'dsc-1', title: 'Fila trava sem sinal', createdAt: '2026-08-03T12:00:00.000Z' },
};

function open(storeDir = dir) {
  return openEsteiraStore({ dir: storeDir, channel: 'alfa', now: () => '2026-08-03T12:00:00.000Z' });
}

describe('esteiraStoreDir', () => {
  it('fica dentro do userData, em pasta propria — fora do config.json e do seu sanitizador', () => {
    expect(esteiraStoreDir({}, 'C:\\Users\\x\\AppData\\Roaming\\donel-dev')).toBe(
      join('C:\\Users\\x\\AppData\\Roaming\\donel-dev', 'esteira'),
    );
  });

  it('aceita override de ambiente, para o smoke nao tocar o store real da maquina', () => {
    expect(esteiraStoreDir({ [ESTEIRA_STORE_DIR_ENV_VAR]: 'C:\\tmp\\store' }, 'C:\\qualquer')).toBe('C:\\tmp\\store');
  });
});

describe('abertura', () => {
  it('cria o diretorio e grava o cabecalho na linha 1', () => {
    const store = open();

    expect(store.compatibility).toBe('read-write');
    const lines = readFileSync(storeEventsPath(dir), 'utf8').trim().split('\n');
    expect(JSON.parse(lines[0])).toMatchObject({ kind: 'esteira.store.header', schema_version: STORE_SCHEMA_VERSION, created_by_channel: 'alfa' });
    expect(store.snapshot().discoveries).toHaveLength(0);
  });

  it('reabrir NAO reescreve o cabecalho nem perde eventos', () => {
    const first = open();
    first.append([DRAFT]);
    const before = readFileSync(storeEventsPath(dir), 'utf8');

    const second = open();
    expect(readFileSync(storeEventsPath(dir), 'utf8')).toBe(before);
    expect(second.snapshot().discoveries).toHaveLength(1);
  });
});

describe('append-only', () => {
  it('acrescenta linha e mantem o conteudo anterior INTACTO (prefixo byte a byte)', () => {
    const store = open();
    store.append([DRAFT]);
    const before = readFileSync(storeEventsPath(dir), 'utf8');

    store.append([{ ...DRAFT, dedupe_key: 'run-2:x', payload: { id: 'dsc-2', title: 'Outro' } }]);
    const after = readFileSync(storeEventsPath(dir), 'utf8');

    expect(after.startsWith(before)).toBe(true);
    expect(after.trim().split('\n')).toHaveLength(3); // cabecalho + 2 eventos
  });

  it('seq e monotonico e continua de onde parou depois de reabrir', () => {
    const first = open();
    const a = first.append([DRAFT, { ...DRAFT, dedupe_key: 'k2' }]);
    expect(a.ok && a.events.map((event) => event.seq)).toEqual([1, 2]);

    const second = open();
    const b = second.append([{ ...DRAFT, dedupe_key: 'k3' }]);
    expect(b.ok && b.events[0].seq).toBe(3);
  });

  it('cada evento sai com id proprio', () => {
    const store = open();
    const result = store.append([DRAFT, { ...DRAFT, dedupe_key: 'k2' }]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(new Set(result.events.map((event) => event.event_id)).size).toBe(2);
  });

  it('append vazio nao toca o arquivo', () => {
    const store = open();
    const before = readFileSync(storeEventsPath(dir), 'utf8');
    expect(store.append([]).ok).toBe(true);
    expect(readFileSync(storeEventsPath(dir), 'utf8')).toBe(before);
  });
});

describe('compatibilidade — a unica pergunta que o cabecalho responde', () => {
  it('arquivo escrito por um canal de major A FRENTE: le e NAO escreve', () => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      storeEventsPath(dir),
      `${JSON.stringify({ kind: 'esteira.store.header', schema_version: '2.0.0', created_at: '2026-08-03T12:00:00.000Z', created_by_channel: 'beta' })}\n` +
        `${JSON.stringify({ seq: 1, event_id: 'evt-1', at: '2026-08-03T12:00:00.000Z', type: 'discovery.created', source: { kind: 'app' }, dedupe_key: null, payload: { id: 'dsc-9', title: 'Do canal novo' } })}\n`,
      'utf8',
    );
    const before = readFileSync(storeEventsPath(dir), 'utf8');

    const store = open();
    expect(store.compatibility).toBe('read-only');
    // Le o que consegue...
    expect(store.snapshot().discoveries[0].id).toBe('dsc-9');
    // ...e recusa escrever, sem tocar um byte do arquivo.
    const result = store.append([DRAFT]);
    expect(result).toEqual({ ok: false, reason: 'read-only' });
    expect(readFileSync(storeEventsPath(dir), 'utf8')).toBe(before);
  });

  it('cabecalho ilegivel: nao escreve e NAO sobrescreve o arquivo existente', () => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(storeEventsPath(dir), 'isto nao e um cabecalho\n', 'utf8');

    const store = open();
    expect(store.compatibility).toBe('unreadable');
    expect(store.append([DRAFT]).ok).toBe(false);
    expect(readFileSync(storeEventsPath(dir), 'utf8')).toBe('isto nao e um cabecalho\n');
  });
});

describe('leitura tolerante — historico nunca se perde por uma linha ruim', () => {
  it('linha corrompida no meio e pulada; as demais entram', () => {
    const store = open();
    store.append([DRAFT]);
    appendFileSync(storeEventsPath(dir), '{ isto nao e json\n', 'utf8');
    store.append([{ ...DRAFT, dedupe_key: 'k2', payload: { id: 'dsc-2', title: 'Segundo' } }]);

    const reopened = open();
    expect(reopened.snapshot().discoveries.map((discovery) => discovery.id)).toEqual(['dsc-1', 'dsc-2']);
  });

  it('evento gravado por um canal mais novo (tipo desconhecido) nao derruba a leitura', () => {
    const store = open();
    store.append([DRAFT]);
    appendFileSync(
      storeEventsPath(dir),
      `${JSON.stringify({ seq: 99, event_id: 'evt-futuro', at: '2026-08-03T12:00:00.000Z', type: 'coisa.do.futuro', source: { kind: 'app' }, dedupe_key: null, payload: {} })}\n`,
      'utf8',
    );

    const reopened = open();
    expect(reopened.snapshot().discoveries).toHaveLength(1);
    // E o seq segue DEPOIS do que ja existe no arquivo — nunca reaproveita numero.
    const result = reopened.append([{ ...DRAFT, dedupe_key: 'k9' }]);
    expect(result.ok && result.events[0].seq).toBe(100);
  });
});

describe('snapshot.json — derivado e descartavel', () => {
  it('e gravado ao lado do log e traz through_seq', () => {
    const store = open();
    store.append([DRAFT]);
    store.persistSnapshot();

    const persisted = JSON.parse(readFileSync(storeSnapshotPath(dir), 'utf8'));
    expect(persisted.kind).toBe('esteira.store.snapshot');
    expect(persisted.through_seq).toBe(1);
    expect(persisted.discoveries).toHaveLength(1);
  });

  it('apagar o snapshot nao perde nada: ele se reconstroi do log', () => {
    const store = open();
    store.append([DRAFT]);
    store.persistSnapshot();
    rmSync(storeSnapshotPath(dir));

    const reopened = open();
    expect(reopened.snapshot().discoveries).toHaveLength(1);
    expect(existsSync(storeSnapshotPath(dir))).toBe(false);
  });

  it('store somente-leitura nao grava snapshot (nem esse arquivo ele toca)', () => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      storeEventsPath(dir),
      `${JSON.stringify({ kind: 'esteira.store.header', schema_version: '2.0.0', created_at: '2026-08-03T12:00:00.000Z', created_by_channel: 'beta' })}\n`,
      'utf8',
    );

    const store = open();
    expect(store.persistSnapshot()).toEqual({ ok: false, reason: 'read-only' });
    expect(existsSync(storeSnapshotPath(dir))).toBe(false);
  });
});

describe('leitura incremental', () => {
  it('refresh pega o que outro processo acrescentou, sem reler o arquivo inteiro', () => {
    const store = open();
    store.append([DRAFT]);
    expect(store.snapshot().discoveries).toHaveLength(1);

    // Outro canal do app, com o mesmo userData, acrescenta um evento.
    appendFileSync(
      storeEventsPath(dir),
      `${JSON.stringify({ seq: 2, event_id: 'evt-outro', at: '2026-08-03T12:05:00.000Z', type: 'discovery.created', source: { kind: 'app' }, dedupe_key: null, payload: { id: 'dsc-2', title: 'Do outro canal' } })}\n`,
      'utf8',
    );

    expect(store.refresh()).toBe(true);
    expect(store.snapshot().discoveries).toHaveLength(2);
    expect(store.refresh()).toBe(false); // nada novo: nao relê
  });
});
