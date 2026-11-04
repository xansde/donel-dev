import { Button, Select, TextInput } from '@donel-dev/design-system';
import { useState } from 'react';
import type { AccountsViewDto, RemotePlace, RemoteSwitchOutcome } from '../../shared';
import styles from './AccountsPanel.module.css';

// Lugares remotos (VPS) dentro do painel de contas: cada lugar tem a sua conta,
// escolhida aqui. Uma conta em uso nesta máquina ou em outro lugar não aparece
// como opção — o motor recusaria (o mesmo refresh token renovado em dois CLIs
// mata a conta).

const NO_ACCOUNT = '';

const REMOTE_FAILURE_LABEL: Record<Extract<RemoteSwitchOutcome, { kind: 'failed' }>['reason'], string> = {
  unreachable: 'Não consegui falar com o lugar por ssh. Confira se o Tailscale está ligado nesta máquina.',
  'in-use': 'Essa conta está em uso nesta máquina ou em outro lugar.',
  'unknown-place': 'Lugar não encontrado.',
  'unknown-account': 'Só contas próprias podem ir para um lugar remoto.',
  offline: 'Sem rede para renovar a credencial da conta.',
  'expired-credentials': 'A credencial da conta venceu. Reconecte a conta e tente de novo.',
  io: 'A troca não terminou. Nada mudou no lugar; tente de novo.',
};

const REACH_LABEL: Record<AccountsViewDto['remotes'][number]['reach'], string> = {
  unknown: 'ainda não lido',
  ok: 'conectado',
  unreachable: 'sem conexão',
};

interface RemotePlacesSectionProps {
  readonly view: AccountsViewDto;
}

export function RemotePlacesSection({ view }: RemotePlacesSectionProps): React.JSX.Element {
  const [busyPlace, setBusyPlace] = useState<string | null>(null);
  const [messages, setMessages] = useState<Record<string, string>>({});
  const [adding, setAdding] = useState(false);
  const [newLabel, setNewLabel] = useState('');
  const [newTarget, setNewTarget] = useState('');
  const [addError, setAddError] = useState<string | null>(null);

  const ownAccounts = view.accounts.filter((account) => !account.id.startsWith('seazone:'));

  const setMessage = (placeId: string, message: string | null): void => {
    setMessages((prev) => {
      const next = { ...prev };
      if (message) next[placeId] = message;
      else delete next[placeId];
      return next;
    });
  };

  const handleChoose = (placeId: string, value: string): void => {
    setBusyPlace(placeId);
    setMessage(placeId, null);
    void window.donel.accounts
      .switchRemote(placeId, value === NO_ACCOUNT ? null : value)
      .then((outcome) => {
        if (outcome.kind === 'failed') setMessage(placeId, REMOTE_FAILURE_LABEL[outcome.reason]);
      })
      .finally(() => setBusyPlace(null));
  };

  const saveRemotes = (remotes: readonly RemotePlace[]): Promise<void> =>
    window.donel.accounts.setConfig({ remotes }).then(() => {
      void window.donel.accounts.list();
    });

  const handleAdd = (): void => {
    const label = newLabel.trim();
    const sshTarget = newTarget.trim();
    if (!label || !sshTarget) {
      setAddError('Preencha o nome e o destino do ssh.');
      return;
    }
    const id = `${label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'lugar'}-${Date.now().toString(36)}`;
    const next: RemotePlace[] = [...view.remotes.map(({ reach: _reach, ...place }) => place), { id, label, sshTarget, activeAccountId: null }];
    void window.donel.accounts.setConfig({ remotes: next }).then((config) => {
      if (!config.remotes.some((place) => place.id === id)) {
        setAddError('Destino inválido. Use usuario@host, sem espaços.');
        return;
      }
      setNewLabel('');
      setNewTarget('');
      setAddError(null);
      setAdding(false);
      void window.donel.accounts.list();
    });
  };

  const handleRemove = (placeId: string): void => {
    void saveRemotes(view.remotes.filter((place) => place.id !== placeId).map(({ reach: _reach, ...place }) => place));
  };

  return (
    <div className={styles.connectSection} data-testid="accounts-remotes">
      <p className={styles.hint}>
        Lugares remotos: cada um usa a sua conta, e uma conta nunca fica em dois lugares ao mesmo tempo. A troca automática
        vale para eles também.
      </p>

      <ul className={styles.list}>
        {view.remotes.map((place) => {
          const options = [
            { value: NO_ACCOUNT, label: 'Nenhuma (lugar sem conta)' },
            ...ownAccounts
              .filter((account) => account.id === place.activeAccountId || (!account.active && account.heldBy === undefined))
              .map((account) => ({ value: account.id, label: account.label })),
          ];
          return (
            <li key={place.id} className={styles.row} data-testid="remote-place-row">
              <div className={styles.rowMain}>
                <span className={styles.label}>
                  {place.label} · {place.sshTarget} · {REACH_LABEL[place.reach]}
                </span>
                <Select
                  value={place.activeAccountId ?? NO_ACCOUNT}
                  options={options}
                  onChange={(value) => handleChoose(place.id, value)}
                  disabled={busyPlace === place.id}
                />
                <Button
                  variant="secondary"
                  data-testid="remote-place-remove"
                  onClick={() => handleRemove(place.id)}
                  disabled={place.activeAccountId !== null || busyPlace === place.id}
                  title={place.activeAccountId !== null ? 'Tire a conta do lugar antes de remover' : undefined}
                >
                  Remover
                </Button>
              </div>
              {busyPlace === place.id ? <p className={styles.hint}>Trocando a conta do lugar…</p> : null}
              {messages[place.id] ? <p className={styles.error}>{messages[place.id]}</p> : null}
            </li>
          );
        })}
      </ul>

      {adding ? (
        <div className={styles.connectSection}>
          <TextInput label="Nome do lugar" value={newLabel} onChange={(event) => setNewLabel(event.target.value)} placeholder="ex.: VPS" />
          <TextInput
            label="Destino do ssh"
            value={newTarget}
            onChange={(event) => setNewTarget(event.target.value)}
            placeholder="usuario@maquina"
            hint="O mesmo que você digita depois de ssh. Precisa entrar sem senha (Tailscale ou chave)."
          />
          {addError ? <p className={styles.error}>{addError}</p> : null}
          <div className={styles.toolbar}>
            <Button variant="primary" data-testid="remote-place-add-confirm" onClick={handleAdd}>
              Adicionar lugar
            </Button>
            <Button variant="secondary" onClick={() => setAdding(false)}>
              Cancelar
            </Button>
          </div>
        </div>
      ) : (
        <Button variant="secondary" data-testid="remote-place-add" onClick={() => setAdding(true)}>
          Adicionar lugar remoto
        </Button>
      )}
    </div>
  );
}
