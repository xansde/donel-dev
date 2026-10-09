// 014-chat (T078) - AskUserQuestion card: up to 4 questions, ONE "Responder" (FR-021). Cards with label and
// description, the preview of the picked option in a column, multiple choice in a grid with no orphan option, "Outra" last
// with a TextInput. With 2+ questions, ONE is shown at a time (tabs + Anterior/Próxima); answers are all sent together. "(Recomendado)" is styled but the label sent back stays exactly as the CLI wrote it (D-C15).

import {
  Button,
  ChoiceCard,
  OtherChoice,
  PendingFrame,
  PendingNote,
  PendingSpacer,
  PreviewPane,
  QuestionBlock,
  SegmentedControl,
  TextInput,
} from '@donel-dev/design-system';
import { CircleHelp } from 'lucide-react';
import { useId, useRef, useState } from 'react';
import type { PendingAnswer } from '../../../../shared/chat/ipc';
import type { Pending, Question } from '../../../../shared/chat/rows';
import {
  areAllQuestionsAnswered,
  buildQuestionAnswers,
  isQuestionAnswered,
  limitQuestions,
  setCustomAnswer,
  toggleOption,
  type QuestionDraft,
  type QuestionDrafts,
} from '../../../../shared/chat/t3/pendingUserInput';
import { choiceColumns, previewForQuestion, questionPager, splitRecommended, stepRadio, waitingLabel } from './pendingModel';

export interface QuestionCardProps {
  pending: Extract<Pending, { kind: 'question' }>;
  waiting: number;
  onAnswer: (answer: PendingAnswer) => void;
  onOpenOrigin?: () => void;
}

/** Single choice starts on the "(Recomendado)" option, as in the design. */
function initialDrafts(questions: readonly Question[]): QuestionDrafts {
  const drafts: Record<string, QuestionDraft> = {};
  for (const q of questions) {
    if (q.multiSelect) continue;
    const rec = q.options.find((o) => splitRecommended(o.label).recommended);
    if (rec !== undefined) drafts[q.question] = { selected: [rec.label], custom: '' };
  }
  return drafts;
}

interface OneQuestionProps {
  question: Question;
  index: number;
  draft: QuestionDraft | undefined;
  onChange: (draft: QuestionDraft) => void;
}

function OneQuestion({ question, index, draft, onChange }: OneQuestionProps): React.JSX.Element {
  const titleId = useId();
  const multiple = question.multiSelect === true;
  const customActive = (draft?.custom.trim() ?? '') !== '';
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const checkedAt = customActive ? -1 : question.options.findIndex((o) => draft?.selected.includes(o.label));
  const tabStop = checkedAt >= 0 ? checkedAt : 0;
  const preview = previewForQuestion(question, draft);

  const options = question.options.map((option, i) => {
    const { base, recommended } = splitRecommended(option.label);
    const checked = !customActive && (draft?.selected.includes(option.label) ?? false);
    return (
      <ChoiceCard
        key={option.label}
        ref={(el) => {
          refs.current[i] = el;
        }}
        kind={multiple ? 'checkbox' : 'radio'}
        checked={checked}
        label={base}
        recommended={recommended}
        description={option.description}
        compact={multiple}
        tabIndex={multiple ? undefined : i === tabStop ? 0 : -1}
        onSelect={() => onChange(toggleOption(question, draft, option.label))}
        onKeyDown={
          multiple
            ? undefined
            : (event) => {
                const next = stepRadio(i, question.options.length, event.key);
                if (next === null) return;
                event.preventDefault();
                refs.current[next]?.focus();
                onChange(toggleOption(question, draft, question.options[next]!.label));
              }
        }
        data-testid="pending-option"
      />
    );
  });

  return (
    <QuestionBlock
      number={index + 1}
      title={question.question}
      titleId={titleId}
      hint={multiple ? 'escolha uma ou mais' : 'escolha uma'}
      multiple={multiple}
      columns={choiceColumns(question.options.length)}
      options={options}
      other={
        <OtherChoice kind={multiple ? 'checkbox' : 'radio'} active={customActive}>
          <TextInput
            aria-label={`Outra resposta: ${question.question}`}
            placeholder="Escreva a sua resposta"
            value={draft?.custom ?? ''}
            onChange={(event) => onChange(setCustomAnswer(draft, event.target.value))}
            data-testid="pending-other"
          />
        </OtherChoice>
      }
      preview={preview.show ? <PreviewPane>{preview.text}</PreviewPane> : undefined}
    />
  );
}

export function QuestionCard({ pending, waiting, onAnswer, onOpenOrigin }: QuestionCardProps): React.JSX.Element {
  const questions = limitQuestions(pending.payload.questions);
  const [drafts, setDrafts] = useState<QuestionDrafts>(() => initialDrafts(questions));
  const ready = areAllQuestionsAnswered(questions, drafts);
  const many = questions.length > 1;
  const [requestedPage, setPage] = useState(0);
  const pager = questionPager(requestedPage, questions.length);
  const question = questions[pager.page];

  const submit = (): void => {
    const answers = buildQuestionAnswers(questions, drafts);
    if (answers !== null) onAnswer({ kind: 'answers', answers });
  };

  return (
    <PendingFrame
      ariaLabel="Pergunta do Claude"
      icon={<CircleHelp size={16} strokeWidth={1.75} />}
      title="O Claude pergunta"
      headerExtra={<PendingNote>{many ? `${pager.label} · uma resposta` : 'uma pergunta'}</PendingNote>}
      waiting={waitingLabel(waiting)}
      origin={pending.scope === 'main' ? undefined : { name: pending.scope.description, onOpen: onOpenOrigin }}
      footer={
        <>
          <PendingNote>
            {many ? 'Responder envia as respostas juntas.' : 'Responder envia a resposta.'} O Claude espera por você.
          </PendingNote>
          <PendingSpacer />
          {many && pager.hasPrev ? (
            <Button onClick={() => setPage(pager.page - 1)} data-testid="pending-prev">
              Anterior
            </Button>
          ) : null}
          {many && pager.hasNext ? (
            <Button onClick={() => setPage(pager.page + 1)} data-testid="pending-next">
              Próxima
            </Button>
          ) : null}
          <Button variant="primary" disabled={!ready} onClick={submit} data-testid="pending-answer">
            Responder
          </Button>
        </>
      }
      data-testid="pending-question"
    >
      {many ? (
        <SegmentedControl
          ariaLabel="Perguntas"
          value={String(pager.page)}
          onChange={(value) => setPage(Number(value))}
          options={questions.map((q, i) => ({
            value: String(i),
            label: `${i + 1}${isQuestionAnswered(q, drafts[q.question]) ? ' ✓' : ''}`,
          }))}
        />
      ) : null}
      {question !== undefined ? (
        <OneQuestion
          key={question.question}
          question={question}
          index={pager.page}
          draft={drafts[question.question]}
          onChange={(draft) => setDrafts((current) => ({ ...current, [question.question]: draft }))}
        />
      ) : null}
    </PendingFrame>
  );
}
