// Spec 010 (A4) — o LIVRO DOS RUNS: o que ja foi ingerido, e com que conteudo.
//
// Por que ele existe, com nome e sobrenome do defeito: a fase Concluir regravou
// o MESMO `run_id` com o desfecho revisto. A segunda leitura casou com a
// `dedupe_key` da primeira — que e o que torna a reingestao segura — e cada
// evento novo foi descartado como "ja visto". O card continuou dizendo
// "terminou sem conclusao" enquanto o arquivo em disco dizia o contrario, e
// nenhum erro apareceu em lugar nenhum. Silencio, que e o unico desfecho que a
// spec 010 nao admite.
//
// A regra: um run NAO se reescreve. Voltar com o mesmo `run_id` e conteudo
// identico e reingestao (idempotente, silenciosa e correta). Voltar com
// conteudo DIFERENTE e um run alterado depois de ingerido — recusa com erro
// VISIVEL no card. Quem precisa acrescentar fato usa um COMPLEMENTO
// (`kind: esteira.result.complement`, `run_id` `<base>.c1`); quem precisa
// rever o desfecho usa uma REVISAO (`revises_run_id`, `run_id` `<base>.rev2`).
// Os dois sao runs novos: o anterior continua legivel.
//
// Modulo puro: sem fs, sem Electron, nunca lanca.

import type { ContractIssue, EsteiraResult } from '../contract/resultContract';

/** O que o store guarda sobre um run ja ingerido. */
export interface IngestedRun {
  readonly runId: string;
  readonly contentHash: string;
}

/**
 * Impressao digital do CONTEUDO declarado. Nao inclui o caminho do arquivo nem
 * a hora da ingestao: mover o `result.json` de pasta nao muda o que ele afirma,
 * e tratar isso como alteracao transformaria a recusa num falso alarme diario.
 *
 * FNV-1a de 32 bits sobre uma serializacao com chaves ORDENADAS. Nao e
 * criptografia — e deteccao de mudanca entre dois documentos que deveriam ser
 * o mesmo. `JSON.stringify` cru nao serviria: ordem de chave e detalhe de quem
 * escreveu o arquivo, e ela mudaria a digital sem nada ter mudado.
 */
export function resultFingerprint(result: EsteiraResult): string {
  const canonical = stableStringify(result as unknown);
  let hash = 0x811c9dc5;
  for (let index = 0; index < canonical.length; index += 1) {
    hash ^= canonical.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const node = value as Record<string, unknown>;
  const body = Object.keys(node)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(node[key])}`)
    .join(',');
  return `{${body}}`;
}

export type ReingestVerdict =
  /** Run novo (ou complemento/revisao de um conhecido): pode entrar. */
  | { readonly kind: 'accept' }
  /** Mesmo run, mesmo conteudo: reingestao normal, sem novidade e sem erro. */
  | { readonly kind: 'already-ingested' }
  /** Mesmo run, conteudo DIFERENTE, sem marca de complemento/revisao: recusa VISIVEL. */
  | { readonly kind: 'changed'; readonly issue: ContractIssue };

/**
 * A pergunta que o livro dos runs existe para responder: **este documento pode
 * entrar?** Recebe o que ja esta gravado e o que chegou; nunca toca disco.
 */
export function checkReingest(known: readonly IngestedRun[], result: EsteiraResult, fingerprint: string): ReingestVerdict {
  const previous = known.find((entry) => entry.runId === result.run.run_id);
  if (previous === undefined) return { kind: 'accept' };
  if (previous.contentHash === fingerprint) return { kind: 'already-ingested' };

  return {
    kind: 'changed',
    issue: {
      code: 'run_changed_after_ingest',
      path: 'run.run_id',
      message:
        `run "${result.run.run_id}" was already ingested with different content; ` +
        'declare a complement (kind "esteira.result.complement" with "complements_run_id") ' +
        'or a revision ("revises_run_id") instead of rewriting it',
    },
  };
}
