import { X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { DragEvent, KeyboardEvent, MouseEvent } from 'react';
import { EditableLabel, type EditableLabelHandle } from '../EditableLabel';
import { SESSION_STATE_LABEL_PT, type SessionState } from '../StateDot';
import styles from './TerminalTab.module.css';

// 009-modo-dev-v3, extensão 7 (`design/modo-dev-v3-verificacao.md` §3) —
// "TerminalTab · variante v3": troca o farol (StateDot) por um ícone de
// estado que pode piscar (CA-28), ganha uma faixa de cor definível pelo
// operador (CA-27) e uma alça de arraste para reordenar (CA-26). O dot
// redondo continua existindo — só que no MAPA (DiscoveryMap), não mais aqui;
// esta é a substituição integral da anatomia da aba, não um modo alternativo
// (nenhum consumidor deste pacote ainda precisava do farol na aba em si).

/**
 * CA-28 — glifo de estado por `SessionState` (mesmos 5 valores de
 * StateDot.tsx), medido no handoff v3 (`Modo Dev v3.dc.html:1075-1082`,
 * `tabLegend` 1243-1249: "Aba — variante v3", estudo de componente). O
 * mockup cobre 4 dos 5 `SessionState` + o pseudo-estado "shell" (terminal
 * comum, sem sessão) — `error` ("falha ou quota esgotada") não aparece na
 * tabela dele. Glifo escolhido por analogia ao `✕` que `PhaseStateGlyph` já
 * usa para "falhou" e ao token `--state-error`, já reservado a "deu errado"
 * no resto do design system — ver decisão nomeada no report do lote.
 */
const SESSION_STATE_ICON: Record<SessionState, string> = {
  working: '▶',
  waiting: '◐',
  permission: '!',
  done: '■',
  error: '✕',
};

/** Terminal comum (sem sessão Claude) — mesmo glifo do handoff v3 (`tabLegend`, `❯`). */
const SHELL_ICON = '❯';

/** Só `working`/`permission` piscam (handoff v3 `iconAnim`: `dd-blink`/`dd-blink-fast`) — mesma cadência de StateDot (`state-dot-pulse`, 2000ms/1000ms). */
const BLINKING_STATES: ReadonlySet<SessionState> = new Set(['working', 'permission']);

/**
 * CA-27 — paleta fixa de 4 faixas (handoff v3, `tabsRaw`
 * `Modo Dev v3.dc.html:1075-1079`): nenhuma cor livre, mesma disciplina de
 * token do resto do sistema ("o mockup não introduz nenhum hex novo",
 * `modo-dev-v3-verificacao.md` §3). `'none'` é o default — sem cor definida
 * pelo operador, mesmo stripe neutro (`var(--border)`) que o mockup usa para
 * a aba sem cor (`zsh`, `stripe: 'var(--border)'`).
 *
 * Cópia PROPOSITAL do tipo `TabColorToken` de `src/shared/tabAppearance.ts`
 * (app) — este pacote não depende do app (mesmo motivo dos dois `SessionState`
 * — StateDot e `SemaphoreState` do app — não serem um import só). Os 4
 * valores têm que continuar batendo 1:1 entre os dois lados.
 */
export type TabColorToken = 'none' | 'accent' | 'donel-accent' | 'permission';

export const TAB_COLOR_TOKENS: readonly TabColorToken[] = ['none', 'accent', 'donel-accent', 'permission'];

export const TAB_COLOR_LABEL_PT: Record<TabColorToken, string> = {
  none: 'Sem cor',
  accent: 'Azul',
  'donel-accent': 'Dourado',
  permission: 'Vermelho',
};

export interface TerminalTabProps {
  /** Nome da sessão, em mono. */
  name: string;
  /** Modelo abreviado, ex. "sonnet", "fable". */
  model?: string;
  /**
   * 014-chat (T079, D-C20) — texto de estado ao lado do nome, ex. "esperando você"
   * quando há pendência aberta. Tem slot próprio: nunca reaproveita `model`.
   * Quando presente, toma o lugar visual do modelo (a aba continua estreita).
   */
  statusText?: string;
  /**
   * Estado do semáforo. Omitido = "terminal comum" (sem sessão Claude) — a
   * aba troca o dot por um ícone de shell (design-system.md §6, Brief 1).
   */
  state?: SessionState;
  active?: boolean;
  onClick?: () => void;
  onClose?: () => void;
  /**
   * T407/T408 (004-nomear-sessoes) — renomear pela própria aba (CA-3):
   * duplo-clique no nome, ou F2 com a aba em foco. Omitido = aba não
   * renomeável (o gesto nem existe).
   */
  onRename?: (next: string) => void;
  /** Limite de caracteres do nome (decisão C5: 60). */
  nameMaxLength?: number;
  className?: string;
  /** CA-27 — faixa de cor escolhida pelo operador. Default `'none'` (neutra). */
  color?: TabColorToken;
  /**
   * CA-27 — chamado quando o operador escolhe uma cor no menu (clique
   * direito na aba). Omitido = aba não pode receber cor (ex.: estudo do
   * Storybook que só ilustra o ícone).
   */
  onColorChange?: (color: TabColorToken) => void;
  /**
   * Fix #19 — cor CSS concreta (hex) lida do `/color` do CLI, quando a
   * sessão já rodou o comando. `null`/`undefined` = sem cor do CLI (mantém
   * a faixa por `color`/token acima). PRECEDÊNCIA: quando presente, esta cor
   * VENCE `color` na faixa visual — decisão nomeada (esclarecimento do
   * Alexandre, 03/08): "não existe lugar na UI para definir cor", o
   * `/color` do CLI é o gesto explícito e mais recente do operador, então
   * ganha de um token que nem tem como ser escolhido hoje. O menu de cor
   * (clique direito, `onColorChange`) continua funcional — só fica
   * visualmente sobreposto enquanto houver `cliColorHex`, exatamente como
   * `.active` não sobrepõe a faixa (são camadas independentes).
   */
  cliColorHex?: string | null;
  /** CA-26 — aba arrastável; a reordenação de verdade é decisão de quem hospeda a barra (`reorderTabs`, src/shared/tabAppearance.ts no app). */
  draggable?: boolean;
  onDragStart?: (event: DragEvent<HTMLDivElement>) => void;
  onDragOver?: (event: DragEvent<HTMLDivElement>) => void;
  onDrop?: (event: DragEvent<HTMLDivElement>) => void;
}

/**
 * Aba de terminal do shell principal (variante v3, extensão 7): ícone de
 * estado (pode piscar) + nome (mono) + modelo abreviado + faixa de cor do
 * operador + alça de arraste; ativa = `bg-raised`.
 */
export function TerminalTab({
  name,
  model,
  statusText,
  state,
  active = false,
  onClick,
  onClose,
  onRename,
  nameMaxLength,
  className,
  color = 'none',
  onColorChange,
  cliColorHex = null,
  draggable = false,
  onDragStart,
  onDragOver,
  onDrop,
}: TerminalTabProps) {
  const stateLabel = state ? SESSION_STATE_LABEL_PT[state] : 'Terminal comum';
  const tooltip = statusText ? `${stateLabel} · ${statusText}` : model ? `${stateLabel} · ${model}` : stateLabel;
  const labelRef = useRef<EditableLabelHandle>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [colorMenuOpen, setColorMenuOpen] = useState(false);

  // Fecha no clique fora ou no Esc — mesmo espírito de EditableLabel (estado
  // de interação local ao componente, sem exigir um Modal cheio para um
  // menu de 4 swatches).
  useEffect(() => {
    if (!colorMenuOpen) return undefined;

    function handlePointerDown(event: PointerEvent): void {
      if (menuRef.current?.contains(event.target as Node)) return;
      setColorMenuOpen(false);
    }
    function handleKeyDown(event: globalThis.KeyboardEvent): void {
      if (event.key === 'Escape') setColorMenuOpen(false);
    }

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [colorMenuOpen]);

  // F2 na aba EM FOCO abre a edição (decisão C5). Fica no botão do corpo
  // porque é ele quem recebe foco na navegação por teclado.
  function handleBodyKeyDown(event: KeyboardEvent<HTMLButtonElement>): void {
    if (!onRename || event.key !== 'F2') return;
    event.preventDefault();
    event.stopPropagation();
    labelRef.current?.startEditing();
  }

  // CA-27 — clique direito abre o menu de cor; sem `onColorChange` a aba não
  // pode receber cor (o gesto nem existe, mesmo espírito do `onRename`
  // omitido acima).
  function handleContextMenu(event: MouseEvent<HTMLDivElement>): void {
    if (!onColorChange) return;
    event.preventDefault();
    setColorMenuOpen(true);
  }

  return (
    <div
      className={[
        styles.tab,
        active ? styles.active : '',
        // Fix #19 — a classe do token só entra quando NÃO há cor do CLI: o
        // inline style abaixo já venceria por especificidade de qualquer
        // jeito, mas nem aplicar a classe deixa a precedência legível no
        // próprio DOM (inspecionar o elemento mostra a intenção, não um
        // empate de CSS resolvido por acidente).
        !cliColorHex && color !== 'none' ? styles[`color-${color}`] : '',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      role="tab"
      aria-selected={active}
      // Nome inteiro no tooltip: com o limite de 60 chars a aba trunca por CSS,
      // e o texto completo passa a existir só aqui.
      title={`${name} — ${tooltip}`}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onContextMenu={handleContextMenu}
      // Fix #19 — cor do CLI vence a faixa por token (ver doc de `cliColorHex`
      // acima); inline style é o único jeito de aplicar um hex livre sem
      // reintroduzir "hex novo" no CSS do design system.
      style={cliColorHex ? { borderTopColor: cliColorHex } : undefined}
    >
      {draggable ? (
        <span className={styles.dragHandle} aria-hidden="true">
          ⣿
        </span>
      ) : null}
      <button type="button" className={styles.body} onClick={onClick} onKeyDown={handleBodyKeyDown}>
        <span
          className={[styles.stateIcon, styles[state ?? 'shell'], state && BLINKING_STATES.has(state) ? styles.stateIconBlink : '']
            .filter(Boolean)
            .join(' ')}
          role="img"
          aria-label={stateLabel}
        >
          {state ? SESSION_STATE_ICON[state] : SHELL_ICON}
        </span>
        {onRename ? (
          <EditableLabel
            ref={labelRef}
            className={styles.name}
            value={name}
            onCommit={onRename}
            maxLength={nameMaxLength}
            inputAriaLabel={`Renomear sessão ${name}`}
          />
        ) : (
          <span className={styles.name}>{name}</span>
        )}
        {statusText ? (
          <span className={styles.statusText}>{statusText}</span>
        ) : model ? (
          <span className={styles.model}>{model}</span>
        ) : null}
      </button>
      {onColorChange && colorMenuOpen ? (
        <div ref={menuRef} className={styles.colorMenu} role="menu" aria-label={`Cor da aba ${name}`}>
          {TAB_COLOR_TOKENS.map((token) => (
            <button
              key={token}
              type="button"
              role="menuitemradio"
              aria-checked={color === token}
              aria-label={TAB_COLOR_LABEL_PT[token]}
              className={[styles.colorSwatch, styles[`swatch-${token}`]].join(' ')}
              onClick={(event) => {
                event.stopPropagation();
                onColorChange(token);
                setColorMenuOpen(false);
              }}
            />
          ))}
        </div>
      ) : null}
      {onClose ? (
        <button type="button" className={styles.close} onClick={onClose} aria-label={`Fechar aba ${name}`}>
          <X size={12} strokeWidth={1.5} aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}
