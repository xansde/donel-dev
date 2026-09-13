import { Button, Modal, TextInput, Toggle } from '@donel-dev/design-system';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { AccountsConfigDto, AccountsViewDto, ConnectModInput, LoginStatusDto, RemoveAccountOutcome } from '../../shared';
import { formatAccountLoad } from './accountsFormat';
import { MigrationWizard } from './MigrationWizard';
import styles from './AccountsPanel.module.css';

// T1123/T1124 (011-contas-e-provedores, etapa 1) — ADAPTAÇÃO do
// ProfileSwitcher.tsx, não reescrita: mesmo padrão de trigger + Modal.
// Painel do motor de contas: nasce INERTE (accounts.mod = null). Nunca
// exibe segredo: o formulário de conectar é WRITE-ONLY — o que foi digitado
// nunca é relido de nenhum canal (`accounts:getConfig`/`accounts:list`
// nunca devolvem token/par).
//
// 011-contas-e-provedores, etapa 3, Fase 1 (plan-etapa-3.md §4) — devolve o
// gesto que os perfis tinham: "Adicionar conta" deixa de exigir motor
// inerte (F1), o cadastro por login isolado mata o F2 (validade real, nunca
// chutada), "Remover conta" e "Desconectar" explícito passam a existir. O
// "Pool Seazone" sai do seletor (decisão do dono, §6) — o tipo `ModId`
// continua aceitando `'seazone'`, só a UI não o oferece mais.

const UNAVAILABLE_REASON_LABEL: Record<'offline' | 'unauthorized' | 'io', string> = {
  offline: 'backend indisponível (offline)',
  unauthorized: 'sessão expirada — reconecte o provedor',
  io: 'erro ao ler contas',
};

/** Mensagens de `BeginLoginOutcome.failed.reason` (`accounts:beginLogin`, isolated-login.ts `begin()`). */
const BEGIN_LOGIN_ERROR_LABEL: Record<'invalid-input' | 'vault-unavailable' | 'login-in-progress' | 'io', string> = {
  'invalid-input': 'Dê um rótulo à conta (até 60 caracteres).',
  'vault-unavailable': 'Este dispositivo não suporta o cofre de credenciais — nada foi aberto.',
  'login-in-progress': 'Já existe um login em andamento — conclua ou cancele antes.',
  io: 'Não foi possível preparar o login — tente de novo.',
};

function emptyView(): AccountsViewDto {
  return { mod: null, state: 'inert', unavailableReason: null, accounts: [], activeAccountId: null, autoSwitch: { enabled: true, switchAtLoad: 90, minAdvantage: 20 }, lastReadAt: null };
}

interface PasteFormState {
  accessToken: string;
  refreshToken: string;
  /** Texto livre — nunca convertido até o submit (F2): vazio = validade desconhecida, só dígitos vira `Number`, o resto é erro local. */
  expiresAt: string;
}

function emptyPasteForm(): PasteFormState {
  return { accessToken: '', refreshToken: '', expiresAt: '' };
}

/** Mensagem de um status final de login isolado (`accounts:loginChanged`, plan-etapa-3.md §4.2). */
function loginStatusMessage(status: LoginStatusDto): string {
  if (status.state === 'added') return `Conta «${status.label}» adicionada.`;
  if (status.state === 'replaced') {
    return `«${status.label}» é a mesma conta que «${status.existingLabel}» — a credencial dela foi renovada.`;
  }
  if (status.state === 'cancelled') {
    if (status.reason === 'user') return `Login de «${status.label}» cancelado.`;
    if (status.reason === 'exited-without-login') return 'A aba de login fechou antes do login terminar — nada foi guardado.';
    return 'A aba de login não abriu — nada foi guardado.'; // 'no-terminal'
  }
  // status.state === 'failed'
  return status.reason === 'vault-unavailable' ? 'O cofre recusou a credencial — nada foi guardado.' : 'Não foi possível registrar a conta — tente de novo.';
}

