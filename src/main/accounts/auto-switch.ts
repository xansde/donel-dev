// T1111 (011-contas-e-provedores, etapa 1) — auto-switch, FUNÇÃO PURA (D5 do
// plan.md). Troca quando `max(5h, 7d, sonnet)` da ativa >= `switchAtLoad`
// (default 90) E existe conta com folga >= `minAdvantage` (default 20);
// entre candidatas, escolhe a melhor de duas sorteadas
// (power-of-two-choices, `pickTwo` injetável para teste determinístico).
// Conta com carga desconhecida (3x null) nunca é destino (C9).
//
// 011-contas-e-provedores, etapa 3, Fase 2 — `eligibleSwitchCandidates`
// extrai o filtro que `selectSwitchTarget` já fazia (agora reaproveitado
// também por `classifyAutoSwitch`, D5) e passa a excluir conta marcada
// `needsReconnect` (D3): a credencial dela está vencida, e o auto-switch não
// tenta uma troca que o próprio motor sabe que vai falhar.

import { overallLoad, type AccountId, type AccountSummary, type AutoSwitchPolicy, type AutoSwitchState } from '../../shared/accounts';

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
 * Puro — nenhum I/O. Outras contas, `available`, sem `needsReconnect`, carga
 * conhecida, com folga (`activeLoad - load`) >= `policy.minAdvantage` sobre a
 * ativa. Vazio se `activeId` for `null`, a ativa não estiver em `accounts`,
 * ou a carga dela for desconhecida — nesses casos não há "folga" pra medir.
 * Não checa `policy.switchAtLoad`: esse limiar é responsabilidade de quem
 * chama (`selectSwitchTarget` decide SE troca; `classifyAutoSwitch` decide o
 * ESTADO; os dois consultam o limiar antes/depois de chamar esta função).
 */
export function eligibleSwitchCandidates(accounts: readonly AccountSummary[], activeId: AccountId | null, policy: AutoSwitchPolicy): readonly AccountSummary[] {
  if (!activeId) return [];

  const active = accounts.find((a) => a.id === activeId);
  if (!active) return [];

  const activeLoad = overallLoad(active.load);
  if (activeLoad === null) return [];

  return accounts.filter((candidate) => {
    if (candidate.id === activeId) return false;
    if (!candidate.available) return false;
    if (candidate.needsReconnect) return false; // D3 — a troca pra ela falharia de novo.
    const load = overallLoad(candidate.load);
    if (load === null) return false; // C9 — carga desconhecida nunca é destino.
    return activeLoad - load >= policy.minAdvantage;
  });
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

  const candidates = eligibleSwitchCandidates(accounts, activeId, policy);
  if (candidates.length === 0) return null;

  const picked = pickTwo(candidates);
  if (picked.length === 0) return null;
  if (picked.length === 1) return picked[0].id;

  const [first, second] = picked;
  const firstLoad = overallLoad(first.load) ?? Number.POSITIVE_INFINITY;
  const secondLoad = overallLoad(second.load) ?? Number.POSITIVE_INFINITY;
  return firstLoad <= secondLoad ? first.id : second.id;
}

/**
 * 011-contas-e-provedores, etapa 3, Fase 2 (D5) — classifica o estado do
 * auto-switch pra view (`AccountsViewDto.autoSwitchState`). Mesma leitura de
 * limiar que `selectSwitchTarget` usa pra decidir SE troca; aqui só descreve
 * a situação, nunca troca nada.
 *
 * Adendo D8 — sem candidata elegível, "saturated" (todo mundo cheio) e
 * "blind" (falta DADO de alguém) são situações diferentes: só é `saturated`
 * quando TODAS as outras contas disponíveis/sem `needsReconnect` têm carga
 * CONHECIDA (e nenhuma tem a folga mínima); basta UMA delas com carga
 * desconhecida pra virar `blind`. Conta com `needsReconnect` ou indisponível
 * nunca conta pra essa checagem — ela já está fora de cogitação por outro
 * motivo, sem leitura ou com.
 */
// 011-contas-e-provedores, etapa 3, Fase 2, emenda 22/09 (item 3) — poll
// adaptativo: 5 min é lento demais perto do limite (a conta pode estourar
// entre dois polls), e 1 min o tempo todo seria tráfego à toa quando a carga
// está de boa. `computePollIntervalMs` é PURA — o motor (account-engine.ts)
// injeta e agenda o próximo tick com o valor que ela devolve.
export const POLL_INTERVAL_NORMAL_MS = 5 * 60 * 1000;
export const POLL_INTERVAL_HIGH_LOAD_MS = 60 * 1000;
export const HIGH_LOAD_POLL_THRESHOLD = 80;

/** `activeLoad` é o `overallLoad` da conta ATIVA (não de toda a lista) — `null` (carga desconhecida) usa o intervalo normal, nunca o agressivo. */
export function computePollIntervalMs(activeLoad: number | null, highLoadThreshold: number = HIGH_LOAD_POLL_THRESHOLD): number {
  if (activeLoad !== null && activeLoad >= highLoadThreshold) return POLL_INTERVAL_HIGH_LOAD_MS;
  return POLL_INTERVAL_NORMAL_MS;
}

export function classifyAutoSwitch(accounts: readonly AccountSummary[], activeId: AccountId | null, policy: AutoSwitchPolicy): AutoSwitchState {
  if (!policy.enabled) return 'off';
  if (!activeId) return 'idle';

  const active = accounts.find((a) => a.id === activeId);
  if (!active) return 'idle';

  const activeLoad = overallLoad(active.load);
  if (activeLoad === null || activeLoad < policy.switchAtLoad) return 'idle';

  const candidates = eligibleSwitchCandidates(accounts, activeId, policy);
  if (candidates.length > 0) return 'armed';

  const hasUnreadOther = accounts.some(
    (candidate) => candidate.id !== activeId && candidate.available && !candidate.needsReconnect && overallLoad(candidate.load) === null,
  );
  return hasUnreadOther ? 'blind' : 'saturated';
}
