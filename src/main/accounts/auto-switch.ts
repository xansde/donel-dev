// T1111 (011-contas-e-provedores, etapa 1) — auto-switch, FUNÇÃO PURA (D5 do
// plan.md). Troca quando `max(5h, 7d, sonnet)` da ativa >= `switchAtLoad`
// (default 90) E existe conta com folga >= `minAdvantage` (default 20);
// entre candidatas, escolhe a melhor de duas sorteadas
// (power-of-two-choices, `pickTwo` injetável para teste determinístico).
// Conta com carga desconhecida (3x null) nunca é destino (C9).

import { overallLoad, type AccountId, type AccountSummary, type AutoSwitchPolicy } from '../../shared/accounts';

/** Injetável — produção usa amostragem aleatória; teste usa uma função determinística. Devolve até 2 elementos. */
export type PickTwo = (candidates: readonly AccountSummary[]) => readonly AccountSummary[];

/** Amostragem aleatória sem repetição, até 2 elementos — usada fora de teste (account-engine.ts). */
export function randomPickTwo(candidates: readonly AccountSummary[]): readonly AccountSummary[] {
  if (candidates.length <= 2) return candidates;
  const pool = [...candidates];
  const first = pool.splice(Math.floor(Math.random() * pool.length), 1)[0];
  const second = pool.splice(Math.floor(Math.random() * pool.length), 1)[0];
  return [first, second];
}

/**
 * Puro — nenhum I/O, nenhum estado. `null` = não troca agora (limiar não
 * atingido, sem candidata elegível, desligado, ou `activeId` desconhecido).
 */
export function selectSwitchTarget(
  accounts: readonly AccountSummary[],
  activeId: AccountId | null,
  policy: AutoSwitchPolicy,
  pickTwo: PickTwo = randomPickTwo,
): AccountId | null {
  if (!policy.enabled) return null;
  if (!activeId) return null;

  const active = accounts.find((a) => a.id === activeId);
  if (!active) return null;

  const activeLoad = overallLoad(active.load);
  if (activeLoad === null || activeLoad < policy.switchAtLoad) return null;

  const candidates = accounts.filter((candidate) => {
    if (candidate.id === activeId) return false;
    if (!candidate.available) return false;
    const load = overallLoad(candidate.load);
    if (load === null) return false; // C9 — carga desconhecida nunca é destino.
    return activeLoad - load >= policy.minAdvantage;
  });

  if (candidates.length === 0) return null;

  const picked = pickTwo(candidates);
  if (picked.length === 0) return null;
  if (picked.length === 1) return picked[0].id;

  const [first, second] = picked;
  const firstLoad = overallLoad(first.load) ?? Number.POSITIVE_INFINITY;
  const secondLoad = overallLoad(second.load) ?? Number.POSITIVE_INFINITY;
  return firstLoad <= secondLoad ? first.id : second.id;
}
