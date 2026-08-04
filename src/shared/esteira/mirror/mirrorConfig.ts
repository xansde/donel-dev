// Spec 010 (D-11, D-12) — a CONFIGURACAO do espelho no tracker.
//
// O tracker e plugue opcional (D-1): quando existe, recebe reflexo de fatos;
// nunca e consultado para saber estado. Este modulo responde uma pergunta so —
// "ha um plugue, e para onde ele aponta?" — e responde por ARQUIVO, nao por
// codigo:
//
//   ~/.claude/esteira-config/donel-mirror.json   (mesmo diretorio que as skills
//                                                 ja usam; `DONEL_ESTEIRA_CONFIG_DIR`
//                                                 redireciona no smoke/e2e)
//
//   {
//     "provider": "taskdex",
//     "columnByStage": { "discovery": "Discovery", "planned": "Plano",
//                        "execution": "Implementar", "done": "Concluido" },
//     "phaseLabelPrefix": "esteira:em-andamento:",
//     "maxAttempts": 5
//   }
//
// O mapeamento etapa → coluna e configuracao porque **as colunas mudam** (D-12).
// Colunas em constante no codigo foi como a v2 acabou com um board renomeado e
// um app afirmando movimento que nunca aconteceu.
//
// Modulo PURO: nao le disco, nao lanca. Arquivo ausente, ilegivel ou incompleto
// = espelho DESLIGADO — ausencia de plugue nao e erro, e ausencia.

import type { MacroStage } from '../store/storeFormat';

/** Arquivo lido de `~/.claude/esteira-config/` (ou do override de ambiente). */
export const MIRROR_CONFIG_FILE = 'donel-mirror.json';

/** Etiqueta historica da fase em andamento; o arquivo pode trocar, `""` desliga a etiqueta. */
export const DEFAULT_PHASE_LABEL_PREFIX = 'esteira:em-andamento:';

/** Quantas vezes a fila reenvia sozinha antes de esperar um gesto humano. */
export const DEFAULT_MAX_ATTEMPTS = 5;

export interface MirrorConfig {
  readonly enabled: boolean;
  /** Qual tracker. Sem provider nao ha espelho: nao da para refletir num board que ninguem nomeou. */
  readonly provider: string;
  /**
   * Etapa → coluna do board. Etapa que o arquivo NAO declara nao vira
   * movimento: o app nao inventa nome de coluna, pela mesma razao que nao
   * inventa estado de fase.
   */
  readonly columnByStage: Readonly<Partial<Record<MacroStage, string>>>;
  /** Prefixo da etiqueta de fase; `""` desliga o espelho de etiqueta sem desligar o resto. */
  readonly phaseLabelPrefix: string;
  /** `0` = sem teto (a fila reenvia sempre que houver oportunidade). */
  readonly maxAttempts: number;
}

/** O estado normal de quem nunca configurou tracker nenhum. */
export const MIRROR_DISABLED: MirrorConfig = {
  enabled: false,
  provider: '',
  columnByStage: {},
  phaseLabelPrefix: '',
  maxAttempts: 0,
};

const MACRO_STAGES: readonly MacroStage[] = ['discovery', 'planned', 'execution', 'done'];

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Le o conteudo do arquivo de configuracao. Nunca lanca; `null` = ausente. */
export function parseMirrorConfig(text: string | null | undefined): MirrorConfig {
  if (typeof text !== 'string' || text.trim().length === 0) return MIRROR_DISABLED;

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return MIRROR_DISABLED;
  }
  if (!isPlainObject(parsed)) return MIRROR_DISABLED;

  // Escrever o arquivo JA e a intencao de ligar; `enabled: false` e a saida
  // explicita para desligar sem apagar o mapeamento.
  if (parsed.enabled === false) return MIRROR_DISABLED;

  const provider = typeof parsed.provider === 'string' ? parsed.provider.trim() : '';
  if (provider.length === 0) return MIRROR_DISABLED;

  const columnByStage: Partial<Record<MacroStage, string>> = {};
  if (isPlainObject(parsed.columnByStage)) {
    for (const stage of MACRO_STAGES) {
      const column = parsed.columnByStage[stage];
      if (typeof column === 'string' && column.trim().length > 0) columnByStage[stage] = column.trim();
    }
  }

  const phaseLabelPrefix =
    typeof parsed.phaseLabelPrefix === 'string' ? parsed.phaseLabelPrefix : DEFAULT_PHASE_LABEL_PREFIX;

  const rawMaxAttempts = parsed.maxAttempts;
  const maxAttempts =
    typeof rawMaxAttempts === 'number' && Number.isInteger(rawMaxAttempts) && rawMaxAttempts >= 0
      ? rawMaxAttempts
      : DEFAULT_MAX_ATTEMPTS;

  return { enabled: true, provider, columnByStage, phaseLabelPrefix, maxAttempts };
}
