import { Button, Select, TextInput } from '@donel-dev/design-system';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { EsteiraSnapshotDto } from '../../../shared/esteira/ipc';
import {
  cardContent,
  cardView,
  dispatchView,
  formatTimestamp,
  ingestErrorLine,
  lockView,
  phaseLines,
  STORE_COMPATIBILITY_WARNING,
  type SignalTone,
} from './esteiraView';
import styles from './EsteiraScreen.module.css';

// Spec 010 — a tela da esteira nova. Ela é PROJEÇÃO do snapshot que o main
// deriva (D-13): não lê disco, não calcula macro etapa, não completa lacuna.
// O que não está no snapshot não aparece — e o que está e é ruim (falha de
// leitura, fase que falhou, trava presa) aparece com todas as letras.
//
// Nasce AO LADO do mapa atual (`[P-5]`), atrás de um gesto interno, para dar
// para comparar os dois com o mesmo dado antes de aposentar o antigo.

export interface EsteiraScreenProps {
  onClose: () => void;
}

/** Tom do sinal → classe. Mapa explícito: nada de montar nome de classe por template. */
const SIGNAL_CLASS: Readonly<Record<SignalTone, string>> = {
  neutral: styles.signalNeutral,
  attention: styles.signalAttention,
  error: styles.signalError,
};