interface AccountsPanelProps {
  /**
   * T1232 (011-contas-e-provedores, etapa 2) — achado da regressão final:
   * `App.tsx` também precisava do `AccountsViewDto` (badge/statusbar) e
   * abria uma SEGUNDA assinatura própria de `window.donel.accounts.list()`/
   * `onChanged` — dobrando o round-trip de IPC no boot e estourando a cerca
   * de regressão do CA-7 (250ms → ~330ms). Callback opcional, mesmo padrão
   * de `ProfileSwitcher.onActiveProfileLabelChange` de antes: uma assinatura
   * só, aqui dentro, reportada pra cima.
   */
  onViewChange?: (view: AccountsViewDto) => void;
  /**
   * 011-contas-e-provedores, etapa 3, Fase 1.2 — login isolado iniciado
   * (`beginLogin` -> `started`): App.tsx abre a aba `claude` cru no
   * diretório efêmero do login (`accountLoginId` vira o `pty:create`).
   */
  onStartLogin?: (loginId: string, label: string) => void;
  /**
   * 011-contas-e-provedores, etapa 3, Fase 1.2 — o login concluiu (added/
   * replaced/cancelled/failed, via `accounts:loginChanged`): App.tsx fecha a
   * aba correspondente (o main já matou o PTY antes de emitir o status).
   */
  onLoginEnded?: (loginId: string) => void;
}

