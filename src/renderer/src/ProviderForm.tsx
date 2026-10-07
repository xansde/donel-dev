import { Button, Modal, TextInput } from '@donel-dev/design-system';
import { useCallback, useEffect, useState } from 'react';
import type { ProviderSummaryDto } from '../../shared';
import styles from './ProviderForm.module.css';

// T1321 (011-contas-e-provedores, etapa 3) — criar/editar/remover entrada
// CLASSE A (não há UI de criação de classe B, C20/D5) e campo de segredo
// WRITE-ONLY: nunca é relido do main, nunca é preenchido de volta; o estado
// exibido é só `configurado`/`não configurado`/`cofre indisponível` (C19).
// Mesmo padrão de trigger + Modal do AccountsPanel.tsx.

const SECRETS_STATUS_LABEL: Record<ProviderSummaryDto['secretsStatus'], string> = {
  configured: 'configurado',
  missing: 'não configurado',
  'vault-unavailable': 'cofre indisponível',
};

interface CreateFormState {
  label: string;
  /** Uma linha por variável, `CHAVE=valor` — env NÃO sensível (D1/C15). */
  envText: string;
  /** Um nome por linha — variáveis cujo valor vai para o cofre via `setSecret`. */
  secretKeysText: string;
}

function emptyCreateForm(): CreateFormState {
  return { label: '', envText: '', secretKeysText: '' };
}

/** `CHAVE=valor` por linha; linha sem `=` ou vazia é ignorada. Puro, sem validação de nome reservado (o main recusa e devolve o motivo). */
function parseEnvText(text: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex <= 0) continue;
    env[trimmed.slice(0, eqIndex).trim()] = trimmed.slice(eqIndex + 1).trim();
  }
  return env;
}

function parseSecretKeysText(text: string): string[] {
  return text
    .split(/[\n,]/)
    .map((key) => key.trim())
    .filter((key) => key.length > 0);
}

interface ProviderFormProps {
  /** Chamado depois de upsert/remove/setSecret bem-sucedidos — o App.tsx repõe a lista que alimenta o `ProviderPicker` do Launcher. */
  onChanged: () => void;
}

