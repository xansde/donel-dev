import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ESTEIRA_OUTBOX_DIR_ENV_VAR, esteiraOutboxDir, ingestOutbox, ingestResultFile, revalidateIngestErrors } from '../src/main/esteira-ingest';
import { openEsteiraStore, storeEventsPath, type EsteiraStore } from '../src/main/esteira-store';

// Spec 010 (D-10) — a INGESTAO, do arquivo ate o card. O teste que importa nao
// e o caminho feliz: e o de baixo, "documento fora do contrato vira erro
// VISIVEL". Foi a ausencia dele que deixou o app afirmar "fase nao realizada"
// quando o certo era "nao consegui ler" (evidencia 1 da spec).

const EXAMPLES_DIR = join(__dirname, '..', 'src', 'shared', 'esteira', 'contract', 'v1', 'examples');

let dir: string;
let outbox: string;
let store: EsteiraStore;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'donel-esteira-ingest-'));
  outbox = join(dir, 'outbox');
  mkdirSync(outbox, { recursive: true });
  store = openEsteiraStore({ dir: join(dir, 'store'), channel: 'alfa', now: () => '2026-08-03T12:00:00.000Z' });
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function putExample(name: string, as = `${name}.json`): string {
  const target = join(outbox, as);
  copyFileSync(join(EXAMPLES_DIR, `${name}.json`), target);
  return target;
}

describe('esteiraOutboxDir', () => {
  it('fica no home local, fora do repo e fora do userData', () => {
    expect(esteiraOutboxDir({}, () => 'C:\\Users\\x')).toBe(join('C:\\Users\\x', '.claude', 'esteira-donel', 'outbox'));
  });

  it('aceita override de ambiente (smoke e teste nunca tocam o outbox real)', () => {
    expect(esteiraOutboxDir({ [ESTEIRA_OUTBOX_DIR_ENV_VAR]: 'C:\\tmp\\ob' }, () => 'C:\\Users\\x')).toBe('C:\\tmp\\ob');
  });
});

describe('ingestResultFile — caminho feliz', () => {
  it('um result.json valido vira eventos e aparece no snapshot', () => {
    const path = putExample('discovery-com-tracker');
    const outcome = ingestResultFile(store, path);

    expect(outcome.status).toBe('ingested');
    expect(store.snapshot().discoveries[0].title).toBe('Fila de importacao trava sem sinal');
    expect(store.snapshot().plans).toHaveLength(1);
  });

  it('a origem do evento carrega o run_id e o caminho do arquivo — a trilha de volta', () => {
    const path = putExample('discovery-com-tracker');
    ingestResultFile(store, path);

    const event = store.events.find((entry) => entry.type === 'discovery.created');
    expect(event?.source).toEqual({ kind: 'ingest', run_id: 'run-2026-08-03-0900', result_path: path });
  });

  it('reingerir o mesmo arquivo nao acrescenta uma linha sequer ao log', () => {
    const path = putExample('discovery-com-tracker');
    ingestResultFile(store, path);
    const before = readFileSync(storeEventsPath(join(dir, 'store')), 'utf8');

    const again = ingestResultFile(store, path);
    expect(again.status).toBe('already-ingested');
    expect(readFileSync(storeEventsPath(join(dir, 'store')), 'utf8')).toBe(before);
  });
});