export function AccountsPanel({ onViewChange, onStartLogin, onLoginEnded }: AccountsPanelProps = {}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<AccountsViewDto>(emptyView());
  const [loading, setLoading] = useState(false);
  const [switchingId, setSwitchingId] = useState<string | null>(null);
  // T1215 (011-contas-e-provedores, etapa 2) — o assistente só aparece
  // enquanto o inventário de `~/.claude-profiles` tiver alguma entrada;
  // some sozinho depois da virada (DoD do tasks-etapa-2.md).
  const [hasLegacyProfiles, setHasLegacyProfiles] = useState(false);
  const [migrationOpen, setMigrationOpen] = useState(false);

  // 011-contas-e-provedores, etapa 3, Fase 1.2 — "Adicionar conta" por login
  // isolado. O rótulo é compartilhado com o formulário de colar (avançado)
  // abaixo: as duas formas de adicionar uma conta pedem o mesmo dado.
  const [loginLabel, setLoginLabel] = useState('');
  const [loginError, setLoginError] = useState<string | null>(null);
  const [startingLogin, setStartingLogin] = useState(false);
  const [pendingLogin, setPendingLogin] = useState<{ loginId: string; label: string } | null>(null);
  const [loginResult, setLoginResult] = useState<string | null>(null);

  // Fase 1.2 — "Colar token (avançado)": fallback do login isolado, agora
  // com campo de validade real (F2) em vez do `Date.now() + 3600_000` chutado.
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteForm, setPasteForm] = useState<PasteFormState>(emptyPasteForm());
  const [pasteError, setPasteError] = useState<string | null>(null);
  const [pasting, setPasting] = useState(false);

  // Fase 1 — "Remover conta" (plan-etapa-3.md §4.3): confirmação inline por linha.
  const [removeConfirmId, setRemoveConfirmId] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [removeMessages, setRemoveMessages] = useState<Record<string, string>>({});

  // Fase 1 — "Desconectar" nunca some com a lista em silêncio.
  const [disconnectConfirmOpen, setDisconnectConfirmOpen] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

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

  // Reporta pra cima (App.tsx) sempre que `view` mudar — uma assinatura só,
  // aqui dentro; ver comentário de `AccountsPanelProps.onViewChange`.
  useEffect(() => {
    onViewChange?.(view);
  }, [view, onViewChange]);

  useEffect(() => {
    if (open) refresh();
  }, [open, refresh]);

  useEffect(() => {
    if (open) void window.donel.migration.scan().then((plan) => setHasLegacyProfiles(plan.entries.length > 0));
  }, [open]);

  // 011-contas-e-provedores, etapa 3, Fase 1.2 — assinatura ÚNICA no mount
  // (mesmo padrão do `onChanged` acima). `onLoginEnded` muda de identidade a
  // cada render do App.tsx; sem a ref, este listener (deps vazias) chamaria
  // pra sempre a versão do PRIMEIRO render (closure velha).
  const onLoginEndedRef = useRef(onLoginEnded);
  onLoginEndedRef.current = onLoginEnded;

  useEffect(() => {
    return window.donel.accounts.onLoginChanged((status) => {
      setPendingLogin(null);
      onLoginEndedRef.current?.(status.loginId);
      setLoginResult(loginStatusMessage(status));
      setOpen(true);
      refresh();
    });
  }, [refresh]);

  const editLoginLabel = (value: string): void => {
    setLoginLabel(value);
    setLoginError(null);
  };

  const editPasteForm = (patch: (prev: PasteFormState) => PasteFormState): void => {
    setPasteForm(patch);
    setPasteError(null);
  };

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

  const handleBeginLogin = (): void => {
    setLoginError(null);
    setStartingLogin(true);
    const label = loginLabel.trim();
    void window.donel.accounts
      .beginLogin(label)
      .then((outcome) => {
        if (outcome.kind === 'failed') {
          setLoginError(BEGIN_LOGIN_ERROR_LABEL[outcome.reason]);
          return;
        }
        setPendingLogin({ loginId: outcome.loginId, label });
        onStartLogin?.(outcome.loginId, label);
        // Write-only: o rótulo é limpo, nunca preenchido de volta. O modal
        // fecha pra a aba de login (aberta pelo App.tsx) ficar visível.
        setLoginLabel('');
        setOpen(false);
      })
      .finally(() => setStartingLogin(false));
  };

  const handleCancelLogin = (): void => {
    if (!pendingLogin) return;
    void window.donel.accounts.cancelLogin(pendingLogin.loginId);
    // Não limpa `pendingLogin` aqui — `onLoginChanged` (state: 'cancelled')
    // fecha o ciclo, mesmo caminho de added/replaced/failed.
  };

  const handlePasteSubmit = (): void => {
    setPasteError(null);
    const label = loginLabel.trim();

    const rawExpiresAt = pasteForm.expiresAt.trim();
    let expiresAt: number | null;
    if (rawExpiresAt === '') {
      expiresAt = null;
    } else if (/^\d+$/.test(rawExpiresAt)) {
      expiresAt = Number(rawExpiresAt);
    } else {
      setPasteError('Validade inválida — use o número expiresAt do arquivo, ou deixe vazio.');
      return;
    }

    const input: ConnectModInput = { mod: 'local', label, accessToken: pasteForm.accessToken, refreshToken: pasteForm.refreshToken, expiresAt };

    setPasting(true);
    void window.donel.accounts
      .connectMod(input)
      .then((outcome) => {
        if (outcome.kind === 'failed') {
          setPasteError(
            outcome.reason === 'vault-unavailable'
              ? 'Este dispositivo não suporta o cofre de credenciais — conexão recusada (nunca gravamos segredo em texto plano).'
              : outcome.reason === 'invalid-input'
                ? 'Dados incompletos — confira os campos.'
                : 'Não foi possível conectar — confira os dados e tente de novo.',
          );
          return;
        }
        // Write-only: os campos nunca são repreenchidos.
        setPasteForm(emptyPasteForm());
        setLoginLabel('');
        refresh();
      })
      .finally(() => setPasting(false));
  };

  const accountLabel = (id: string): string => view.accounts.find((account) => account.id === id)?.label ?? id;

  const handleStartRemove = (id: string): void => {
    setRemoveConfirmId(id);
    setRemoveMessages((prev) => {
      if (!(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
  };

  const handleConfirmRemove = (id: string): void => {
    setRemovingId(id);
    void window.donel.accounts
      .removeAccount(id)
      .then((outcome: RemoveAccountOutcome) => {
        setRemoveConfirmId(null);
        if (outcome.kind === 'removed') {
          refresh();
          return;
        }
        // A tela NÃO desabilita o Remover da ativa (quem bloqueia é o main) —
        // aqui só mostra a explicação. `outcome.kind === 'failed'` é o resto.
        const message =
          outcome.kind === 'blocked'
            ? `«${accountLabel(id)}» é a conta em uso — troque para outra antes de removê-la. A credencial dela vive no ~/.claude; removê-la agora faria a próxima troca perder a credencial renovada.`
            : 'Não foi possível remover — tente de novo.';
        setRemoveMessages((prev) => ({ ...prev, [id]: message }));
      })
      .finally(() => setRemovingId(null));
  };

  const handleDisconnect = (): void => {
    setDisconnecting(true);
    void window.donel.accounts
      .disconnectMod()
      .then((config: AccountsConfigDto) => {
        setView((prev) => ({ ...prev, mod: config.mod, state: 'inert', accounts: [], activeAccountId: config.activeAccountId }));
        setDisconnectConfirmOpen(false);
      })
      .finally(() => setDisconnecting(false));
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
          {hasLegacyProfiles ? (
            <div className={styles.toolbar}>
              <Button variant="secondary" data-testid="accounts-open-migration" onClick={() => setMigrationOpen(true)}>
                Migrar perfis antigos
              </Button>
            </div>
          ) : null}

          {view.mod !== null ? (
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
                <Button variant="secondary" onClick={() => setDisconnectConfirmOpen(true)} data-testid="accounts-disconnect">
                  Desconectar
                </Button>
              </div>

              {view.state === 'unavailable' && view.unavailableReason ? (
                <p className={styles.error} data-testid="accounts-unavailable">
                  Contas indisponíveis: {UNAVAILABLE_REASON_LABEL[view.unavailableReason]}
                </p>
              ) : null}

              {disconnectConfirmOpen ? (
                <div className={styles.confirmBox} data-testid="accounts-disconnect-confirm">
                  <p className={styles.hint}>
                    Desconectar tira as {view.accounts.length} contas do app e apaga as credenciais delas do cofre. O Claude
                    Code continua logado na conta em uso; para voltar ao pool, cada conta precisa de novo login.
                  </p>
                  <div className={styles.toolbar}>
                    <Button
                      variant="danger"
                      data-testid="accounts-disconnect-confirm-yes"
                      onClick={handleDisconnect}
                      disabled={disconnecting}
                    >
                      {disconnecting ? 'Desconectando…' : 'Desconectar e apagar'}
                    </Button>
                    <Button variant="secondary" data-testid="accounts-disconnect-cancel" onClick={() => setDisconnectConfirmOpen(false)}>
                      Cancelar
                    </Button>
                  </div>
                </div>
              ) : null}

              <ul className={styles.list}>
                {view.accounts.map((account) => (
                  <li key={account.id} className={styles.row} data-testid="account-row" data-account-id={account.id}>
                    <div className={styles.rowMain}>
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
                      <Button
                        variant="secondary"
                        data-testid="account-remove"
                        onClick={() => handleStartRemove(account.id)}
                        disabled={removingId === account.id}
                      >
                        Remover
                      </Button>
                    </div>

                    {removeConfirmId === account.id ? (
                      <div className={styles.confirmBox} data-testid="account-remove-confirm-box">
                        <p className={styles.hint}>Remover «{account.label}»? A credencial sai do cofre; voltar exige novo login.</p>
                        <div className={styles.toolbar}>
                          <Button
                            variant="danger"
                            data-testid="account-remove-confirm"
                            onClick={() => handleConfirmRemove(account.id)}
                            disabled={removingId === account.id}
                          >
                            Remover
                          </Button>
                          <Button variant="secondary" data-testid="account-remove-cancel" onClick={() => setRemoveConfirmId(null)}>
                            Cancelar
                          </Button>
                        </div>
                      </div>
                    ) : null}

                    {removeMessages[account.id] ? (
                      <p className={styles.error} data-testid="account-remove-blocked">
                        {removeMessages[account.id]}
                      </p>
                    ) : null}
                  </li>
                ))}
                {view.accounts.length === 0 && view.state === 'ready' ? <li className={styles.hint}>Nenhuma conta cadastrada ainda.</li> : null}
              </ul>
            </>
          ) : null}

          {pendingLogin ? (
            <div className={styles.connectSection} data-testid="accounts-login-pending">
              <p className={styles.hint}>
                Login de «{pendingLogin.label}» em andamento na aba «Login · {pendingLogin.label}».
              </p>
              <Button variant="secondary" data-testid="accounts-login-cancel" onClick={handleCancelLogin}>
                Cancelar login
              </Button>
            </div>
          ) : (
            <div className={styles.connectSection} data-testid="accounts-connect-form">
              <p className={styles.hint}>
                {view.mod === null ? 'Nenhuma conta cadastrada — o Claude Code segue com o login atual.' : 'Adicionar conta'}
              </p>

              {loginResult ? (
                <p className={styles.hint} data-testid="accounts-login-result">
                  {loginResult}
                </p>
              ) : null}

              <TextInput label="Rótulo da conta" value={loginLabel} onChange={(event) => editLoginLabel(event.target.value)} placeholder="ex.: Conta B" />

              {loginError ? (
                <p className={styles.error} data-testid="accounts-login-error">
                  {loginError}
                </p>
              ) : null}

              <Button variant="primary" data-testid="accounts-login-start" onClick={handleBeginLogin} disabled={startingLogin}>
                {startingLogin ? 'Iniciando…' : 'Entrar com login'}
              </Button>

              <p className={styles.hint}>
                Abre uma aba do Claude Code só para o login. Faça o /login nela — nunca /logout. A aba fecha sozinha quando a
                credencial estiver guardada.
              </p>

              <Button variant="ghost" data-testid="accounts-paste-toggle" onClick={() => setPasteOpen((prev) => !prev)}>
                Colar token (avançado)
              </Button>

              {pasteOpen ? (
                <div className={styles.connectSection}>
                  <TextInput
                    label="Access token"
                    type="password"
                    value={pasteForm.accessToken}
                    onChange={(event) => editPasteForm((prev) => ({ ...prev, accessToken: event.target.value }))}
                  />
                  <TextInput
                    label="Refresh token"
                    type="password"
                    value={pasteForm.refreshToken}
                    onChange={(event) => editPasteForm((prev) => ({ ...prev, refreshToken: event.target.value }))}
                  />
                  <TextInput
                    label="Validade (expiresAt, em ms)"
                    data-testid="accounts-paste-expires"
                    value={pasteForm.expiresAt}
                    onChange={(event) => editPasteForm((prev) => ({ ...prev, expiresAt: event.target.value }))}
                    hint="Copie o expiresAt do .credentials.json. Vazio = o app renova o token antes do primeiro uso."
                  />
                  {pasteError ? (
                    <p className={styles.error} data-testid="accounts-paste-error">
                      {pasteError}
                    </p>
                  ) : null}
                  <Button variant="secondary" data-testid="accounts-paste-submit" onClick={handlePasteSubmit} disabled={pasting}>
                    {pasting ? 'Adicionando…' : 'Adicionar'}
                  </Button>
                </div>
              ) : null}
            </div>
          )}

          <p className={styles.hint}>
            Trocar de conta não reinicia sessões abertas. O login acontece no terminal, pelo fluxo oficial do Claude Code — o
            painel nunca exibe token ou segredo.
          </p>
        </div>
      </Modal>

      <Modal open={migrationOpen} onClose={() => setMigrationOpen(false)} title="Migração de perfis">
        <MigrationWizard onClose={() => setMigrationOpen(false)} />
      </Modal>
    </>
  );
}
