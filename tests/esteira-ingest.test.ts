import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ESTEIRA_OUTBOX_DIR_ENV_VAR, esteiraOutboxDir, HISTORIC_CONTRACT_CUTOFF, ingestOutbox, ingestResultFile, revalidateIngestErrors } from '../src/main/esteira-ingest';
import { ingestFailureEvent } from '../src/shared/esteira/ingest/resultToEvents';
import { openEsteiraStore, storeEventsPath, type EsteiraStore } from '../src/main/esteira-store';

// Spec 010 (D-10) — a INGESTAO, do arquivo ate o card. O teste que importa nao
// e o caminho feliz: e o de baixo, "documento fora do contrato vira erro
// VISIVEL". Foi a ausencia dele que deixou o app afirmar "fase nao realizada"
// quando o certo era "nao consegui ler" (evidencia 1 da spec).

const EXAMPLES_DIR = join(__dirname, '..', 'docs', 'esteira-dev', 'contract', 'v1', 'examples');

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

/**
 * F26 — os fixtures do corpus (`EXAMPLES_DIR`) tem `run.finished_at` de
 * 03/08, ANTES de `HISTORIC_CONTRACT_CUTOFF` (05/08). Um teste que quer um
 * documento "novo" (contrato de HOJE, sem relacao com o outbox historico)
 * precisa de um timestamp DEPOIS do corte — senao a anistia por data (criterio
 * 3) o pega, mascarando o que o teste quer provar (rejeicao normal).
 */
