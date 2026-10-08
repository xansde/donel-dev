import {
  forwardRef,
  useCallback,
  useId,
  useEffect,
  useLayoutEffect,
  useRef,
  type ChangeEvent,
  type TextareaHTMLAttributes,
} from 'react';
import styles from './TextArea.module.css';

/** `useLayoutEffect` não roda no servidor (teste com renderToString): cai para `useEffect` lá. */
const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

/** Altura da linha (px) — `line-height` de 20 px do `T06`. */
export const TEXT_AREA_LINE_HEIGHT = 20;
/** Respiro vertical interno (6 + 6 px do `T06`). */
export const TEXT_AREA_VERTICAL_PADDING = 12;

/** Altura (px) de `rows` linhas, com o respiro interno. */
export function textAreaHeightForRows(rows: number): number {
  return rows * TEXT_AREA_LINE_HEIGHT + TEXT_AREA_VERTICAL_PADDING;
}

/**
 * Altura que o campo deve ter dado o `scrollHeight` do conteúdo: cresce com o
 * texto, nunca abaixo de `minRows` e nunca acima de `maxRows` (a partir daí
 * rola). Pura, para testar sem DOM.
 */
export function computeTextAreaHeight(scrollHeight: number, minRows: number, maxRows: number): number {
  const min = textAreaHeightForRows(minRows);
  const max = textAreaHeightForRows(Math.max(minRows, maxRows));
  return Math.min(Math.max(scrollHeight, min), max);
}

export interface TextAreaProps
  extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'value' | 'onChange' | 'rows' | 'style'> {
  /** Controlado: o chamador é dono do texto. */
  value: string;
  onChange: (value: string, event: ChangeEvent<HTMLTextAreaElement>) => void;
  /** Linhas mínimas (padrão 1). */
  minRows?: number;
  /** Linhas em que o campo para de crescer e passa a rolar (padrão 10). */
  maxRows?: number;
  /** Texto em JetBrains Mono (comando `/`, shell `!`). */
  mono?: boolean;
  /**
   * `box` = campo autônomo (fundo `bg-raised`, borda, anel de foco);
   * `bare` = sem moldura, para viver dentro do `Composer`.
   */
  appearance?: 'box' | 'bare';
  /** Rótulo visível acima do campo (sem ele, passe `aria-label`). */
  label?: string;
  /** Texto de apoio abaixo do campo. */
  hint?: string;
  className?: string;
}

/**
 * Campo de texto de várias linhas que cresce com o conteúdo até `maxRows` e
 * depois rola (014-chat, extensão 7). O `ref` vai para o `<textarea>`.
 */
export const TextArea = forwardRef<HTMLTextAreaElement, TextAreaProps>(function TextArea(
  {
    value,
    onChange,
    minRows = 1,
    maxRows = 10,
    mono = false,
    appearance = 'box',
    label,
    hint,
    id,
    className,
    ...rest
  },
  forwardedRef,
) {
  const generatedId = useId();
  const areaId = id ?? generatedId;
  const innerRef = useRef<HTMLTextAreaElement | null>(null);

  const setRef = useCallback(
    (node: HTMLTextAreaElement | null) => {
      innerRef.current = node;
      if (typeof forwardedRef === 'function') forwardedRef(node);
      else if (forwardedRef) forwardedRef.current = node;
    },
    [forwardedRef],
  );

  // Mede no layout (antes de pintar) para não piscar com a altura antiga.
  useIsoLayoutEffect(() => {
    const node = innerRef.current;
    if (!node) return;
    node.style.height = 'auto';
    const next = computeTextAreaHeight(node.scrollHeight, minRows, maxRows);
    node.style.height = `${next}px`;
    node.style.overflowY = node.scrollHeight > next ? 'auto' : 'hidden';
  }, [value, minRows, maxRows, mono]);

  const area = (
    <textarea
      id={areaId}
      ref={setRef}
      rows={minRows}
      value={value}
      onChange={(event) => onChange(event.target.value, event)}
      className={[styles.area, appearance === 'bare' ? styles.bare : styles.box, mono ? styles.mono : '']
        .filter(Boolean)
        .join(' ')}
      {...rest}
    />
  );

  if (!label && !hint && !className) return area;

  return (
    <div className={[styles.field, className].filter(Boolean).join(' ')}>
      {label ? (
        <label htmlFor={areaId} className={styles.label}>
          {label}
        </label>
      ) : null}
      {area}
      {hint ? <span className={styles.hint}>{hint}</span> : null}
    </div>
  );
});
