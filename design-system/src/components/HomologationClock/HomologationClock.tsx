import type { CSSProperties } from 'react';
import { computeClockTier } from '../../lib/homologationClock';
import styles from './HomologationClock.module.css';

export interface HomologationClockProps {
  /**
   * Horário-limite ABSOLUTO, já formatado pelo chamador (ex.: "amanhã
   * (30/07) · 09:00") — o componente nunca formata calendário, só exibe
   * (mesma divisão de trabalho do mockup: `absolute` chega pronto, separado
   * de `clockData`).
   */
  absoluteLabel: string;
  /** Prazo da homologação. Epoch ms ou `Date` — nunca lido de `Date.now()` aqui dentro. */
  deadline: number | Date;
  /** Instante "agora", explícito — quem chama decide a cadência de atualização (ex.: tick de 1s do App). */
  now: number | Date;
  /**
   * `default` = card completo (usado no card de Validação). `compact` = só
   * o degrau `urgente` promovido à barra de status ("promoção, não
   * duplicação" — decisão A do handoff v3). O componente não impõe a regra
   * de QUANDO promover: isso é decisão de quem monta a tela (lote 7/8).
   */
  variant?: 'default' | 'compact';
  className?: string;
}

/** `pulse-blink`/`pulse-blink-fast` só quando o degrau pisca — `pulse-none` não existe no CSS module. */
function pulseClass(pulse: ReturnType<typeof computeClockTier>['pulse']): string {
  return pulse === 'none' ? '' : styles[`pulse-${pulse}`];
}

/**
 * A janela de 24h da homologação (009-modo-dev-v3, extensão 6): horário-
 * limite absoluto em mono (dado principal), barra de 4px consumindo a
 * janela, relativo como apoio, frase de consequência — quatro degraus de
 * urgência (`computeClockTier`, `../../lib/homologationClock.ts`).
 */
export function HomologationClock({ absoluteLabel, deadline, now, variant = 'default', className }: HomologationClockProps) {
  const tier = computeClockTier(deadline, now);
  const cssVars = { '--clock-color': tier.colorVar } as CSSProperties;
  const ariaLabel = `Homologação: ${tier.relativeLabel}, prazo ${absoluteLabel}. ${tier.note}`;

  if (variant === 'compact') {
    return (
      <span
        className={[styles.compact, className].filter(Boolean).join(' ')}
        style={cssVars}
        data-tier={tier.tier}
        role="status"
        aria-label={ariaLabel}
      >
        <span className={[styles.icon, pulseClass(tier.pulse)].filter(Boolean).join(' ')} aria-hidden="true">
          ◷
        </span>
        <span className={styles.compactAbsolute}>{absoluteLabel}</span>
        <span className={styles.compactBarTrack}>
          <span className={styles.compactBarFill} style={{ width: `${tier.percent}%` }} />
        </span>
      </span>
    );
  }

  return (
    <div className={[styles.root, className].filter(Boolean).join(' ')} style={cssVars} data-tier={tier.tier} role="status" aria-label={ariaLabel}>
      <div className={styles.header}>
        <span className={[styles.icon, pulseClass(tier.pulse)].filter(Boolean).join(' ')} aria-hidden="true">
          ◷
        </span>
        <span className={styles.headerLabel}>desfaz o merge em</span>
        <span className={styles.relative}>{tier.relativeLabel}</span>
      </div>
      <div className={styles.absolute}>{absoluteLabel}</div>
      <div className={styles.barTrack}>
        <div className={styles.barFill} style={{ width: `${tier.percent}%` }} />
      </div>
      <div className={styles.note}>{tier.note}</div>
    </div>
  );
}
