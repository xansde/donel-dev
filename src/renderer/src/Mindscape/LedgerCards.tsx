// Cartas forma A (spec docs/specs/cartas-forma-a.md, fatia 3) — "esperando você" on the desktop opens the cards
// over the board, as in docs/prototipos/carta-oraculo/final.html: the hand on the left, the big card in the
// middle. The front decides (question, visual, recommendation, named options), the back explains (what happened,
// why, each path with its risk, who did it by name; the request and the technical details folded away). A delivery
// without the owner block, and the Revisor's daily sample, keep the old card: one face with the request, the
// criterion, the note and the proofs. Every decision goes to the main as the owner.

import { useEffect, useState } from 'react';
import {
  lastDelivery,
  recommendedOption,
  type LedgerForOwner,
  type LedgerOption,
  type LedgerProof,
  type LedgerTask,
  type LedgerVisual,
  type SlackLetter,
} from '../../../shared/ledger/contract';
import { proofUrl } from '../../../shared/ledger/channels';
import { actorLabel, naipeDoPapel, reciboDe, slackRecipient, type PlaceNameOf } from '../../../shared/ledger/labels';
import type { Naipe } from '../../../shared/celular';
import styles from './LedgerCards.module.css';

// Own glyphs, the same strokes as the phone (src/main/celular/pwa/app.js).
const GLYPHS: Readonly<Record<Naipe, string>> = {
  martelos: '<svg viewBox="0 0 24 24"><path d="M5.5 3.5l5 5-2.8 2.8-5-5z"/><path d="M8.2 6.2l3.3-3.3 2.6 2.6-3.3 3.3"/><path d="M10.4 11.2L20 20.8"/><path d="M14 4.5l1.5-1.5"/></svg>',
  escudos: '<svg viewBox="0 0 24 24"><path d="M12 2.8l7.5 3v5.4c0 5-3.6 8.6-7.5 10-3.9-1.4-7.5-5-7.5-10V5.8z"/><path d="M12 6.5v11M7.8 11h8.4"/></svg>',
  chaves: '<svg viewBox="0 0 24 24"><circle cx="7" cy="12" r="3.6"/><circle cx="7" cy="12" r="1.1"/><path d="M10.6 12H21.5M17.5 12v3.2M20.5 12v2.3"/></svg>',
  livros: '<svg viewBox="0 0 24 24"><path d="M3.5 5.2c3-1.1 6-1 8.5 1 2.5-2 5.5-2.1 8.5-1v13.6c-3-1.1-6-1-8.5 1-2.5-2-5.5-2.1-8.5-1z"/><path d="M12 6.2v13.6M6 9c1.5-.3 2.8-.1 4 .5M6 12c1.5-.3 2.8-.1 4 .5M14 9.5c1.2-.6 2.5-.8 4-.5"/></svg>',
  estrelas: '<svg viewBox="0 0 24 24"><path d="M12 2.2l1.9 6.3 6.2-2.2-3.6 5.7 3.6 5.7-6.2-2.2L12 21.8l-1.9-6.3-6.2 2.2 3.6-5.7-3.6-5.7 6.2 2.2z"/><circle cx="12" cy="12" r="1.6"/></svg>',
  coroas: '<svg viewBox="0 0 24 24"><path d="M3 8.2l4.6 4.1L12 4.8l4.4 7.5L21 8.2l-2 10.6H5z"/><path d="M5.6 15.6h12.8"/><circle cx="12" cy="4" r=".6"/></svg>',
};
const SUIT_NAMES: Readonly<Record<Naipe, string>> = { martelos: 'Martelos', escudos: 'Escudos', chaves: 'Chaves', livros: 'Livros', estrelas: 'Estrelas', coroas: 'Coroas' };

function roman(n: number): string {
  const table: [number, string][] = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
  let out = '';
  for (const [value, letters] of table) while (n >= value) {
    out += letters;
    n -= value;
  }
  return out;
}

