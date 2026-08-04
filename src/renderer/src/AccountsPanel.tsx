import { Button, Modal, Select, TextInput, Toggle } from '@donel-dev/design-system';
import { useCallback, useEffect, useState } from 'react';
import type { AccountsConfigDto, AccountsViewDto, ConnectModInput, ModId } from '../../shared';
import { formatAccountLoad } from './accountsFormat';
import styles from './AccountsPanel.module.css';

// T1123/T1124 (011-contas-e-provedores, etapa 1) — ADAPTAÇÃO do
// ProfileSwitcher.tsx, não reescrita: mesmo padrão de trigger + Modal, mesma
// disciplina de refs pra callbacks (aqui não precisamos, componente
// autossuficiente como o ProfileSwitcher). Painel do motor de contas: nasce
// INERTE (accounts.mod = null) — DoD explícito de T1123: "renderiza com
// motor inerte sem quebrar a tela atual". Nunca exibe segredo: o formulário
// de conectar (T1124) é WRITE-ONLY — o que foi digitado nunca é relido de
// nenhum canal (`accounts:getConfig`/`accounts:list` nunca devolvem
// token/par).

const UNAVAILABLE_REASON_LABEL: Record<'offline' | 'unauthorized' | 'io', string> = {
  offline: 'backend indisponível (offline)',
  unauthorized: 'sessão expirada — reconecte o provedor',
  io: 'erro ao ler contas',
};

function emptyView(): AccountsViewDto {
  return { mod: null, state: 'inert', unavailableReason: null, accounts: [], activeAccountId: null, autoSwitch: { enabled: true, switchAtLoad: 90, minAdvantage: 20 }, lastReadAt: null };
}

interface ConnectFormState {
  mod: ModId;
  baseUrl: string;
  sessionRefreshToken: string;
  label: string;
  accessToken: string;
  refreshToken: string;
}

function emptyConnectForm(): ConnectFormState {
  return { mod: 'seazone', baseUrl: '', sessionRefreshToken: '', label: '', accessToken: '', refreshToken: '' };
}

