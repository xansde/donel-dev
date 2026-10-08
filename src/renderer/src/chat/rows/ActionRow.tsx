import { ActionLine, CommandOutput } from '@donel-dev/design-system';
import { memo, useState } from 'react';
import type { ReactNode } from 'react';
import type { ActionRow } from '../../../../shared/chat/rows';
import { DiffView, useCopyFeedback } from '../markdown';
import {
  actionDetailPart,
  dsActionCategory,
  dsActionStatus,
  parseExitCode,
  progressiveVerb,
  splitStats,
} from './format';
import styles from './rows.module.css';
import { useRowDetail } from './useRowDetail';
import type { DetailState, RequestRowDetail } from './useRowDetail';

export interface ActionRowViewProps {
  row: ActionRow;
  /** `chat:row-detail` — diff, command output, file list or raw input/output. */
  requestDetail: RequestRowDetail;
}

/** "Lista de arquivos (50 + ver tudo)" — conversation-rows.md §4. */
const FILE_LIST_LINES = 50;

function Note({ state }: { state: DetailState | undefined }) {
  if (state?.status === 'error') return <div className={styles.note}>Não foi possível carregar o detalhe.</div>;
  return <div className={styles.note}>carregando…</div>;
}

/**
 * One tool call as a single `ActionLine` (T053, decision B): Portuguese summary,
 * icon by category, `+a −b` counters, failure/denied/interrupted visible without
 * opening. D-C3: no test statistics and no exit code unless the result starts
 * with "Exit code N". D-C4: gerund while it runs. Click opens the detail
 * (diff, output cut at 40 lines + "ver tudo", file list), fetched on demand.
 */
function ActionRowViewImpl({ row, requestDetail }: ActionRowViewProps) {
  const [expanded, setExpanded] = useState(false);
  const { states, load } = useRowDetail(requestDetail, row.id);
  const { copy } = useCopyFeedback();

  const part = actionDetailPart(row.category);
  const expandable = part !== null && row.detail !== undefined && row.status !== 'running';
  const running = row.status === 'running';
  const { added, removed, text: statsText } = splitStats(row.summary.stats);
  const object = [row.summary.target, statsText].filter(Boolean).join(' · ') || undefined;

  const toggle = () => {
    if (!expanded && part) load(part);
    setExpanded(!expanded);
  };

  const state = part ? states[part] : undefined;
  const full = states['output-full'];

  let detail: ReactNode = null;
  if (expanded && part) {
    if (state?.status !== 'ready') {
      detail = <Note state={state} />;
    } else if (part === 'diff') {
      detail = <DiffView text={state.detail.text} path={row.summary.target} />;
    } else if (part === 'output') {
      const source = full?.status === 'ready' ? full.detail : state.detail;
      const { exitCode, body } = parseExitCode(source.text);
      detail = (
        <CommandOutput
          title={row.summary.target ? `$ ${row.summary.target}` : 'saída'}
          text={body}
          exitCode={exitCode}
          showAll={full?.status === 'ready'}
          onViewAll={source.truncated || body.split('\n').length > 40 ? () => load('output-full') : undefined}
          onCopy={() => void copy(body)}
        />
      );
    } else if (part === 'files') {
      const files = state.detail.files ?? state.detail.text.split('\n').filter(Boolean);
      detail = <FileList files={files} />;
    } else {
      detail = <CommandOutput title={row.tool} text={state.detail.text} showAll />;
    }
  }

  return (
    <ActionLine
      category={dsActionCategory(row.category)}
      verb={running ? progressiveVerb(row.summary.verb) : row.summary.verb}
      object={object}
      status={dsActionStatus(row.status)}
      added={added}
      removed={removed}
      expanded={expanded}
      onToggle={expandable ? toggle : undefined}
    >
      {detail}
    </ActionLine>
  );
}

function FileList({ files }: { files: readonly string[] }) {
  const [showAll, setShowAll] = useState(false);
  return (
    <CommandOutput
      title={`${files.length} ${files.length === 1 ? 'arquivo' : 'arquivos'}`}
      lines={files}
      maxLines={FILE_LIST_LINES}
      showAll={showAll}
      onViewAll={() => setShowAll(true)}
    />
  );
}

export const ActionRowView = memo(ActionRowViewImpl);