function when(at: number): string {
  return new Date(at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function folder(projectPath: string): string {
  return projectPath.split(/[\\/]/).filter(Boolean).pop() ?? projectPath;
}

type Decide = (decision: { accept: true; option?: string; text?: string } | { accept: false; reason: string; option?: string; text?: string }) => Promise<string | null>;

function newRequestId(): string {
  return crypto.randomUUID().replace(/-/g, '');
}

/**
 * "✎ Escrever para <quem fez>" (Parte B): free text. "Enviar" sends it at once to the session that owns the task (or
 * the Líder) and the card keeps waiting; picking a path with it written takes it along with the decision.
 */
function WriteBox({ task, who, draft, onDraft }: { readonly task: LedgerTask; readonly who: string; readonly draft: string; readonly onDraft: (text: string) => void }): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<{ text: string; receipt: string }[]>([]);
  // The same request id while the text does not change: a second click joins the first send.
  const [requestId, setRequestId] = useState(newRequestId);
  const send = async (): Promise<void> => {
    const text = draft.trim();
    if (!text || busy) return;
    setBusy(true);
    setError(null);
    const result = await window.donel.ledger.comment({ id: task.id, text, requestId }).catch(() => null);
    setBusy(false);
    if (!result) return setError('O app não respondeu.');
    if (!result.ok) return setError(result.reason);
    setSent((list) => [...list, { text, receipt: reciboDe(result.deliveredTo, who, result.at) }]);
    onDraft('');
    setRequestId(newRequestId());
    setOpen(false);
  };
  return (
    <div>
      <button type="button" className={styles.write} onClick={() => setOpen((value) => !value)}>
        ✎ Escrever para {who} (pergunta, ajuste, outra opção)
      </button>
      {open ? (
        <div className={styles.writeBox}>
          <textarea
            value={draft}
            maxLength={2000}
            onChange={(event) => {
              onDraft(event.target.value);
              setRequestId(newRequestId());
            }}
            placeholder="O que você quer dizer a quem fez"
            autoFocus
          />
          <small>Enviar manda agora. Se você escolher um caminho com isto escrito, vai junto da decisão.</small>
          <button type="button" disabled={busy || !draft.trim()} onClick={() => void send()}>
            {busy ? 'Enviando…' : 'Enviar'}
          </button>
        </div>
      ) : null}
      {error ? <div className={styles.error}>{error}</div> : null}
      {sent.map((item, i) => (
        <div key={i} className={styles.sent}>
          <p>“{item.text}”</p>
          <small>{item.receipt}</small>
        </div>
      ))}
    </div>
  );
}

/** What the owner wrote on the card and the answers (re-deliveries), in order. */
function Conversation({ task, who }: { readonly task: LedgerTask; readonly who: string }): React.JSX.Element | null {
  const first = task.events.find((event) => event.kind === 'entregue');
  const lines = task.events.flatMap((event): { at: number; mine: boolean; text: string; receipt?: string }[] => {
    if (event.kind === 'comentada' && event.text) return [{ at: event.at, mine: true, text: event.text, receipt: reciboDe(event.deliveredTo, who, event.at) }];
    if (event.kind === 'entregue' && event !== first && task.events.some((other) => other.kind === 'comentada' && other.at <= event.at)) {
      const text = event.forOwner?.summary ?? event.text;
      return text ? [{ at: event.at, mine: false, text }] : [];
    }
    return [];
  });
  if (lines.length === 0) return null;
  return (
    <>
      <h4>A conversa</h4>
      {lines.map((line, i) => (
        <div key={i} className={line.mine ? `${styles.line} ${styles.lineMine}` : styles.line}>
          <b>{line.mine ? 'Você' : who}</b>
          <p>{line.text}</p>
          {line.receipt ? <small>{line.receipt}</small> : null}
        </div>
      ))}
    </>
  );
}

function Glyph({ naipe }: { readonly naipe: Naipe }): React.JSX.Element {
  return <span className={styles.glyph} aria-hidden="true" dangerouslySetInnerHTML={{ __html: GLYPHS[naipe] }} />;
}

function ProofImage({ task, index, alt }: { readonly task: LedgerTask; readonly index: number; readonly alt: string }): React.JSX.Element {
  const [src, setSrc] = useState<string | null>(null);
  const [big, setBig] = useState(false);
  useEffect(() => {
    let alive = true;
    void window.donel.ledger
      .proofImage(task.id, index)
      .then((url) => {
        if (alive) setSrc(url);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [task.id, index]);
  if (!src) return <div className={styles.mediaEmpty}>Carregando o print…</div>;
  return (
    <button type="button" className={big ? `${styles.mediaButton} ${styles.mediaBig}` : styles.mediaButton} onClick={() => setBig((value) => !value)} title={big ? 'Fechar' : 'Ampliar'}>
      <img className={styles.media} src={src} alt={alt} />
    </button>
  );
}

/**
 * The prototype (an agent's HTML) running INSIDE the card, isolated: `sandbox="allow-scripts"` without
 * `allow-same-origin` (opaque origin: no `window.donel`, no storage of the app), and `donel-prova:` sends it with a
 * CSP without network. No `allow-top-navigation`, no `allow-popups`.
 */
function Prototype({ file }: { readonly file: string }): React.JSX.Element {
  const [full, setFull] = useState(false);
  return (
    <div className={full ? `${styles.prototype} ${styles.prototypeFull}` : styles.prototype}>
      <iframe className={styles.prototypeFrame} sandbox="allow-scripts" src={proofUrl(file)} title="Protótipo anexado à entrega" referrerPolicy="no-referrer" />
      <button type="button" className={styles.fullButton} onClick={() => setFull((value) => !value)}>
        {full ? '✕ Fechar' : '⤢ Tela cheia'}
      </button>
    </div>
  );
}

/** A file proof on the front: a print, a video or the prototype, all inside the card. */
function ProofMedia({ task, index }: { readonly task: LedgerTask; readonly index: number }): React.JSX.Element | null {
  const proof = lastDelivery(task)?.proofs?.[index];
  if (proof?.kind !== 'arquivo') return null;
  if (proof.mediaType.startsWith('image/')) return <ProofImage task={task} index={index} alt="Print da entrega" />;
  if (proof.mediaType === 'text/html') return <Prototype file={proof.file} />;
  return <video className={styles.media} controls src={proofUrl(proof.file)} />;
}

function Visual({ task, visual }: { readonly task: LedgerTask; readonly visual: LedgerVisual }): React.JSX.Element {
  if (visual.kind === 'checagens') {
    const ok = visual.checks.filter((check) => check.ok).length;
    return (
      <div className={styles.vis}>
        <h5>
          <span>Checagens</span>
          <span>
            {ok} de {visual.checks.length} ok
          </span>
        </h5>
        <ul className={styles.lights}>
          {visual.checks.map((check, i) => (
            <li key={i} className={check.ok ? styles.lightOk : styles.lightWarn}>
              <i aria-hidden="true">{check.ok ? '✓' : '!'}</i>
              <b>{check.name}</b>
              {/* The sentence only where it did not pass: what is ok needs no reading. */}
              {check.ok ? null : <span>{check.sentence}</span>}
            </li>
          ))}
        </ul>
      </div>
    );
  }
  if (visual.kind === 'antes-depois') {
    return (
      <div className={`${styles.vis} ${styles.beforeAfter}`}>
        <div>
          <div className={styles.legend}>Antes</div>
          <ProofMedia task={task} index={visual.before} />
        </div>
        <div>
          <div className={styles.legend}>Depois</div>
          <ProofMedia task={task} index={visual.after} />
        </div>
      </div>
    );
  }
  return (
    <div className={styles.vis}>
      <ProofMedia task={task} index={visual.proof} />
    </div>
  );
}

function ProofDetail({ proof }: { readonly proof: LedgerProof }): React.JSX.Element {
  if (proof.kind === 'arquivo' && proof.mediaType === 'text/html') return <Prototype file={proof.file} />;
  if (proof.kind === 'texto') {
    return (
      <details className={styles.proofText}>
        <summary>Saída ({proof.text.length} caracteres)</summary>
        <pre>{proof.text}</pre>
      </details>
    );
  }
  const label = proof.kind === 'link' ? proof.url : proof.mediaType.startsWith('video/') ? 'Abrir vídeo' : 'Abrir print';
  return (
    <button type="button" className={styles.link} onClick={() => void window.donel.ledger.openProof(proof)} title={proof.kind === 'link' ? proof.url : proof.file}>
      {label}
    </button>
  );
}

/** Request + technical details, folded away (the back of the card A, the body of the old card). */
function Folded({ task, open }: { readonly task: LedgerTask; readonly open?: boolean }): React.JSX.Element {
  const delivery = lastDelivery(task);
  return (
    <>
      <details className={styles.folded} open={open}>
        <summary>O que você pediu, nas suas palavras</summary>
        <blockquote>“{task.request}”</blockquote>
      </details>
      <details className={styles.folded} open={open}>
        <summary>Detalhes técnicos</summary>
        <h6>Pronto quando</h6>
        <p>{task.doneWhen}</p>
        {delivery?.text ? (
          <>
            <h6>Nota de quem entregou</h6>
            <p>{delivery.text}</p>
          </>
        ) : null}
        {delivery?.proofs?.length ? (
          <>
            <h6>{delivery.proofs.length === 1 ? 'Prova' : 'Provas'}</h6>
            <div className={styles.proofs}>
              {delivery.proofs.map((proof, index) => (
                <ProofDetail key={index} proof={proof} />
              ))}
            </div>
          </>
        ) : null}
        <div className={styles.ids}>
          tarefa {task.id}
          {delivery?.by.kind === 'lugar' ? ` · lugar ${delivery.by.placeId}` : ''}
        </div>
      </details>
    </>
  );
}

function CardA({
  task,
  forOwner,
  naipe,
  index,
  count,
  who,
  decide,
}: {
  readonly task: LedgerTask;
  readonly forOwner: LedgerForOwner;
  readonly naipe: Naipe;
  readonly index: number;
  readonly count: number;
  readonly who: string;
  readonly decide: Decide;
}): React.JSX.Element {
  const [flipped, setFlipped] = useState(false);
  const [marked, setMarked] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const recommended = recommendedOption(forOwner);
  const delivery = lastDelivery(task);
  const title = forOwner.title ?? task.title ?? folder(task.projectPath);

  // One click marks the path, a second one on it decides: a stray click never closes a task.
  const pick = async (option: LedgerOption): Promise<void> => {
    if (busy) return;
    if (marked !== option.label) {
      setMarked(option.label);
      setError(null);
      return;
    }
    setBusy(true);
    const text = draft.trim() ? { text: draft.trim() } : {};
    const why = await decide(option.closes === 'aceita' ? { accept: true, option: option.label, ...text } : { accept: false, reason: '', option: option.label, ...text });
    setBusy(false);
    if (why) setError(why);
  };

  return (
    <div className={styles.table}>
      <div className={flipped ? `${styles.card} ${styles.flipped}` : styles.card} data-naipe={naipe} data-testid="ledger-card">
        <div className={styles.face}>
          <div className={styles.frame}>
            <div className={styles.inner}>
              <header className={styles.head}>
                <Glyph naipe={naipe} />
                <span className={styles.suit}>{SUIT_NAMES[naipe]}</span>
                <span className={styles.index}>
                  {roman(index + 1)} · {roman(count)}
                </span>
              </header>
              <div className={styles.title}>
                <div className={styles.name}>{title}</div>
                <h3>{forOwner.question}</h3>
              </div>
              <div className={styles.scroll}>
                {forOwner.visual ? <Visual task={task} visual={forOwner.visual} /> : null}
                {recommended ? (
                  <p className={styles.rec}>
                    Recomendo <b>{recommended.label}</b>: {forOwner.why}
                  </p>
                ) : null}
                <div className={styles.options}>
                  {forOwner.options.map((option) => (
                    <button
                      key={option.label}
                      type="button"
                      disabled={busy}
                      className={[styles.option, option.recommended ? styles.optionRec : '', marked === option.label ? styles.optionMarked : ''].join(' ')}
                      onClick={() => void pick(option)}
                    >
                      <b>{option.label}</b>
                      {option.recommended ? <em>recomendo</em> : null}
                      <span>{marked === option.label ? 'Clique de novo para decidir.' : option.effect}</span>
                    </button>
                  ))}
                </div>
                {error ? <div className={styles.error}>{error}</div> : null}
                <WriteBox task={task} who={who} draft={draft} onDraft={setDraft} />
              </div>
              <footer className={styles.foot}>
                <span className={task.risk === 'alto' ? `${styles.seal} ${styles.sealHigh}` : `${styles.seal} ${styles.sealLow}`}>
                  <i>risco {task.risk}</i>
                  <span>{forOwner.risk}</span>
                </span>
                <button type="button" className={styles.flip} onClick={() => setFlipped(true)}>
                  ↻ Virar
                </button>
              </footer>
            </div>
          </div>
        </div>
        <div className={`${styles.face} ${styles.back}`}>
          <div className={styles.frame}>
            <div className={styles.inner}>
              <header className={styles.head}>
                <Glyph naipe={naipe} />
                <span className={styles.suit}>O verso</span>
                <button type="button" className={styles.flip} onClick={() => setFlipped(false)}>
                  ↻ Frente
                </button>
              </header>
              <div className={styles.backBody}>
                <h4>O que aconteceu</h4>
                <p>{forOwner.summary}</p>
                {recommended ? (
                  <>
                    <h4>Por que eu recomendo {recommended.label.toLowerCase()}</h4>
                    <p>{forOwner.why}</p>
                  </>
                ) : null}
                <h4>Cada caminho</h4>
                <dl>
                  {forOwner.options.map((option) => (
                    <div key={option.label}>
                      <dt>{option.label}</dt>
                      <dd>{option.effect}</dd>
                      {option.risk ? <dd className={styles.pathRisk}>Risco: {option.risk}</dd> : null}
                    </div>
                  ))}
                </dl>
                <h4>Risco {task.risk}</h4>
                <p>{forOwner.risk}</p>
                <Conversation task={task} who={who} />
                <h4>Quem fez</h4>
                <p>
                  {who}, no quadro {folder(task.projectPath)} · {when(delivery?.at ?? task.createdAt)} · prazo {task.due.split('-').reverse().join('/')}
                </p>
                <Folded task={task} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * A Slack letter (06/11, "um toque só"): first who it goes to, then the exact text, then "Enviar" and "Não enviar"
 * (with the reason). "Enviar" asks for a second click: the message leaves in the owner's name.
 */
function SlackCard({ task, slack, naipe, index, count, who, decide }: { readonly task: LedgerTask; readonly slack: SlackLetter; readonly naipe: Naipe; readonly index: number; readonly count: number; readonly who: string; readonly decide: Decide }): React.JSX.Element {
  const [armed, setArmed] = useState(false);
  const [refusing, setRefusing] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recipient = slackRecipient(slack);
  const run = async (send: boolean): Promise<void> => {
    if (busy) return;
    if (send && !armed) return setArmed(true);
    setBusy(true);
    const why = await decide(send ? { accept: true, option: 'Enviar' } : { accept: false, reason: reason.trim(), option: 'Não enviar' });
    setBusy(false);
    if (why) setError(why);
  };
  return (
    <div className={styles.table}>
      <div className={styles.card} data-naipe={naipe} data-testid="ledger-card">
        <div className={styles.face}>
          <div className={styles.frame}>
            <div className={styles.inner}>
              <header className={styles.head}>
                <Glyph naipe={naipe} />
                <span className={styles.suit}>Mensagem no Slack</span>
                <span className={styles.index}>
                  {roman(index + 1)} · {roman(count)}
                </span>
              </header>
              <div className={styles.scroll}>
                <div className={styles.slackTo}>
                  <small>Para</small>
                  <b>{recipient.name}</b>
                  <span>
                    {recipient.kindLabel} · {recipient.conversationLabel}
                  </span>
                </div>
                <h4 className={styles.slackLabel}>O texto, exatamente como sai</h4>
                <div className={styles.slackText}>{slack.text}</div>
                <div className={styles.slackActions}>
                  <button type="button" disabled={busy} className={styles.slackNo} onClick={() => setRefusing((value) => !value)}>
                    Não enviar
                  </button>
                  <button type="button" disabled={busy} className={armed ? `${styles.slackSend} ${styles.slackArmed}` : styles.slackSend} onClick={() => void run(true)}>
                    {armed ? 'Clique de novo para enviar' : 'Enviar'}
                  </button>
                </div>
                {refusing ? (
                  <div className={styles.slackRefuse}>
                    <textarea value={reason} maxLength={2000} onChange={(event) => setReason(event.target.value)} placeholder="O que mudar no texto (opcional). Vai para quem escreveu." autoFocus />
                    <button type="button" disabled={busy} className={styles.slackNo} onClick={() => void run(false)}>
                      Confirmar: não enviar
                    </button>
                  </div>
                ) : null}
                {error ? <div className={styles.error}>{error}</div> : null}
                <p className={styles.slackWhy}>Por quê: {slack.reason}</p>
              </div>
              <footer className={styles.foot}>
                <span>
                  Pedido por {who} · {when(lastDelivery(task)?.at ?? task.createdAt)}
                </span>
              </footer>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** The old card: one face, as the list under the strip showed it (no owner block, or the Revisor's sample). */
function OldCard({ task, naipe, index, count, who, decide }: { readonly task: LedgerTask; readonly naipe: Naipe; readonly index: number; readonly count: number; readonly who: string; readonly decide: Decide }): React.JSX.Element {
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const sample = task.state === 'aceita';
  const delivery = lastDelivery(task);
  const run = async (accept: boolean): Promise<void> => {
    const why = await decide(accept ? { accept: true } : { accept: false, reason });
    if (why) setError(why);
  };
  return (
    <div className={styles.table}>
      <div className={styles.card} data-naipe={naipe} data-testid="ledger-card">
        <div className={styles.face}>
          <div className={styles.frame}>
            <div className={styles.inner}>
              <header className={styles.head}>
                <Glyph naipe={naipe} />
                <span className={styles.suit}>{sample ? 'Amostra do dia' : SUIT_NAMES[naipe]}</span>
                <span className={styles.index}>
                  {roman(index + 1)} · {roman(count)}
                </span>
              </header>
              <div className={styles.title}>
                <div className={styles.name}>{sample ? 'Aceita pelo Revisor: confira' : `risco ${task.risk} · prazo ${task.due.split('-').reverse().join('/')}`}</div>
                <h3>{task.title ?? folder(task.projectPath)}</h3>
              </div>
              <div className={styles.backBody}>
                <h4>O pedido</h4>
                <blockquote className={styles.request}>“{task.request}”</blockquote>
                <h4>Pronto quando</h4>
                <p>{task.doneWhen}</p>
                {delivery?.text ? (
                  <>
                    <h4>Nota de quem entregou</h4>
                    <p>{delivery.text}</p>
                  </>
                ) : null}
                {delivery?.proofs?.length ? (
                  <>
                    <h4>{delivery.proofs.length === 1 ? 'Prova' : 'Provas'}</h4>
                    <div className={styles.proofs}>
                      {delivery.proofs.map((proof, i) => (
                        <ProofDetail key={i} proof={proof} />
                      ))}
                    </div>
                  </>
                ) : null}
                <p className={styles.byline}>
                  Entregue por {who} · {when(delivery?.at ?? task.createdAt)}
                </p>
              </div>
              <footer className={styles.foot}>
                {rejecting ? (
                  <div className={styles.reject}>
                    <input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Motivo" autoFocus />
                    <button type="button" disabled={!reason.trim()} onClick={() => void run(false)}>
                      Rejeitar
                    </button>
                    <button type="button" onClick={() => setRejecting(false)}>
                      Voltar
                    </button>
                  </div>
                ) : (
                  <div className={styles.reject}>
                    <button type="button" onClick={() => void run(true)}>
                      {sample ? 'Conferi' : 'Aceitar'}
                    </button>
                    <button type="button" onClick={() => setRejecting(true)}>
                      Rejeitar…
                    </button>
                  </div>
                )}
              </footer>
              {error ? <div className={styles.error}>{error}</div> : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function LedgerCards({
  queue,
  placeName,
  onClose,
}: {
  readonly queue: readonly LedgerTask[];
  readonly placeName?: PlaceNameOf;
  /** Absent = the cards ARE the screen (the Oráculo in the center of the main window): no "Fechar", no Esc. */
  readonly onClose?: () => void;
}): React.JSX.Element | null {
  const [selected, setSelected] = useState<string | null>(queue[0]?.id ?? null);

  useEffect(() => {
    if (!onClose) return undefined;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // A decided card leaves the queue: the next one comes up; nothing left closes the table.
  useEffect(() => {
    if (queue.length === 0) onClose?.();
  }, [queue.length, onClose]);
  if (queue.length === 0) return null;
  const index = Math.max(0, queue.findIndex((task) => task.id === selected));
  const task = queue[index]!;
  const delivery = lastDelivery(task);
  const naipe = naipeDoPapel(delivery?.by.kind === 'lugar' ? delivery.by.roleId : undefined);
  const who = actorLabel(delivery?.by, task.projectPath, placeName);
  const forOwner = task.state === 'aceita' ? undefined : delivery?.forOwner;

  const decide: Decide = async (decision) => {
    const result = await window.donel.ledger.decide({ id: task.id, ...decision }).catch(() => null);
    if (!result) return 'O app não respondeu.';
    if (!result.ok) return result.reason;
    setSelected(queue[index + 1]?.id ?? queue[index - 1]?.id ?? null);
    return null;
  };

  return (
    <div className={styles.veil} role="dialog" aria-label="Esperando você" data-testid="ledger-cards" onClick={(event) => event.target === event.currentTarget && onClose?.()}>
      <div className={styles.stage}>
        <div className={styles.hand}>
          {queue.map((item) => {
            const itemDelivery = lastDelivery(item);
            const itemNaipe = naipeDoPapel(itemDelivery?.by.kind === 'lugar' ? itemDelivery.by.roleId : undefined);
            const block = item.state === 'aceita' ? undefined : itemDelivery?.forOwner;
            return (
              <button key={item.id} type="button" className={styles.mini} data-naipe={itemNaipe} aria-current={item.id === task.id} onClick={() => setSelected(item.id)}>
                <small>{item.state === 'aceita' ? 'Amostra do dia' : item.slack ? 'Mensagem no Slack' : block ? 'Decisão sua' : 'Entrega para conferir'}</small>
                <b>{item.slack ? `Para ${slackRecipient(item.slack).name}` : (block?.title ?? item.title ?? block?.question ?? item.request)}</b>
              </button>
            );
          })}
          {onClose ? (
            <button type="button" className={styles.close} onClick={onClose}>
              Fechar (Esc)
            </button>
          ) : null}
        </div>
        {task.slack && task.state === 'entregue' ? (
          <SlackCard key={`${task.id}:${task.events.length}`} task={task} slack={task.slack} naipe={naipe} index={index} count={queue.length} who={who} decide={decide} />
        ) : forOwner ? (
          <CardA key={`${task.id}:${task.events.length}`} task={task} forOwner={forOwner} naipe={naipe} index={index} count={queue.length} who={who} decide={decide} />
        ) : (
          <OldCard key={`${task.id}:${task.events.length}`} task={task} naipe={naipe} index={index} count={queue.length} who={who} decide={decide} />
        )}
      </div>
    </div>
  );
}