export function AccountsPanel(): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<AccountsViewDto>(emptyView());
  const [loading, setLoading] = useState(false);
  const [switchingId, setSwitchingId] = useState<string | null>(null);
  const [connectForm, setConnectForm] = useState<ConnectFormState>(emptyConnectForm());
  const [connectError, setConnectError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);

  const refresh = useCallback((force = false): void => {
    setLoading(true);
    void window.donel.accounts
      .list(force ? { force: true } : undefined)
      .then(setView)
      .finally(() => setLoading(false));
  }, []);

  // Boot: precisa saber se o motor está inerte/ready mesmo com o painel
  // fechado (mesmo espírito do ProfileSwitcher, "badge do titlebar precisa
  // saber quem é a conta ativa mesmo com o dropdown fechado").
  useEffect(() => {
    void window.donel.accounts.list().then(setView);
    return window.donel.accounts.onChanged(setView);
  }, []);

  useEffect(() => {
    if (open) refresh();
  }, [open, refresh]);

  const handleSwitch = (id: string): void => {
    setSwitchingId(id);
    void window.donel.accounts
      .switch(id)
      .then(() => window.donel.accounts.list())
      .then(setView)
      .finally(() => setSwitchingId(null));
  };

  const handleToggleAutoSwitch = (enabled: boolean): void => {
    void window.donel.accounts
      .setConfig({ autoSwitch: { ...view.autoSwitch, enabled } })
      .then((): void => {
        setView((prev) => ({ ...prev, autoSwitch: { ...prev.autoSwitch, enabled } }));
      });
  };

  const handleDisconnect = (): void => {
    void window.donel.accounts.disconnectMod().then((config: AccountsConfigDto) => {
      setView((prev) => ({ ...prev, mod: config.mod, state: 'inert', accounts: [], activeAccountId: config.activeAccountId }));
    });
  };

  const handleConnect = (): void => {
    setConnectError(null);
    const input: ConnectModInput =
      connectForm.mod === 'seazone'
        ? { mod: 'seazone', baseUrl: connectForm.baseUrl.trim(), sessionRefreshToken: connectForm.sessionRefreshToken }
        : {
            mod: 'local',
            label: connectForm.label.trim(),
            accessToken: connectForm.accessToken,
            refreshToken: connectForm.refreshToken,
            expiresAt: Date.now() + 3600_000,
          };

    setConnecting(true);
    void window.donel.accounts
      .connectMod(input)
      .then((outcome) => {
        if (outcome.kind === 'failed') {
          setConnectError(
            outcome.reason === 'vault-unavailable'
              ? 'Este dispositivo não suporta o cofre de credenciais — conexão recusada (nunca gravamos segredo em texto plano).'
              : outcome.reason === 'invalid-input'
                ? 'Dados incompletos — confira os campos.'
                : 'Não foi possível conectar — confira o endereço e tente de novo.',
          );
          return;
        }
        // Write-only: o formulário é limpo, nunca preenchido de volta.
        setConnectForm(emptyConnectForm());
        refresh();
      })
      .finally(() => setConnecting(false));
  };

  return (
    <>
      <button
        type="button"
        className={styles.trigger}
        data-testid="accounts-panel-trigger"
        onClick={() => setOpen(true)}
        title="Contas e provedores"
      >
        {view.mod === null ? 'Contas' : view.state === 'unavailable' ? 'Contas ⚠' : 'Contas ✓'}
      </button>

      <Modal open={open} onClose={() => setOpen(false)} title="Contas e provedores">
        <div className={styles.body} data-testid="accounts-panel">
          {view.mod === null ? (
            <div className={styles.connectSection} data-testid="accounts-connect-form">
              <p className={styles.hint}>Nenhum provedor conectado — os perfis de hoje continuam funcionando normalmente.</p>
              <Select
                label="Provedor"
                value={connectForm.mod}
                onChange={(value) => setConnectForm((prev) => ({ ...prev, mod: value as ModId }))}
                options={[
                  { value: 'seazone', label: 'Pool Seazone' },
                  { value: 'local', label: 'Pool próprio' },
                ]}
              />
              {connectForm.mod === 'seazone' ? (
                <>
                  <TextInput
                    label="Endereço do switcher"
                    value={connectForm.baseUrl}
                    onChange={(event) => setConnectForm((prev) => ({ ...prev, baseUrl: event.target.value }))}
                    placeholder="https://switcher.seazone.dev"
                  />
                  <TextInput
                    label="Token de sessão"
                    type="password"
                    value={connectForm.sessionRefreshToken}
                    onChange={(event) => setConnectForm((prev) => ({ ...prev, sessionRefreshToken: event.target.value }))}
                  />
                </>
              ) : (
                <>
                  <TextInput
                    label="Rótulo da conta"
                    value={connectForm.label}
                    onChange={(event) => setConnectForm((prev) => ({ ...prev, label: event.target.value }))}
                    placeholder="ex.: Conta B"
                  />
                  <TextInput
                    label="Access token"
                    type="password"
                    value={connectForm.accessToken}
                    onChange={(event) => setConnectForm((prev) => ({ ...prev, accessToken: event.target.value }))}
                  />
                  <TextInput
                    label="Refresh token"
                    type="password"
                    value={connectForm.refreshToken}
                    onChange={(event) => setConnectForm((prev) => ({ ...prev, refreshToken: event.target.value }))}
                  />
                </>
              )}
              {connectError ? (
                <p className={styles.error} data-testid="accounts-connect-error">
                  {connectError}
                </p>
              ) : null}
              <Button variant="secondary" onClick={handleConnect} disabled={connecting}>
                {connecting ? 'Conectando…' : 'Conectar'}
              </Button>
            </div>
          ) : (
            <>
              <div className={styles.toolbar}>
                <Button variant="secondary" data-testid="accounts-refresh" onClick={() => refresh(true)} disabled={loading}>
                  {loading ? 'Atualizando…' : 'Atualizar'}
                </Button>
                <Toggle
                  checked={view.autoSwitch.enabled}
                  onChange={handleToggleAutoSwitch}
                  label="Trocar automaticamente"
                  className={styles.autoSwitchToggle}
                />
                <Button variant="secondary" onClick={handleDisconnect} data-testid="accounts-disconnect">
                  Desconectar
                </Button>
              </div>

              {view.state === 'unavailable' && view.unavailableReason ? (
                <p className={styles.error} data-testid="accounts-unavailable">
                  Contas indisponíveis: {UNAVAILABLE_REASON_LABEL[view.unavailableReason]}
                </p>
              ) : null}

              <ul className={styles.list}>
                {view.accounts.map((account) => (
                  <li key={account.id} className={styles.row} data-testid="account-row" data-account-id={account.id}>
                    <button
                      type="button"
                      className={styles.plainRow}
                      onClick={() => handleSwitch(account.id)}
                      disabled={switchingId === account.id || account.active}
                    >
                      <span className={styles.label}>
                        {account.label}
                        {account.active ? ' · ativa' : ''}
                      </span>
                      <span className={styles.load} data-testid="account-load">
                        {formatAccountLoad(account.load)}
                      </span>
                    </button>
                  </li>
                ))}
                {view.accounts.length === 0 && view.state === 'ready' ? <li className={styles.hint}>Nenhuma conta cadastrada ainda.</li> : null}
              </ul>

              <p className={styles.hint}>
                Trocar de conta não reinicia sessões abertas. O login/credenciais seguem fora do app — o painel nunca exibe
                token ou segredo.
              </p>
            </>
          )}
        </div>
      </Modal>
    </>
  );
}
