import { Button, Toggle } from '@donel-dev/design-system';
import { useEffect, useState } from 'react';
import type { CelularPairing, CelularState } from '../../shared/celular';
import styles from './CelularSection.module.css';

// Ledger no celular — Preferências → Celular: ligar a PWA (só na Tailscale), parear um celular pelo QR e
// revogar os pareados. O token de cada celular nunca chega aqui; só nome e datas.

function statusText(state: CelularState): string {
  switch (state.status) {
    case 'listening':
      return `No ar em ${state.url ?? ''}, só pela sua Tailscale.`;
    case 'no-tailscale':
      return 'A Tailscale não está ligada neste PC. O app do celular sobe sozinho quando ela ligar.';
    case 'error':
      return state.error ?? 'O servidor do celular não subiu.';
    default:
      return 'Desligado.';
  }
}

function when(iso: string | null): string {
  if (!iso) return 'nunca';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

export function CelularSection(): React.JSX.Element {
  const [state, setState] = useState<CelularState | null>(null);
  const [pairing, setPairing] = useState<CelularPairing | null>(null);
  const [pairError, setPairError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    void window.donel.celular.getState().then((next) => {
      if (alive) setState(next);
    });
    return () => {
      alive = false;
    };
  }, []);

  // O convite vence em 10 minutos e o pareamento some da tela quando o celular entra.
  useEffect(() => {
    if (!pairing) return;
    const timer = window.setInterval(() => {
      if (Date.now() > Date.parse(pairing.expiresAt)) setPairing(null);
      void window.donel.celular.getState().then((next) => {
        setState((previous) => {
          if (previous && next.devices.length > previous.devices.length) setPairing(null);
          return next;
        });
      });
    }, 3000);
    return () => window.clearInterval(timer);
  }, [pairing]);

  if (!state) return <p className={styles.muted}>Carregando…</p>;

  const toggle = (enabled: boolean): void => {
    setBusy(true);
    setPairing(null);
    void window.donel.celular
      .setEnabled(enabled)
      .then(setState)
      .finally(() => setBusy(false));
  };

  const pair = (): void => {
    setBusy(true);
    setPairError(null);
    void window.donel.celular
      .pair()
      .then((result) => {
        if (result.ok) setPairing(result.pairing);
        else setPairError(result.reason);
        return window.donel.celular.getState().then(setState);
      })
      .finally(() => setBusy(false));
  };

  return (
    <div className={styles.section}>
      <Toggle
        checked={state.enabled}
        disabled={busy}
        onChange={toggle}
        label="App do celular para validar entregas"
        description="Só pela sua rede Tailscale: nada sai para a internet e o ledger continua neste PC."
      />
      {state.enabled ? <p className={state.status === 'listening' ? styles.status : styles.statusWarn}>{statusText(state)}</p> : null}

      {state.enabled ? (
        <div className={styles.pairBlock}>
          <div>
            <Button variant="secondary" onClick={pair} disabled={busy || state.status !== 'listening'}>
              Parear um celular
            </Button>
          </div>
          {pairError ? <p className={styles.statusWarn}>{pairError}</p> : null}
          {pairing ? (
            <div className={styles.pairing}>
              <img className={styles.qr} src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(pairing.qrSvg)}`} alt="QR para parear o celular" />
              <ol className={styles.steps}>
                <li>Ligue a Tailscale no celular.</li>
                <li>Aponte a câmera para o QR e abra o link.</li>
                <li>No navegador do celular, “Adicionar à tela inicial”.</li>
              </ol>
              <p className={styles.muted}>
                Vale uma vez, até {when(pairing.expiresAt)}. Link: <span className={styles.url}>{pairing.url}</span>
              </p>
            </div>
          ) : null}
        </div>
      ) : null}

      {state.devices.length > 0 ? (
        <ul className={styles.devices} aria-label="Celulares pareados">
          {state.devices.map((device) => (
            <li key={device.id} className={styles.device}>
              <span className={styles.deviceName}>{device.name}</span>
              <span className={styles.muted}>
                pareado {when(device.pairedAt)} · visto {when(device.lastSeenAt)}
              </span>
              <Button variant="danger" onClick={() => void window.donel.celular.revoke(device.id).then(setState)}>
                Revogar
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
