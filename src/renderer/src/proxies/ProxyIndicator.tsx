// Proxy da vez (specs/018-proxy-da-vez) — the short line in the bar ("Proxy · Portal IA · 320 ms", colored by the
// health of the proxies the machines use now) and the panel it opens: the proxy of each machine with a one-click
// switch (and one for all), the registry with health and keys, what the machines use that is not registered yet,
// and the alert when the proxy in use goes down. Keys only go in; nothing here ever reads one back.

import { Button, Modal, Select, TextInput } from '@donel-dev/design-system';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { MachineId, MachineView, ProxiesViewDto, ProxyKind, ProxyView } from '../../../shared/proxies';
import healthStyles from '../health/HealthIndicator.module.css';
import { downAlerts, downDetail, formatClock, formatProxyIndicator, guessLabel, healthText, indicatorTone, keyResultText, proxyOf, switchOutcomeText, type IndicatorTone } from './proxyFormat';
import styles from './ProxyIndicator.module.css';

const TONE_CLASS: Record<IndicatorTone, string | undefined> = {
  ok: healthStyles.ok,
  warn: healthStyles.warn,
  critical: healthStyles.critical,
  unknown: healthStyles.unknown,
};

const KIND_OPTIONS = [
  { value: 'gateway', label: 'Gateway de contas num PC' },
  { value: 'portal', label: 'Portal de API' },
];

function proxyTone(proxy: ProxyView | undefined): string | undefined {
  if (!proxy) return healthStyles.unknown;
  if (proxy.health.status === 'up') return healthStyles.ok;
  if (proxy.health.status === 'down') return healthStyles.critical;
  return healthStyles.unknown;
}

interface EditState {
  readonly id: string | null;
  readonly label: string;
  readonly kind: ProxyKind;
  readonly baseUrl: string;
  readonly machines: readonly MachineId[];
}

/** Editing the address of a proxy that has an address drops its keys (proxy-service `upsert`). */
function addressChangesKeys(view: ProxiesViewDto | null, edit: EditState): boolean {
  if (!edit.id || !view) return false;
  const current = view.proxies.find((proxy) => proxy.entry.id === edit.id);
  if (!current?.entry.baseUrl || current.keyFor.length === 0) return false;
  return edit.baseUrl.trim().replace(/\/+$/, '') !== current.entry.baseUrl;
}

const EMPTY_EDIT: EditState = { id: null, label: '', kind: 'gateway', baseUrl: '', machines: [] };

