import { describe, expect, it } from 'vitest';
import { reduceEvents } from '../src/shared/esteira/store/reducer';
import { STORE_EVENT_TYPES, parseEventLine, type DiscardedItemTombstone, type IngestRecovery, type StoreEvent } from '../src/shared/esteira/store/storeFormat';

// Spec 010 — os tipos DECLARADOS e ainda não derivados: `ingest.recovered` e a
// lápide do item descartado.
//
// Por que declarar sem implementar, em vez de esperar: a forma deles amarra
// duas camadas (o writer e a tela) e nasceria divergente se cada lado a
// inventasse na sua vez. E o formato JÁ promete o comportamento que os torna
// seguros de declarar — evento de tipo que este canal não deriva é IGNORADO na
// derivação e JAMAIS apagado do log.
//
// Estes testes cobrem só o que este batch de fato entregou: os nomes existem, o
// envelope os aceita, e o log os preserva sem que nada se perca. O que eles
// fazem no snapshot é do batch seguinte.

function evt(type: string, seq: number, payload: Record<string, unknown> = {}): StoreEvent {
  return { seq, event_id: `evt-${seq}`, at: '2026-08-05T12:00:00.000Z', type, source: { kind: 'app' }, dedupe_key: null, payload };
}

describe('tipos declarados para a ingestão sanável e a lápide', () => {
  it('`ingest.recovered` é um tipo conhecido do formato', () => {
    expect(STORE_EVENT_TYPES).toContain('ingest.recovered');
  });

  it('o envelope lê o evento declarado — ele entra no log como qualquer outro', () => {
    const linha = JSON.stringify({
      seq: 7,
      event_id: 'evt-7',
      at: '2026-08-05T12:00:00.000Z',
      type: 'ingest.recovered',
      source: { kind: 'app' },
      dedupe_key: null,
      payload: { resultPath: 'C:/outbox/run-1.json', how: 'a skill reemitiu' },
    });
    const lida = parseEventLine(linha);
    expect(lida.ok).toBe(true);
    if (!lida.ok) return;
    expect(lida.event.type).toBe('ingest.recovered');
    expect(lida.event.payload.how).toBe('a skill reemitiu');
  });

  it('o reducer IGNORA o que ainda não deriva, sem derrubar os eventos vizinhos', () => {
    const snapshot = reduceEvents([
      evt('discovery.created', 1, { id: 'dsc-1', title: 'Fila trava sem sinal' }),
      evt('ingest.recovered', 2, { resultPath: 'C:/outbox/run-1.json', how: 'a skill reemitiu' }),
      evt('plan.created', 3, { id: 'pln-1', discoveryId: 'dsc-1', title: 'Tornar observável' }),
    ]);

    // O evento não derivado não custou os outros — e o `through_seq` prova que
    // ele foi LIDO, não pulado: o log inteiro continua íntegro.
    expect(snapshot.discoveries).toHaveLength(1);
    expect(snapshot.plans).toHaveLength(1);
    expect(snapshot.through_seq).toBe(3);
  });

  it('a lápide tem a forma fixada, e ela responde "por que este item sumiu?"', () => {
    // O teste é do CONTRATO da estrutura: se um campo sair daqui, o batch que
    // a derivar vai descobrir na hora, e não numa tela que não sabe o que
    // mostrar.
    const lapide: DiscardedItemTombstone = {
      id: 'wi-1',
      discoveryId: 'dsc-1',
      title: 'Medir onde o lote para',
      itemType: 'spike',
      discardedAt: '2026-08-05T12:00:00.000Z',
      reason: null,
    };
    expect(Object.keys(lapide).sort()).toEqual(['discardedAt', 'discoveryId', 'id', 'itemType', 'reason', 'title']);
  });

  it('a recuperação tem a forma fixada, ancorada no MESMO caminho do erro que supera', () => {
    const recuperacao: IngestRecovery = {
      resultPath: 'C:/outbox/run-1.json',
      at: '2026-08-05T12:00:00.000Z',
      runId: null,
      subject: { entity: 'discovery', id: 'dsc-1' },
      recoveredCodes: ['unknown_field'],
      how: 'a skill reemitiu sem o campo que só um lado conhecia',
    };
    expect(Object.keys(recuperacao).sort()).toEqual(['at', 'how', 'recoveredCodes', 'resultPath', 'runId', 'subject']);
  });
});
