import { Button, Select, TextInput } from '@donel-dev/design-system';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { EsteiraGestureDto, EsteiraSnapshotDto } from '../../../shared/esteira/ipc';
import type { MacroStage, WorkItemSnapshot, WorkItemState } from '../../../shared/esteira/store/storeFormat';
import {
  cardView,
  discardHint,
  dispatchHint,
  discardedMessage,
  formatTimestamp,
  gestureRefusalMessage,
  ingestErrorLine,
  itemLine,
  itemStateActions,
  ITEM_STATE_RULE,
  lockView,
  MACRO_STAGE_OPTIONS,
  noteTargetOptions,
  parseNoteTarget,
  phaseLines,
  scanOutcomeMessage,
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

const PHASE_OPTIONS = [
  { value: 'discovery', label: 'Discovery' },
  { value: 'plano', label: 'Plano' },
];

export function EsteiraScreen({ onClose }: EsteiraScreenProps): JSX.Element {
  const [state, setState] = useState<EsteiraSnapshotDto | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [newTitle, setNewTitle] = useState('');
  const [newRepo, setNewRepo] = useState('');
  const [phase, setPhase] = useState('discovery');
  const [message, setMessage] = useState<string | null>(null);
  // Escolhas dos gestos novos. Ambas guardadas como "o que o operador escolheu",
  // não como "o estado atual": o default sai do card e volta sozinho ao trocar
  // de card ou quando o item escolhido some (descarte).
  const [stagePick, setStagePick] = useState<MacroStage | null>(null);
  const [notePick, setNotePick] = useState<string | null>(null);
  const [noteText, setNoteText] = useState('');

  useEffect(() => {
    void window.donel.esteira.snapshot().then(setState);
    // Um evento só cobre os três caminhos de mudança (ingestão, gesto, outro canal).
    return window.donel.esteira.onChanged(setState);
  }, []);

  const snapshot = state?.snapshot ?? null;
  const cards = snapshot?.discoveries ?? [];
  const selected = useMemo(() => (snapshot && selectedId ? cardView(snapshot, selectedId) : null), [snapshot, selectedId]);
  const lock = useMemo(() => (selected === null ? null : lockView(selected)), [selected]);
  const warning = state === null ? null : STORE_COMPATIBILITY_WARNING[state.compatibility];
  const readOnly = state !== null && state.compatibility !== 'read-write';

  // O alvo da nota é o que o operador escolheu — enquanto ele existir. Item
  // descartado no meio do caminho devolve o formulário ao card, em vez de
  // deixá-lo apontando para um assunto que sumiu.
  const noteTargets = useMemo(() => (selected === null ? [] : noteTargetOptions(selected)), [selected]);
  const noteTarget = notePick !== null && noteTargets.some((option) => option.value === notePick) ? notePick : (noteTargets[0]?.value ?? '');

  /** Trocar de card zera as escolhas: elas pertencem ao card, não à tela. */
  const selectCard = useCallback((id: string) => {
    setSelectedId(id);
    setStagePick(null);
    setNotePick(null);
    setNoteText('');
    setMessage(null);
  }, []);

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
    if (selected === null) return;
    const targetRepo = selected.discovery.targetRepo;
    const dispatched = await window.donel.esteira.dispatch({
      phase,
      discoveryId: selected.discovery.id,
      planId: null,
      workItemId: null,
      // D-6 — o alvo é explícito: o que está no card, nunca o projeto em foco.
      workspace: targetRepo === null ? null : { target_repo: targetRepo, repo_path: null, worktree_path: null, branch: null },
      continuesSessionId: null,
      handoffReason: null,
    });
    setState(dispatched.state);

    if (dispatched.ok) {
      setMessage(`Fase "${phase}" preparada. A skill lê ${dispatched.inputPath} e devolve em ${dispatched.resultPath}.`);
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
  }, [phase, selected]);

  const handleRelease = useCallback(async () => {
    if (selected?.lock == null) return;
    setState(await window.donel.esteira.releaseLock({ subject: selected.lock.subject, phase: selected.lock.phase }));
    setMessage(null);
  }, [selected]);

  /** Toda resposta de gesto atualiza o estado; só a recusa fala. */
  const applyGesture = useCallback((gesture: EsteiraGestureDto, successMessage: string): boolean => {
    setState(gesture.state);
    setMessage(gesture.ok ? successMessage : gestureRefusalMessage(gesture.reason));
    return gesture.ok;
  }, []);

  const handleItemState = useCallback(
    async (item: WorkItemSnapshot, state: WorkItemState, hint: string) => {
      applyGesture(await window.donel.esteira.setWorkItemState({ workItemId: item.id, state }), hint);
    },
    [applyGesture],
  );

  const handleDiscard = useCallback(
    async (item: WorkItemSnapshot) => {
      applyGesture(await window.donel.esteira.discardWorkItem({ workItemId: item.id, reason: null }), discardedMessage(item));
    },
    [applyGesture],
  );

  const handleOverrideStage = useCallback(
    async (value: MacroStage | null) => {
      if (selected === null) return;
      if (
        applyGesture(
          await window.donel.esteira.setStageOverride({ discoveryId: selected.discovery.id, value, reason: null }),
          value === null
            ? 'Ajuste removido. A etapa volta a ser só o cálculo.'
            : 'Etapa ajustada à mão. O cálculo continua visível ao lado — ele nunca é apagado.',
        )
      ) {
        // O seletor volta a acompanhar a etapa calculada. Deixá-lo parado na
        // escolha anterior faria a tela mostrar duas etapas diferentes sem que
        // nenhuma das duas fosse o estado do card.
        setStagePick(null);
      }
    },
    [applyGesture, selected],
  );

  const handleAddNote = useCallback(
    async (target: string) => {
      const text = noteText.trim();
      const subject = parseNoteTarget(target);
      if (text.length === 0 || subject === null) return;
      if (applyGesture(await window.donel.esteira.addNote({ subject, text }), 'Nota registrada.')) setNoteText('');
    },
    [applyGesture, noteText],
  );

  const handleScan = useCallback(async () => {
    const before = state?.snapshot.through_seq ?? null;
    const scanned = await window.donel.esteira.scanOutbox();
    setState(scanned);
    setMessage(scanOutcomeMessage(before, scanned.rejectedOnLastScan, scanned.snapshot.through_seq));
  }, [state]);

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
                onClick={() => selectCard(discovery.id)}
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

              {/* D-13 — a etapa é derivada. O ajuste manual existe, é sempre
                  marcado, e o cálculo aparece ao lado dele: override que esconde
                  o cálculo é override que engana. */}
              <section className={styles.block} data-testid="esteira-stage">
                <h4 className={styles.blockTitle}>Etapa</h4>
                <p className={styles.stageLine}>
                  <strong>{selected.stage.shown}</strong>
                  <span className={styles.hint}>
                    {selected.stage.overridden ? ' · ajuste manual' : ' · calculada dos fatos, nunca digitada'}
                  </span>
                </p>
                {selected.stage.overrideLine ? (
                  <p className={styles.overrideNote} data-testid="esteira-stage-override-line">
                    {selected.stage.overrideLine}
                  </p>
                ) : null}
                <div className={styles.dispatchRow}>
                  {/* Âncora estável para o roteiro e2e: o rótulo do gatilho do
                      Select é o valor escolhido, e valor muda com o fluxo. */}
                  <div data-testid="esteira-stage-picker">
                    <Select
                      label="Forçar etapa"
                      value={stagePick ?? selected.discovery.derivedStage}
                      onChange={(value) => setStagePick(value as MacroStage)}
                      options={[...MACRO_STAGE_OPTIONS]}
                      disabled={readOnly}
                    />
                  </div>
                  <Button onClick={() => void handleOverrideStage(stagePick ?? selected.discovery.derivedStage)} disabled={readOnly}>
                    Forçar
                  </Button>
                  {selected.stage.overridden ? (
                    <Button variant="ghost" onClick={() => void handleOverrideStage(null)} disabled={readOnly}>
                      Voltar ao calculado
                    </Button>
                  ) : null}
                </div>
              </section>

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

              <section className={styles.block}>
                <h4 className={styles.blockTitle}>
                  Planos e itens ({selected.planCount} plano(s), {selected.items.length} item(ns))
                </h4>
                {selected.items.length === 0 ? (
                  <p className={styles.hint}>
                    {selected.planCount === 0
                      ? 'Nenhum plano registrado. Se o discovery terminou assim, é um desfecho — não uma pendência.'
                      : 'Os planos ainda não declararam itens.'}
                  </p>
                ) : (
                  <>
                    <ul className={styles.itemList}>
                      {selected.items.map((item) => (
                        <li key={item.id} className={styles.item} data-testid="esteira-item">
                          <span className={styles.itemLine}>{itemLine(item)}</span>
                          <div className={styles.rowActions}>
                            {itemStateActions(item).map((action) => (
                              <Button
                                key={action.state}
                                variant="ghost"
                                onClick={() => void handleItemState(item, action.state, action.hint)}
                                disabled={readOnly}
                              >
                                {action.label}
                              </Button>
                            ))}
                            {/* D-16 — criar item é da skill; descartar é um gesto
                                daqui. O botão continua clicável mesmo com o item
                                travado: a recusa é dita, nunca calada. */}
                            <Button variant="ghost" onClick={() => void handleDiscard(item)} disabled={readOnly}>
                              Descartar
                            </Button>
                          </div>
                          <span className={styles.hint}>{discardHint(item, selected.lock)}</span>
                        </li>
                      ))}
                    </ul>
                    <p className={styles.hint}>{ITEM_STATE_RULE}</p>
                  </>
                )}
              </section>

              <section className={styles.block} data-testid="esteira-notes">
                <h4 className={styles.blockTitle}>Notas</h4>
                {selected.notes.length === 0 ? (
                  <p className={styles.hint}>Nenhuma nota ainda.</p>
                ) : (
                  <ul className={styles.lines}>
                    {selected.notes.map((note, index) => (
                      <li key={`${index}:${note.at}`}>
                        <span className={styles.noteAbout}>{note.about}</span> — {note.text}
                      </li>
                    ))}
                  </ul>
                )}
                <div className={styles.noteForm}>
                  <div data-testid="esteira-note-target">
                    <Select label="Sobre" value={noteTarget} onChange={setNotePick} options={[...noteTargets]} disabled={readOnly} />
                  </div>
                  <TextInput
                    label="Nota"
                    value={noteText}
                    onChange={(event) => setNoteText(event.target.value)}
                    placeholder="O que precisa ficar registrado?"
                    disabled={readOnly}
                  />
                  <Button onClick={() => void handleAddNote(noteTarget)} disabled={readOnly || noteText.trim().length === 0}>
                    Anotar
                  </Button>
                </div>
              </section>

              <section className={styles.block}>
                <h4 className={styles.blockTitle}>Disparar fase</h4>
                <div className={styles.dispatchRow}>
                  <Select label="Fase" value={phase} onChange={setPhase} options={PHASE_OPTIONS} />
                  <Button onClick={() => void handleDispatch()} disabled={readOnly || selected.lock !== null}>
                    Preparar
                  </Button>
                </div>
                <p className={styles.hint}>{dispatchHint(selected)}</p>
              </section>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
