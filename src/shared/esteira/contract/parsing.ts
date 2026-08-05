// Spec 010 (D-10) — o rigor de leitura, COMPARTILHADO pelos dois contratos da
// esteira: a volta (`resultContract.ts`, o `result.json` que a skill devolve) e
// a ida (`runInput.ts`, o `run-input.json` que o app entrega). Extraido para um
// modulo so quando a ida ganhou schema (03/08): duas copias das mesmas regras
// seriam duas chances de elas divergirem — que e literalmente o problema que a
// spec 010 existe para resolver.
//
// A disciplina que estes helpers impoem:
//
// - **Campo desconhecido e ERRO**, nao ruido ignorado. E por aqui que "campo
//   que so um lado conhece" aparece no instante da leitura, e nao meses depois
//   como uma tela que mente.
// - **Nunca lanca.** Todo problema vira `ContractIssue` com CAMINHO — e o
//   caminho e o que a UI mostra no card.
//
// Modulo puro: sem I/O, sem Electron.

/**
 * Codigos estaveis de erro de contrato. A redacao pt-BR mostrada no card e
 * composta pela UI a partir de `code` + `path` — o parser nao carrega texto de
 * interface.
 */
export type ContractIssueCode =
  | 'not_an_object'
  | 'invalid_json'
  | 'wrong_kind'
  | 'unsupported_major'
  | 'missing_field'
  | 'unknown_field'
  | 'wrong_type'
  | 'bad_format'
  | 'not_in_enum'
  | 'empty_facts'
  | 'unknown_fact_type'
  | 'missing_required_fact'
  /** Fase que declarou o ciclo encerrado (`outcome: done`) sem a verificacao que o encerra (D-4). */
  | 'done_without_passed_verification'
  /** A18 — fase de conversa (discovery, plano) fechada `done` sem nenhum fato humano: ela nao perguntou nada. */
  | 'done_without_human_decision'
  /** A4 — complemento sem o run ao qual se ancora: acrescentar fatos a coisa nenhuma. */
  | 'complement_without_anchor'
  /** A4 — result normal declarando `complements_run_id`: complemento sem se dizer complemento. */
  | 'complement_without_kind'
  /** A4 — complemento redeclarando a fase: a mesma execucao contada duas vezes. */
  | 'complement_redeclares_phase'
  /** A4/A13 — o `run_id` nao traz o sufixo do parentesco que ele declara. */
  | 'lineage_suffix_mismatch'
  /** A22 — o MESMO assunto e a MESMA fase fechados duas vezes no mesmo result: duas historias sobre uma execucao. */
  | 'duplicate_phase_completed'
  /** A22 — o run fechou outras fases e nao disse o que houve com a SUA. */
  | 'phase_completed_missing_for_run'
  /** A16 — fase de risco sensivel fechada sem declarar o roteiro e2e manual. */
  | 'sensitive_without_e2e'
  /** A16 — aprovacao humana registrada com o roteiro e2e ainda pendente, em risco sensivel. */
  | 'approval_before_e2e'
  /**
   * A4 — o MESMO `run_id`, ja ingerido, voltou com conteudo DIFERENTE e sem se
   * declarar complemento nem revisao. Caso real: a Concluir regravou o run com
   * o desfecho revisto e o card ficou "terminou sem conclusao" em silencio —
   * porque a segunda leitura casava com a `dedupe_key` da primeira e sumia.
   */
  | 'run_changed_after_ingest'
  | 'issue_without_target_repo'
  | 'artifact_repo_mismatch'
  | 'failure_missing'
  | 'failure_unexpected';

export interface ContractIssue {
  readonly code: ContractIssueCode;
  /** Caminho canonico dentro do documento, ex.: `facts[2].work_item_id`. */
  readonly path: string;
  /** Texto tecnico curto, em ingles — insumo de log, nao de tela. */
  readonly message: string;
}

export const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;
export const PHASE_PATTERN = /^[a-z][a-z0-9-]{0,39}$/;
export const TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;
export const SEMVER_PATTERN = /^\d+\.\d+\.\d+$/;

export class Collector {
  readonly issues: ContractIssue[] = [];

  add(code: ContractIssueCode, path: string, message: string): void {
    this.issues.push({ code, path, message });
  }

  get failed(): boolean {
    return this.issues.length > 0;
  }
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Campo desconhecido e ERRO, nao ruido ignorado: e assim que "campo de um lado so" aparece na hora. */
export function rejectUnknownKeys(node: Record<string, unknown>, allowed: readonly string[], path: string, c: Collector): void {
  for (const key of Object.keys(node)) {
    if (!allowed.includes(key)) c.add('unknown_field', path ? `${path}.${key}` : key, `unknown field "${key}"`);
  }
}

export function requireString(node: Record<string, unknown>, key: string, path: string, c: Collector): string | null {
  const value = node[key];
  if (value === undefined || value === null) {
    c.add('missing_field', `${path}.${key}`, `required field "${key}" is missing`);
    return null;
  }
  if (typeof value !== 'string' || value.length === 0) {
    c.add('wrong_type', `${path}.${key}`, `field "${key}" must be a non-empty string`);
    return null;
  }
  return value;
}

export function optionalString(node: Record<string, unknown>, key: string, path: string, c: Collector): string | null {
  const value = node[key];
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') {
    c.add('wrong_type', `${path}.${key}`, `field "${key}" must be a string or null`);
    return null;
  }
  return value;
}

export function requirePattern(
  node: Record<string, unknown>,
  key: string,
  pattern: RegExp,
  path: string,
  c: Collector,
): string | null {
  const value = requireString(node, key, path, c);
  if (value === null) return null;
  if (!pattern.test(value)) {
    c.add('bad_format', `${path}.${key}`, `field "${key}" does not match ${String(pattern)}`);
    return null;
  }
  return value;
}

export function optionalPattern(
  node: Record<string, unknown>,
  key: string,
  pattern: RegExp,
  path: string,
  c: Collector,
): string | null {
  const value = optionalString(node, key, path, c);
  if (value === null) return null;
  if (!pattern.test(value)) {
    c.add('bad_format', `${path}.${key}`, `field "${key}" does not match ${String(pattern)}`);
    return null;
  }
  return value;
}

export function requireEnum<T extends string>(
  node: Record<string, unknown>,
  key: string,
  allowed: readonly T[],
  path: string,
  c: Collector,
): T | null {
  const value = node[key];
  if (value === undefined || value === null) {
    c.add('missing_field', `${path}.${key}`, `required field "${key}" is missing`);
    return null;
  }
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    c.add('not_in_enum', `${path}.${key}`, `field "${key}" must be one of ${allowed.join('|')}`);
    return null;
  }
  return value as T;
}

export function requireStringList(node: Record<string, unknown>, key: string, path: string, c: Collector): readonly string[] {
  const value = node[key];
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string' || entry.length === 0)) {
    c.add('wrong_type', `${path}.${key}`, `field "${key}" must be an array of non-empty strings`);
    return [];
  }
  return value as readonly string[];
}

/** Major do semver, ou `null` se nao for semver. A fronteira de compatibilidade dos dois contratos. */
export function majorOf(version: string): string | null {
  if (!SEMVER_PATTERN.test(version)) return null;
  return version.split('.')[0];
}
