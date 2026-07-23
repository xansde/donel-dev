import styles from './SegmentedControl.module.css';

export interface SegmentedControlOption {
  value: string;
  label: string;
}

export interface SegmentedControlProps {
  options: SegmentedControlOption[];
  value: string;
  onChange: (value: string) => void;
  /** Nome acessível do grupo, ex. "Modelo", "Esforço" (Brief 3). */
  ariaLabel: string;
  className?: string;
}

/**
 * Segmented control — usado para Modelo, Esforço, Tipo (Brief 3, 12).
 * Opção ativa = `bg-raised` + `text-primary` (design-system.md §6).
 */
export function SegmentedControl({ options, value, onChange, ariaLabel, className }: SegmentedControlProps) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className={[styles.root, className].filter(Boolean).join(' ')}>
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            className={[styles.segment, active ? styles.active : ''].filter(Boolean).join(' ')}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
