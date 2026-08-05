// Spec 010 (A14) — a política de review ESTRUTURADA do repo-alvo.
//
// Antes de hoje: o gate/skill de Concluir tratava a política de review como
// prosa — o CLAUDE.md do repo EXPLICA quantos revisores um risco pede, e quem
// aplica o gate tem que ler e confiar de boa vontade (ou, pior, aceitar a
// política como uma STRING que o proprio payload afirma). O CLAUDE.md continua
// existindo — mas como explicação para gente, não como fonte que o gate lê.
//
// A fonte agora é `.esteira/review-policy.json`, na raiz do repo-alvo — o
// MESMO prefixo `.esteira/` que já guarda os handoffs de fase deste repo. Este
// módulo é a leitura (parse + a régua default); QUEM toca disco — acha o
// arquivo do repo-alvo, decide o que fazer com "não existe" vs. "existe e é
// ilegível" — é o chamador (o gate/skill de Concluir).
//
// Modulo puro: sem fs, sem Electron, nunca lança.

import { Collector, isPlainObject, optionalString, rejectUnknownKeys, type ContractIssue } from './parsing';
import type { PhaseRisk } from './resultContract';

export const REVIEW_POLICY_SCHEMA_VERSION = '1.0.0';

/** Onde a política mora, relativo à raiz do repo-alvo. */
export const REVIEW_POLICY_FILE = '.esteira/review-policy.json';

/**
 * A régua DEFAULT da esteira ("default-risco-esteira" no vocabulário do
 * CLAUDE.md): sensível pede DOIS revisores, trivial pede UM. Um repo SEM
 * política própria (arquivo ausente) cai aqui — nunca em zero, que seria "não
 * pede revisor nenhum" por omissão.
 */
export const DEFAULT_REQUIRED_REVIEWERS: Readonly<Record<PhaseRisk, number>> = {
  trivial: 1,
  sensivel: 2,
};

const RISKS: readonly PhaseRisk[] = ['trivial', 'sensivel'];

export interface ReviewPolicy {
  readonly schemaVersion: string;
  readonly requiredReviewers: Readonly<Record<PhaseRisk, number>>;
  /** Por que o repo se afasta do default, quando quem escreveu o arquivo disse. `null` = ninguém disse. */
  readonly note: string | null;
}

export type ParseReviewPolicy =
  | { readonly ok: true; readonly policy: ReviewPolicy }
  | { readonly ok: false; readonly issues: readonly ContractIssue[] };

function parseRequiredReviewers(raw: unknown, c: Collector): Readonly<Record<PhaseRisk, number>> | null {
  if (!isPlainObject(raw)) {
    c.add(raw === undefined ? 'missing_field' : 'wrong_type', 'required_reviewers', 'field "required_reviewers" must be an object');
    return null;
  }
  rejectUnknownKeys(raw, [...RISKS], 'required_reviewers', c);

  const result: Partial<Record<PhaseRisk, number>> = {};
  let ok = true;
  for (const risk of RISKS) {
    const value = raw[risk];
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
      c.add('wrong_type', `required_reviewers.${risk}`, `field "${risk}" must be a non-negative integer`);
      ok = false;
      continue;
    }
    result[risk] = value;
  }
  return ok ? (result as Record<PhaseRisk, number>) : null;
}

/**
 * Lê `.esteira/review-policy.json` já como TEXTO — tocar disco é do chamador.
 * Documento fora do formato NUNCA vira "usa o default calado": ele volta com
 * os issues, porque "repo com política ILEGÍVEL" não é a mesma coisa que
 * "repo SEM política" — a primeira é um defeito que precisa aparecer, a
 * segunda é um estado legítimo que o default cobre.
 */
export function parseReviewPolicyText(text: string): ParseReviewPolicy {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return { ok: false, issues: [{ code: 'invalid_json', path: '', message: error instanceof Error ? error.message : 'unknown parse error' }] };
  }
  if (!isPlainObject(parsed)) {
    return { ok: false, issues: [{ code: 'not_an_object', path: '', message: 'review policy must be a JSON object' }] };
  }

  const c = new Collector();
  rejectUnknownKeys(parsed, ['schema_version', 'required_reviewers', 'note'], '', c);

  const schemaVersion = typeof parsed.schema_version === 'string' && parsed.schema_version.length > 0 ? parsed.schema_version : null;
  if (schemaVersion === null) c.add('missing_field', 'schema_version', 'required field "schema_version" is missing');

  const requiredReviewers = parseRequiredReviewers(parsed.required_reviewers, c);
  const note = optionalString(parsed, 'note', '', c);

  if (c.failed || schemaVersion === null || requiredReviewers === null) {
    return { ok: false, issues: c.failed ? c.issues : [{ code: 'missing_field', path: '', message: 'incomplete review policy' }] };
  }

  return { ok: true, policy: { schemaVersion, requiredReviewers, note } };
}

/**
 * A régua DE AGORA para um risco: a do repo, quando ele tem política própria
 * legível; senão o default da esteira. `policy: null` cobre os dois estados
 * que devem cair no default — arquivo ausente, ou o chamador optou por não
 * tratar "ilegível" como bloqueio (decisão dele, não desta função).
 */
export function requiredReviewersFor(policy: ReviewPolicy | null, risk: PhaseRisk): number {
  return policy?.requiredReviewers[risk] ?? DEFAULT_REQUIRED_REVIEWERS[risk];
}
