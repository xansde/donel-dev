// Ledger v5, fatia 1 — the box "Esperando você" (docs/planos/ledger-v5.md 1.8; prototype variant A, on top of the
// Oráculo as the owner chose in D5). Everything that waits for the owner, grouped by kind, each item with its verb.
// The list is pure (`ownerInbox`, shared/ledger/inbox.ts); deciding still happens on the cards (`LedgerCards`), which
// open on the item picked. The kinds v4 has no operation for (a stuck letter, a send to check, an orphan) open their
// details and say what to do: the box never writes anything of its own.

import { useEffect, useState } from 'react';
import { lastDelivery, slackDestinationLabel, slackLetterText, slackSendState, type LedgerTask } from '../../../shared/ledger/contract';
import type { OwnerInboxItem, OwnerInboxKind } from '../../../shared/ledger/inbox';
import { actorLabel, type PlaceNameOf } from '../../../shared/ledger/labels';
import { LedgerCards } from './LedgerCards';
import styles from './OwnerInbox.module.css';

/** "12 min", "5 h", "3 dias". */
export function waitedFor(since: number, now: number): string {
  const minutes = Math.max(0, Math.round((now - since) / 60_000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${hours} h` : `${Math.round(hours / 24)} dias`;
}

interface KindView {
  readonly label: string;
  readonly glyph: string;
  /** The button of the item: on the card kinds it opens the card, on the others the details. */
  readonly verb: string;
  /** What the owner does about it, on the kinds the card does not cover. */
  readonly hint?: string;
}

const KINDS: Readonly<Record<OwnerInboxKind, KindView>> = {
  'decidir-entrega': { label: 'Decidir entrega', glyph: '◆', verb: 'Decidir' },
  'aprovar-carta': { label: 'Aprovar carta', glyph: '✉', verb: 'Ver a carta' },
  'entrega-parada': { label: 'Entrega parada', glyph: '◇', verb: 'Decidir' },
  'para-repassar': {
    label: 'Para repassar',
    glyph: '→',
    verb: 'Ver detalhes',
    hint: 'Ninguém está fazendo. Peça ao Líder, pelo Jobu, para passar adiante ou cancelar.',
  },
  'carta-parada': {
    label: 'Carta parada',
    glyph: '✉',
    verb: 'Ver a carta',
    hint: 'Você aceitou e ela não saiu. Quem envia é a sessão que escreveu; se ela fechou, peça ao Líder pelo Jobu.',
  },
  'conferir-envio': { label: 'Conferir envio', glyph: '⚠', verb: 'Ver o envio', hint: 'Confira no Slack se a mensagem chegou.' },
  'amostra-revisor': { label: 'Amostra do Revisor', glyph: '✓', verb: 'Conferir' },
};

/** The kinds whose verb is on the card: the box opens the cards on them. */
const CARD_KINDS: ReadonlySet<OwnerInboxKind> = new Set(['decidir-entrega', 'aprovar-carta', 'entrega-parada', 'amostra-revisor']);

function folder(projectPath: string): string {
  return projectPath.split(/[\\/]/).filter(Boolean).pop() ?? projectPath;
}

function clip(text: string, max: number): string {
  const line = text.replace(/\s+/g, ' ').trim();
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line;
}

function titleOf(task: LedgerTask): string {
  const delivery = lastDelivery(task);
  return clip(task.title ?? delivery?.forOwner?.title ?? delivery?.forOwner?.question ?? task.request, 90);
}

/** Who the item is about: whoever delivered, or the owner place by its name. */
function whoOf(task: LedgerTask, placeName: PlaceNameOf | undefined): string {
  const delivery = lastDelivery(task);
  if (delivery) return actorLabel(delivery.by, task.projectPath, placeName);
  return placeName?.(task.projectPath, task.ownerPlaceId)?.trim() || 'um lugar que já fechou';
}

const SEND_LINES: Readonly<Record<ReturnType<typeof slackSendState>, string>> = {
  nenhum: 'Ainda não saiu.',
  'sem-confirmacao': 'Saiu, e o Slack não respondeu se chegou.',
  confirmado: 'O Slack confirmou.',
  falhou: 'O Slack recusou; ela ainda pode ser enviada de novo uma vez.',
  esgotada: 'O Slack recusou duas vezes; esta carta não sai mais.',
};

function Details({ task }: { readonly task: LedgerTask }): React.JSX.Element {
  return (
    <div className={styles.details}>
      {task.slack ? (
        <>
          <p className={styles.detailLabel}>
            Para {slackDestinationLabel(task.slack)}
            {task.slack.thread ? ' (na thread)' : ''}
          </p>
          <pre className={styles.letter}>{slackLetterText(task.slack)}</pre>
          <p className={styles.detailLabel}>{SEND_LINES[slackSendState(task)]}</p>
        </>
      ) : (
        <>
          <p className={styles.detailLabel}>O pedido</p>
          <pre className={styles.letter}>{task.request}</pre>
        </>
      )}
    </div>
  );
}

function Item({
  item,
  now,
  placeName,
  showBoard,
  onOpenCard,
}: {
  readonly item: OwnerInboxItem;
  readonly now: number;
  readonly placeName?: PlaceNameOf;
  readonly showBoard: boolean;
  readonly onOpenCard: (id: string) => void;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const { task } = item;
  const view = KINDS[item.kind];
  const onCard = CARD_KINDS.has(item.kind);
  const meta = [
    showBoard ? folder(task.projectPath) : null,
    task.slack ? `para ${slackDestinationLabel(task.slack)}` : null,
    whoOf(task, placeName),
    `há ${waitedFor(item.since, now)}`,
  ].filter(Boolean);
  return (
    <li className={styles.item} data-testid="owner-inbox-item" data-kind={item.kind}>
      <div className={styles.itemHead}>
        <b className={styles.itemTitle}>{titleOf(task)}</b>
        {task.risk === 'alto' ? <span className={styles.risk}>risco alto</span> : null}
      </div>
      <p className={styles.meta}>{meta.join(' · ')}</p>
      {item.why ? <p className={styles.why}>{item.why[0]!.toUpperCase() + item.why.slice(1)}.</p> : null}
      {open ? (
        <>
          <Details task={task} />
          {view.hint ? <p className={styles.hint}>{view.hint}</p> : null}
        </>
      ) : null}
      <div className={styles.verbs}>
        {onCard ? (
          <button type="button" className={styles.primary} onClick={() => onOpenCard(task.id)}>
            {view.verb}
          </button>
        ) : (
          <button type="button" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
            {open ? 'Recolher' : view.verb}
          </button>
        )}
      </div>
    </li>
  );
}

export function OwnerInbox({
  items,
  now,
  placeName,
  showBoard = false,
  onClose,
}: {
  readonly items: readonly OwnerInboxItem[];
  readonly now: number;
  readonly placeName?: PlaceNameOf;
  /** Items of several boards: each says its board. */
  readonly showBoard?: boolean;
  /** Present = the box opens over the board (the strip): "Fechar" and Esc. */
  readonly onClose?: () => void;
}): React.JSX.Element | null {
  const [cardFor, setCardFor] = useState<string | null>(null);

  useEffect(() => {
    if (!onClose || cardFor !== null) return undefined;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, cardFor]);

  if (items.length === 0) return null;
  // Groups in the order of their first item: what blocks someone comes first, as in the list.
  const groups = new Map<OwnerInboxKind, OwnerInboxItem[]>();
  for (const item of items) groups.set(item.kind, [...(groups.get(item.kind) ?? []), item]);
  const oldest = Math.min(...items.map((item) => item.since));
  const cardQueue = items.filter((item) => CARD_KINDS.has(item.kind)).map((item) => item.task);

  return (
    // Over the board the box scrolls inside a fixed layer, so the cards' veil (absolute) covers the layer, not the scroll.
    <div className={onClose ? styles.overlay : undefined}>
      <section className={styles.inbox} aria-label="Esperando você" data-testid="owner-inbox">
        <header className={styles.head}>
          <div className={styles.count}>
            <small>Esperando você</small>
            <b>{items.length}</b>
          </div>
          <div className={styles.headText}>
            <h2>Tudo o que depende de você, em um lugar</h2>
            <p>Primeiro o que trava alguém, depois o prazo, depois a idade. A mais antiga espera há {waitedFor(oldest, now)}.</p>
          </div>
          {onClose ? (
            <button type="button" className={styles.close} onClick={onClose}>
              Fechar (Esc)
            </button>
          ) : null}
        </header>
        <div className={styles.grid}>
          {[...groups].map(([kind, group]) => (
            <div key={kind} className={styles.group} data-kind={kind}>
              <h3 className={styles.groupHead}>
                <span aria-hidden="true">{KINDS[kind].glyph}</span> {KINDS[kind].label} <span className={styles.groupCount}>{group.length}</span>
              </h3>
              <ul className={styles.items}>
                {group.map((item) => (
                  <Item key={item.task.id} item={item} now={now} placeName={placeName} showBoard={showBoard} onOpenCard={setCardFor} />
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>
      {cardFor !== null && cardQueue.length > 0 ? (
        <LedgerCards queue={cardQueue} placeName={placeName} initialId={cardFor} onClose={() => setCardFor(null)} />
      ) : null}
    </div>
  );
}
