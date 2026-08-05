// Spec 010 (D-10) — vertical pequeno, passo 2: a INGESTAO. Descobre o
// `result.json` que a skill deixou, valida contra o contrato e traduz em
// eventos do store. A traducao em si e pura (`shared/esteira/ingest`); aqui
// mora o encanamento de disco.
//
// A REGRA que este modulo existe para cumprir: **o app nunca afirma o que nao
// leu**. Documento fora do contrato nao e ignorado nem "interpretado do jeito
// que der" — vira `ingest.failed` com os issues do parser e o caminho do
// arquivo, visivel no card. "Nao consegui ler" e um estado; "nao realizada" e
// uma afirmacao. Confundir os dois foi o bug de 03/08.
//
// Nada aqui lanca: arquivo ausente, permissao negada ou JSON truncado degradam
// para um resultado tipado.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { declaredFactsFromRawText, parseEsteiraResultText, runIdFromRawText, runTimestampFromRawText } from '../shared/esteira/contract/resultContract';
import { ingestAmnestyEvent, ingestFailureEvent, ingestRecoveryEvent, resultToEvents, runSubject } from '../shared/esteira/ingest/resultToEvents';
import { checkReingest, resultFingerprint } from '../shared/esteira/ingest/runLedger';
import type { EsteiraStore } from './esteira-store';

/**
 * F26 — o instante em que o contrato endurecido (novos required-facts,
 * `done_without_human_decision`, enum `verification_kind`, `unknown_field`)
 * entrou no app instalado do dono. Runs cujo timestamp e ANTERIOR a este
 * corte sao historicos por definicao: nao ha como eles terem sido escritos
 * ja sabendo de regras que ainda nao existiam, e o contrato de hoje nao pode
 * cobrar retroativamente algo que a skill de ontem nunca prometeu cumprir.
 *
 * So entra em jogo quando o `run_id` nao e conhecido de nenhuma ingestao
 * anterior (criterio 1/2) — e o criterio de ULTIMO recurso, nao o primeiro.
 */
export const HISTORIC_CONTRACT_CUTOFF = '2026-08-05T13:00:00Z';

/**
 * Comparacao NUMERICA (nao lexicografica): `finished_at`/`started_at` de um
 * `result.json` pode vir sem milissegundos ou noutra forma ISO valida que
 * ainda assim compara errado como string. `Date.parse` invalido (`NaN`) e
 * "nao da para dizer" — nunca tratado como anterior ao corte.
 */
function isBeforeHistoricCutoff(timestamp: string): boolean {
  const value = Date.parse(timestamp);
  if (Number.isNaN(value)) return false;
  return value < Date.parse(HISTORIC_CONTRACT_CUTOFF);
}

/**
 * O "local combinado" — onde a skill deixa o `result.json` e o app o encontra.
 *
 * Fora do repo (nao polui checkout nem vira commit acidental), fora do
 * `userData` (a skill nao sabe o nome nem o canal do app), no home LOCAL —
 * nunca no OneDrive, onde sync gera conflito.
 */
export const ESTEIRA_OUTBOX_DIR_ENV_VAR = 'DONEL_ESTEIRA_OUTBOX_DIR';

export function esteiraOutboxDir(env: Record<string, string | undefined>, homedirFn: () => string): string {
  const override = env[ESTEIRA_OUTBOX_DIR_ENV_VAR];
  return override && override.trim() ? override : join(homedirFn(), '.claude', 'esteira-donel', 'outbox');
}

export type IngestStatus =
  /** Fatos gravados no store. */
  | 'ingested'
  /** Ja estava no store (mesmo `run_id`, mesmo conteudo): nenhuma linha nova. */
  | 'already-ingested'
  /** Fora do contrato: virou `ingest.failed` VISIVEL, com os issues. */
  | 'rejected'
  /**
   * F26 — fora do contrato ATUAL, mas o `run_id` ja consta no livro: e um run
   * historico, ja ingerido por um contrato mais antigo. Virou `ingest.amnestied`,
   * nao `ingest.failed` — a tela nao ganha um erro para um run que ja existe.
   */
  | 'amnestied'
  /** Nao deu para ler o arquivo (ausente, permissao). Nao e afirmacao sobre a fase. */
  | 'unreadable'
  /** O store recusou escrita (cabecalho de major a frente, por exemplo). */
  | 'store-refused';

export interface IngestOutcome {
  readonly status: IngestStatus;
  readonly resultPath: string;
  readonly runId: string | null;
}

