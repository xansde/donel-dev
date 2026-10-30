// Issue #21 — o modelo que a sessão está usando DE FATO.
//
// O Launcher só sabe com que modelo a aba NASCEU (`--model` do launch, ou o
// default dele). Depois disso o CLI pode trocar sozinho — `/model` digitado no
// terminal, sessão retomada que vinha de outro modelo — e a única fonte que
// acompanha é o transcript: cada resposta do assistente grava o id em
// `message.model`. Este módulo é a parte pura dessa leitura (sem Electron, fs
// nem React): extrair o id de uma linha, encurtá-lo para o rodapé e escolher o
// denominador do medidor de contexto.
//
// A tabela de janelas continua confinada em `contextWindow.ts` (único arquivo a
// revisitar quando a Anthropic mudar tamanhos de janela).

import type { ModelAlias } from './commandBuilder';
import {
  LEGACY_MODEL_ID,
  MODERN_MODEL_ID,
  SMART_ZONE_TOKENS,
  contextZoneForModelId,
  effectiveContextZone,
  normalizeModelAlias,
  normalizeModelId,
} from './contextWindow';

/**
 * Uma linha do `.jsonl` → id do modelo que respondeu (`message.model`), ou
 * `null` se a linha não é uma resposta do assistente da sessão principal.
 *
 * Descarta, além de JSON inválido (a primeira linha da cauda vem cortada — é o
 * caso normal):
 * - `isSidechain: true` — subagente roda com modelo próprio; mostrá-lo como o da
 *   sessão faria o rodapé piscar a cada `Task`. Mesmo filtro do
 *   `contextTokensFromLine`.
 * - ids entre `<…>`, como o `<synthetic>` que o CLI grava em resposta que não
 *   veio da API (erro de API, comando local). Não é modelo, e trocar o rodapé
 *   por ele apagaria o modelo real.
 */
export function modelIdFromLine(line: string): string | null {
  const raw = typeof line === 'string' ? line.trim() : '';
  if (!raw || raw[0] !== '{' || !raw.includes('"model"')) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;

  const record = parsed as { type?: unknown; isSidechain?: unknown; message?: unknown };
  if (record.type !== 'assistant' || record.isSidechain === true) return null;
  if (typeof record.message !== 'object' || record.message === null) return null;

  const model = (record.message as { model?: unknown }).model;
  if (typeof model !== 'string') return null;
  const trimmed = model.trim();
  if (!trimmed || trimmed.startsWith('<')) return null;
  return trimmed;
}

/**
 * Rótulo curto do modelo para o rodapé: `claude-opus-5-5` → `opus 5.5`,
 * `claude-haiku-4-5-20251001` → `haiku 4.5`. O alias do launch fica como está
 * (`opus`), e um id desconhecido aparece cru — esconder o que a sessão usa seria
 * pior que um rótulo comprido.
 */
export function formatModelLabel(modelId: string): string {
  const trimmed = typeof modelId === 'string' ? modelId.trim() : '';
  const alias = normalizeModelAlias(trimmed);
  if (alias !== null) return alias;

  const id = normalizeModelId(trimmed);
  const modern = MODERN_MODEL_ID.exec(id);
  if (modern) {
    const [, family, major, minor] = modern;
    return minor === undefined ? `${family} ${major}` : `${family} ${major}.${minor}`;
  }
  const legacy = LEGACY_MODEL_ID.exec(id);
  if (legacy) {
    const [, major, minor, family] = legacy;
    return minor === undefined ? `${family} ${major}` : `${family} ${major}.${minor}`;
  }
  return trimmed;
}

export interface SessionModelView {
  /** O que o rodapé mostra antes do `/esforço`. */
  readonly label: string;
  /** Denominador do medidor de contexto (`min(smart zone, janela)`). */
  readonly contextZone: number;
}

/**
 * Modelo exibido e régua do contexto de uma sessão.
 *
 * - Sem resposta ainda (`observedModelId` nulo): vale o modelo do launch — é o
 *   ponto de partida, e o único dado que existe antes da primeira resposta.
 * - Com resposta: vale o id do transcript, mesmo que divirja do launch (é
 *   exatamente o caso do `/model`).
 * - Id desconhecido (modelo de provedor de terceiros): mostra o id cru e usa a
 *   smart zone inteira. A smart zone é a régua do Alexandre, independente de
 *   modelo; a janela só a encurta quando se SABE que ela é menor (Haiku 4.5).
 *   Sem saber, não há base para encurtar — e herdar a régua do alias do launch
 *   seria medir um modelo pela janela de outro.
 */
export function resolveSessionModel(observedModelId: string | null | undefined, launchAlias: ModelAlias): SessionModelView {
  if (!observedModelId) return { label: launchAlias, contextZone: effectiveContextZone(launchAlias) };
  return {
    label: formatModelLabel(observedModelId),
    contextZone: contextZoneForModelId(observedModelId) ?? SMART_ZONE_TOKENS,
  };
}
