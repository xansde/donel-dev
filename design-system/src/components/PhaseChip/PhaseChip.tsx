import type { CSSProperties } from 'react';
import styles from './PhaseChip.module.css';

/**
 * As fases fixas da Esteira (design-system.md §6, Brief 10 do handoff),
 * mais `documentar` (009-modo-dev-v3, extensão 8 — D-V5): o caminho
 * documental não é nenhuma das 5 fases originais e precisa de chip próprio,
 * sem reaproveitar leitura errada de outra fase.
 */
export type EsteiraPhase = 'discovery' | 'plano' | 'implementar' | 'validar' | 'concluir' | 'documentar';

export const ESTEIRA_PHASE_LABEL_PT: Record<EsteiraPhase, string> = {
  discovery: 'Discovery',
  plano: 'Plano',
  implementar: 'Implementar',
  validar: 'Validar',
  concluir: 'Concluir',
  // Rótulo visível "Documentação" (D-V5: o VALOR de domínio é `documentar`,
  // igual à spec/skills; `documentacao` é só o nome da variante visual —
  // aqui expresso pelo rótulo, o mockup nunca escreve "Documentar").
  documentar: 'Documentação',
};

export interface PhaseChipProps {
  phase: EsteiraPhase;
  className?: string;
}

/**
 * Chip de fase da Esteira, usado no modo Dev (Brief 10): retângulo pequeno
 * de 11px com o nome da fase, cor fixa e dessaturada por fase. A paleta das
 * 5 fases originais é interpretação — o design-system.md não fixa os hex
 * (§6). A variante `documentar` (extensão 8) usa `--donel-accent`, token já
 * existente — nenhum hex novo (verificação v3 §3). Ver tokens.css para o
 * racional completo.
 */
export function PhaseChip({ phase, className }: PhaseChipProps) {
  const style: CSSProperties & Record<'--phase-color', string> = {
    '--phase-color': `var(--phase-${phase})`,
  };

  return (
    <span
      className={[styles.chip, className].filter(Boolean).join(' ')}
      style={style}
      // Contrato para CSS/teste (mesmo padrão de `data-zone` em
      // SmartZoneMeter): a variante `documentar` tem uma opacidade de fundo
      // diferente das outras 5 (14% vs 16%, medida literal do mockup —
      // ver PhaseChip.module.css e o report do lote).
      data-phase={phase}
    >
      {ESTEIRA_PHASE_LABEL_PT[phase]}
    </span>
  );
}
