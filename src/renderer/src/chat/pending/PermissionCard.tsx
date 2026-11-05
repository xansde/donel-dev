// 014-chat (T078) - permission request card (FR-022): "O Claude quer <verbo>" + object in a mono chip, the
// Claude-written description verbatim (D-C12), the diff of Edit/Write scrolling inside (D-C14) and three exits:
// Permitir / Permitir sempre (the label says the rule really written, D-C13) / Negar (+ optional reason).

import {
  Button,
  ClaudeNote,
  DenyField,
  DenyForm,
  DiffBlock,
  DiffStat,
  Kbd,
  MonoChip,
  PendingActions,
  PendingFooterStack,
  PendingFrame,
  PendingIndent,
  PendingNote,
  PendingSpacer,
  TextInput,
} from '@donel-dev/design-system';
import { ShieldAlert } from 'lucide-react';
import { Fragment, useMemo, useState, type KeyboardEvent } from 'react';
import type { PendingAnswer } from '../../../../shared/chat/ipc';
import { allowAlwaysLabel, permissionDescription, permissionSentence } from '../../../../shared/chat/pendingText';
import type { Pending } from '../../../../shared/chat/rows';
import { diffToLines, waitingLabel } from './pendingModel';

/** Height (px) the diff may take before it scrolls inside the card. */
const DIFF_MAX_HEIGHT = 170;

export interface PermissionCardProps {
  pending: Extract<Pending, { kind: 'permission' }>;
  waiting: number;
  onAnswer: (answer: PendingAnswer) => void;
  onOpenOrigin?: () => void;
  /** Turns on Modo YOLO for the tab's project and approves this request. Absent = no project to turn it on for. */
  onYolo?: () => void;
}

/** "sempre: `Bash(npm install:*)`" -> text with the rule in <code>. */
function RuleLabel({ label }: { label: string }): React.JSX.Element {
  const parts = label.split('`');
  return (
    <>
      {parts.map((part, i) => (
        <Fragment key={i}>{i % 2 === 1 ? <code>{part}</code> : part}</Fragment>
      ))}
    </>
  );
}

export function PermissionCard({ pending, waiting, onAnswer, onOpenOrigin, onYolo }: PermissionCardProps): React.JSX.Element {
  const payload = pending.payload;
  const sentence = permissionSentence(payload);
  const description = permissionDescription(payload);
  const diff = useMemo(() => (payload.diff !== undefined ? diffToLines(payload.diff) : null), [payload.diff]);
  const filePath = typeof payload.toolInput.file_path === 'string' ? payload.toolInput.file_path : undefined;
  const [denying, setDenying] = useState(false);
  const [reason, setReason] = useState('');

  const sendDeny = (): void => {
    const text = reason.trim();
    onAnswer(text === '' ? { kind: 'deny' } : { kind: 'deny', reason: text });
  };

  const onReasonKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Escape') {
      // D-C24 case 2: Esc in the reason field only cancels the field.
      event.preventDefault();
      event.stopPropagation();
      setDenying(false);
      setReason('');
    } else if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
      event.preventDefault();
      sendDeny();
    }
  };

  return (
    <PendingFrame
      ariaLabel="Pedido de permissão"
      icon={<ShieldAlert size={18} strokeWidth={1.75} />}
      title={`O Claude quer ${sentence.verb}`}
      headerExtra={
        <>
          <MonoChip title={sentence.object}>{sentence.object}</MonoChip>
          {diff !== null ? <DiffStat added={diff.added} removed={diff.removed} /> : null}
        </>
      }
      waiting={waitingLabel(waiting)}
      origin={pending.scope === 'main' ? undefined : { name: pending.scope.description, onOpen: onOpenOrigin }}
      footer={
        <PendingFooterStack>
          <PendingActions>
            <Button variant="primary" onClick={() => onAnswer({ kind: 'allow' })} data-testid="pending-allow">
              Permitir
            </Button>
            <Button variant="secondary" onClick={() => onAnswer({ kind: 'allow-always' })} data-testid="pending-allow-always">
              Permitir sempre neste projeto
            </Button>
            {onYolo !== undefined ? (
              <Button
                variant="secondary"
                onClick={onYolo}
                title="Liga o Modo YOLO: neste projeto o agente passa a agir sem perguntar. Desliga na engrenagem do projeto."
                data-testid="pending-yolo"
              >
                YOLO neste projeto
              </Button>
            ) : null}
            <Button
              variant="danger"
              aria-expanded={denying}
              onClick={() => setDenying((open) => !open)}
              data-testid="pending-deny"
            >
              Negar
            </Button>
            <PendingSpacer />
            <PendingNote>
              <RuleLabel label={allowAlwaysLabel(payload)} />
            </PendingNote>
            <PendingNote>
              <Kbd>Esc</Kbd> nega
            </PendingNote>
          </PendingActions>
          {denying ? (
            <DenyForm>
              <DenyField>
                <TextInput
                  autoFocus
                  label="Motivo (opcional)"
                  placeholder="O Claude lê o motivo e ajusta o caminho"
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  onKeyDown={onReasonKeyDown}
                  data-testid="pending-deny-reason"
                />
              </DenyField>
              <Button variant="danger" onClick={sendDeny} data-testid="pending-deny-send">
                Negar e enviar
              </Button>
            </DenyForm>
          ) : null}
        </PendingFooterStack>
      }
      data-testid="pending-permission"
    >
      {description !== null ? <ClaudeNote>{description}</ClaudeNote> : null}
      {diff !== null ? (
        <PendingIndent>
          <DiffBlock lines={diff.lines} path={filePath} showAll maxHeight={DIFF_MAX_HEIGHT} />
        </PendingIndent>
      ) : null}
    </PendingFrame>
  );
}
