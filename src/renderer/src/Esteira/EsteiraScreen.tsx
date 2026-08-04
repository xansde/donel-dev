import { Button, Select, TextInput } from '@donel-dev/design-system';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { EsteiraSnapshotDto } from '../../../shared/esteira/ipc';
import {
  dispatchHint,
  dispatchRefusedMessage,
  esteiraPhaseCommand,
  esteiraTabName,
  lockStateOf,
  preparedMessage,
  resolveSessionCwd,
  type EsteiraSessionRequest,
  type KnownProject,
  type SessionOpenOutcome,
} from './esteiraSession';
import { cardView, formatTimestamp, ingestErrorLine, lockView, phaseLines, STORE_COMPATIBILITY_WARNING, type SignalTone } from './esteiraView';
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
  /**
   * Projetos que o app conhece — a lista contra a qual o repo alvo do card é
   * resolvido. D-6: o alvo é explícito; sem correspondência, a sessão não abre
   * (e a tela diz por quê), nunca abre "no projeto em foco".
   */
  projects: readonly KnownProject[];
  /** Abre a aba de terminal da fase. Quem faz o encanamento (PTY, pré-digitar) é o App. */
  onOpenSession: (request: EsteiraSessionRequest) => void;
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

export function EsteiraScreen({ onClose, projects, onOpenSession }: EsteiraScreenProps): JSX.Element {
  const [state, setState] = useState<EsteiraSnapshotDto | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [newTitle, setNewTitle] = useState('');
  const [newRepo, setNewRepo] = useState('');
  const [phase, setPhase] = useState('discovery');
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
    if (selected === null) return;
    const targetRepo = selected.discovery.targetRepo;
    // O cwd é resolvido ANTES do disparo: ele viaja dentro do `run-input.json`
    // (a skill precisa saber onde trabalhar) e é onde a aba abre. Um alvo só,
    // declarado uma vez.
    const resolved = resolveSessionCwd(targetRepo, projects);
    const dispatched = await window.donel.esteira.dispatch({
      phase,
      discoveryId: selected.discovery.id,
      planId: null,
      workItemId: null,
      // D-6 — o alvo é explícito: o que está no card, nunca o projeto em foco.
      workspace:
        targetRepo === null
          ? null
          : { target_repo: targetRepo, repo_path: resolved.ok ? resolved.cwd : null, worktree_path: null, branch: null },
      continuesSessionId: null,
      handoffReason: null,
    });
    setState(dispatched.state);

    if (dispatched.ok) {
      // Batch B1 — o disparo deixou de parar no arquivo: se há para onde abrir,
      // a aba nasce agora, com o comando escrito. Se NÃO há, a fase continua
      // preparada e a tela diz o motivo em vez de fingir que abriu.
      let outcome: SessionOpenOutcome;
      if (resolved.ok) {
        const tabName = esteiraTabName(phase, selected.discovery.title);
        onOpenSession({
          sessionId: dispatched.sessionId,
          phase,
          cwd: resolved.cwd,
          tabName,
          command: esteiraPhaseCommand(phase, dispatched.inputPath),
        });
        outcome = { opened: true, tabName };
      } else {
        outcome = { opened: false, reason: resolved.reason };
      }
      setMessage(preparedMessage({ phase, targetRepo, inputPath: dispatched.inputPath, outcome }));
      return;
    }
    if (dispatched.reason === 'locked') {
      // A frase sai da camada pura, com a MESMA palavra do bloco da trava:
      // escrita aqui, ela dizia "em andamento" para um card cujo bloco dizia
      // outra coisa — o erro nº 1 de `erros-conhecidos.md`, terceira volta.
      setMessage(
        dispatchRefusedMessage(
          lockStateOf(dispatched.lock.holderKind, dispatched.lock.cliSessionId !== null),
          dispatched.lock.phase,
          formatTimestamp(dispatched.lock.acquiredAt),
        ),
      );
      return;
    }
    if (dispatched.reason === 'invalid-target') {
      setMessage(`Não dá para disparar: ${dispatched.issues.map((issue) => issue.code).join(', ')}.`);
      return;
    }
    setMessage('Não deu para disparar: o histórico não aceita escrita agora.');
  }, [phase, selected, projects, onOpenSession]);

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
                onClick={() => setSelectedId(discovery.id)}
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
                // Âncora estável para o roteiro e2e: filtrar `section` por texto
                // fazia o print do bloco cair na LISTA DE FASES, que repete a
                // mesma palavra (erro nº 5 de `erros-conhecidos.md`).
                <section className={styles.block} data-testid="esteira-lock" data-state={lock.state}>
                  <h4 className={styles.blockTitle}>{lock.title}</h4>
                  <p className={styles.lockLine}>{lock.line}</p>
                  {/* O disparo abre a aba sozinho quando há para onde abrir; o
                      próximo passo só sobra quando NÃO houve (card sem repo
                      alvo, repo desconhecido). Travar o card e ficar calada
                      seria pior do que não travar. */}
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
                  <ul className={styles.lines}>
                    {selected.items.map((item) => (
                      <li key={item.id}>
                        {item.title} · {item.itemType} · {item.state}
                        {item.targetRepo ? ` · ${item.targetRepo}` : ' · sem repo alvo'}
                      </li>
                    ))}
                  </ul>
                )}
              </section>

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

              <section className={styles.block}>
                <h4 className={styles.blockTitle}>Disparar fase</h4>
                <div className={styles.dispatchRow}>
                  <Select label="Fase" value={phase} onChange={setPhase} options={PHASE_OPTIONS} />
                  <Button onClick={() => void handleDispatch()} disabled={readOnly || selected.lock !== null}>
                    Preparar
                  </Button>
                </div>
                <p className={styles.hint}>{dispatchHint(lock?.state ?? null)}</p>
              </section>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
