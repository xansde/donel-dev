import { Button, Modal } from '@donel-dev/design-system';
import { CircleCheck, CircleDashed, CircleMinus, CircleX, Eye, GitPullRequest, MessageSquareWarning } from 'lucide-react';
import { useEffect, useState } from 'react';
import {
  buildFixPrompt,
  needsFix,
  type PrCheck,
  type PrChecksRollup,
  type PrReviewSignal,
  type PrReviewState,
  type PullRequestStatus,
} from '../../shared/pullRequestStatus';
import styles from './PullRequestIndicator.module.css';

// B3 — indicador discreto do PR da branch (número + cor do agregado dos
// checks + sinal de review) e o painel que ele abre. O painel usa o `Modal`
// do design-system, pela mesma razão nomeada em `ProjectSwitcher.tsx`
// ("popover → Modal"): foco preso, Escape e foco devolvido de graça, sem
// posicionamento à mão.

export const ROLLUP_LABEL: Record<PrChecksRollup, string> = {
  pass: 'checks passaram',
  pending: 'checks rodando',
  fail: 'checks falharam',
  none: 'sem checks',
};

export const REVIEW_LABEL: Record<PrReviewSignal, string> = {
  approved: 'aprovado',
  'changes-requested': 'mudanças pedidas',
  'review-required': 'review pendente',
  none: 'sem review',
};

const REVIEW_STATE_LABEL: Record<PrReviewState, string> = {
  APPROVED: 'aprovou',
  CHANGES_REQUESTED: 'pediu mudanças',
  COMMENTED: 'comentou',
  DISMISSED: 'review descartado',
  PENDING: 'review em rascunho',
};

const ROLLUP_CLASS: Record<PrChecksRollup, string> = {
  pass: styles.pass,
  pending: styles.pending,
  fail: styles.fail,
  none: styles.none,
};

const NO_TAB_HINT = 'Abra uma sessão do Claude neste projeto para mandar o conserto.';
const NOTHING_TO_FIX_HINT = 'Nada a consertar: nenhum check falhou e ninguém pediu mudanças.';

export interface PullRequestIndicatorProps {
  readonly path: string;
  readonly pr: PullRequestStatus;
  /** Nome da linha (sessão ou projeto), para o rótulo acessível. */
  readonly label: string;
  /** Aba do Claude que recebe o conserto; `null` = nenhuma aberta neste projeto. */
  readonly fixTabId: string | null;
  readonly onLoadDetails: (path: string) => Promise<PullRequestStatus | null>;
  readonly onOpenUrl: (url: string) => void;
  readonly onSendFix: (tabId: string, text: string) => void;
}

function CheckGlyph({ state }: { state: PrCheck['state'] }): React.JSX.Element {
  const props = { size: 12, strokeWidth: 1.5, 'aria-hidden': true } as const;
  if (state === 'pass') return <CircleCheck {...props} className={styles.pass} />;
  if (state === 'fail') return <CircleX {...props} className={styles.fail} />;
  if (state === 'pending') return <CircleDashed {...props} className={styles.pending} />;
  return <CircleMinus {...props} className={styles.none} />;
}

function ReviewGlyph({ review }: { review: PrReviewSignal }): React.JSX.Element | null {
  if (review === 'changes-requested') return <MessageSquareWarning size={10} strokeWidth={1.5} aria-hidden="true" className={styles.fail} />;
  if (review === 'review-required') return <Eye size={10} strokeWidth={1.5} aria-hidden="true" className={styles.pending} />;
  return null;
}

function threadsLine(details: PullRequestStatus | null, loading: boolean): string {
  if (loading) return 'Conversas não resolvidas: lendo…';
  const count = details?.unresolvedThreads;
  if (typeof count !== 'number') return 'Conversas não resolvidas: não consegui ler.';
  return count === 0 ? 'Nenhuma conversa não resolvida.' : `Conversas não resolvidas: ${count}`;
}

export function PullRequestIndicator({ path, pr, label, fixTabId, onLoadDetails, onOpenUrl, onSendFix }: PullRequestIndicatorProps): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [details, setDetails] = useState<PullRequestStatus | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    setLoading(true);
    void onLoadDetails(path).then((next) => {
      if (cancelled) return;
      setDetails(next);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [open, path, onLoadDetails]);

  // O que o painel mostra: a leitura detalhada assim que chega; até lá, o que o indicador já tinha.
  const shown = details ?? pr;
  const fixable = needsFix(shown);
  const canSend = fixable && fixTabId !== null;
  const summary = `${ROLLUP_LABEL[pr.rollup]}${pr.review === 'none' ? '' : `, ${REVIEW_LABEL[pr.review]}`}`;

  return (
    <>
      <button
        type="button"
        className={[styles.chip, ROLLUP_CLASS[pr.rollup], pr.isDraft ? styles.draft : ''].join(' ')}
        onClick={() => setOpen(true)}
        aria-label={`PR #${pr.number} de ${label}: ${summary}`}
        title={`PR #${pr.number}: ${summary}`}
        data-testid="sidebar-pr"
        data-rollup={pr.rollup}
        data-review={pr.review}
      >
        <GitPullRequest size={10} strokeWidth={1.5} aria-hidden="true" />
        <span>#{pr.number}</span>
        <ReviewGlyph review={pr.review} />
      </button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={`PR #${shown.number}${shown.isDraft ? ' (rascunho)' : ''}`}
        actions={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Fechar
            </Button>
            <Button
              variant="primary"
              disabled={!canSend}
              title={!fixable ? NOTHING_TO_FIX_HINT : fixTabId === null ? NO_TAB_HINT : undefined}
              onClick={() => {
                if (!canSend || fixTabId === null) return;
                onSendFix(fixTabId, buildFixPrompt(shown));
                setOpen(false);
              }}
            >
              Mandar pro Claude consertar
            </Button>
          </>
        }
      >
        <div className={styles.panel} data-testid="pr-panel">
          <p className={styles.title}>{shown.title}</p>
          <Button variant="link" onClick={() => onOpenUrl(shown.url)}>
            Abrir no navegador
          </Button>

          <h3 className={styles.sectionTitle}>Checks · {ROLLUP_LABEL[shown.rollup]}</h3>
          {shown.checks.length === 0 ? <p className={styles.muted}>Nenhum check neste PR.</p> : null}
          <ul className={styles.list}>
            {shown.checks.map((check, index) => (
              <li key={`${check.name}-${index}`} className={styles.item} data-testid="pr-check" data-state={check.state}>
                <CheckGlyph state={check.state} />
                <span className={styles.itemName}>{check.name}</span>
                {check.url ? (
                  <Button variant="link" onClick={() => onOpenUrl(check.url as string)} aria-label={`Abrir o job ${check.name}`}>
                    {check.state === 'fail' ? 'ver o job que falhou' : 'ver'}
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>

          <h3 className={styles.sectionTitle}>Reviews · {REVIEW_LABEL[shown.review]}</h3>
          <ul className={styles.list}>
            {shown.reviews.map((review) => (
              <li key={`${review.author}-${review.state}`} className={styles.item}>
                <span className={styles.itemName}>
                  {review.author} {REVIEW_STATE_LABEL[review.state]}
                </span>
              </li>
            ))}
          </ul>
          <p className={styles.muted} data-testid="pr-threads">
            {threadsLine(details, loading)}
          </p>
          {!canSend ? <p className={styles.muted}>{!fixable ? NOTHING_TO_FIX_HINT : NO_TAB_HINT}</p> : null}
        </div>
      </Modal>
    </>
  );
}