/** Le um `result.json` e o grava no store. Nunca lanca. */
export function ingestResultFile(store: EsteiraStore, resultPath: string): IngestOutcome {
  // A6 — este path JA estava com erro pendente? Precisa saber ANTES de tentar
  // ler de novo: se o documento passar desta vez, isto e o que diz que houve
  // RECUPERACAO, e nao so mais uma ingestao normal.
  const pendingError = store.snapshot().ingestErrors.find((error) => error.resultPath === resultPath) ?? null;

  let text: string;
  try {
    text = readFileSync(resultPath, 'utf8');
  } catch {
    // Nao ler um arquivo NAO diz nada sobre o trabalho que ele descreve — e por
    // isso que este caminho nao grava fato nenhum.
    return { status: 'unreadable', resultPath, runId: null };
  }

  const parsed = parseEsteiraResultText(text);

  if (!parsed.ok) {
    // O erro precisa ter DONO: sem o `subject` do documento (que pode estar
    // ilegivel), ele aparece como erro sem card, mas aparece.
    const subject = subjectFromRawText(text);

    // F26 — antes de afirmar "nao consegui ler", tres criterios (em ordem) —
    // qualquer um basta:
    //
    // 1/2. Este `run_id` (lido de forma leniente, sem exigir que o resto do
    //    documento seja valido) JA PASSOU pela ingestao — no livro
    //    (`store.snapshot().runs`, o caso comum) OU em qualquer evento ja
    //    gravado com origem `ingest` mesmo sem `run.ingested`
    //    (`knownIngestRunIds`: os runs pre-ledger, ingeridos ANTES do livro
    //    existir, tem fatos no store mas nunca ganharam aquele evento).
    // 3. Sem `run_id` conhecido: o TIMESTAMP do run (leniente, `finished_at`
    //    OU `started_at`) e anterior ao corte do contrato endurecido — um run
    //    de antes daquela data nao tem como ter sido escrito ja sabendo das
    //    regras de hoje.
    //
    // Qualquer um dos tres e um run HISTORICO, ingerido (ou tentado) de boa
    // fe por um contrato mais antigo — o endurecimento de HOJE nao pode fazer
    // ele reaparecer como erro. Revalidacao/re-scan so LIMPA, nunca SUJA.
    const rawRunId = runIdFromRawText(text);
    const snapshot = store.snapshot();
    const runIdKnown = rawRunId !== null && (snapshot.runs.some((run) => run.runId === rawRunId) || snapshot.knownIngestRunIds.has(rawRunId));

    let isHistoric = runIdKnown;
    if (!isHistoric) {
      const rawTimestamp = runTimestampFromRawText(text);
      isHistoric = rawTimestamp !== null && isBeforeHistoricCutoff(rawTimestamp);
    }

    if (isHistoric) {
      const amnesty = ingestAmnestyEvent({
        resultPath,
        runId: rawRunId,
        subject,
        issues: parsed.issues,
        at: new Date().toISOString(),
      });
      const written = store.append([amnesty], { kind: 'app' });
      if (!written.ok) return { status: 'store-refused', resultPath, runId: rawRunId };
      return { status: 'amnestied', resultPath, runId: rawRunId };
    }

    const failure = ingestFailureEvent({
      resultPath,
      issues: parsed.issues,
      subject,
      at: new Date().toISOString(),
      // A5 — o custo: o que este arquivo declararia, se entrasse.
      declaredFacts: declaredFactsFromRawText(text),
    });
    const written = store.append([failure], { kind: 'app' });
    if (!written.ok) return { status: 'store-refused', resultPath, runId: null };
    return { status: 'rejected', resultPath, runId: null };
  }

  const result = parsed.result;

  // A4 — o mesmo `run_id` de volta com conteudo DIFERENTE e um run alterado
  // depois de ingerido, nao uma releitura. Sem esta checagem, cada evento novo
  // casaria com a `dedupe_key` do anterior e seria descartado como "ja visto":
  // foi assim que a Concluir regravou o desfecho e o card ficou dizendo
  // "terminou sem conclusao" sem nenhum erro em lugar nenhum.
  const verdict = checkReingest(store.snapshot().runs, result, resultFingerprint(result));
  if (verdict.kind === 'changed') {
    const failure = ingestFailureEvent({
      resultPath,
      issues: [verdict.issue],
      subject: runSubject(result),
      at: new Date().toISOString(),
      declaredFacts: declaredFactsFromRawText(text),
    });
    const refused = store.append([failure], { kind: 'app' });
    if (!refused.ok) return { status: 'store-refused', resultPath, runId: result.run.run_id };
    return { status: 'rejected', resultPath, runId: result.run.run_id };
  }

  const drafts = resultToEvents(result, { resultPath });
  const written = store.append(drafts, { kind: 'ingest', run_id: result.run.run_id, result_path: resultPath });

  if (!written.ok) return { status: 'store-refused', resultPath, runId: result.run.run_id };

  // A6 — o documento passou, e este path tinha um erro pendente: a recuperacao
  // e um FATO proprio, nao o apagamento do `ingest.failed` anterior (que
  // continua no log). So muda o status DE AGORA daquele path.
  if (pendingError !== null) {
    store.append(
      [
        ingestRecoveryEvent({
          resultPath,
          at: new Date().toISOString(),
          runId: result.run.run_id,
          subject: pendingError.subject,
          recoveredCodes: pendingError.issues.map((issue) => issue.code),
          how: 'o documento agora passa no contrato',
        }),
      ],
      { kind: 'app' },
    );
  }

  // Zero eventos escritos com drafts nao-vazios = tudo ja estava la (dedupe).
  if (written.events.length === 0 && drafts.length > 0) {
    return { status: 'already-ingested', resultPath, runId: result.run.run_id };
  }
  return { status: 'ingested', resultPath, runId: result.run.run_id };
}

