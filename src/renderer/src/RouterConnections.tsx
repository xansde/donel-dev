// Desktop roteador (plano da madrugada 18/11, item 11) — the "Conexões" screen: VPS, proxy, contas and saúde in one
// page. Each block reuses the piece the app already had (the remote places of the accounts panel, the proxy and health
// indicators with their own panels, the providers form); nothing here reads or writes a credential.

import type { AccountsViewDto } from '../../shared';
import { formatAccountLoad } from './accountsFormat';
import { HealthIndicator } from './health/HealthIndicator';
import { ProviderForm } from './ProviderForm';
import { ProxyIndicator } from './proxies/ProxyIndicator';
import { RemotePlacesSection } from './RemotePlacesSection';
import styles from './RouterConnections.module.css';

interface RouterConnectionsProps {
  readonly view: AccountsViewDto;
  readonly onProvidersChanged: () => void;
}

function placeOf(view: AccountsViewDto, accountId: string): string | null {
  if (view.activeAccountId === accountId) return 'em uso neste computador';
  const holder = view.accounts.find((account) => account.id === accountId)?.heldBy;
  if (!holder) return null;
  return `em uso em ${view.remotes.find((remote) => remote.id === holder)?.label ?? holder}`;
}

export function RouterConnections({ view, onProvidersChanged }: RouterConnectionsProps): React.JSX.Element {
  return (
    <div className={styles.page} data-testid="router-connections">
      <section className={styles.block}>
        <h2 className={styles.title}>VPS</h2>
        {view.remotes.length === 0 ? <p className={styles.hint}>Nenhum lugar remoto ainda. Adicione abaixo.</p> : null}
        <RemotePlacesSection view={view} />
      </section>

      <section className={styles.block}>
        <h2 className={styles.title}>Proxy</h2>
        <p className={styles.hint}>Por onde cada máquina chega ao modelo. Clique para ver e trocar.</p>
        <div className={styles.pills}>
          <ProxyIndicator />
        </div>
      </section>

      <section className={styles.block}>
        <h2 className={styles.title}>Contas</h2>
        {view.accounts.length === 0 ? (
          <p className={styles.hint}>Nenhuma conta conectada. Conecte pelo selo da conta, no topo.</p>
        ) : (
          <ul className={styles.list}>
            {view.accounts.map((account) => {
              const where = placeOf(view, account.id);
              return (
                <li key={account.id} className={styles.row} data-testid="router-account-row">
                  <span className={styles.name}>{account.label}</span>
                  <span className={styles.muted}>{formatAccountLoad(account.load)}</span>
                  {where ? <span className={styles.badge}>{where}</span> : null}
                  {account.needsReconnect ? <span className={styles.warn}>reconectar</span> : !account.available ? <span className={styles.warn}>indisponível</span> : null}
                </li>
              );
            })}
          </ul>
        )}
        <p className={styles.hint}>Trocar a conta deste computador ou conectar outra: no selo da conta, no topo.</p>
        <div>
          <ProviderForm onChanged={onProvidersChanged} />
        </div>
      </section>

      <section className={styles.block}>
        <h2 className={styles.title}>Saúde</h2>
        <p className={styles.hint}>Este computador e cada VPS. Clique para ver os detalhes.</p>
        <div className={styles.pills}>
          <HealthIndicator />
        </div>
      </section>
    </div>
  );
}