// Spec 010 (A4) — o defeito com nome: a fase Concluir regravou o MESMO
// `run_id` com o desfecho revisto. A segunda leitura casou com a `dedupe_key`
// da primeira e cada evento novo foi descartado como "ja visto". O card
// continuou dizendo "terminou sem conclusao" enquanto o arquivo dizia o
// contrario, e nenhum erro apareceu em lugar nenhum.
describe('ingestResultFile — run alterado depois de ingerido (A4)', () => {
  it('o mesmo run_id com conteudo DIFERENTE e recusado com erro visivel no card', () => {
    const path = putExample('discovery-com-tracker');
    expect(ingestResultFile(store, path).status).toBe('ingested');

    const doc = JSON.parse(readFileSync(path, 'utf8'));
    doc.facts.find((fact: { type: string }) => fact.type === 'phase.completed').outcome = 'abandoned';
    writeFileSync(path, JSON.stringify(doc), 'utf8');

    const outcome = ingestResultFile(store, path);
    expect(outcome.status).toBe('rejected');

    const erro = store.snapshot().ingestErrors.at(-1);
    expect(erro?.issues[0].code).toBe('run_changed_after_ingest');
    // O erro tem DONO: ele aparece no card, nao num log que ninguem le.
    expect(erro?.subject).toEqual({ entity: 'discovery', id: 'dsc-2026-08-03-a' });
    // E o desfecho antigo continua de pe: recusar nao e engolir metade.
    expect(store.snapshot().phases[0].outcome).toBe('done');
  });

  it('o COMPLEMENTO do mesmo run entra — ele acrescenta fatos, nao reescreve', () => {
    ingestResultFile(store, putExample('spike-inconclusivo'));
    const antes = store.snapshot().artifacts.length;

    expect(ingestResultFile(store, putExample('complemento-do-implementar')).status).toBe('ingested');
    expect(store.snapshot().artifacts.length).toBe(antes + 1);
    // A fase nao foi contada de novo: o complemento nao a redeclara.
    expect(store.snapshot().phases.filter((phase) => phase.phase === 'implementar')).toHaveLength(1);
  });

  it('o livro dos runs guarda o parentesco — desfecho revisto vira dado consultavel (A13)', () => {
    ingestResultFile(store, putExample('concluir-desfecho-revisto'));
    const run = store.snapshot().runs.find((entry) => entry.runId === 'run-2026-08-06-1600.rev2');
    expect(run?.revisesRunId).toBe('run-2026-08-06-1600');
    expect(run?.kind).toBe('esteira.result');
  });
});

describe('ingestResultFile — o documento fora do contrato', () => {
  it('vira erro VISIVEL no snapshot, com os issues e o caminho — nunca silencio', () => {
    const path = join(outbox, 'quebrado.json');
    // Campo que so um lado conhece: exatamente o desencontro que originou a spec.
    const doc = JSON.parse(readFileSync(join(EXAMPLES_DIR, 'discovery-com-tracker.json'), 'utf8'));
    doc.facts[0].fanout_cards = ['card-1'];
    writeFileSync(path, JSON.stringify(doc), 'utf8');

    const outcome = ingestResultFile(store, path);

    expect(outcome.status).toBe('rejected');
    const errors = store.snapshot().ingestErrors;
    expect(errors).toHaveLength(1);
    expect(errors[0].resultPath).toBe(path);
    expect(errors[0].issues.some((issue) => issue.path.includes('fanout_cards'))).toBe(true);
    // E o card do assunto fica MARCADO — o erro tem dono, nao fica num log solto.
    expect(errors[0].subject).toEqual({ entity: 'discovery', id: 'dsc-2026-08-03-a' });
  });

  it('nenhum fato do documento recusado entra no store — o app nao aproveita meia verdade', () => {
    const path = join(outbox, 'quebrado.json');
    const doc = JSON.parse(readFileSync(join(EXAMPLES_DIR, 'discovery-com-tracker.json'), 'utf8'));
    doc.facts[0].fanout_cards = ['card-1'];
    writeFileSync(path, JSON.stringify(doc), 'utf8');

    ingestResultFile(store, path);

    expect(store.snapshot().discoveries).toHaveLength(0);
    expect(store.snapshot().plans).toHaveLength(0);
  });

  it('contrato de major desconhecido e recusado com codigo proprio, sem chutar', () => {
    const path = join(outbox, 'futuro.json');
    const doc = JSON.parse(readFileSync(join(EXAMPLES_DIR, 'discovery-com-tracker.json'), 'utf8'));
    doc.contract_version = '2.0.0';
    writeFileSync(path, JSON.stringify(doc), 'utf8');

    expect(ingestResultFile(store, path).status).toBe('rejected');
    expect(store.snapshot().ingestErrors[0].issues.some((issue) => issue.code === 'unsupported_major')).toBe(true);
  });

  it('JSON quebrado tambem vira erro visivel, nao excecao', () => {
    const path = join(outbox, 'truncado.json');
    writeFileSync(path, '{"kind":"esteira.result", "run":', 'utf8');

    expect(() => ingestResultFile(store, path)).not.toThrow();
    expect(store.snapshot().ingestErrors[0].issues[0].code).toBe('invalid_json');
  });

  it('o mesmo arquivo quebrado, relido a cada boot, mostra UM erro — nao uma pilha', () => {
    const path = join(outbox, 'truncado.json');
    writeFileSync(path, '{ nao json', 'utf8');

    ingestResultFile(store, path);
    ingestResultFile(store, path);
    ingestResultFile(store, path);

    expect(store.snapshot().ingestErrors).toHaveLength(1);
  });

  it('arquivo ausente nao quebra nem inventa erro de contrato', () => {
    const outcome = ingestResultFile(store, join(outbox, 'nao-existe.json'));
    expect(outcome.status).toBe('unreadable');
    expect(store.snapshot().ingestErrors).toHaveLength(0);
  });
});