export function ProviderForm({ onChanged }: ProviderFormProps): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [providers, setProviders] = useState<readonly ProviderSummaryDto[]>([]);
  const [createForm, setCreateForm] = useState<CreateFormState>(emptyCreateForm());
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [secretDrafts, setSecretDrafts] = useState<Record<string, string>>({});
  const [savingSecretKey, setSavingSecretKey] = useState<string | null>(null);

  const refresh = useCallback((): void => {
    void window.donel.providers.list().then(setProviders);
  }, []);

  useEffect(() => {
    if (open) refresh();
  }, [open, refresh]);

  const handleCreate = (): void => {
    setCreateError(null);
    const label = createForm.label.trim();
    if (!label) {
      setCreateError('Dê um nome ao provedor.');
      return;
    }
    setCreating(true);
    void window.donel.providers
      .upsert({
        label,
        class: 'A',
        env: parseEnvText(createForm.envText),
        secretEnvKeys: parseSecretKeysText(createForm.secretKeysText),
      })
      .then((result) => {
        if (result.kind === 'invalid') {
          setCreateError(`Dados inválidos no campo "${result.field}" (${result.reason}).`);
          return;
        }
        // Write-only: o formulário some depois de criar.
        setCreateForm(emptyCreateForm());
        refresh();
        onChanged();
      })
      .finally(() => setCreating(false));
  };

  const handleRemove = (id: string): void => {
    void window.donel.providers.remove(id).then((next) => {
      setProviders(next);
      onChanged();
    });
  };

  const handleSaveSecret = (providerId: string, envKey: string): void => {
    const value = secretDrafts[`${providerId}:${envKey}`]?.trim();
    if (!value) return;
    setSavingSecretKey(`${providerId}:${envKey}`);
    void window.donel.providers
      .setSecret(providerId, envKey, value)
      .then(() => {
        // Write-only: o valor digitado nunca fica no estado depois de enviado.
        setSecretDrafts((prev) => {
          const next = { ...prev };
          delete next[`${providerId}:${envKey}`];
          return next;
        });
        refresh();
        onChanged();
      })
      .finally(() => setSavingSecretKey(null));
  };

  return (
    <>
      <button type="button" className={styles.trigger} data-testid="providers-panel-trigger" onClick={() => setOpen(true)} title="Provedores">
        Provedores
      </button>

      <Modal open={open} onClose={() => setOpen(false)} title="Provedores">
        <div className={styles.body} data-testid="providers-panel">
          <p className={styles.hint}>
            Provedores LLM alternativos (classe A — mesmo binário do Claude Code, endpoint próprio). Sem nenhum cadastrado, o
            launcher continua exatamente como hoje.
          </p>

          <ul className={styles.list}>
            {providers.map((provider) => (
              <li key={provider.id} className={styles.row} data-testid="provider-row" data-provider-id={provider.id}>
                <div className={styles.rowHeader}>
                  <span className={styles.label}>
                    {provider.label}
                    {!provider.supported ? ' — não suportada nesta versão (classe B)' : ''}
                  </span>
                  <Button variant="secondary" onClick={() => handleRemove(provider.id)} data-testid="provider-remove">
                    Remover
                  </Button>
                </div>
                <span className={styles.hint} data-testid="provider-secrets-status">
                  Segredo: {SECRETS_STATUS_LABEL[provider.secretsStatus]}
                </span>
              </li>
            ))}
            {providers.length === 0 ? <li className={styles.hint}>Nenhum provedor cadastrado ainda.</li> : null}
          </ul>

          <div className={styles.field}>
            <span className={styles.label}>Novo provedor (classe A)</span>
            <TextInput
              label="Nome"
              value={createForm.label}
              onChange={(event) => setCreateForm((prev) => ({ ...prev, label: event.target.value }))}
              placeholder="ex.: OpenRouter"
            />
            <span className={styles.hint}>Variáveis de ambiente (uma por linha, CHAVE=valor — sem segredo aqui)</span>
            <textarea
              className={styles.textarea}
              data-testid="provider-env-input"
              value={createForm.envText}
              onChange={(event) => setCreateForm((prev) => ({ ...prev, envText: event.target.value }))}
              placeholder={'ANTHROPIC_BASE_URL=https://openrouter.ai/api/v1\nANTHROPIC_MODEL=algum-modelo'}
            />
            <span className={styles.hint}>Nomes das variáveis secretas (uma por linha — o valor é digitado depois de criar)</span>
            <textarea
              className={styles.textarea}
              data-testid="provider-secret-keys-input"
              value={createForm.secretKeysText}
              onChange={(event) => setCreateForm((prev) => ({ ...prev, secretKeysText: event.target.value }))}
              placeholder="ANTHROPIC_AUTH_TOKEN"
            />
            {createError ? (
              <p className={styles.error} data-testid="provider-create-error">
                {createError}
              </p>
            ) : null}
            <div className={styles.toolbar}>
              <Button variant="secondary" onClick={handleCreate} disabled={creating} data-testid="provider-create-submit">
                {creating ? 'Criando…' : 'Criar provedor'}
              </Button>
            </div>
          </div>

          {providers
            .filter((provider) => provider.supported && provider.secretsStatus !== 'vault-unavailable' && provider.envKeys.length > 0)
            .map((provider) => (
              <div key={`secrets-${provider.id}`} className={styles.row}>
                <span className={styles.label}>Segredos de {provider.label}</span>
                <span className={styles.hint}>
                  Digite o NOME exato de uma das variáveis marcadas como secreta na criação — write-only, nunca relido.
                </span>
                {provider.envKeys.map((envKey) => (
                  <div key={envKey} className={styles.secretRow}>
                      <TextInput
                        label={envKey}
                        type="password"
                        value={secretDrafts[`${provider.id}:${envKey}`] ?? ''}
                        onChange={(event) =>
                          setSecretDrafts((prev) => ({ ...prev, [`${provider.id}:${envKey}`]: event.target.value }))
                        }
                        placeholder="write-only — nunca relido"
                      />
                      <Button
                        variant="secondary"
                        onClick={() => handleSaveSecret(provider.id, envKey)}
                        disabled={savingSecretKey === `${provider.id}:${envKey}`}
                        data-testid="provider-secret-save"
                      >
                        Salvar
                      </Button>
                    </div>
                  ))}
              </div>
            ))}
        </div>
      </Modal>
    </>
  );
}
