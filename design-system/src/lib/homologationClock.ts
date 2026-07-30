/**
 * HomologationClock — regras puras do relógio de 24h da homologação
 * (009-modo-dev-v3, extensão 6). Portada 1:1 de `clockData(hoursLeft)` em
 * `design/modo-dev-v3-handoff/project/Modo Dev v3.dc.html:852-863` e
 * conferida em `design/modo-dev-v3-verificacao.md` §1. Isolada de React e
 * de `Date.now()` de propósito: quem chama decide o instante ("agora"),
 * para o degrau dar teste determinístico sem mockar relógio nenhum.
 */

export type ClockTier = 'tranquilo' | 'atencao' | 'urgente' | 'estourado';

export interface ClockTierResult {
  tier: ClockTier;
  /** Token já existente em tokens.css — nenhum hex novo (verificação §3). */
  colorVar: string;
  /**
   * `blink` e `blink-fast` pulsam na MESMA cadência (1s, medido no mockup —
   * as duas variantes do `anim` usam `1s ease-in-out infinite`); o que
   * diferencia é a profundidade do mergulho de opacidade que o componente
   * aplica (0.35 vs 0.15) — ver `HomologationClock.module.css`.
   */
  pulse: 'none' | 'blink' | 'blink-fast';
  /** Frase de consequência do degrau, texto exato do mockup. */
  note: string;
  /** Horas restantes CRUAS (pode ser negativa — não usar para exibir, só para decidir o degrau). */
  hoursLeft: number;
  /** "faltam 18h 30min" / "prazo vencido" — mesmo texto do mockup. */
  relativeLabel: string;
  /** 2–100: nunca menor que 2 mesmo com a janela quase zerada (a barra nunca some de vez). */
  percent: number;
}

const WINDOW_HOURS = 24;

const TIER_COLOR_VAR: Record<ClockTier, string> = {
  tranquilo: 'var(--zone-ok)',
  atencao: 'var(--state-waiting)',
  urgente: 'var(--state-permission)',
  estourado: 'var(--state-error)',
};

const TIER_PULSE: Record<ClockTier, ClockTierResult['pulse']> = {
  tranquilo: 'none',
  atencao: 'none',
  urgente: 'blink',
  estourado: 'blink-fast',
};

const TIER_NOTE: Record<ClockTier, string> = {
  tranquilo: 'janela de 24h aberta — homologar antes do prazo mantém o merge.',
  atencao: 'menos de meia janela — homologue hoje ou o merge é desfeito.',
  urgente: 'reta final — passando do prazo, o merge é desfeito automaticamente.',
  estourado: 'prazo estourado — reversão automática em curso, o PR volta a staging zerado.',
};

function toMs(value: number | Date): number {
  return value instanceof Date ? value.getTime() : value;
}

/** > 12h tranquilo · 4–12h atenção · 0–4h urgente · <= 0h estourado (mockup: só `>`, nunca `>=`). */
function resolveTier(hoursLeft: number): ClockTier {
  if (hoursLeft > 12) return 'tranquilo';
  if (hoursLeft > 4) return 'atencao';
  if (hoursLeft > 0) return 'urgente';
  return 'estourado';
}

function formatRelativeLabel(hoursLeft: number, clampedHours: number): string {
  if (hoursLeft <= 0) return 'prazo vencido';
  const totalMinutes = Math.round(clampedHours * 60);
  const h = Math.floor(totalMinutes / 60);
  const min = totalMinutes % 60;
  return `faltam ${h}h ${min < 10 ? `0${min}` : min}min`;
}

/**
 * Calcula o degrau de urgência da homologação a partir do prazo e do
 * instante atual — os dois vêm de fora (epoch ms ou `Date`), nunca de
 * `Date.now()` interno.
 */
export function computeClockTier(deadline: number | Date, now: number | Date): ClockTierResult {
  const hoursLeft = (toMs(deadline) - toMs(now)) / (1000 * 60 * 60);
  const clampedHours = Math.max(0, hoursLeft);
  const tier = resolveTier(hoursLeft);

  return {
    tier,
    colorVar: TIER_COLOR_VAR[tier],
    pulse: TIER_PULSE[tier],
    note: TIER_NOTE[tier],
    hoursLeft,
    relativeLabel: formatRelativeLabel(hoursLeft, clampedHours),
    percent: Math.max(2, Math.min(100, (clampedHours / WINDOW_HOURS) * 100)),
  };
}
