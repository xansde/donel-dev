// 014-chat (T078) - plan card (FR-023): the plan as markdown, collapsible by the T3 rule (long plans open
// collapsed to the title + first 3 steps, D-C16), "N passos" only with a numbered list, fixed phrases, and the
// two exits. "Pedir ajuste" shrinks the card to its title; the chat box turns into the adjustment field
// (`ChatComposer adjust`) and the text leaves as `plan-adjust`.

import {
  AnnotationTag,
  Button,
  PendingFrame,
  PendingIconButton,
  PendingNote,
  PendingSpacer,
  PlanBody,
  PlanCollapsedTitle,
  PlanTitle,
} from '@donel-dev/design-system';
import { ChevronDown, ChevronUp, ListChecks } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { PendingAnswer } from '../../../../shared/chat/ipc';
import type { Pending } from '../../../../shared/chat/rows';
import { buildCollapsedPlanPreview, planStepCount, stripDisplayedPlanMarkdown } from '../../../../shared/chat/t3/proposedPlan';
import { Markdown } from '../markdown';
import { waitingLabel } from './pendingModel';

export interface PlanCardProps {
  pending: Extract<Pending, { kind: 'plan' }>;
  waiting: number;
  /** The adjustment field is open (the chat box). */
  adjusting: boolean;
  onAnswer: (answer: PendingAnswer) => void;
  onAdjust: () => void;
  onOpenExternal: (url: string) => void;
  onOpenOrigin?: () => void;
}

export function PlanCard({
  pending,
  waiting,
  adjusting,
  onAnswer,
  onAdjust,
  onOpenExternal,
  onOpenOrigin,
}: PlanCardProps): React.JSX.Element {
  const markdown = pending.payload.markdown;
  const preview = useMemo(() => buildCollapsedPlanPreview(markdown), [markdown]);
  const stepCount = useMemo(() => planStepCount(markdown), [markdown]);
  const [expanded, setExpanded] = useState(!preview.collapsed);
  const title = preview.title ?? 'Plano proposto';

  const toggle = (
    <PendingIconButton
      label={expanded ? 'Recolher o plano' : 'Expandir o plano'}
      expanded={expanded}
      onClick={() => setExpanded((open) => !open)}
    >
      {expanded ? <ChevronUp size={16} strokeWidth={1.75} /> : <ChevronDown size={16} strokeWidth={1.75} />}
    </PendingIconButton>
  );

  return (
    <PendingFrame
      ariaLabel={adjusting ? 'Plano aguardando ajuste' : 'Plano proposto pelo Claude'}
      icon={<ListChecks size={16} strokeWidth={1.75} />}
      title="Plano proposto"
      headerExtra={<PendingNote>{adjusting ? 'aguardando o seu ajuste' : 'aguardando a sua aprovação'}</PendingNote>}
      aside={
        <>
          {stepCount !== null ? <AnnotationTag tone="muted">{`${stepCount} passos`}</AnnotationTag> : null}
          {adjusting ? null : toggle}
        </>
      }
      waiting={waitingLabel(waiting)}
      origin={pending.scope === 'main' ? undefined : { name: pending.scope.description, onOpen: onOpenOrigin }}
      bodyOverride={adjusting ? <PlanCollapsedTitle>{title}</PlanCollapsedTitle> : undefined}
      footer={
        adjusting ? undefined : (
          <>
            <Button variant="primary" onClick={() => onAnswer({ kind: 'plan-approve' })} data-testid="pending-plan-approve">
              Aprovar e seguir
            </Button>
            <Button variant="secondary" onClick={onAdjust} data-testid="pending-plan-adjust">
              Pedir ajuste
            </Button>
            <PendingSpacer />
            <PendingNote>Aprovar libera o Claude para executar o plano.</PendingNote>
          </>
        )
      }
      data-testid="pending-plan"
    >
      <PlanBody>
        <PlanTitle>{title}</PlanTitle>
        <Markdown
          source={expanded || !preview.collapsed ? stripDisplayedPlanMarkdown(markdown) : preview.previewMarkdown}
          onOpenExternal={onOpenExternal}
        />
      </PlanBody>
    </PendingFrame>
  );
}