function freshenRun(doc: { run: { started_at: string; finished_at: string } }): void {
  doc.run.started_at = '2026-08-06T09:00:00.000Z';
  doc.run.finished_at = '2026-08-06T09:41:07.000Z';
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
    freshenRun(doc);
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
    freshenRun(doc);
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
    freshenRun(doc);
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
    freshenRun(doc);
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
    freshenRun(doc);
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
    freshenRun(doc);
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

// F26 — a anistia do outbox historico: um RUN JA INGERIDO pelo contrato
// antigo nao pode reaparecer como "nao consegui ler" so porque o contrato
// endureceu. Revalidacao/re-scan so LIMPA a tela, nunca SUJA um run que ja
// foi ingerido legitimamente.
describe('ingestResultFile — a anistia do outbox historico (F26)', () => {
  it('(a) run ja ingerido cujo arquivo passa a falhar no contrato novo e ANISTIADO, nao vira erro', () => {
    const path = putExample('discovery-com-tracker');
    expect(ingestResultFile(store, path).status).toBe('ingested');

    // O "contrato mais rigoroso de hoje": o MESMO arquivo, com um campo que o
    // parser de agora nao conhece (o parser recusaria isto como run novo).
    const doc = JSON.parse(readFileSync(path, 'utf8'));
    doc.facts[0].fanout_cards = ['card-1'];
    writeFileSync(path, JSON.stringify(doc), 'utf8');

    const outcome = ingestResultFile(store, path);

    expect(outcome.status).toBe('amnestied');
    expect(outcome.runId).toBe('run-2026-08-03-0900');
    expect(store.snapshot().ingestErrors).toHaveLength(0);
    // Os fatos da ingestao ORIGINAL continuam de pe — a anistia nao os apaga
    // nem os reescreve.
    expect(store.snapshot().discoveries).toHaveLength(1);
    expect(store.snapshot().discoveries[0].title).toBe('Fila de importacao trava sem sinal');
  });

  it('(b) store ja poluido (ingest.failed gravado ANTES do fix) — o proximo scan deixa o path amnistiado', () => {
    const path = putExample('discovery-com-tracker');
    expect(ingestResultFile(store, path).status).toBe('ingested');

    const doc = JSON.parse(readFileSync(path, 'utf8'));
    doc.facts[0].fanout_cards = ['card-1'];
    writeFileSync(path, JSON.stringify(doc), 'utf8');

    // Simula o `ingest.failed` que o boot de hoje cedo gravou ANTES do fix —
    // aquele codigo nao consultava o livro dos runs. Escrito direto no log,
    // sem passar por `ingestResultFile` (que ja tem o fix), para reproduzir
    // fielmente a ordem real: `run.ingested` (do ingest valido) seguido de
    // `ingest.failed` (do boot ruim).
    const failureDeHojeCedo = ingestFailureEvent({
      resultPath: path,
      issues: [{ code: 'unknown_field', path: 'facts[0].fanout_cards', message: 'unknown field "fanout_cards"' }],
      subject: { entity: 'discovery', id: 'dsc-2026-08-03-a' },
      at: '2026-08-05T08:00:00.000Z',
      declaredFacts: [],
    });
    store.append([failureDeHojeCedo], { kind: 'app' });
    expect(store.snapshot().ingestErrors).toHaveLength(1);

    // O PROXIMO boot (com o fix) reprocessa o mesmo arquivo.
    const outcome = ingestResultFile(store, path);

    expect(outcome.status).toBe('amnestied');
    expect(store.snapshot().ingestErrors).toHaveLength(0);
    // O `ingest.failed` de hoje cedo PERMANECE no log — a anistia nao apaga
    // historico, so para de mostrar o path como pendente.
    expect(readFileSync(storeEventsPath(join(dir, 'store')), 'utf8')).toContain('ingest.failed');
  });

  it('(c) run NOVO (fora do livro) com arquivo invalido continua ingest.failed — a regra nova vale para run novo', () => {
    const path = join(outbox, 'run-novo-invalido.json');
    const doc = JSON.parse(readFileSync(join(EXAMPLES_DIR, 'discovery-com-tracker.json'), 'utf8'));
    doc.run.run_id = 'run-2026-08-05-9999'; // nunca entrou no livro
    freshenRun(doc); // depois do corte — isola do criterio 3 (data)
    doc.facts[0].fanout_cards = ['card-1'];
    writeFileSync(path, JSON.stringify(doc), 'utf8');

    const outcome = ingestResultFile(store, path);

    expect(outcome.status).toBe('rejected');
    expect(store.snapshot().ingestErrors).toHaveLength(1);
    expect(store.snapshot().ingestErrors[0].issues.some((issue) => issue.path.includes('fanout_cards'))).toBe(true);
  });

  it('(d) arquivo sem run_id extraivel (JSON quebrado de verdade) continua ingest.failed', () => {
    const path = join(outbox, 'truncado-sem-run-id.json');
    writeFileSync(path, '{"kind":"esteira.result", "run":', 'utf8');

    const outcome = ingestResultFile(store, path);

    expect(outcome.status).toBe('rejected');
    expect(store.snapshot().ingestErrors).toHaveLength(1);
    expect(store.snapshot().ingestErrors[0].issues[0].code).toBe('invalid_json');
  });

  it('(e) dois boots seguidos nao empilham eventos duplicados — o dedupe do amnestied e chave propria', () => {
    const path = putExample('discovery-com-tracker');
    ingestResultFile(store, path);

    const doc = JSON.parse(readFileSync(path, 'utf8'));
    doc.facts[0].fanout_cards = ['card-1'];
    writeFileSync(path, JSON.stringify(doc), 'utf8');

    expect(ingestResultFile(store, path).status).toBe('amnestied'); // primeiro "boot" com o contrato novo
    const afterFirst = store.events.length;

    expect(ingestResultFile(store, path).status).toBe('amnestied'); // segundo "boot": releitura do mesmo arquivo
    expect(store.events.length).toBe(afterFirst);
    expect(store.snapshot().ingestErrors).toHaveLength(0);
  });

  it('ingestOutbox conta os arquivos anistiados a parte dos rejeitados', () => {
    const path = putExample('discovery-com-tracker');
    ingestResultFile(store, path);
    const doc = JSON.parse(readFileSync(path, 'utf8'));
    doc.facts[0].fanout_cards = ['card-1'];
    writeFileSync(path, JSON.stringify(doc), 'utf8');

    const summary = ingestOutbox(store, outbox);

    expect(summary.amnestied).toBe(1);
    expect(summary.rejected).toBe(0);
  });
});

// F26 (achado real do dono, pos-deploy) — a anistia so olhava `snapshot().runs`
// (eventos `run.ingested`), mas o livro NASCEU depois de muitos runs ja terem
// entrado. Tres runs de erro real: 4/18 no livro (ja cobertos acima), 10/18
// ingeridos ANTES do livro existir (fatos no store com `source.run_id`, sem
// `run.ingested`), 4/18 nunca ingeridos por store nenhum (arquivos quebrados
// desde o nascimento). Os dois criterios abaixo cobrem os dois primeiros.
describe('ingestResultFile — a anistia ampliada: run pre-ledger e corte por data (F26)', () => {
  it('(i) run PRE-LEDGER — fatos no store com source.run_id, sem run.ingested — e anistiado', () => {
    const path = putExample('discovery-com-tracker');

    // Simula um fato ingerido ANTES do evento `run.ingested` existir: so o
    // fato em si, com origem `ingest`, nenhum `run.ingested` gravado.
    store.append(
      [
        {
          type: 'discovery.created',
          at: '2026-01-01T00:00:00.000Z',
          dedupe_key: 'run-pre-ledger:discovery.recorded:dsc-pre-ledger',
          payload: {
            id: 'dsc-pre-ledger',
            title: 'Discovery pre-ledger',
            problem: null,
            tracker: null,
            targetRepo: null,
            scopeRepos: [],
            createdAt: '2026-01-01T00:00:00.000Z',
          },
        },
      ],
      { kind: 'ingest', run_id: 'run-pre-ledger', result_path: path },
    );
    expect(store.snapshot().runs).toHaveLength(0); // o livro nao sabe deste run
    expect(store.snapshot().knownIngestRunIds.has('run-pre-ledger')).toBe(true);

    // Um arquivo com o MESMO run_id, timestamp DEPOIS do corte (isola que a
    // anistia vem do criterio 2, nao do criterio 3) e um campo que o parser
    // de hoje recusa.
    const doc = JSON.parse(readFileSync(path, 'utf8'));
    doc.run.run_id = 'run-pre-ledger';
    doc.run.started_at = '2026-08-06T09:00:00.000Z';
    doc.run.finished_at = '2026-08-06T09:41:07.000Z';
    doc.facts[0].fanout_cards = ['card-1'];
    writeFileSync(path, JSON.stringify(doc), 'utf8');

    const outcome = ingestResultFile(store, path);

    expect(outcome.status).toBe('amnestied');
    expect(outcome.runId).toBe('run-pre-ledger');
    expect(store.snapshot().ingestErrors).toHaveLength(0);
  });

  it('(ii) arquivo NUNCA ingerido, com finished_at anterior ao corte, e anistiado por CORTE DE DATA', () => {
    const path = join(outbox, 'run-antigo-nunca-ingerido.json');
    const doc = JSON.parse(readFileSync(join(EXAMPLES_DIR, 'discovery-com-tracker.json'), 'utf8'));
    doc.run.run_id = 'run-2026-07-01-antigo';
    doc.run.started_at = '2026-07-01T09:00:00.000Z';
    doc.run.finished_at = '2026-07-01T09:41:07.000Z'; // antes do HISTORIC_CONTRACT_CUTOFF
    doc.facts[0].fanout_cards = ['card-1']; // o que o parser de hoje recusaria
    writeFileSync(path, JSON.stringify(doc), 'utf8');
    expect(Date.parse(doc.run.finished_at)).toBeLessThan(Date.parse(HISTORIC_CONTRACT_CUTOFF));

    const outcome = ingestResultFile(store, path);

    expect(outcome.status).toBe('amnestied');
    expect(outcome.runId).toBe('run-2026-07-01-antigo');
    expect(store.snapshot().ingestErrors).toHaveLength(0);
    expect(store.snapshot().ingestAmnesties).toHaveLength(1);
  });

  it('(iii) arquivo NOVO (timestamp apos o corte, run_id desconhecido) invalido continua ingest.failed', () => {
    const path = join(outbox, 'run-novo-apos-corte.json');
    const doc = JSON.parse(readFileSync(join(EXAMPLES_DIR, 'discovery-com-tracker.json'), 'utf8'));
    doc.run.run_id = 'run-2026-08-06-novo';
    doc.run.started_at = '2026-08-06T09:00:00.000Z';
    doc.run.finished_at = '2026-08-06T09:41:07.000Z'; // depois do corte
    doc.facts[0].fanout_cards = ['card-1'];
    writeFileSync(path, JSON.stringify(doc), 'utf8');
    expect(Date.parse(doc.run.finished_at)).toBeGreaterThan(Date.parse(HISTORIC_CONTRACT_CUTOFF));

    const outcome = ingestResultFile(store, path);

    expect(outcome.status).toBe('rejected');
    expect(store.snapshot().ingestErrors).toHaveLength(1);
    expect(store.snapshot().ingestAmnesties).toHaveLength(0);
  });

  it('(iv) sem run_id extraivel e sem timestamp extraivel continua ingest.failed', () => {
    const path = join(outbox, 'sem-run-nem-timestamp.json');
    // JSON valido, mas sem "run" nenhum: nem run_id nem finished_at/started_at
    // tem de onde sair.
    writeFileSync(path, JSON.stringify({ kind: 'esteira.result', facts: [] }), 'utf8');

    const outcome = ingestResultFile(store, path);

    expect(outcome.status).toBe('rejected');
    expect(store.snapshot().ingestErrors).toHaveLength(1);
    expect(store.snapshot().ingestAmnesties).toHaveLength(0);
  });
});
