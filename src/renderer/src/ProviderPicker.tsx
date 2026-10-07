import { Select } from '@donel-dev/design-system';
import type { SelectOption } from '@donel-dev/design-system';
import type { ProviderSummaryDto } from '../../shared';
import styles from './ProviderPicker.module.css';

// T1320 (011-contas-e-provedores, etapa 3) — campo "Provedor" do Launcher.
// SÓ renderizado com registry não vazio (C14/D6) — registry vazio = launcher
// idêntico ao de hoje, este componente devolve `null`. Primeira opção
// sempre "Claude (conta)" (`null`) e default. Entrada `class: 'B'` aparece
// marcada "não suportada nesta versão" e NÃO é selecionável (C20/D5) — o
// handler de troca ignora silenciosamente um clique nela, mantendo a
// seleção anterior (o `Select` do design-system não tem opção nativa
// "disabled" por item).

export const CLAUDE_ACCOUNT_OPTION_VALUE = '';

export interface ProviderPickerProps {
  providers: readonly ProviderSummaryDto[];
  /** `null` = "Claude (conta)" (default). */
  value: string | null;
  onChange: (providerId: string | null) => void;
}

export function ProviderPicker({ providers, value, onChange }: ProviderPickerProps): React.JSX.Element | null {
  // C14/D6 — registry vazio: nem o campo aparece. Comportamento de hoje intocado.
  if (providers.length === 0) return null;

  const selectedProvider = providers.find((provider) => provider.id === value) ?? null;

  const options: SelectOption[] = [
    { value: CLAUDE_ACCOUNT_OPTION_VALUE, label: 'Claude (conta)' },
    ...providers.map((provider) => ({
      value: provider.id,
      label: provider.supported ? provider.label : `${provider.label} (não suportada nesta versão)`,
    })),
  ];

  const handleChange = (nextValue: string): void => {
    if (nextValue === CLAUDE_ACCOUNT_OPTION_VALUE) {
      onChange(null);
      return;
    }
    const nextProvider = providers.find((provider) => provider.id === nextValue);
    // C20/D5 — classe B nasce vazia: aceita e persiste, mas não é
    // selecionável nesta versão. Clique numa entrada não suportada é um
    // no-op silencioso na seleção (mantém o que já estava escolhido).
    if (!nextProvider || !nextProvider.supported) return;
    onChange(nextProvider.id);
  };

  return (
    <div className={styles.field} data-testid="provider-picker">
      <span className={styles.label}>Provedor</span>
      <Select value={value ?? CLAUDE_ACCOUNT_OPTION_VALUE} options={options} onChange={handleChange} />
      {selectedProvider ? (
        <p className={styles.hint} data-testid="provider-picker-hint">
          Modelo e esforço vêm da configuração deste provedor (os controles acima são ignorados). Sessão isolada em uma
          pasta de configuração própria — vazia, sem os MCPs/preferências do Claude Code.
        </p>
      ) : null}
    </div>
  );
}
