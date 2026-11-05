// Navegador integrado — what the agent may NOT do in the browser (V2, docs/design/navegador-interno.md). Pure, no I/O.
//
// Two rules, both only for the agent's tools; the owner navigates and types freely:
//
// - Vigia de domínio: per session, the owner says where the agent may go (default: anywhere). Idea from browser-use
//   (MIT, `browser/watchdogs/security_watchdog.py`), with a simpler rule for the owner: `dominio.com` covers the
//   domain and all of its subdomains.
// - Trava: the agent does not type in password or card fields and does not click buy/pay/delete buttons. It gets an
//   error asking for `navegador_pedir_humano`, and the owner does it himself in the page.
//
// The trava is a heuristic over what the page declares about itself, not a security boundary against a hostile page:
// a field with no hint that it holds a password goes through. It exists so that an agent acting in good faith (or
// misled by what it read) stops before the irreversible step.

import type { CdpKeyEvent } from './keys';
import { MODIFIER_BITS } from './keys';
import { isAllowedLocalFileUrl } from './url';

// ---------------------------------------------------------------------------------------------------------------
// Vigia de domínio

/** `all` = anywhere (default); `only` = only these domains; `except` = anywhere but these. */
export type DomainMode = 'all' | 'only' | 'except';

export interface DomainRules {
  readonly mode: DomainMode;
  readonly domains: readonly string[];
}

export const OPEN_DOMAINS: DomainRules = { mode: 'all', domains: [] };

function hostname(candidate: string): string | null {
  try {
    const host = new URL(candidate).hostname.toLowerCase().replace(/\.+$/, '');
    return host === '' ? null : host;
  } catch {
    return null;
  }
}

/** Reads what the owner typed: domains split by comma, space or line. Scheme, path, port and `*.` are dropped. */
export function parseDomainList(text: string): { readonly domains: string[]; readonly invalid: string[] } {
  const domains: string[] = [];
  const invalid: string[] = [];
  for (const raw of text.split(/[\s,;]+/)) {
    const token = raw.trim();
    if (token === '') continue;
    const bare = token.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').replace(/^\*\./, '').split(/[/?#]/, 1)[0];
    const host = /^[\p{L}\p{N}.:[\]-]+$/u.test(bare) ? hostname(`http://${bare}`) : null;
    if (host === null || (!host.includes('.') && host !== 'localhost')) invalid.push(token);
    else if (!domains.includes(host)) domains.push(host);
  }
  return { domains, invalid };
}

function matches(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

/**
 * Whether the agent may be on `url` under these rules. A local file of this computer is not a site, so the domain
 * list does not cover it (the panel only gets one by an explicit load, see shared/browser/url.ts). Anything else
 * that is not a readable http(s) URL fails closed.
 */
export function agentMayNavigate(rules: DomainRules, url: string): boolean {
  if (rules.mode === 'all' || url === 'about:blank' || isAllowedLocalFileUrl(url)) return true;
  const host = /^https?:/i.test(url) ? hostname(url) : null;
  if (host === null) return false;
  const listed = rules.domains.some((domain) => matches(host, domain));
  return rules.mode === 'only' ? listed : !listed;
}

/** The host of `url` as the messages show it. */
export function displayHost(url: string): string {
  return hostname(url) ?? url.slice(0, 80);
}

export function domainBlockMessage(url: string): string {
  return `Bloqueado: o dono não liberou ${displayHost(url)} para o agente nesta sessão. Se precisar desse site, peça a ele com navegador_pedir_humano.`;
}

// ---------------------------------------------------------------------------------------------------------------
// Trava

/** What the page says about one element, read at the moment of acting. */
export interface ElementFacts {
  /** Lower-case tag name. */
  readonly tag: string;
  /** Attribute names in lower case. */
  readonly attributes: Readonly<Record<string, string>>;
  /** Accessibility role and name. */
  readonly role: string;
  readonly name: string;
  /** Label of the submit button of the form this element is in: Enter in a field presses it. */
  readonly formSubmitLabel?: string;
}

export type SensitiveField = 'senha' | 'cartão';

function plain(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** `cardNumber`, `card_number` and `card-number` all read as `card number`. */
function words(text: string): string {
  return plain(text.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_\-.[\]:]+/g, ' '));
}

const NOT_TYPED = new Set(['hidden', 'submit', 'button', 'reset', 'image', 'checkbox', 'radio', 'file', 'range', 'color']);
const PASSWORD_WORDS = /senha|password|passwd|passcode|\bpwd\b|\bpin\b/;
const CARD_WORDS =
  /cartao|credit ?card|debit ?card|card ?(number|num|no|holder|code|cvc|cvv|expir\w*|exp)\b|cardnumber|\bcc ?(num|number|name|exp|cvc|csc)\b|\b(cvv2?|cvc2?|csc|cvn)\b|codigo de seguranca|security code|numero de seguranca/;

