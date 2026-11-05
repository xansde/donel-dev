import { Button, Toggle } from '@donel-dev/design-system';
import { useEffect, useState } from 'react';
import type { CelularFirewallRule, CelularPairing, CelularState, CelularTailnet } from '../../shared/celular';
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

/** O que a tela diz dos celulares na Tailscale, com o passo seguinte quando não há nenhum. */
function tailnetText(tailnet: CelularTailnet | null): { text: string; ok: boolean } {
  if (tailnet === null) return { text: 'Procurando celulares na sua Tailscale…', ok: true };
  if (!tailnet.readable) return { text: 'Não consegui perguntar à Tailscale deste PC quais celulares estão nela.', ok: false };
  if (tailnet.phones.length === 0) {
    return {
      text: 'Nenhum celular na sua Tailscale ainda. Instale o app Tailscale no celular (Play Store ou App Store), entre com a mesma conta da Tailscale deste PC e deixe-o conectado; ele aparece aqui.',
      ok: false,
    };
  }
  const names = tailnet.phones.map((phone) => `${phone.name} (${phone.online ? 'conectado' : 'desconectado'})`).join(', ');
  const anyOnline = tailnet.phones.some((phone) => phone.online);
  return {
    text: anyOnline ? `Celular na sua Tailscale: ${names}.` : `Celular na sua Tailscale, mas desconectado: ${names}. Abra o app Tailscale nele e ligue.`,
    ok: anyOnline,
  };
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
  const [tailnet, setTailnet] = useState<CelularTailnet | null>(null);
  /** "O celular não abriu?": `null` = o dono não perguntou; senão o que o firewall diz. */
  const [firewall, setFirewall] = useState<CelularFirewallRule | 'checking' | 'asking' | null>(null);
  const [firewallError, setFirewallError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void window.donel.celular.getState().then((next) => {
      if (alive) setState(next);
    });
    return () => {
      alive = false;
    };
  }, []);

  // Quem está na Tailscale: ao abrir, e de novo a cada 5 s enquanto ligado (o dono pode estar instalando o app agora).
  const enabled = state?.enabled === true;
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const read = (): void => {
      void window.donel.celular.tailnet().then((next) => {
        if (alive) setTailnet(next);
      });
    };
    read();
    const timer = window.setInterval(read, 5000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [enabled]);

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

  const checkFirewall = (): void => {
    setFirewall('checking');
    setFirewallError(null);
    void window.donel.celular.firewall().then(setFirewall);
  };

  const allowFirewall = (): void => {
    setFirewall('asking');
    setFirewallError(null);
    void window.donel.celular.allowFirewall().then((result) => {
      if (!result.ok) setFirewallError(result.reason);
      return window.donel.celular.firewall().then(setFirewall);
    });
  };

  const pair = (): void => {
    setBusy(true);
    setPairError(null);
    setFirewall(null);
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
          <div className={styles.before}>
            <p className={styles.beforeTitle}>Antes de parear</p>
            <p className={styles.muted}>
              O celular só alcança este PC pela Tailscale. Instale nele o app Tailscale e entre com a mesma conta da Tailscale deste PC; sem
              isso o link do QR não abre (“Não é possível acessar esse site”), mesmo no mesmo Wi-Fi.
            </p>
            <p className={tailnetText(tailnet).ok ? styles.status : styles.statusWarn} data-testid="celular-tailnet">
              {tailnetText(tailnet).text}
            </p>
          </div>
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
                <li>No celular, abra o app Tailscale e confira que está conectado.</li>
                <li>Aponte a câmera para o QR e abra o link.</li>
                <li>No navegador do celular, “Adicionar à tela inicial”.</li>
              </ol>
              <p className={styles.muted}>
                Vale uma vez, até {when(pairing.expiresAt)}. Link: <span className={styles.url}>{pairing.url}</span>
              </p>
              <div className={styles.firewall}>
                {firewall === null ? (
                  <div>
                    <Button variant="ghost" onClick={checkFirewall}>
                      O celular não abriu a página?
                    </Button>
                  </div>
                ) : firewall === 'checking' ? (
                  <p className={styles.muted}>Conferindo o Firewall do Windows…</p>
                ) : firewall === 'asking' ? (
                  <p className={styles.muted}>Aceite o pedido de administrador do Windows para criar a regra.</p>
                ) : firewall === 'present' ? (
                  <p className={styles.muted}>
                    O Firewall do Windows já deixa o celular entrar. Confira se o app Tailscale do celular está conectado e na mesma conta, e tente o
                    link de novo.
                  </p>
                ) : firewall === 'absent' ? (
                  <>
                    <p className={styles.muted}>
                      Com o celular na Tailscale, o que ainda pode barrar é o Firewall do Windows. A regra deixa entrar só na porta do app e só de quem
                      está na sua Tailscale; o Windows pede sua confirmação de administrador.
                    </p>
                    <div>
                      <Button variant="secondary" onClick={allowFirewall}>
                        Liberar no Firewall do Windows
                      </Button>
                    </div>
                  </>
                ) : (
                  <p className={styles.muted}>Não consegui ler o Firewall do Windows. Confira se o app Tailscale do celular está conectado.</p>
                )}
                {firewallError ? <p className={styles.statusWarn}>{firewallError}</p> : null}
              </div>
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