describe('ingestOutbox — a varredura do diretorio combinado', () => {
  it('ingere todos os result.json e devolve o resumo', () => {
    putExample('discovery-com-tracker');
    putExample('plano-com-itens');

    const summary = ingestOutbox(store, outbox);

    expect(summary.ingested).toBe(2);
    expect(summary.rejected).toBe(0);
    expect(store.snapshot().workItems).toHaveLength(3);
  });

  it('um arquivo quebrado nao impede os outros de entrarem', () => {
    putExample('discovery-com-tracker');
    writeFileSync(join(outbox, 'zzz-quebrado.json'), '{ nao json', 'utf8');

    const summary = ingestOutbox(store, outbox);

    expect(summary.ingested).toBe(1);
    expect(summary.rejected).toBe(1);
    expect(store.snapshot().discoveries).toHaveLength(1);
    expect(store.snapshot().ingestErrors).toHaveLength(1);
  });

  it('ignora o que nao e .json e nao explode com diretorio inexistente', () => {
    writeFileSync(join(outbox, 'anotacao.txt'), 'nada a ver', 'utf8');
    expect(ingestOutbox(store, outbox)).toMatchObject({ ingested: 0, rejected: 0 });
    expect(ingestOutbox(store, join(dir, 'nem-existe'))).toMatchObject({ ingested: 0, rejected: 0 });
  });

  it('a segunda varredura do mesmo outbox nao duplica nada', () => {
    putExample('discovery-com-tracker');
    ingestOutbox(store, outbox);
    const first = store.snapshot();

    const summary = ingestOutbox(store, outbox);
    expect(summary.alreadyIngested).toBe(1);
    expect(store.snapshot().discoveries).toHaveLength(first.discoveries.length);
    expect(store.events.length).toBe(first.through_seq);
  });
});

// A5 — o CUSTO: o card sabe o que o arquivo recusado declarava, sem entrar.
describe('ingestResultFile — o custo do documento recusado (A5)', () => {
  it('o erro carrega os fatos declarados — os work_item.recorded que nunca chegaram a existir', () => {
    const path = join(outbox, 'quebrado.json');
    const doc = JSON.parse(readFileSync(join(EXAMPLES_DIR, 'plano-com-itens.json'), 'utf8'));
    doc.facts[0].fanout_cards = ['card-1'];
    writeFileSync(path, JSON.stringify(doc), 'utf8');

    ingestResultFile(store, path);

    const error = store.snapshot().ingestErrors[0];
    const workItems = error.declaredFacts.filter((fact) => fact.entity === 'work_item');
    expect(workItems).toHaveLength(3);
    expect(workItems.map((fact) => fact.id)).toContain('wi-2026-08-03-a1-01');
    expect(store.snapshot().workItems).toHaveLength(0); // nao entrou nenhum — a lista e o CUSTO, nao um atalho para o dado
  });
});

