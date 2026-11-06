import { Button, TextInput } from '@donel-dev/design-system';
import { useEffect, useState } from 'react';
import type { LedgerMirrorState } from '../../shared/ledger/mirror';
import styles from './CelularSection.module.css';

// Espelho do Oráculo — Preferências → Celular: the tasks of the Oráculo copied to the owner's personal Supabase,
// so nothing is lost with the PC and the history opens anywhere. The key is write-only: it goes to the app's vault
// and never comes back here.

function when(iso: string | null): string {
  if (!iso) return 'nunca';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

function statusText(state: LedgerMirrorState): { text: string; ok: boolean } {
  if (!state.enabled) return { text: 'Desligado: as tarefas ficam só neste PC.', ok: false };
  if (state.lastError) return { text: `Não consegui enviar (${state.lastError}). Tento de novo sozinho.`, ok: false };
  if (state.pending) return { text: `Uma mudança espera para ir. Último envio: ${when(state.lastSyncAt)}.`, ok: true };
  return { text: `Ligado. Último envio: ${when(state.lastSyncAt)}.`, ok: true };
}

export function EspelhoSection(): React.JSX.Element {
  const [state, setState] = useState<LedgerMirrorState | null>(null);
  const [url, setUrl] = useState('');
  const [key, setKey] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    void window.donel.ledgerMirror.getState().then((next) => {
      if (!alive) return;
      setState(next);
      setUrl(next.url ?? '');
    });
    return () => {
      alive = false;
    };
  }, []);

  if (!state) return <p className={styles.muted}>Carregando…</p>;
  const status = statusText(state);

  const save = (): void => {
    setBusy(true);
    setError(null);
    void window.donel.ledgerMirror
      .configure(url.trim(), key)
      .then((result) => {
        if (!result.ok) setError(result.reason);
        else setKey('');
        return window.donel.ledgerMirror.getState().then(setState);
      })
      .finally(() => setBusy(false));
  };

  const run = (action: 'syncNow' | 'disable'): void => {
    setBusy(true);
    void window.donel.ledgerMirror[action]()
      .then(setState)
      .finally(() => setBusy(false));
  };

  return (
    <div className={styles.section}>
      <p className={status.ok ? styles.status : styles.statusWarn}>{status.text}</p>
      <TextInput label="Endereço do projeto" placeholder="https://seu-projeto.supabase.co" value={url} onChange={(event) => setUrl(event.target.value)} />
      <TextInput
        label="Chave de serviço"
        type="password"
        value={key}
        onChange={(event) => setKey(event.target.value)}
        placeholder={state.keyConfigured ? 'guardada no cofre; preencha só para trocar' : 'cole a chave de serviço'}
      />
      {error ? <p className={styles.statusWarn}>{error}</p> : null}
      <div style={{ display: 'flex', gap: 8 }}>
        <Button variant="primary" onClick={save} disabled={busy || !url.trim() || (!key && !state.keyConfigured)}>
          {state.enabled ? 'Salvar' : 'Ligar'}
        </Button>
        {state.enabled ? (
          <>
            <Button variant="secondary" onClick={() => run('syncNow')} disabled={busy}>
              Enviar agora
            </Button>
            <Button variant="secondary" onClick={() => run('disable')} disabled={busy}>
              Desligar
            </Button>
          </>
        ) : null}
      </div>
    </div>
  );
}
