// Hill climbing — the council of judges, behind a provider interface. A judge is one direct call to an LLM key
// (never a session): it is born clean on every call, so it cannot inflate the score with context. The key does
// not exist yet (05/11: not in `config.json → providers`, not in the environment), so the main resolves the
// council to "falta a chave" unless the demo/test fake is switched on. No paid API is called from here.

import { HILL_CLIMB_RULES, type BlindJudgeInput, type JudgeVerdict } from './contract';

export interface JudgeAnswer {
  readonly scores: Readonly<Record<string, number>>;
  readonly comment: string;
}

export interface JudgeProvider {
  /** "Juiz 1"… */
  readonly label: string;
  /** The model behind it, for the owner's eyes (never shown to another judge). */
  readonly model: string;
  /** Only `BlindJudgeInput` crosses: the type is the guarantee that a judge never sees scores or older versions. */
  judge(input: BlindJudgeInput): Promise<JudgeAnswer>;
}

export type CouncilStatus =
  | { readonly ready: true; readonly judges: readonly { readonly label: string; readonly model: string }[]; readonly fake: boolean }
  | { readonly ready: false; readonly reason: string };

export const MISSING_KEY_REASON =
  'Falta a chave de LLM: o conselho de juízes chama a chave direto, e ela não está nas configurações nem no ambiente. Até o dono dizer onde ela fica, nenhuma missão roda.';

/** Demo and test switch: a deterministic council that costs nothing. */
export const FAKE_JUDGES_ENV_VAR = 'DONEL_HILL_CLIMB_FAKE_JUDGES';

function hash(text: string): number {
  let h = 0;
  for (let i = 0; i < text.length; i += 1) h = (h * 31 + text.charCodeAt(i)) >>> 0;
  return h;
}

/** Fake judge: the longer the version, the higher the score, with a small fixed bias per judge × criterion. */
export function fakeJudge(label: string, model: string): JudgeProvider {
  return {
    label,
    model,
    judge: async (input) => {
      const scores: Record<string, number> = {};
      for (const criterion of input.criteria) {
        const bias = (hash(`${label}|${criterion}`) % 3) - 1;
        scores[criterion] = Math.max(0, Math.min(10, 3 + Math.floor(input.version.length / 60) + bias));
      }
      return { scores, comment: `${label} (falso): nota pelo tamanho da versão, para demonstração.` };
    },
  };
}

export function fakeCouncil(): JudgeProvider[] {
  return [fakeJudge('Juiz 1', 'falso-a'), fakeJudge('Juiz 2', 'falso-b'), fakeJudge('Juiz 3', 'falso-c')];
}

export function councilStatus(judges: readonly JudgeProvider[] | null, fake: boolean): CouncilStatus {
  if (!judges || judges.length < HILL_CLIMB_RULES.judges) return { ready: false, reason: MISSING_KEY_REASON };
  return { ready: true, judges: judges.map((judge) => ({ label: judge.label, model: judge.model })), fake };
}

function checkedAnswer(judge: JudgeProvider, answer: JudgeAnswer, criteria: readonly string[]): JudgeVerdict {
  const scores: Record<string, number> = {};
  for (const criterion of criteria) {
    const score = answer.scores[criterion];
    if (typeof score !== 'number' || !Number.isFinite(score) || score < 0 || score > 10)
      throw new Error(`${judge.label} não deu nota de 0 a 10 para "${criterion}".`);
    scores[criterion] = score;
  }
  return { judge: judge.label, model: judge.model, scores, comment: typeof answer.comment === 'string' ? answer.comment.slice(0, 2000) : '' };
}

/** Every judge at once, each with the same blind input. A judge that fails fails the round (nothing is recorded). */
export async function convene(judges: readonly JudgeProvider[], input: BlindJudgeInput): Promise<JudgeVerdict[]> {
  return Promise.all(judges.map(async (judge) => checkedAnswer(judge, await judge.judge({ target: input.target, criteria: [...input.criteria], version: input.version }), input.criteria)));
}