// A6 — a ingestao SANAVEL: um arquivo recusado que passou a ler vira um FATO
// de recuperacao, sem apagar o `ingest.failed` do log.
describe('ingestResultFile — a recuperacao de um path que estava em erro (A6)', () => {
  it('arquivo corrigido no MESMO path emite ingest.recovered e some de ingestErrors', () => {
    const path = join(outbox, 'run-quebrado.json');
    const doc = JSON.parse(readFileSync(join(EXAMPLES_DIR, 'discovery-com-tracker.json'), 'utf8'));
    doc.facts[0].fanout_cards = ['card-1'];
    writeFileSync(path, JSON.stringify(doc), 'utf8');

    expect(ingestResultFile(store, path).status).toBe('rejected');
    expect(store.snapshot().ingestErrors).toHaveLength(1);

    delete doc.facts[0].fanout_cards;
    writeFileSync(path, JSON.stringify(doc), 'utf8');
    const outcome = ingestResultFile(store, path);

    expect(outcome.status).toBe('ingested');
    expect(store.snapshot().ingestErrors).toHaveLength(0);
    expect(store.snapshot().ingestRecoveries).toHaveLength(1);
    expect(store.snapshot().ingestRecoveries[0].resultPath).toBe(path);
    // O `ingest.failed` original continua no LOG — so o status de agora mudou.
    expect(readFileSync(storeEventsPath(join(dir, 'store')), 'utf8')).toContain('ingest.failed');
  });

  it('arquivo que nunca teve erro pendente NAO gera recuperacao ao ser ingerido', () => {
    putExample('discovery-com-tracker');
    expect(store.snapshot().ingestRecoveries).toHaveLength(0);
  });
});

describe('revalidateIngestErrors — a abertura do app revalida os erros pendentes (A6)', () => {
  it('arquivo que NAO EXISTE MAIS sai da lista de erros', () => {
    const path = join(outbox, 'run-sumiu.json');
    const doc = JSON.parse(readFileSync(join(EXAMPLES_DIR, 'discovery-com-tracker.json'), 'utf8'));
    doc.facts[0].fanout_cards = ['card-1'];
    writeFileSync(path, JSON.stringify(doc), 'utf8');
    ingestResultFile(store, path);
    expect(store.snapshot().ingestErrors).toHaveLength(1);

    unlinkSync(path);
    const summary = revalidateIngestErrors(store);

    expect(summary).toEqual({ recovered: 1, stillFailing: 0 });
    expect(store.snapshot().ingestErrors).toHaveLength(0);
    expect(store.snapshot().ingestRecoveries[0].how).toContain('não existe mais');
  });

  it('arquivo que EXISTE e agora PASSA e recuperado pelo mesmo caminho de uma releitura normal', () => {
    const path = join(outbox, 'run-consertado.json');
    const doc = JSON.parse(readFileSync(join(EXAMPLES_DIR, 'discovery-com-tracker.json'), 'utf8'));
    doc.facts[0].fanout_cards = ['card-1'];
    writeFileSync(path, JSON.stringify(doc), 'utf8');
    ingestResultFile(store, path);

    delete doc.facts[0].fanout_cards;
    writeFileSync(path, JSON.stringify(doc), 'utf8');
    const summary = revalidateIngestErrors(store);

    expect(summary).toEqual({ recovered: 1, stillFailing: 0 });
    expect(store.snapshot().discoveries).toHaveLength(1);
  });

  it('arquivo que CONTINUA quebrado nao vira recuperacao nem duplica erro', () => {
    const path = join(outbox, 'run-continua-quebrado.json');
    writeFileSync(path, '{ nao json', 'utf8');
    ingestResultFile(store, path);

    const summary = revalidateIngestErrors(store);

    expect(summary).toEqual({ recovered: 0, stillFailing: 1 });
    expect(store.snapshot().ingestErrors).toHaveLength(1);
  });

  it('sem erro pendente nenhum, nao faz nada', () => {
    expect(revalidateIngestErrors(store)).toEqual({ recovered: 0, stillFailing: 0 });
  });
});
