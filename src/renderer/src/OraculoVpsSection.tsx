import { Button, Select } from '@donel-dev/design-system';
import { useEffect, useState } from 'react';
import type { LedgerRemoteResult, LedgerRemoteState } from '../../shared/ledger/remote';
import styles from './CelularSection.module.css';

// Oráculo na VPS — Preferências → Celular: where the Oráculo Harrow lives. On a remote place (the owner's VPS) it
// keeps working with the PC off; the PC reads and writes through it. Plan: docs/planos/oraculo-na-vps.md.

function statusText(state: LedgerRemoteState): { text: string; ok: boolean } {
  if (state.mode === 'local') {
    if (state.erro) return { text: state.erro, ok: false };
    if (state.espelhoSemModo) return { text: `O registro está em ${state.espelhoSemModo}, mas este PC não está ligado a ele: o Oráculo está só para ler. Traga de volta ou ligue de novo.`, ok: false };
    return { text: 'Neste PC: o Oráculo para quando o PC desliga.', ok: true };
  }
  const where = state.lugarNome ?? state.lugar ?? 'na VPS';
  if (state.conectado) return { text: `Em ${where}: funciona com o PC desligado.`, ok: true };
  return { text: `Em ${where}, mas o PC não está falando com ele agora${state.erro ? ` (${state.erro})` : ''}. Até voltar, o Oráculo fica só para ler.`, ok: false };
}

export function OraculoVpsSection(): React.JSX.Element {
  const [state, setState] = useState<LedgerRemoteState | null>(null);
  const [lugar, setLugar] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    const read = (): void => {
      void window.donel.ledgerRemote.getState().then((next) => {
        if (!alive) return;
        setState(next);
        setLugar((current) => current || next.lugar || next.espelhoSemModo || next.lugares[0]?.id || '');
      });
    };
    read();
    const timer = setInterval(read, 5000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  if (!state) return <p className={styles.muted}>Carregando…</p>;
  const status = statusText(state);

  const run = (action: () => Promise<LedgerRemoteResult>): void => {
    setBusy(true);
    setError(null);
    void action()
      .then((result) => {
        setState(result.state);
        if (!result.ok) setError(result.reason);
      })
      .finally(() => setBusy(false));
  };

  return (
    <div className={styles.section}>
      <p className={status.ok ? styles.status : styles.statusWarn}>{status.text}</p>
      {state.mode === 'local' && !state.espelhoSemModo ? (
        state.lugares.length ? (
          <>
            <Select label="Levar para" value={lugar} options={state.lugares.map((place) => ({ value: place.id, label: place.label }))} onChange={setLugar} />
            <p className={styles.muted}>O registro vai inteiro, como está, e este PC passa a ler e gravar nele. Dá para trazer de volta.</p>
          </>
        ) : (
          <p className={styles.muted}>Cadastre a VPS em Contas → Lugares remotos para poder levar o Oráculo para lá.</p>
        )
      ) : null}
      {error ? <p className={styles.statusWarn}>{error}</p> : null}
      <div style={{ display: 'flex', gap: 8 }}>
        {state.mode === 'local' && !state.espelhoSemModo ? (
          <Button variant="primary" onClick={() => run(() => window.donel.ledgerRemote.move(lugar))} disabled={busy || !lugar}>
            {busy ? 'Levando…' : 'Levar o Oráculo para a VPS'}
          </Button>
        ) : (
          <Button variant="secondary" onClick={() => run(() => window.donel.ledgerRemote.back())} disabled={busy}>
            {busy ? 'Trazendo…' : 'Trazer de volta para este PC'}
          </Button>
        )}
      </div>
    </div>
  );
}