/** Password or card field, or `null`. Used before typing, selecting or pressing a character key on an element. */
export function sensitiveField(facts: ElementFacts): SensitiveField | null {
  const attributes = facts.attributes;
  const type = (attributes.type ?? '').toLowerCase();
  if (facts.tag === 'input' && type === 'password') return 'senha';
  const autocomplete = (attributes.autocomplete ?? '').toLowerCase().split(/\s+/);
  if (autocomplete.some((token) => token.startsWith('cc-'))) return 'cartão';
  if (autocomplete.some((token) => token === 'current-password' || token === 'new-password' || token === 'one-time-code')) return 'senha';
  if (facts.tag === 'input' && NOT_TYPED.has(type)) return null;
  // A search box may well talk about "cartões": what it says about itself does not make it a card field.
  if (type === 'search' || facts.role === 'searchbox') return null;
  const said = words([attributes.name, attributes.id, attributes.placeholder, attributes['aria-label'], attributes.title, facts.name].filter(Boolean).join(' '));
  if (CARD_WORDS.test(said)) return 'cartão';
  if (PASSWORD_WORDS.test(said)) return 'senha';
  return null;
}

const CLICKABLE_ROLES = new Set(['button', 'link', 'menuitem', 'menuitemcheckbox', 'menuitemradio']);

/** Verbs that only count at the start of the label ("Pagar agora" locks, "Como pagar" does not). */
const LOCKED_START = /^(comprar|compre|pagar|pague|contratar|excluir|exclua|apagar|apague|deletar|delete|buy|purchase|pay|erase)\b/;
const LOCKED_ANYWHERE = new RegExp(
  [
    'finalizar (a |o |sua |seu )?(compra|pedido|pagamento)',
    'fechar (o )?pedido',
    'confirmar (a |o |sua |seu )?(compra|pedido|pagamento|transferencia|exclusao|pix)',
    '(efetuar|realizar|fazer) (o )?pagamento',
    '(enviar|fazer) (um )?pix',
    'fazer (uma )?transferencia',
    '^transferir\\b',
    'assinar (agora|plano|o plano)',
    '(excluir|apagar|encerrar) (minha |sua |a )?conta',
    'place (your |the )?order',
    'complete (your |the )?(purchase|order|payment)',
    'confirm (your |the )?(purchase|order|payment|deletion)',
    'submit (your |the )?(order|payment)',
    'pay now',
    'buy now',
    '(delete|close) (my |your |the )?account',
    'send money',
  ].join('|'),
);

/** `true` for a label that buys, pays or deletes. */
export function isLockedLabel(label: string): boolean {
  const text = plain(label).replace(/^[^\p{L}]+/u, '');
  return LOCKED_START.test(text) || LOCKED_ANYWHERE.test(text);
}

/** The label that locks this element for a click, or `null`. Only buttons, links and menu items are looked at. */
export function lockedAction(facts: ElementFacts): string | null {
  const type = (facts.attributes.type ?? '').toLowerCase();
  const clickable = CLICKABLE_ROLES.has(facts.role) || facts.tag === 'button' || facts.tag === 'a' || (facts.tag === 'input' && (type === 'submit' || type === 'button' || type === 'image'));
  if (!clickable) return null;
  const labels = [facts.name, facts.attributes['aria-label'], facts.attributes.value, facts.attributes.title];
  return labels.find((label): label is string => label !== undefined && isLockedLabel(label)) ?? null;
}

/** The label that locks pressing Enter or Space on the focused element (itself, or the form it would submit). */
export function lockedKeyAction(facts: ElementFacts): string | null {
  const own = lockedAction(facts);
  if (own) return own;
  return facts.formSubmitLabel && isLockedLabel(facts.formSubmitLabel) ? facts.formSubmitLabel : null;
}

export function fieldLockMessage(kind: SensitiveField): string {
  return `Travado: este é um campo de ${kind} e o agente não digita nele. Chame navegador_pedir_humano para o dono preencher na própria página.`;
}

export function actionLockMessage(label: string): string {
  return `Travado: "${label.slice(0, 80)}" compra, paga ou apaga algo, e o agente não aciona isso. Chame navegador_pedir_humano para o dono decidir.`;
}

/** What a key combo does to the focused element: `types` writes in a field (paste included), `activates` presses a button. */
export function keyEffect(events: readonly CdpKeyEvent[]): { readonly types: boolean; readonly activates: boolean } {
  const down = events[0];
  if (!down) return { types: false, activates: false };
  const command = (down.modifiers & (MODIFIER_BITS.ctrl | MODIFIER_BITS.meta)) !== 0;
  const shift = (down.modifiers & MODIFIER_BITS.shift) !== 0;
  const paste = (command && down.key.toLowerCase() === 'v') || (shift && down.key === 'Insert');
  return {
    types: paste || (down.text !== undefined && down.text !== '\r'),
    activates: down.key === 'Enter' || down.key === ' ',
  };
}
