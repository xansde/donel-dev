import type { ReactNode } from 'react';
import { SmartZoneMeter } from '../SmartZoneMeter';
import styles from './StatusBar.module.css';

export interface StatusBarSmartZone {
  usedTokens: number;
  maxTokens?: number;
}

export interface StatusBarProps {
  /** Ex. "Tecnologia Claude 3 · 62%" (Brief 1). */
  accountLabel: string;
  /** Ex. "fable/high" — modelo/esforço da aba em foco. */
  modelEffort?: string;
  sessionCount: number;
  /** Mini smart zone da aba em foco (§6, P1). Omitido = não renderiza o medidor. */
  smartZone?: StatusBarSmartZone;
  /**
   * Lote 7 (009-modo-dev-v3), Decisão A do handoff v3 — o `HomologationClock`
   * (variante `compact`) PROMOVIDO quando o card de Validação no degrau
   * urgente sai de foco (`shouldPromoteClockToStatusBar`, `shared/mapLevels.ts`).
   * A StatusBar não decide QUANDO promover — só reserva o slot, mesmo padrão
   * de `smartZone` (CA-22): omitido = nada aparece, nunca um espaço vazio
   * reservado à toa.
   */
  homologationClock?: ReactNode;
  className?: string;
  /**
   * FIX (auditoria rodada 5, achado baixa "testid hardcoded na lib") —
   * `data-testid` do span da conta é decisão de QUEM CONSOME o
   * design-system (o app, que sabe o que seus próprios smokes procuram),
   * não da lib compartilhada — antes `"statusbar-account"` vinha fixo aqui
   * dentro, um precedente de app-em-lib (era o único `data-testid` de todo
   * o pacote). Opcional: sem isto, o span não ganha `data-testid` nenhum.
   */
  accountTestId?: string;
}

/**
 * Rodapé do shell: conta ativa · modelo/esforço da aba em foco · nº de
 * sessões · mini smart zone (design-system.md §4, §6) · relógio de
 * homologação promovido (lote 7, opcional). Altura 28px.
 */
export function StatusBar({
  accountLabel,
  modelEffort,
  sessionCount,
  smartZone,
  homologationClock,
  className,
  accountTestId,
}: StatusBarProps) {
  const sessionLabel = sessionCount === 1 ? '1 sessão' : `${sessionCount} sessões`;

  return (
    <div className={[styles.bar, className].filter(Boolean).join(' ')}>
      <span data-testid={accountTestId}>{accountLabel}</span>
      {modelEffort ? (
        <>
          <span className={styles.separator} aria-hidden="true">
            ·
          </span>
          <span className={styles.mono}>{modelEffort}</span>
        </>
      ) : null}
      <span className={styles.separator} aria-hidden="true">
        ·
      </span>
      <span>{sessionLabel}</span>
      {smartZone ? (
        <>
          <span className={styles.separator} aria-hidden="true">
            ·
          </span>
          {/* CA-22 (009) — o rótulo "contexto" NÃO é decoração: o
              `accountLabel` à esquerda já mostra um `%` (a COTA do perfil), e
              dois números percentuais no mesmo rodapé sem dizer de quê foi
              exatamente a confusão relatada na rodada 6 da 006. */}
          <span>contexto</span>
          <SmartZoneMeter
            variant="compact"
            usedTokens={smartZone.usedTokens}
            maxTokens={smartZone.maxTokens}
          />
        </>
      ) : null}
      {homologationClock ? (
        <>
          <span className={styles.separator} aria-hidden="true">
            ·
          </span>
          {homologationClock}
        </>
      ) : null}
    </div>
  );
}
