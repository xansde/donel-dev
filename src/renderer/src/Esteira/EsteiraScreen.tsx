import { Button, Select, TextInput } from '@donel-dev/design-system';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { EsteiraGestureDto, EsteiraSnapshotDto } from '../../../shared/esteira/ipc';
import type { MacroStage, WorkItemSnapshot, WorkItemState } from '../../../shared/esteira/store/storeFormat';
import { SEED_DOCUMENT_EXAMPLE } from '../../../shared/esteira/store/seed';
import type { EsteiraSessionRequest, KnownProject } from './esteiraSession';
import { preparePhase } from './preparePhase';
import { RepoScopePicker } from './RepoScopePicker';
import { normalizeRepoScope, repoScopeWarning, scopeSummary, type RepoScope } from './repoScope';
import {
  cardContent,
  cardView,
  discardHint,
  discardedMessage,
  dispatchView,
  gestureRefusalMessage,
  ingestErrorCostLine,
  ingestErrorLine,
  ingestRecoveryLine,
  itemStateActions,
  ITEM_STATE_RULE,
  lockView,
  MACRO_STAGE_OPTIONS,
  deliveryLine,
  humanDecisionLines,
  reviewChecklist,
  reviewChecklistTitle,
  MIRROR_PENDING_HINT,
  MIRROR_PENDING_TITLE,
  mirrorLines,
  noteTargetOptions,
  NOTHING_NEW,
  parseNoteTarget,
  phaseLines,
  provenanceMark,
  scanMessage,
  scanOutcomeMessage,
  SEEDED_CARD_NOTE,
  seedIssueLine,
  seedIssuesShown,
  seededSummary,
  STORE_COMPATIBILITY_WARNING,
  tombstoneLines,
  verificationLines,
  type ProvenanceMark,
  type SeedRefusal,
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

// O catálogo de fases saiu daqui no B2: quem diz o que a tela oferece — e por
// que uma fase está desabilitada — é `dispatchView`, na camada pura.

/**
 * A marca de proveniência (D-2). Componente burro de propósito: o texto e a
 * decisão de mostrar ou não vêm de `esteiraView`, porque foi corrigir rótulo
 * dentro do JSX que fez a mesma palavra errada reaparecer noutro bloco.
 */
function ProvenanceChip({ mark }: { mark: ProvenanceMark | null }): JSX.Element | null {
  if (mark === null) return null;
  return (
    <span className={styles.seeded} title={mark.title}>
      {mark.label}
    </span>
  );
}

export function EsteiraScreen({ onClose, projects, onOpenSession }: EsteiraScreenProps): JSX.Element {
  const [state, setState] = useState<EsteiraSnapshotDto | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [newTitle, setNewTitle] = useState('');
  // Alvo e escopo do card novo — os dois JUNTOS, porque sao a mesma decisao
  // ("onde isto acontece"). Ver `repoScope.ts`.
  const [newScope, setNewScope] = useState<RepoScope>({ targetRepo: null, scopeRepos: [] });
  /**
   * O rascunho da correcao de alvo/escopo do card selecionado. `null` = o bloco
   * esta fechado, mostrando o que o card TEM. Guardar rascunho separado do
   * snapshot e o que impede a tela de parecer salva antes de o gesto acontecer.
   */
  const [repoDraft, setRepoDraft] = useState<RepoScope | null>(null);
  const [phase, setPhase] = useState('discovery');
  /** O assunto escolhido para o disparo. `null` = o primeiro que a fase comporta. */
  const [targetKey, setTargetKey] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  // Escolhas dos gestos novos. Ambas guardadas como "o que o operador escolheu",
  // não como "o estado atual": o default sai do card e volta sozinho ao trocar
  // de card ou quando o item escolhido some (descarte).
  const [stagePick, setStagePick] = useState<MacroStage | null>(null);
  const [notePick, setNotePick] = useState<string | null>(null);
  const [noteText, setNoteText] = useState('');
  // D-2 — semear trabalho em curso. Fica fechado por default: é o caminho de
  // exceção (plantar o que já existe), não o gesto do dia a dia.
  const [seedOpen, setSeedOpen] = useState(false);
  const [seedDoc, setSeedDoc] = useState('');
  // A recusa guarda o documento que ela julgou: veredito não sobrevive ao texto
  // que o motivou (ver `seedIssuesShown`).
  const [seedRefusal, setSeedRefusal] = useState<SeedRefusal | null>(null);

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
  const seedIssues = seedIssuesShown(seedRefusal, seedDoc);
  const warning = state === null ? null : STORE_COMPATIBILITY_WARNING[state.compatibility];
  const readOnly = state !== null && state.compatibility !== 'read-write';

  // O alvo da nota é o que o operador escolheu — enquanto ele existir. Item
  // descartado no meio do caminho devolve o formulário ao card, em vez de
  // deixá-lo apontando para um assunto que sumiu.
  // As linhas de `cardContent`, separadas por quem as desenha: plano vira linha
  // simples; item vira linha COM gestos, e o texto continua sendo o mesmo que a
  // camada pura escreveu.
  const planLines = useMemo(() => (content?.lines ?? []).filter((line) => line.kind === 'plan'), [content]);
  // A9/A18, A10/A19 e A15 — as três listas vêm PRONTAS da camada pura. A tela
  // só decide se o bloco aparece; nenhuma frase nasce no JSX (foi montando
  // frase aqui que a tela passou a se contradizer).
  const decisoes = useMemo(() => (selected === null ? [] : humanDecisionLines(selected)), [selected]);
  const revisao = useMemo(() => (selected === null ? [] : reviewChecklist(selected)), [selected]);
  const entrega = useMemo(() => (selected === null ? null : deliveryLine(selected)), [selected]);
  const itemLineById = useMemo(
    () => new Map((content?.lines ?? []).filter((line) => line.kind === 'item').map((line) => [line.key.slice('work_item:'.length), line])),
    [content],
  );

  // E2 — as lápides: item que saiu, mas o card ainda sabe responder por quê.
  const tombstones = useMemo(() => (selected === null ? [] : tombstoneLines(selected)), [selected]);

  const noteTargets = useMemo(() => (selected === null ? [] : noteTargetOptions(selected)), [selected]);
  const noteTarget = notePick !== null && noteTargets.some((option) => option.value === notePick) ? notePick : (noteTargets[0]?.value ?? '');

  /** Trocar de card zera as escolhas: elas pertencem ao card, não à tela. */
  const selectCard = useCallback((id: string) => {
    setSelectedId(id);
    // O assunto do disparo (B2) é escolha de card como as outras: mantido entre
    // cards, ele apontaria para um item que não está mais na tela.
    setTargetKey(null);
    setStagePick(null);
    setRepoDraft(null);
    setNotePick(null);
    setNoteText('');
    setMessage(null);
  }, []);

  const handleCreate = useCallback(async () => {
    const title = newTitle.trim();
    if (title.length === 0) return;
    const escolha = normalizeRepoScope(newScope);
    const created = await window.donel.esteira.createDiscovery({
      title,
      problem: null,
      targetRepo: escolha.targetRepo,
      scopeRepos: escolha.scopeRepos,
      tracker: null,
    });
    setState(created.state);
    if (created.ok) {
      setSelectedId(created.discoveryId);
      setNewTitle('');
      setNewScope({ targetRepo: null, scopeRepos: [] });
      setMessage(null);
    } else {
      setMessage('Não deu para criar: o histórico não aceita escrita agora.');
    }
  }, [newTitle, newScope]);

  const handleSeed = useCallback(async () => {
    const document = seedDoc.trim();
    if (document.length === 0) return;
    const seeded = await window.donel.esteira.seed({ document });
    setState(seeded.state);

    if (seeded.ok) {
      setSeedRefusal(null);
      setSeedDoc('');
      setSeedOpen(false);
      setSelectedId(seeded.discoveryId);
      setMessage(seededSummary({ plans: seeded.planIds.length, items: seeded.workItemIds.length }));
      return;
    }
    if (seeded.reason === 'invalid-seed') {
      // Nada foi escrito: o documento volta na tela com o motivo de cada
      // recusa, para ser corrigido — é isto que "sem edição manual às cegas"
      // significa na prática. A recusa anda grudada no texto que a produziu:
      // editar o documento apaga o veredito, em vez de acusar defeito que não
      // está mais lá.
      setSeedRefusal({ document, issues: seeded.issues });
      setMessage(null);
      return;
    }
    setSeedRefusal(null);
    setMessage('Não deu para semear: o histórico não aceita escrita agora.');
  }, [seedDoc]);

  const handleDispatch = useCallback(async () => {
    // O botão já está desabilitado quando não dá; esta guarda existe para o
    // caminho de teclado e para não haver DOIS lugares decidindo a mesma coisa.
    if (selected === null || dispatch === null || !dispatch.canDispatch || dispatch.target === null) return;
    // A sequência inteira (cwd, disparo, aba, frase) mora em `preparePhase`: o
    // mapa oferece o MESMO gesto na trilha, e duas orquestrações do mesmo
    // disparo divergiriam no primeiro conserto.
    const result = await preparePhase(
      { card: selected, phase: dispatch.phase.phase, target: dispatch.target, projects },
      { dispatch: (payload) => window.donel.esteira.dispatch(payload), openSession: onOpenSession },
    );
    // `state: null` = a recusa nao tocou no historico. Aplicar `null` aqui
    // apagaria a tela inteira para dizer que nada mudou.
    if (result.state !== null) setState(result.state);
    setMessage(result.message);
  }, [dispatch, selected, projects, onOpenSession]);

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

  /**
   * D-6 — corrigir a âncora e o escopo de um card que já existe.
   *
   * O gesto não existia: o repo só podia ser declarado no nascimento do card, e
   * num campo de texto livre. Quem errasse ali ficava com um card que não
   * dispara e sem como consertá-lo — foi o que aconteceu com o "Diário de Obra"
   * em 06/08, cujo alvo era a frase "spotsys e api-spotsys".
   */
  const handleSaveRepos = useCallback(async () => {
    if (selected === null || repoDraft === null) return;
    const escolha = normalizeRepoScope(repoDraft);
    if (
      applyGesture(
        await window.donel.esteira.setDiscoveryRepos({
          discoveryId: selected.discovery.id,
          targetRepo: escolha.targetRepo,
          scopeRepos: escolha.scopeRepos,
        }),
        `Alvo e escopo atualizados: ${scopeSummary(escolha)}.`,
      )
    ) {
      // Fecha o rascunho: o que a tela mostra volta a ser o que o card TEM.
      setRepoDraft(null);
    }
  }, [applyGesture, repoDraft, selected]);

  const handleAddNote = useCallback(
    async (target: string) => {
      const text = noteText.trim();
      const subject = parseNoteTarget(target);
      if (text.length === 0 || subject === null) return;
      if (applyGesture(await window.donel.esteira.addNote({ subject, text }), 'Nota registrada.')) setNoteText('');
    },
    [applyGesture, noteText],
  );

  // D-12 — reenviar o espelho é gesto de cortesia: ele não desbloqueia nada
  // local, e por isso a mensagem fala do board, nunca do trabalho.
  const handleRetryMirror = useCallback(async () => {
    const state = await window.donel.esteira.retryMirror();
    setState(state);
    const pending = state.snapshot.mirrorQueue.length;
    setMessage(pending === 0 ? 'O board recebeu o que faltava.' : `${pending} operação(ões) ainda não foram aceitas pelo board.`);
  }, []);

  const handleScan = useCallback(async () => {
    const before = state?.snapshot.through_seq ?? null;
    const scanned = await window.donel.esteira.scanOutbox();
    setState(scanned);
    // A frase nasce em `esteiraView`, com o resultado INTEIRO da varredura: a
    // versão anterior olhava só o que fora recusado e, por isso, anunciava
    // "nada novo" enquanto o card mudava de etapa embaixo dela.
    //
    // As DUAS varreduras do merge sobrevivem, e não por gosto: o B5 conta pelos
    // contadores da varredura (ingerido, recusado, ilegível) e o B3 compara o
    // `through_seq` de antes e depois. O contador é mais informativo, então ele
    // fala primeiro; o seq entra quando os contadores não viram nada MAS o log
    // andou — que é exatamente o caso em que a tela voltaria a dizer "nada
    // novo" sobre um card que acabou de mudar.
    const porContador = scanMessage(scanned);
    setMessage(
      porContador === NOTHING_NEW
        ? scanOutcomeMessage(before, scanned.rejectedOnLastScan, scanned.snapshot.through_seq)
        : porContador,
    );
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
            {/* Era um `TextInput` livre. Virou escolha entre o que o app
                conhece + escopo multi-repo — ver `RepoScopePicker`. */}
            <RepoScopePicker value={newScope} onChange={setNewScope} projects={projects} disabled={readOnly} />
            <Button onClick={() => void handleCreate()} disabled={readOnly || newTitle.trim().length === 0}>
              Criar
            </Button>
          </div>

          {/* D-2 — o caminho para trabalho que JÁ existe. O store nasce limpo e
              continua nascendo: isto não importa o modelo antigo, é o operador
              descrevendo o que está em curso. Tudo o que entra por aqui nasce
              marcado como semeado — afirmação, não fato observado. */}
          <div className={styles.seedCard}>
            <Button
              variant="ghost"
              data-testid="esteira-seed-toggle"
              onClick={() => setSeedOpen((open) => !open)}
              disabled={readOnly}
            >
              {seedOpen ? 'Fechar o seed' : 'Semear trabalho em curso'}
            </Button>

            {seedOpen ? (
              <>
                <p className={styles.hint}>
                  Descreva o que já existe — o discovery, os planos, os itens e em que ponto estão. Nasce marcado como semeado: é a sua
                  palavra, não algo que o app tenha lido de uma execução.
                </p>
                <textarea
                  className={styles.seedDoc}
                  data-testid="esteira-seed-doc"
                  aria-label="Documento do seed"
                  spellCheck={false}
                  rows={12}
                  value={seedDoc}
                  onChange={(event) => setSeedDoc(event.target.value)}
                  placeholder="Cole aqui o documento do seed, ou comece pelo exemplo."
                />
                {seedIssues.length > 0 ? (
                  <ul className={styles.seedIssues} data-testid="esteira-seed-issues">
                    {seedIssues.map((issue, index) => (
                      <li key={`${index}:${issue.code}:${issue.path}`}>{seedIssueLine(issue)}</li>
                    ))}
                  </ul>
                ) : null}
                <div className={styles.rowActions}>
                  <Button onClick={() => void handleSeed()} disabled={readOnly || seedDoc.trim().length === 0}>
                    Semear
                  </Button>
                  <Button variant="ghost" onClick={() => setSeedDoc(SEED_DOCUMENT_EXAMPLE)}>
                    Exemplo
                  </Button>
                </div>
              </>
            ) : null}
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
                  <ProvenanceChip mark={provenanceMark(discovery.seeded)} />
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

              {/* D-6 — onde isto roda. Fica ANTES da etapa porque é o que
                  decide se a fase abre: um card com repo impossível não tem
                  etapa a discutir. O aviso aparece aqui, ao lado da escolha, e
                  não depois do disparo — foi um aviso tardio que deixou um card
                  travado por um trabalho que nunca começou (06/08). */}
              <section className={styles.block} data-testid="esteira-repos">
                <h4 className={styles.blockTitle}>Onde isto roda</h4>
                {repoDraft === null ? (
                  <>
                    <p className={styles.stageLine}>
                      <strong>{scopeSummary(selected.discovery)}</strong>
                    </p>
                    {repoScopeWarning(selected.discovery, projects) ? (
                      <p className={styles.blockedReason} data-testid="esteira-repos-warning">
                        {repoScopeWarning(selected.discovery, projects)}
                      </p>
                    ) : null}
                    <Button
                      variant="ghost"
                      data-testid="esteira-repos-edit"
                      onClick={() =>
                        setRepoDraft({ targetRepo: selected.discovery.targetRepo, scopeRepos: [...selected.discovery.scopeRepos] })
                      }
                      disabled={readOnly}
                    >
                      Corrigir alvo e escopo
                    </Button>
                  </>
                ) : (
                  <>
                    <RepoScopePicker value={repoDraft} onChange={setRepoDraft} projects={projects} disabled={readOnly} />
                    <div className={styles.rowActions}>
                      <Button onClick={() => void handleSaveRepos()} disabled={readOnly}>
                        Salvar
                      </Button>
                      <Button variant="ghost" onClick={() => setRepoDraft(null)}>
                        Cancelar
                      </Button>
                    </div>
                  </>
                )}
              </section>

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

              {/* D-2 — o card foi semeado: a nota diz o que a marca significa,
                  uma vez por card, em vez de repetir a explicação em cada chip. */}
              {selected.discovery.seeded ? <p className={styles.seededNote}>{SEEDED_CARD_NOTE}</p> : null}

              {/* O erro de leitura vem PRIMEIRO: é a informação que o modelo
                  antigo escondia, e a que muda o que o operador faz agora. */}
              {selected.ingestErrors.length > 0 ? (
                <section className={styles.block} data-testid="esteira-ingest-errors">
                  <h4 className={styles.blockTitle}>Não consegui ler</h4>
                  {selected.ingestErrors.map((error) => (
                    <p key={error.resultPath} className={styles.errorLine}>
                      <code>{error.resultPath}</code> — {ingestErrorLine(error)}
                      <br />
                      <span className={styles.hint}>O que a skill fez não se perdeu: o arquivo continua lá, fora do contrato.</span>
                      {/* A5 — o CUSTO: sem este arquivo, quais entidades nunca
                          chegaram a existir. É a diferença entre "um campo
                          quebrou" e "por isso o Implementar não abre". */}
                      {ingestErrorCostLine(error) ? (
                        <>
                          <br />
                          <strong>{ingestErrorCostLine(error)}</strong>
                        </>
                      ) : null}
                    </p>
                  ))}
                </section>
              ) : null}

              {/* A6 — a recuperação é um FATO próprio, não o desaparecimento
                  silencioso do erro: o card diz que ele foi superado, e como. */}
              {selected.ingestRecoveries.length > 0 ? (
                <section className={styles.block} data-testid="esteira-ingest-recovered">
                  <h4 className={styles.blockTitle}>Erros arquivados</h4>
                  {selected.ingestRecoveries.map((recovery) => (
                    <p key={recovery.resultPath} className={styles.hint}>
                      <code>{recovery.resultPath}</code> — {ingestRecoveryLine(recovery)}
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

              <section className={styles.block} data-testid="esteira-fases">
                <h4 className={styles.blockTitle}>Fases</h4>
                {selected.phases.length === 0 ? (
                  <p className={styles.hint}>Nenhuma fase rodou ainda.</p>
                ) : (
                  <ul className={styles.lines}>
                    {phaseLines(selected).map((entry) => (
                      <li key={entry.key} className={entry.failed ? styles.failed : undefined}>
                        {entry.text} <ProvenanceChip mark={entry.mark} />
                        {entry.detail ? <span className={styles.hint}> {entry.detail}</span> : null}
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              {/* A evidência de D-4: o PR, o check, a resposta do spike. Sem
                  este bloco, a fase declarava como o ciclo termina e o card
                  engolia — dado lido e não mostrado custa o mesmo que dado
                  ausente para quem lê a tela para decidir. */}
              {selected.verifications.length > 0 ? (
                <section className={styles.block} data-testid="esteira-verificacoes">
                  <h4 className={styles.blockTitle}>Verificações</h4>
                  <ul className={styles.lines}>
                    {verificationLines(selected).map((entry) => (
                      <li key={entry.key} className={entry.failed ? styles.failed : undefined}>
                        {entry.text}
                        {entry.detail ? <span className={styles.hint}> {entry.detail}</span> : null}
                      </li>
                    ))}
                  </ul>
                  {/* A15 — num repo com escada alfa→beta→stable, "concluído"
                      sem destino se lê como "está na main". A frase inteira vem
                      de `deliveryLine`; se ninguém declarou destino, ela é nula
                      e a tela não afirma nada. */}
                  {entrega === null ? null : <p className={styles.hint}>{entrega}</p>}
                </section>
              ) : null}

              {/* A9 + A18 — o que GENTE disse sobre este card: gates
                  confirmados e decisões tomadas. Antes viviam como blockquote
                  no `tasks.md`, onde gate composto virava uma linha só e
                  meia-confirmação não cabia. As frases vêm prontas de
                  `humanDecisionLines`; aqui só se posiciona. */}
              {decisoes.length > 0 ? (
                <section className={styles.block} data-testid="esteira-decisoes">
                  <h4 className={styles.blockTitle}>Decisões e confirmações</h4>
                  <ul className={styles.lines}>
                    {decisoes.map((entry) => (
                      <li key={entry.key}>{entry.text}</li>
                    ))}
                  </ul>
                </section>
              ) : null}

              {/* A10 + A19 — o que sobrou para você. Antes era uma frase
                  corrida no `summary` da fase, que ninguém lê como lista.
                  Item pendente NÃO é falha: o tom vem da linha, e ele nunca é
                  de erro — esperar por gente é um estado legítimo. */}
              {revisao.length > 0 ? (
                <section className={styles.block} data-testid="esteira-revisao">
                  <h4 className={styles.blockTitle}>{reviewChecklistTitle(revisao)}</h4>
                  <ul className={styles.lines}>
                    {revisao.map((entry) => (
                      <li key={entry.key}>
                        {entry.text}
                        {entry.detail ? <span className={styles.hint}> {entry.detail}</span> : null}
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}

              {/* O TEXTO de cada linha vem pronto de `cardContent` (B2) e os
                  GESTOS de cada item vêm do B3. Os dois batches reescreveram
                  este bloco: um para a lista parar de contradizer o disparo
                  sobre o repo, o outro para o item ganhar estado e descarte.
                  Montar a frase aqui de novo desfaria o primeiro. A marca de
                  proveniência (B4) vem JUNTO da linha, do mesmo `cardContent`:
                  duas fontes para o mesmo bloco foi o que fez a tela se
                  contradizer no print 16. */}
              {content === null ? null : (
              <section className={styles.block} data-testid="card-content">
                <h4 className={styles.blockTitle}>{content.title}</h4>
                {planLines.length > 0 ? (
                  <ul className={styles.lines}>
                    {planLines.map((line) => (
                      <li key={line.key}>
                        {line.text} <ProvenanceChip mark={line.mark} />
                      </li>
                    ))}
                  </ul>
                ) : null}
                {selected.items.length > 0 ? (
                  <>
                    <ul className={styles.itemList}>
                      {selected.items.map((item) => {
                        // A trava DESTE item, não a primeira do card: com disparo
                        // por assunto (B2) um card tem mais de uma, e a promessa
                        // do descarte tem que casar com a recusa do mesmo item.
                        const itemLock =
                          selected.locks.find((entry) => entry.subject.entity === 'work_item' && entry.subject.id === item.id) ??
                          null;
                        return (
                          <li key={item.id} className={styles.item} data-testid="esteira-item">
                            <span className={styles.itemLine}>
                              {itemLineById.get(item.id)?.text ?? ''} <ProvenanceChip mark={itemLineById.get(item.id)?.mark ?? null} />
                            </span>
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
                            <span className={styles.hint}>{discardHint(item, itemLock)}</span>
                          </li>
                        );
                      })}
                    </ul>
                    <p className={styles.hint}>{ITEM_STATE_RULE}</p>
                  </>
                ) : null}
                {content.note !== null ? <p className={styles.hint}>{content.note}</p> : null}
              </section>
              )}

              {/* E2 — a lápide: o item saiu de "Planos e itens", mas continua
                  respondendo "por que ele sumiu?" — nunca vira órfão calado. */}
              {tombstones.length > 0 ? (
                <section className={styles.block} data-testid="esteira-tombstones">
                  <h4 className={styles.blockTitle}>Itens descartados</h4>
                  <ul className={styles.lines}>
                    {tombstones.map((tombstone) => (
                      <li key={tombstone.key}>
                        {tombstone.text}
                        {tombstone.reason ? <span className={styles.hint}> — {tombstone.reason}</span> : null}
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}

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

              {/* O espelho vem DEPOIS dos fatos locais, e nunca antes: ele é
                  cortesia para quem olha o board (D-12). Board atrasado não é
                  trabalho parado — e a tela precisa dizer isso, senão o
                  operador espera por uma integração opcional. */}
              {selected.mirrorQueue.length > 0 ? (
                <section className={styles.block} data-testid="mirror-pending">
                  <h4 className={styles.blockTitle}>{MIRROR_PENDING_TITLE}</h4>
                  <p className={styles.hint}>{MIRROR_PENDING_HINT}</p>
                  <ul className={styles.lines}>
                    {mirrorLines(selected).map((entry) => (
                      <li key={entry.key}>
                        {entry.text}
                        <span className={styles.hint}> — {entry.detail}</span>
                      </li>
                    ))}
                  </ul>
                  <div className={styles.rowActions}>
                    <Button variant="ghost" onClick={() => void handleRetryMirror()} disabled={readOnly}>
                      Reenviar espelho
                    </Button>
                  </div>
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

                  {/* B1 + B2 — a razão vem da camada pura (B2) E usa a MESMA
                      palavra do bloco da trava (B1): `dispatchView` já monta o
                      `hint` a partir do estado da trava, então não há um segundo
                      lugar escrevendo frase de estado. */}
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