export interface RevalidateSummary {
  readonly recovered: number;
  readonly stillFailing: number;
}

/**
 * A6 — "revalidar os erros na ABERTURA do app": o parser e puro e barato, e
 * so examina os paths que hoje aparecem em `ingestErrors`. Dois desfechos
 * viram recuperacao, e so um deles passa pelo parser:
 *
 * - o arquivo NAO EXISTE MAIS — a preocupacao que ele registrava nao tem mais
 *   objeto; recupera direto, sem tentar ler nada.
 * - o arquivo EXISTE e agora PASSA — `ingestResultFile` cuida de emitir a
 *   recuperacao, pelo MESMO caminho que uma releitura em vida normal usaria.
 *
 * Caso real que motivou isto: de 4 erros na tela, 3 arquivos ja liam bem e 1
 * nem existia mais — e so um reboot (ou esta funcao) para descobrir.
 */
export function revalidateIngestErrors(store: EsteiraStore, now: () => string = () => new Date().toISOString()): RevalidateSummary {
  const pending = store.snapshot().ingestErrors;
  let recovered = 0;
  let stillFailing = 0;

  for (const error of pending) {
    if (!existsSync(error.resultPath)) {
      const recovery = ingestRecoveryEvent({
        resultPath: error.resultPath,
        at: now(),
        runId: null,
        subject: error.subject,
        recoveredCodes: error.issues.map((issue) => issue.code),
        how: 'o arquivo não existe mais no outbox',
      });
      const written = store.append([recovery], { kind: 'app' });
      if (written.ok) recovered += 1;
      else stillFailing += 1;
      continue;
    }

    const outcome = ingestResultFile(store, error.resultPath);
    // F26 — `amnestied` some de `ingestErrors` tao bem quanto `ingested`: para
    // quem olha a tela, e a MESMA coisa (o erro sumiu); o resumo de boot nao
    // precisa distinguir por que sumiu.
    if (outcome.status === 'ingested' || outcome.status === 'already-ingested' || outcome.status === 'amnestied') recovered += 1;
    else stillFailing += 1;
  }

  return { recovered, stillFailing };
}

/**
 * Tenta achar o assunto num documento que o parser recusou. Best-effort de
 * proposito: e melhor um erro ancorado no card certo do que um erro correto e
 * invisivel — mas nunca se INVENTA um dono quando o documento nao diz qual e.
 */
function subjectFromRawText(text: string): { entity: 'discovery' | 'plan' | 'work_item'; id: string } | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const subject = (parsed as Record<string, unknown>).subject;
  if (typeof subject !== 'object' || subject === null) return null;

  const node = subject as Record<string, unknown>;
  const workItemId = typeof node.work_item_id === 'string' ? node.work_item_id : null;
  const planId = typeof node.plan_id === 'string' ? node.plan_id : null;
  const discoveryId = typeof node.discovery_id === 'string' ? node.discovery_id : null;

  if (workItemId) return { entity: 'work_item', id: workItemId };
  if (planId) return { entity: 'plan', id: planId };
  if (discoveryId) return { entity: 'discovery', id: discoveryId };
  return null;
}

export interface OutboxSummary {
  readonly ingested: number;
  readonly alreadyIngested: number;
  readonly rejected: number;
  /** F26 — quantos arquivos falhariam no contrato de hoje mas foram anistiados por ja constarem no livro. */
  readonly amnestied: number;
  readonly unreadable: number;
  readonly outcomes: readonly IngestOutcome[];
}

/**
 * Varre o diretorio combinado. Ordem alfabetica (nome com `run_id` datado ja
 * ordena por tempo) e, principalmente, TOLERANTE: um arquivo ruim nao impede os
 * outros de entrarem.
 *
 * O arquivo NAO e movido nem apagado depois de ingerido — a idempotencia vem do
 * `run_id`, e apagar o insumo destruiria a trilha de volta ao que a skill
 * escreveu.
 */
export function ingestOutbox(store: EsteiraStore, outboxDir: string): OutboxSummary {
  if (!existsSync(outboxDir)) {
    return { ingested: 0, alreadyIngested: 0, rejected: 0, amnestied: 0, unreadable: 0, outcomes: [] };
  }

  let names: string[];
  try {
    names = readdirSync(outboxDir).filter((name) => name.toLowerCase().endsWith('.json')).sort();
  } catch {
    return { ingested: 0, alreadyIngested: 0, rejected: 0, amnestied: 0, unreadable: 0, outcomes: [] };
  }

  const outcomes = names.map((name) => ingestResultFile(store, join(outboxDir, name)));

  return {
    ingested: outcomes.filter((outcome) => outcome.status === 'ingested').length,
    alreadyIngested: outcomes.filter((outcome) => outcome.status === 'already-ingested').length,
    rejected: outcomes.filter((outcome) => outcome.status === 'rejected').length,
    amnestied: outcomes.filter((outcome) => outcome.status === 'amnestied').length,
    unreadable: outcomes.filter((outcome) => outcome.status === 'unreadable').length,
    outcomes,
  };
}