export function EsteiraScreen({ onClose }: EsteiraScreenProps): JSX.Element {
  const [state, setState] = useState<EsteiraSnapshotDto | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [newTitle, setNewTitle] = useState('');
  const [newRepo, setNewRepo] = useState('');
  const [phase, setPhase] = useState('discovery');
  /** O assunto escolhido para o disparo. `null` = o primeiro que a fase comporta. */
  const [targetKey, setTargetKey] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    void window.donel.esteira.snapshot().then(setState);
    // Um evento só cobre os três caminhos de mudança (ingestão, gesto, outro canal).
    return window.donel.esteira.onChanged(setState);
  }, []);

  const snapshot = state?.snapshot ?? null;
  const cards = snapshot?.discoveries ?? [];
  const selected = useMemo(() => (snapshot && selectedId ? cardView(snapshot, selectedId) : null), [snapshot, selectedId]);
  const lock = useMemo(() => (selected === null ? null : lockView(selected)), [selected]);
  const content = useMemo(() => (selected === null ? null : cardContent(selected)), [selected]);
  // Quem decide o que está habilitado e com que razão é a camada pura — o JSX
  // abaixo só desenha o que sai daqui.
  const dispatch = useMemo(
    () => (selected === null ? null : dispatchView(selected, { phase, targetKey })),
    [selected, phase, targetKey],
  );
  const warning = state === null ? null : STORE_COMPATIBILITY_WARNING[state.compatibility];
  const readOnly = state !== null && state.compatibility !== 'read-write';

  const handleCreate = useCallback(async () => {
    const title = newTitle.trim();
    if (title.length === 0) return;
    const created = await window.donel.esteira.createDiscovery({
      title,
      problem: null,
      targetRepo: newRepo.trim() || null,
      scopeRepos: [],
      tracker: null,
    });
    setState(created.state);
    if (created.ok) {
      setSelectedId(created.discoveryId);
      setNewTitle('');
      setMessage(null);
    } else {
      setMessage('Não deu para criar: o histórico não aceita escrita agora.');
    }
  }, [newTitle, newRepo]);

  const handleDispatch = useCallback(async () => {
    // O botão já está desabilitado quando não dá; esta guarda existe para o
    // caminho de teclado e para não haver DOIS lugares decidindo a mesma coisa.
    if (dispatch === null || !dispatch.canDispatch || dispatch.target === null) return;
    const target = dispatch.target;
    const dispatched = await window.donel.esteira.dispatch({
      phase: dispatch.phase.phase,
      discoveryId: target.discoveryId,
      // O assunto vai EXPLÍCITO: a fase de um item leva o item (e o plano dele);
      // a fase de um plano leva o plano. Era daqui que saía o `plan_id: null`
      // num disparo de fase "Plano".
      planId: target.planId,
      workItemId: target.workItemId,
      // D-6 — o alvo é explícito: o do item, ou o herdado do card. Nunca o projeto em foco.
      workspace:
        target.targetRepo === null
          ? null
          : { target_repo: target.targetRepo, repo_path: null, worktree_path: null, branch: null },
      continuesSessionId: null,
      handoffReason: null,
    });
    setState(dispatched.state);

    if (dispatched.ok) {
      setMessage(`Fase "${dispatch.phase.phase}" preparada. A skill lê ${dispatched.inputPath} e devolve em ${dispatched.resultPath}.`);
      return;
    }
    if (dispatched.reason === 'locked') {
      setMessage(`Já há uma fase em andamento (${dispatched.lock.phase}), desde ${formatTimestamp(dispatched.lock.acquiredAt)}.`);
      return;
    }
    if (dispatched.reason === 'invalid-target') {
      setMessage(`Não dá para disparar: ${dispatched.issues.map((issue) => issue.code).join(', ')}.`);
      return;
    }
    setMessage('Não deu para disparar: o histórico não aceita escrita agora.');
  }, [dispatch]);

  const handleRelease = useCallback(async () => {
    if (selected?.lock == null) return;
    setState(await window.donel.esteira.releaseLock({ subject: selected.lock.subject, phase: selected.lock.phase }));
    setMessage(null);
  }, [selected]);

  const handleScan = useCallback(async () => {
    const scanned = await window.donel.esteira.scanOutbox();
    setState(scanned);
    setMessage(
      scanned.rejectedOnLastScan > 0
        ? `${scanned.rejectedOnLastScan} arquivo(s) fora do contrato — os cards mostram o motivo.`
        : 'Nada novo no outbox.',
    );
  }, []);

  return (
    <section className={styles.screen} aria-label="Esteira">
      <header className={styles.header}>
        <div>
          <h2 className={styles.title}>Esteira</h2>
          <p className={styles.subtitle}>
            {cards.length} card(s) · histórico em {state?.storeDir ?? '—'}
          </p>
        </div>
        <div className={styles.headerActions}>
          <Button variant="ghost" onClick={() => void handleScan()}>
            Varrer outbox
          </Button>
          <Button variant="ghost" onClick={onClose}>
            Fechar
          </Button>
        </div>
      </header>

      {warning ? <p className={styles.warning}>{warning}</p> : null}
      {message ? <p className={styles.message}>{message}</p> : null}

      <div className={styles.body}>
        <div className={styles.list}>
          <div className={styles.newCard}>
            <TextInput
              label="Novo discovery"
              value={newTitle}
              onChange={(event) => setNewTitle(event.target.value)}
              placeholder="O que está em jogo?"
              disabled={readOnly}
            />
            <TextInput
              label="Repo alvo (opcional)"
              value={newRepo}
              onChange={(event) => setNewRepo(event.target.value)}
              placeholder="ex.: donel-dev"
              disabled={readOnly}
            />
            <Button onClick={() => void handleCreate()} disabled={readOnly || newTitle.trim().length === 0}>
              Criar
            </Button>
          </div>

          {cards.length === 0 ? (
            <p className={styles.empty}>Nenhum card ainda. O histórico nasce limpo — nada foi importado do modelo antigo.</p>
          ) : null}

          {cards.map((discovery) => {
            const view = snapshot ? cardView(snapshot, discovery.id) : null;
            if (view === null) return null;
            return (
              <button
                type="button"
                key={discovery.id}
                className={[styles.card, selectedId === discovery.id ? styles.cardSelected : ''].filter(Boolean).join(' ')}
                onClick={() => {
                  setSelectedId(discovery.id);
                  setTargetKey(null);
                }}
              >
                <span className={styles.cardTitle}>{discovery.title}</span>
                <span className={styles.cardMeta}>
                  <span className={styles.stage}>{view.stage.shown}</span>
                  {view.stage.overridden ? <span className={styles.stageDerived}>derivada: {view.stage.derived}</span> : null}
                  {discovery.targetRepo ? <span className={styles.repo}>{discovery.targetRepo}</span> : null}
                </span>
                {view.signals.length > 0 ? (
                  <span className={styles.signals}>
                    {view.signals.map((signal) => (
                      <span key={signal.label} className={SIGNAL_CLASS[signal.tone]} title={signal.title}>
                        {signal.label}
                      </span>
                    ))}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>

        <div className={styles.detail}>
          {selected === null ? (
            <p className={styles.empty}>Escolha um card para ver o que aconteceu nele.</p>
          ) : (
            <>
              <h3 className={styles.detailTitle}>{selected.discovery.title}</h3>
              {selected.discovery.problem ? <p className={styles.problem}>{selected.discovery.problem}</p> : null}
              {selected.stage.overridden ? <p className={styles.overrideNote}>Etapa {selected.stage.overrideNote}</p> : null}

              {/* O erro de leitura vem PRIMEIRO: é a informação que o modelo
                  antigo escondia, e a que muda o que o operador faz agora. */}
              {selected.ingestErrors.length > 0 ? (
                <section className={styles.block}>
                  <h4 className={styles.blockTitle}>Não consegui ler</h4>
                  {selected.ingestErrors.map((error) => (
                    <p key={error.resultPath} className={styles.errorLine}>
                      <code>{error.resultPath}</code> — {ingestErrorLine(error)}
                      <br />
                      <span className={styles.hint}>O que a skill fez não se perdeu: o arquivo continua lá, fora do contrato.</span>
                    </p>
                  ))}
                </section>
              ) : null}

              {lock ? (
                <section className={styles.block}>
                  <h4 className={styles.blockTitle}>{lock.title}</h4>
                  <p className={styles.lockLine}>{lock.line}</p>
                  {/* Enquanto o disparo não abre a aba de terminal, a tela diz o
                      que falta fazer — travar o card e ficar calada seria pior
                      do que não travar. */}
                  {lock.nextStep ? (
                    <>
                      <p className={styles.hint}>{lock.nextStep.explanation}</p>
                      <code className={styles.command}>{lock.nextStep.command}</code>
                      <div className={styles.rowActions}>
                        <Button variant="ghost" onClick={() => void window.donel.clipboard.writeText(lock.nextStep!.command)}>
                          Copiar comando
                        </Button>
                        <Button variant="ghost" onClick={() => void handleRelease()} disabled={readOnly}>
                          Liberar
                        </Button>
                      </div>
                    </>
                  ) : (
                    <div className={styles.rowActions}>
                      <Button variant="ghost" onClick={() => void handleRelease()} disabled={readOnly}>
                        Liberar
                      </Button>
                    </div>
                  )}
                </section>
              ) : null}

              <section className={styles.block}>
                <h4 className={styles.blockTitle}>Fases</h4>
                {selected.phases.length === 0 ? (
                  <p className={styles.hint}>Nenhuma fase rodou ainda.</p>
                ) : (
                  <ul className={styles.lines}>
                    {phaseLines(selected).map((entry) => (
                      <li key={entry.key} className={entry.failed ? styles.failed : undefined}>
                        {entry.text}
                        {entry.detail ? <span className={styles.hint}> {entry.detail}</span> : null}
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              {/* Cada linha vem pronta de `cardContent`: montar a frase aqui foi
                  o que fez a lista dizer "sem repo alvo" enquanto o disparo,
                  quatro linhas abaixo, dizia "repo herdado do card" — sobre o
                  mesmo item, na mesma tela (print 16 do roteiro do B2). */}
              {content === null ? null : (
              <section className={styles.block} data-testid="card-content">
                <h4 className={styles.blockTitle}>{content.title}</h4>
                {content.lines.length > 0 ? (
                  <ul className={styles.lines}>
                    {content.lines.map((line) => (
                      <li key={line.key}>{line.text}</li>
                    ))}
                  </ul>
                ) : null}
                {content.note !== null ? <p className={styles.hint}>{content.note}</p> : null}
              </section>
              )}

              {selected.notes.length > 0 ? (
                <section className={styles.block}>
                  <h4 className={styles.blockTitle}>Notas</h4>
                  <ul className={styles.lines}>
                    {selected.notes.map((note) => (
                      <li key={`${note.at}:${note.text}`}>{note.text}</li>
                    ))}
                  </ul>
                </section>
              ) : null}

              {/* Só oferecer disparo que o modelo comporta — e nunca recusar
                  calado. A fase que o card ainda não comporta continua VISÍVEL,
                  desabilitada, com a razão escrita ao lado; esconder faria a
                  tela mentir por omissão, que é a outra metade do mesmo vício. */}
              {dispatch !== null ? (
                <section className={styles.block}>
                  <h4 className={styles.blockTitle}>Disparar fase</h4>

                  <div className={styles.phaseRow} data-testid="dispatch-phases">
                    {dispatch.phases.map((option) => (
                      <button
                        type="button"
                        key={option.phase}
                        data-testid={`dispatch-phase-${option.phase}`}
                        className={[styles.phaseChip, option.phase === dispatch.phase.phase ? styles.phaseChipSelected : '']
                          .filter(Boolean)
                          .join(' ')}
                        aria-pressed={option.phase === dispatch.phase.phase}
                        disabled={!option.enabled}
                        onClick={() => {
                          setPhase(option.phase);
                          setTargetKey(null);
                        }}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>

                  {dispatch.phases.some((option) => !option.enabled) ? (
                    <ul className={styles.lines} data-testid="dispatch-phase-reasons">
                      {dispatch.phases
                        .filter((option) => !option.enabled)
                        .map((option) => (
                          <li key={option.phase} className={styles.hint}>
                            <strong>{option.label}</strong> — {option.reason}
                          </li>
                        ))}
                    </ul>
                  ) : null}

                  <div data-testid="dispatch-subject">
                    <Select
                      label="Assunto"
                      value={dispatch.target?.key ?? ''}
                      onChange={setTargetKey}
                      options={dispatch.targets.map((target) => ({ value: target.key, label: target.label }))}
                      placeholder="Nenhum assunto para esta fase"
                      disabled={dispatch.targets.length === 0}
                    />
                  </div>

                  <p className={styles.hint} data-testid="dispatch-repo">
                    {dispatch.target?.targetRepo
                      ? `Repo alvo: ${dispatch.target.targetRepo}${dispatch.target.repoNote ? ` — ${dispatch.target.repoNote}` : ''}`
                      : 'Sem repo alvo.'}
                  </p>

                  <div className={styles.dispatchRow}>
                    <Button onClick={() => void handleDispatch()} disabled={readOnly || !dispatch.canDispatch}>
                      Preparar
                    </Button>
                  </div>

                  <p
                    className={dispatch.blocked === null ? styles.hint : styles.blockedReason}
                    data-testid="dispatch-blocked"
                  >
                    {dispatch.blocked ?? dispatch.hint}
                  </p>
                </section>
              ) : null}
            </>
          )}
        </div>
      </div>
    </section>
  );
}