export function ProxyIndicator(): React.JSX.Element | null {
  const api = window.donel?.proxies;
  const [view, setView] = useState<ProxiesViewDto | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [messages, setMessages] = useState<readonly string[]>([]);
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [edit, setEdit] = useState<EditState | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [keyDraft, setKeyDraft] = useState<{ proxyId: string; machineId: MachineId; value: string } | null>(null);

  useEffect(() => {
    if (!api) return undefined;
    let alive = true;
    void api.view().then((initial) => {
      if (alive && initial) setView(initial);
    });
    const unsubscribe = api.onChanged((next) => setView(next));
    return () => {
      alive = false;
      unsubscribe();
    };
  }, [api]);

  const say = useCallback((...lines: string[]) => setMessages(lines.filter(Boolean)), []);

  const refresh = useCallback(async () => {
    if (!api) return;
    setBusy('refresh');
    try {
      setView(await api.refresh());
    } finally {
      setBusy(null);
    }
  }, [api]);

  const openPanel = useCallback(() => {
    setOpen(true);
    say();
    void refresh();
  }, [refresh, say]);

  const close = useCallback(() => {
    setOpen(false);
    setEdit(null);
    setKeyDraft(null);
  }, []);

  const switchMachine = useCallback(
    async (machine: MachineView, proxyId: string) => {
      if (!api) return;
      setBusy(`switch:${machine.id}`);
      try {
        const outcome = await api.switch(machine.id, proxyId);
        say(switchOutcomeText(outcome, view, machine.label));
        // The picked option was the one just applied: the select goes back to "the other one".
        setPicked(({ [machine.id]: _done, ...rest }) => rest);
      } finally {
        setBusy(null);
      }
    },
    [api, say, view],
  );

  const switchAll = useCallback(
    async (proxyId: string) => {
      if (!api || !view) return;
      setBusy('switch:all');
      try {
        const outcomes = await api.switchAll(proxyId);
        setPicked({});
        say(...outcomes.map((outcome) => switchOutcomeText(outcome, view, view.machines.find((m) => m.id === outcome.machineId)?.label ?? outcome.machineId)));
      } finally {
        setBusy(null);
      }
    },
    [api, say, view],
  );

  const saveEdit = useCallback(async () => {
    if (!api || !edit) return;
    const result = await api.upsert({ id: edit.id ?? undefined, label: edit.label, kind: edit.kind, baseUrl: edit.baseUrl.trim() || null, machines: edit.machines });
    if (result.kind === 'ok') {
      setEdit(null);
      setEditError(null);
    } else {
      setEditError(result.field === 'baseUrl' ? 'Endereço inválido: use http(s)://host[:porta], sem usuário nem senha.' : result.field === 'label' ? 'Dê um nome (até 60 letras).' : 'Não deu para salvar.');
    }
  }, [api, edit]);

  const saveKey = useCallback(async () => {
    if (!api || !keyDraft) return;
    const result = await api.setKey(keyDraft.proxyId, keyDraft.machineId, keyDraft.value);
    const text = keyResultText(result);
    if (text) say(text);
    else {
      setKeyDraft(null);
      say('Chave guardada no cofre do app.');
    }
  }, [api, keyDraft, say]);

  const importKey = useCallback(
    async (proxyId: string, machine: MachineView) => {
      if (!api) return;
      setBusy(`import:${proxyId}:${machine.id}`);
      try {
        const text = keyResultText(await api.importKey(proxyId, machine.id));
        say(text ? `${machine.label}: ${text}` : `${machine.label}: chave importada para o cofre do app.`);
      } finally {
        setBusy(null);
      }
    },
    [api, say],
  );

  /** Registers an address a machine uses and brings the key that machine already has. */
  const adopt = useCallback(
    async (machine: MachineView) => {
      if (!api || !machine.baseUrl) return;
      const guess = guessLabel(machine.baseUrl, machine.label);
      const result = await api.upsert({ label: guess.label, kind: guess.kind, baseUrl: machine.baseUrl, machines: [] });
      if (result.kind !== 'ok') {
        say('Não deu para cadastrar esse endereço.');
        return;
      }
      await importKey(result.id, machine);
    },
    [api, importKey, say],
  );

  const remove = useCallback(
    async (proxy: ProxyView) => {
      if (!api) return;
      setView(await api.remove(proxy.entry.id));
    },
    [api],
  );

  const alerts = useMemo(() => (view ? downAlerts(view) : []), [view]);
  const unregistered = useMemo(() => (view ? view.machines.filter((m) => m.reach === 'ok' && m.baseUrl && !m.currentProxyId) : []), [view]);
  /** "Todas": only proxies every machine can take now. */
  const allChoices = useMemo(
    () => (view ? view.proxies.filter((proxy) => view.machines.length > 0 && view.machines.every((m) => m.choices.includes(proxy.entry.id))) : []),
    [view],
  );

  if (!api) return null;

  const tone = indicatorTone(view);
  const local = view?.machines.find((m) => m.id === 'local');
  const localCurrent = view && local ? proxyOf(view, local.currentProxyId) : undefined;

  return (
    <>
      <button
        type="button"
        className={[healthStyles.indicator, TONE_CLASS[tone]].filter(Boolean).join(' ')}
        onClick={openPanel}
        data-testid="proxy-indicator"
        data-tone={tone}
        title={localCurrent ? `Proxy deste computador: ${localCurrent.entry.label} (${healthText(localCurrent)})` : 'Proxy da vez'}
      >
        <span className={healthStyles.dot} aria-hidden="true" />
        {formatProxyIndicator(view)}
        {alerts.length > 0 ? <span className={styles.alertMark}> · {alerts.length === 1 ? '1 máquina sem saída' : `${alerts.length} máquinas sem saída`}</span> : null}
      </button>

      <Modal
        open={open}
        onClose={close}
        title="Proxy da vez"
        actions={
          <>
            <Button variant="secondary" onClick={() => setEdit(EMPTY_EDIT)} disabled={edit !== null}>
              Novo proxy
            </Button>
            <Button variant="secondary" onClick={() => void refresh()} disabled={busy === 'refresh'}>
              {busy === 'refresh' ? 'Lendo…' : 'Atualizar'}
            </Button>
            <Button variant="primary" onClick={close}>
              Fechar
            </Button>
          </>
        }
      >
        <div className={healthStyles.body} data-testid="proxy-panel">
          {!view ? <p className={healthStyles.muted}>Lendo as máquinas…</p> : null}
          {view && !view.vaultAvailable ? <p className={styles.warnLine}>O cofre do app não está disponível: dá para ver, mas não para guardar chave nem trocar.</p> : null}

          {alerts.map((alert) => (
            <div key={alert.machine.id} className={[healthStyles.finding, healthStyles.critical].join(' ')} data-testid={`proxy-alert-${alert.machine.id}`}>
              <div className={healthStyles.findingHead}>
                <span className={healthStyles.dot} aria-hidden="true" />
                <strong>
                  {alert.machine.label}: {alert.current.entry.label} está fora
                </strong>
              </div>
              <span className={healthStyles.detail}>
                {downDetail(alert.current)} {alert.suggestion ? `${alert.suggestion.entry.label} está de pé.` : 'Nenhum outro proxy configurado para esta máquina está de pé agora.'}
              </span>
              {alert.suggestion ? (
                <div>
                  <Button variant="primary" onClick={() => void switchMachine(alert.machine, alert.suggestion!.entry.id)} disabled={busy !== null}>
                    Trocar para {alert.suggestion.entry.label}
                  </Button>
                </div>
              ) : null}
            </div>
          ))}

          {messages.length > 0 ? (
            <div className={styles.messages} data-testid="proxy-messages">
              {messages.map((line) => (
                <p key={line} className={healthStyles.message}>
                  {line}
                </p>
              ))}
            </div>
          ) : null}

          {view ? (
            <section>
              <h3 className={healthStyles.heading}>Em cada máquina</h3>
              <div className={styles.machines}>
                {view.machines.map((machine) => {
                  const current = proxyOf(view, machine.currentProxyId);
                  const options = machine.choices.map((id) => ({ value: id, label: proxyOf(view, id)?.entry.label ?? id }));
                  const choice = picked[machine.id] ?? options.find((o) => o.value !== machine.currentProxyId)?.value ?? '';
                  return (
                    <div key={machine.id} className={styles.machineRow} data-testid={`proxy-machine-${machine.id}`}>
                      <span className={[styles.machineName, proxyTone(current)].filter(Boolean).join(' ')}>
                        <span className={healthStyles.dot} aria-hidden="true" />
                        <strong>{machine.label}</strong>
                      </span>
                      <span className={styles.machineCurrent}>
                        {machine.reach === 'unreachable'
                          ? `sem conexão${machine.baseUrl ? ` · por último em ${current?.entry.label ?? machine.baseUrl}` : ''}`
                          : machine.reach === 'unknown'
                            ? 'lendo…'
                            : current
                              ? `${current.entry.label} · ${healthText(current)}`
                              : machine.baseUrl
                                ? `${machine.baseUrl} (fora do cadastro)`
                                : 'direto na Anthropic'}
                      </span>
                      {options.length > 0 ? (
                        <span className={styles.machineSwitch}>
                          <Select value={choice} options={options} onChange={(value) => setPicked((prev) => ({ ...prev, [machine.id]: value }))} disabled={busy !== null} />
                          <Button
                            variant="secondary"
                            onClick={() => void switchMachine(machine, choice)}
                            disabled={!choice || busy !== null || machine.reach === 'unreachable'}
                            data-testid={`proxy-switch-${machine.id}`}
                          >
                            {busy === `switch:${machine.id}` ? 'Trocando…' : 'Trocar'}
                          </Button>
                        </span>
                      ) : (
                        <span className={healthStyles.muted}>nenhum proxy pronto para esta máquina</span>
                      )}
                    </div>
                  );
                })}
                {allChoices.length > 0 && view.machines.length > 1 ? (
                  <div className={styles.machineRow} data-testid="proxy-machine-all">
                    <span className={styles.machineName}>
                      <strong>Todas as máquinas</strong>
                    </span>
                    <span className={styles.machineCurrent}>uma por vez; a que falhar fica como estava</span>
                    <span className={styles.machineSwitch}>
                      <Select
                        value={picked.all ?? allChoices[0]!.entry.id}
                        options={allChoices.map((proxy) => ({ value: proxy.entry.id, label: proxy.entry.label }))}
                        onChange={(value) => setPicked((prev) => ({ ...prev, all: value }))}
                        disabled={busy !== null}
                      />
                      <Button variant="secondary" onClick={() => void switchAll(picked.all ?? allChoices[0]!.entry.id)} disabled={busy !== null} data-testid="proxy-switch-all">
                        {busy === 'switch:all' ? 'Trocando…' : 'Trocar todas'}
                      </Button>
                    </span>
                  </div>
                ) : null}
              </div>
            </section>
          ) : null}

          {unregistered.length > 0 ? (
            <section>
              <h3 className={healthStyles.heading}>Achados nas máquinas</h3>
              {unregistered.map((machine) => (
                <div key={machine.id} className={styles.found} data-testid={`proxy-found-${machine.id}`}>
                  <span>
                    {machine.label} usa <code>{machine.baseUrl}</code>, que não está no cadastro.
                  </span>
                  <Button variant="secondary" onClick={() => void adopt(machine)} disabled={busy !== null}>
                    Cadastrar e importar a chave
                  </Button>
                </div>
              ))}
            </section>
          ) : null}

          {edit ? (
            <section className={styles.editor} data-testid="proxy-editor">
              <h3 className={healthStyles.heading}>{edit.id ? 'Editar proxy' : 'Novo proxy'}</h3>
              <TextInput label="Nome" value={edit.label} onChange={(e) => setEdit({ ...edit, label: e.target.value })} />
              <Select label="Tipo" value={edit.kind} options={KIND_OPTIONS} onChange={(value) => setEdit({ ...edit, kind: value as ProxyKind })} />
              <TextInput
                label="Endereço"
                placeholder="https://host ou http://host:porta"
                value={edit.baseUrl}
                onChange={(e) => setEdit({ ...edit, baseUrl: e.target.value })}
                hint={editError ?? (addressChangesKeys(view, edit) ? 'Ao salvar, as chaves guardadas deste proxy saem: eram do endereço antigo.' : 'Vazio = ainda não configurado.')}
                hintTone={editError ? 'danger' : 'muted'}
              />
              {view ? (
                <div className={styles.machineChecks}>
                  <span className={healthStyles.muted}>Quais máquinas podem usar (nenhuma marcada = todas):</span>
                  {view.machines.map((machine) => (
                    <label key={machine.id} className={styles.check}>
                      <input
                        type="checkbox"
                        checked={edit.machines.includes(machine.id)}
                        onChange={(e) =>
                          setEdit({ ...edit, machines: e.target.checked ? [...edit.machines, machine.id] : edit.machines.filter((id) => id !== machine.id) })
                        }
                      />
                      {machine.label}
                    </label>
                  ))}
                </div>
              ) : null}
              <div className={styles.row}>
                <Button variant="primary" onClick={() => void saveEdit()}>
                  Salvar
                </Button>
                <Button variant="ghost" onClick={() => (setEdit(null), setEditError(null))}>
                  Cancelar
                </Button>
              </div>
            </section>
          ) : null}

          {view ? (
            <section>
              <h3 className={healthStyles.heading}>Cadastro</h3>
              <div className={styles.proxies}>
                {view.proxies.map((proxy) => (
                  <div key={proxy.entry.id} className={[healthStyles.remote, proxyTone(proxy)].filter(Boolean).join(' ')} data-testid={`proxy-entry-${proxy.entry.id}`}>
                    <div className={healthStyles.findingHead}>
                      <span className={healthStyles.dot} aria-hidden="true" />
                      <strong>{proxy.entry.label}</strong>
                      <span className={healthStyles.muted}>{proxy.entry.kind === 'portal' ? 'portal' : 'gateway'}</span>
                      <span className={healthStyles.badge}>{healthText(proxy)}</span>
                    </div>
                    <dl className={healthStyles.numbers}>
                      <dt>Endereço</dt>
                      <dd>{proxy.entry.baseUrl ?? 'falta configurar'}</dd>
                      {proxy.health.checkedAt ? (
                        <>
                          <dt>Sonda</dt>
                          <dd>
                            {formatClock(proxy.health.checkedAt)}
                            {proxy.health.httpStatus ? ` · HTTP ${proxy.health.httpStatus}` : ''} · repete a cada minuto
                          </dd>
                        </>
                      ) : null}
                      {proxy.health.lastError && proxy.health.lastErrorAt ? (
                        <>
                          <dt>Último erro</dt>
                          <dd>
                            {proxy.health.lastError} às {formatClock(proxy.health.lastErrorAt)}
                          </dd>
                        </>
                      ) : null}
                      <dt>Chave</dt>
                      <dd className={styles.keys}>
                        {view.machines
                          .filter((machine) => proxy.entry.machines.length === 0 || proxy.entry.machines.includes(machine.id))
                          .map((machine) => {
                            const has = proxy.keyFor.includes(machine.id);
                            const usingNow = machine.currentProxyId === proxy.entry.id;
                            const drafting = keyDraft?.proxyId === proxy.entry.id && keyDraft.machineId === machine.id;
                            return (
                              <span key={machine.id} className={styles.keyRow}>
                                <span>
                                  {machine.label}: {has ? 'no cofre' : 'falta'}
                                </span>
                                {drafting ? (
                                  <>
                                    <TextInput
                                      type="password"
                                      autoComplete="off"
                                      placeholder="cole a chave"
                                      value={keyDraft.value}
                                      onChange={(e) => setKeyDraft({ ...keyDraft, value: e.target.value })}
                                    />
                                    <Button variant="secondary" onClick={() => void saveKey()} disabled={!keyDraft.value.trim()}>
                                      Guardar
                                    </Button>
                                    <Button variant="ghost" onClick={() => setKeyDraft(null)}>
                                      Cancelar
                                    </Button>
                                  </>
                                ) : (
                                  <>
                                    <Button variant="link" onClick={() => setKeyDraft({ proxyId: proxy.entry.id, machineId: machine.id, value: '' })}>
                                      {has ? 'trocar' : 'colar'}
                                    </Button>
                                    {usingNow && proxy.entry.baseUrl ? (
                                      <Button variant="link" onClick={() => void importKey(proxy.entry.id, machine)} disabled={busy !== null}>
                                        importar desta máquina
                                      </Button>
                                    ) : null}
                                  </>
                                )}
                              </span>
                            );
                          })}
                      </dd>
                    </dl>
                    <div className={styles.row}>
                      <Button
                        variant="link"
                        onClick={() =>
                          setEdit({ id: proxy.entry.id, label: proxy.entry.label, kind: proxy.entry.kind, baseUrl: proxy.entry.baseUrl ?? '', machines: proxy.entry.machines })
                        }
                      >
                        editar
                      </Button>
                      <Button variant="link" onClick={() => void remove(proxy)} disabled={view.machines.some((m) => m.currentProxyId === proxy.entry.id)}>
                        apagar
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ) : null}
        </div>
      </Modal>
    </>
  );
}
