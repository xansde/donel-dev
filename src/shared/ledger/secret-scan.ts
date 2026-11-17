// Secret scan — before anything leaves the PC (the mirror's rows, the phone's cards and the whole prototype). A hit is
// replaced in place and reported (never its value).
//
// t-36a99827 — the prototype (up to 2 MB, scanned in the main) made the old regexes quadratic: an unbounded run
// before a fixed character (`[A-Za-z0-9_.-]*` before the keyword, the URL scheme before `://`, the e-mail's local
// part, the JWT's first segment) is retried from every start inside the run, and `'eyJ-'.repeat(50000)` held the main
// for 13 s. Bounding the runs was no fix: `_` is a word character, so `\b` never restarts inside an identifier, and a
// name, scheme or local part past the bound went out raw. So those four shapes are hand-written scanners, linear in
// the text, that give EXACTLY the leftmost match the regex gave (the regex is kept in each comment); the other shapes
// stay regexes, already linear (a fixed prefix, then a run with nothing required after it). Then one more pass: a
// secret name with its value written escaped (`\"token\": \"…\"`, `&quot;password&quot;: &quot;…&quot;`), as a
// prototype carries a JSON in a string or in an HTML text.

export interface MaskHit {
  readonly kind: string;
}

// ---------------------------------------------------------------------------------------------------------------
// Characters, by code unit (the regexes have no `u` flag; `/i` without `u` folds ASCII only).

const isDigit = (c: number): boolean => c >= 48 && c <= 57;
const isLetter = (c: number): boolean => (c >= 65 && c <= 90) || (c >= 97 && c <= 122);
/** `\w`: what `\b` looks at. */
const isWord = (c: number): boolean => isLetter(c) || isDigit(c) || c === 95;
/** `\s`: WhiteSpace and LineTerminator of ECMAScript. */
const isSpace = (c: number): boolean =>
  (c >= 9 && c <= 13) || c === 32 || c === 0xa0 || c === 0x1680 || (c >= 0x2000 && c <= 0x200a) || c === 0x2028 || c === 0x2029 || c === 0x202f || c === 0x205f || c === 0x3000 || c === 0xfeff;

const QUOTE = 34;
const APOS = 39;
const BACKSLASH = 92;
const isQuote = (c: number): boolean => c === QUOTE || c === APOS;

function wordAt(t: string, i: number): boolean {
  return i >= 0 && i < t.length && isWord(t.charCodeAt(i));
}

/** `\b` before `t[i]`. */
function boundary(t: string, i: number): boolean {
  return wordAt(t, i - 1) !== wordAt(t, i);
}

/** Where the run of `cls` starting at `i` ends (`i` when `t[i]` is not in it), read no further than `limit`. */
function runEnd(t: string, i: number, cls: (c: number) => boolean, limit = t.length): number {
  const n = Math.min(t.length, limit);
  while (i < n && cls(t.charCodeAt(i))) i += 1;
  return i;
}

/**
 * `runEnd` for starts that only move forward (a scan): a start inside the run seen last ends where it ended, so each
 * character is read once.
 */
function runCache(cls: (c: number) => boolean): (t: string, i: number) => number {
  let from = 0;
  let end = -1;
  return (t, i) => {
    if (i >= from && i <= end) return end;
    from = i;
    end = runEnd(t, i, cls);
    return end;
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Passes: a regex (`String.replace`) or a scanner that finds the next match from a position.

interface Found {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

/** Finds the leftmost match at or after `from`; made once per pass (it may keep what it read). */
type Finder = (t: string, from: number) => Found | null;

interface Pattern {
  readonly kind: string;
  readonly apply: (t: string, hits: MaskHit[]) => string;
}

function regex(kind: string, re: RegExp, keep?: (match: string, ...groups: string[]) => string): Pattern {
  return {
    kind,
    apply: (t, hits) =>
      t.replace(re, (...args: unknown[]) => {
        hits.push({ kind });
        const groups = args.slice(1, -2).map((g) => (typeof g === 'string' ? g : ''));
        return keep ? keep(String(args[0]), ...groups) : '[segredo]';
      }),
  };
}

function scanner(kind: string, finder: () => Finder): Pattern {
  return {
    kind,
    apply: (t, hits) => {
      const find = finder();
      const parts: string[] = [];
      let pos = 0;
      for (let found = find(t, 0); found; found = find(t, pos)) {
        parts.push(t.slice(pos, found.start), found.text);
        hits.push({ kind });
        pos = found.end;
      }
      if (pos === 0) return t;
      parts.push(t.slice(pos));
      return parts.join('');
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------
// JWT: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g
// `.` is outside the class, so each segment is a whole run: the match at a start is decided by where its run ends.

const isJwtChar = (c: number): boolean => isWord(c) || c === 45;

/** The end of the 2nd and 3rd segments after a first segment ending at `r1`, or -1. */
function jwtTail(t: string, r1: number): number {
  if (t.charCodeAt(r1) !== 46) return -1;
  const r2 = runEnd(t, r1 + 1, isJwtChar);
  if (r2 - (r1 + 1) < 8 || t.charCodeAt(r2) !== 46) return -1;
  const r3 = runEnd(t, r2 + 1, isJwtChar);
  return r3 - (r2 + 1) < 8 ? -1 : r3;
}

function jwtFinder(): Finder {
  const run = runCache(isJwtChar);
  let tailOf = -1;
  let tail = -1;
  return (t, from) => {
    for (let i = t.indexOf('eyJ', from); i !== -1; i = t.indexOf('eyJ', i + 1)) {
      if (!boundary(t, i)) continue;
      const r1 = run(t, i + 3);
      if (r1 - (i + 3) < 8) continue;
      if (tailOf !== r1) {
        tailOf = r1;
        tail = jwtTail(t, r1);
      }
      if (tail !== -1) return { start: i, end: tail, text: '[segredo]' };
    }
    return null;
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Password in a URL: /\b([a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:)[^\s@/]+@/gi — the scheme and the user stay.
// Each part ends where its run ends (the character after it is outside the run), so every start inside one scheme
// run has the same fate.

const isSchemeChar = (c: number): boolean => isLetter(c) || isDigit(c) || c === 43 || c === 46 || c === 45;
const isUserChar = (c: number): boolean => !isSpace(c) && c !== 58 && c !== 47 && c !== 64;
const isUrlPasswordChar = (c: number): boolean => !isSpace(c) && c !== 64 && c !== 47;

/** After a scheme ending at `e`: where the user part ends (after its `:`) and where the match ends, or null. */
function urlTail(t: string, e: number): { head: number; end: number } | null {
  if (!t.startsWith('://', e)) return null;
  const user = runEnd(t, e + 3, isUserChar);
  if (user === e + 3 || t.charCodeAt(user) !== 58) return null;
  const pass = runEnd(t, user + 1, isUrlPasswordChar);
  if (pass === user + 1 || t.charCodeAt(pass) !== 64) return null;
  return { head: user + 1, end: pass + 1 };
}

function urlPasswordFinder(): Finder {
  const run = runCache(isSchemeChar);
  return (t, from) => {
    for (let i = from; i < t.length; i += 1) {
      if (!isLetter(t.charCodeAt(i)) || !boundary(t, i)) continue;
      const e = run(t, i + 1);
      const tail = urlTail(t, e);
      if (tail) return { start: i, end: tail.end, text: `${t.slice(i, tail.head)}[segredo]@` };
      i = e - 1; // every later start in this scheme run ends at the same `e`
    }
    return null;
  };
}

// ---------------------------------------------------------------------------------------------------------------
// A secret-looking name with its value — the name stays, the value goes. `PGPASSWORD=…`, `DB_PASSWORD=…`,
// `"password": "…"`, `"apiKey": "…"`, `senha: …`:
// /\b([A-Za-z0-9_.-]*(?:password|passwd|senha|secret|token|api[_-]?key)[A-Za-z0-9_.-]*)(["']?\s*[:=]\s*)
//   (?!["']?\[segredo\])("[^"\n]+"|'[^'\n]+'|[^\s"',;&]{4,})/gi
// The keyword is made of name characters, and what follows the name never is one, so the name is always its whole
// run: a start matches when a keyword begins at or after it inside the run, and the run's tail (separator, value)
// matches. With `escaped`, the quotes may also be escaped (see `escapedQuoteAt`), and the tail must use at least one
// escaped quote (the plain form is the pass before). A plain quoted value may also skip what is escaped inside it
// (`"hun\"ter"`), but never masks less than the regex did (see `valueTail`); an escaped one closes only on a quote at
// its own level, within `MAX_ESCAPED_VALUE` (found through `EscapedIndex`, so the pass stays linear in the text).

const isNameChar = (c: number): boolean => isWord(c) || c === 46 || c === 45;
const KEYWORDS = ['password', 'passwd', 'senha', 'secret', 'token', 'apikey', 'api_key', 'api-key'];
const MIN_KEYWORD = 5;

/** `word` (lowercase) at `p`, ASCII case-insensitive. */
function wordIs(t: string, p: number, word: string): boolean {
  if (p + word.length > t.length) return false;
  for (let j = 0; j < word.length; j += 1) {
    const k = word.charCodeAt(j);
    const c = t.charCodeAt(p + j);
    if (isLetter(k) ? (c | 32) !== k : c !== k) return false;
  }
  return true;
}

/** Where the last keyword inside the name run [a, r) begins, or -1. */
function lastKeyword(t: string, a: number, r: number): number {
  for (let p = r - MIN_KEYWORD; p >= a; p -= 1) {
    for (const word of KEYWORDS) if (p + word.length <= r && wordIs(t, p, word)) return p;
  }
  return -1;
}

const isHex = (c: number): boolean => isDigit(c) || ((c | 32) >= 97 && (c | 32) <= 102);
/** The quote a character code stands for, or 0. */
const quoteOf = (code: number): number => (code === QUOTE || code === APOS ? code : 0);

/** A numeric character reference with more digits than this (leading zeros counted) is not taken as a quote. */
const MAX_ENTITY_DIGITS = 8;

/**
 * A quote written as an HTML character reference at `i` (`&quot;`, `&apos;`, `&#34;`, `&#039;`, `&#x22;`, `&#x0027;`,
 * the `;` optional as HTML allows), maybe encoded once more (`&amp;quot;`): its end and quote, or null. The digits are
 * read no further than `MAX_ENTITY_DIGITS` (a run of zeros would otherwise be read whole by every look at it).
 */
function entityQuoteAt(t: string, i: number): { end: number; quote: number; amp: boolean } | null {
  if (t.charCodeAt(i) !== 38) return null;
  let p = i + 1;
  const amp = wordIs(t, p, 'amp;');
  if (amp) p += 4;
  let quote = 0;
  if (wordIs(t, p, 'quot')) {
    quote = QUOTE;
    p += 4;
  } else if (wordIs(t, p, 'apos')) {
    quote = APOS;
    p += 4;
  } else if (t.charCodeAt(p) === 35) {
    const hex = (t.charCodeAt(p + 1) | 32) === 120;
    const d = p + (hex ? 2 : 1);
    const e = runEnd(t, d, hex ? isHex : isDigit, d + MAX_ENTITY_DIGITS + 1);
    if (e === d || e - d > MAX_ENTITY_DIGITS) return null;
    let code = 0;
    for (let k = d; k < e && code <= 0xffff; k += 1) code = code * (hex ? 16 : 10) + parseInt(t[k]!, 16);
    quote = quoteOf(code);
    p = e;
  }
  if (!quote) return null;
  if (t.charCodeAt(p) === 59) p += 1;
  return { end: p, quote, amp };
}

interface EscapedQuote {
  readonly length: number;
  readonly quote: number;
  /** Backslashes before it: the level of escaping (0 for a bare entity). */
  readonly slashes: number;
  readonly amp: boolean;
}

const isBackslash = (c: number): boolean => c === BACKSLASH;

/**
 * An escaped quote at `i`, or null: backslashes (any number) before `"`, `'`, `u0022`/`u0027`, `x22`/`x27` or an
 * entity quote; or a bare entity quote.
 */
function escapedQuoteAt(t: string, i: number): EscapedQuote | null {
  const c = t.charCodeAt(i);
  if (c === BACKSLASH) {
    const q = runEnd(t, i, isBackslash);
    if (q >= t.length) return null;
    const slashes = q - i;
    const after = t.charCodeAt(q);
    if (isQuote(after)) return { length: slashes + 1, quote: after, slashes, amp: false };
    const lower = after | 32;
    if (lower === 117 && wordIs(t, q + 1, '00') && (wordIs(t, q + 3, '22') || wordIs(t, q + 3, '27'))) {
      return { length: slashes + 5, quote: t.charCodeAt(q + 4) === 50 ? QUOTE : APOS, slashes, amp: false };
    }
    if (lower === 120 && (wordIs(t, q + 1, '22') || wordIs(t, q + 1, '27'))) {
      return { length: slashes + 3, quote: t.charCodeAt(q + 2) === 50 ? QUOTE : APOS, slashes, amp: false };
    }
    const entity = entityQuoteAt(t, q);
    return entity ? { length: entity.end - i, quote: entity.quote, slashes, amp: entity.amp } : null;
  }
  const entity = entityQuoteAt(t, i);
  return entity ? { length: entity.end - i, quote: entity.quote, slashes: 0, amp: entity.amp } : null;
}

/**
 * Each level of escaping doubles the backslashes and adds one: 0, 1, 3, 7… An opening quote off that ladder is not
 * taken (it is no real escaping).
 */
const onLadder = (d: number): boolean => ((d + 1) & d) === 0;

/**
 * `k` backslashes before a quote close a value opened at level `d` (on the ladder) when `k % (2 * (d + 1)) === d`:
 * inside `\"…\"`, `\\\"` is an escaped quote and `\\\\\"` a backslash then the closing quote. For `d = 2^m - 1`
 * that is: `k` ends in exactly `m` one bits. So each escaped quote closes exactly one level, and its class (quote,
 * `&amp;`, trailing one bits of its backslashes) is the class of the openings it closes.
 */
function classOf(q: EscapedQuote): number {
  let m = 0;
  while ((q.slashes >>> m) & 1) m += 1;
  return m * 4 + (q.amp ? 2 : 0) + (q.quote === QUOTE ? 1 : 0);
}

/** `[segredo]` at `i`, ASCII case-insensitive (the regex has `/i`). */
const maskedAt = (t: string, i: number): boolean => wordIs(t, i, '[segredo]');

/** `[^\s"',;&]`: an unquoted value; the escaped pass stops before a backslash too (the `\"` closing it). */
const isBareValueChar = (c: number): boolean => !isSpace(c) && c !== QUOTE && c !== APOS && c !== 44 && c !== 59 && c !== 38;
const isBareEscapedValueChar = (c: number): boolean => isBareValueChar(c) && c !== BACKSLASH;

/**
 * The value opened by the plain quote at `v`: where the regex closed it (`"[^"\n]+"`: the first such quote on the
 * line) and where it closes when what is escaped inside it is skipped (`"hun\"ter"`); -1 when there is none.
 */
function plainQuotedEnds(t: string, v: number): { first: number; skip: number } {
  const n = t.length;
  const open = t.charCodeAt(v);
  let first = -1;
  let escapedNext = false;
  for (let y = v + 1; y < n; y += 1) {
    const c = t.charCodeAt(y);
    if (c === 10) break;
    if (c === open) {
      if (first === -1) first = y;
      if (!escapedNext) return { first, skip: y };
    }
    escapedNext = !escapedNext && c === BACKSLASH;
  }
  return { first, skip: -1 };
}

/** The escaped pass looks this far for a closing quote (and never past the line): a value is no bigger. */
const MAX_ESCAPED_VALUE = 4096;

/**
 * The escaped quotes of a text, read once from left to right: at a backslash run or an `&`, an escaped quote is taken
 * whole and skipped; a backslash run before no quote is skipped whole. A read that starts after an opening quote lines
 * up with this one at once (no opening ends in a backslash, and an escaped quote holds a `&` or a backslash only at
 * its start or right after its own backslashes), so the first quote of the opening's class past it is its close. Each opening then costs a
 * binary search, not a read of its window: openings repeated all along a 2 MB line read it once.
 */
interface EscapedIndex {
  /** By class (`classOf`): where each quote begins, and where its backslashes end (the quote character proper). */
  readonly byClass: Map<number, { readonly at: number[]; readonly quoteAt: number[] }>;
  readonly newlines: number[];
}

function escapedIndex(t: string): EscapedIndex {
  const byClass = new Map<number, { at: number[]; quoteAt: number[] }>();
  const newlines: number[] = [];
  for (let y = 0; y < t.length; y += 1) {
    const c = t.charCodeAt(y);
    if (c === 10) newlines.push(y);
    if (c !== BACKSLASH && c !== 38) continue;
    const q = escapedQuoteAt(t, y);
    if (q) {
      const key = classOf(q);
      let list = byClass.get(key);
      if (!list) byClass.set(key, (list = { at: [], quoteAt: [] }));
      list.at.push(y);
      list.quoteAt.push(y + q.slashes);
      y += q.length - 1;
    } else if (c === BACKSLASH) y = runEnd(t, y, isBackslash) - 1;
  }
  return { byClass, newlines };
}

/** The first index of the sorted `list` whose value is at least `x` (`list.length` when none). */
function lowerBound(list: readonly number[], x: number): number {
  let lo = 0;
  let hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (list[mid]! < x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Where the closing quote of the value opened by the escaped quote `open` at `v` begins, or -1: the first quote of its
 * class after it, when its quote character is inside the window, no line ends before it, and the value is not empty.
 */
function escapedQuotedEnd(index: EscapedIndex, t: string, v: number, open: EscapedQuote): number {
  const start = v + open.length;
  const n = Math.min(t.length, start + MAX_ESCAPED_VALUE);
  const list = index.byClass.get(classOf(open));
  if (!list) return -1;
  const k = lowerBound(list.at, start);
  if (k === list.at.length) return -1;
  const y = list.at[k]!;
  if (y === start || list.quoteAt[k]! >= n) return -1;
  const line = lowerBound(index.newlines, start);
  return line < index.newlines.length && index.newlines[line]! < y ? -1 : y;
}

/**
 * After a name ending at `r`: where its separator (`["']?\s*[:=]`) is, and whether an escaped quote stood for the
 * quote (only with `escaped`); null when none follows.
 */
function separatorAt(t: string, r: number, escaped: boolean): { sep: number; usedEscape: boolean } | null {
  let usedEscape = false;
  let q = r;
  if (isQuote(t.charCodeAt(q))) q += 1;
  else if (escaped) {
    const e = escapedQuoteAt(t, q);
    if (e) {
      q += e.length;
      usedEscape = true;
    }
  }
  q = runEnd(t, q, isSpace);
  const sep = t.charCodeAt(q);
  return sep === 58 || sep === 61 ? { sep: q, usedEscape } : null;
}

/**
 * Whether a secret name with its separator begins in [from, to): a superset of where the regex could match again
 * (its value aside). `t[to]` is a quote, so no name run crosses `to`.
 */
function nameWithSeparatorIn(t: string, from: number, to: number, escaped: boolean): boolean {
  let a = from;
  while (a < to) {
    while (a < to && !isNameChar(t.charCodeAt(a))) a += 1;
    if (a >= to) return false;
    const r = runEnd(t, a, isNameChar);
    const last = lastKeyword(t, a, r);
    if (last !== -1) {
      let s = a;
      while (s <= last && !boundary(t, s)) s += 1;
      if (s <= last && separatorAt(t, r, escaped)) return true;
    }
    a = r;
  }
  return false;
}

interface ValueTail {
  /** Where the value begins (the separator is [r, value)). */
  readonly value: number;
  readonly end: number;
  readonly open: string;
  readonly close: string;
}

/** The escaped quotes of the text the pass reads (made once, on the first escaped opening). */
type IndexOf = (t: string) => EscapedIndex;

function valueTail(t: string, r: number, escaped: boolean, indexOf: IndexOf): ValueTail | null {
  const separator = separatorAt(t, r, escaped);
  if (!separator) return null;
  const { usedEscape } = separator;
  const v = runEnd(t, separator.sep + 1, isSpace);
  const first = t.charCodeAt(v);
  // (?!["']?\[segredo\]) — already masked.
  if (maskedAt(t, v) || (isQuote(first) && maskedAt(t, v + 1))) return null;
  if (isQuote(first)) {
    // Never less than the regex: its close (the first quote) unless the one past `\"` reaches further and swallows
    // no other secret name with its separator (`SECRET_DIR="C:\keys\" DB_PASSWORD="…"` closes where the regex
    // closed, and the next pair is masked on its own; `"hun\"ter"` is masked whole).
    const { first: f, skip } = plainQuotedEnds(t, v);
    if (f === -1 || f === v + 1) return null;
    if (escaped && !usedEscape) return null;
    const y = skip > f && !nameWithSeparatorIn(t, f + 1, skip, escaped) ? skip : f;
    return { value: v, end: y + 1, open: t[v]!, close: t[y]! };
  }
  if (escaped) {
    const open = escapedQuoteAt(t, v);
    if (open) {
      if (!onLadder(open.slashes)) return null;
      const start = v + open.length;
      if (maskedAt(t, start)) return null;
      const y = escapedQuotedEnd(indexOf(t), t, v, open);
      if (y === -1) return null;
      const closeLength = escapedQuoteAt(t, y)!.length;
      return { value: v, end: y + closeLength, open: t.slice(v, start), close: t.slice(y, y + closeLength) };
    }
    if (!usedEscape) return null;
  }
  const z = runEnd(t, v, escaped ? isBareEscapedValueChar : isBareValueChar);
  return z - v >= 4 ? { value: v, end: z, open: '', close: '' } : null;
}

function namedSecretFinder(escaped: boolean): Finder {
  let indexed: string | null = null;
  let index: EscapedIndex | null = null;
  const indexOf: IndexOf = (t) => {
    if (indexed !== t || !index) {
      indexed = t;
      index = escapedIndex(t);
    }
    return index;
  };
  return (t, from) => {
    const n = t.length;
    let a = from;
    while (a < n) {
      while (a < n && !isNameChar(t.charCodeAt(a))) a += 1;
      if (a === n) return null;
      const r = runEnd(t, a, isNameChar);
      const last = lastKeyword(t, a, r);
      if (last !== -1) {
        let s = a;
        while (s <= last && !boundary(t, s)) s += 1;
        if (s <= last) {
          const tail = valueTail(t, r, escaped, indexOf);
          if (tail) return { start: s, end: tail.end, text: `${t.slice(s, tail.value)}${tail.open}[segredo]${tail.close}` };
        }
      }
      a = r;
    }
    return null;
  };
}

// ---------------------------------------------------------------------------------------------------------------
// E-mail: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g
// The local part ends where its run ends (`@` is outside it). The domain backtracks to the LAST `.` followed by two
// or more letters and then a non-word character (the only place `\b` holds after a letter).

const isLocalChar = (c: number): boolean => isLetter(c) || isDigit(c) || c === 46 || c === 95 || c === 37 || c === 43 || c === 45;
const isDomainChar = (c: number): boolean => isLetter(c) || isDigit(c) || c === 46 || c === 45;

/** Where an e-mail whose `@` is at `at` ends, or -1. */
function emailEnd(t: string, at: number): number {
  const d = runEnd(t, at + 1, isDomainChar);
  for (let k = d - 1; k >= at + 2; k -= 1) {
    if (t.charCodeAt(k) !== 46) continue;
    const te = runEnd(t, k + 1, isLetter);
    if (te - (k + 1) >= 2 && !wordAt(t, te)) return te;
  }
  return -1;
}

function emailFinder(): Finder {
  const run = runCache(isLocalChar);
  return (t, from) => {
    for (let i = from; i < t.length; i += 1) {
      if (!isLocalChar(t.charCodeAt(i)) || !boundary(t, i)) continue;
      const at = run(t, i);
      if (t.charCodeAt(at) === 64) {
        const end = emailEnd(t, at);
        if (end !== -1) return { start: i, end, text: '[e-mail]' };
      }
      i = at - 1; // every later start in this run reaches the same `@` (or none)
    }
    return null;
  };
}

// ---------------------------------------------------------------------------------------------------------------

// Order matters: whole-token shapes first, then the connection string (before the e-mail, which would eat
// `senha@host`), then a secret-looking name with its value, then personal data.
const SECRET_PATTERNS: readonly Pattern[] = [
  regex('chave privada', /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g),
  regex('token GitHub', /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g),
  regex('chave Anthropic/OpenAI', /\bsk-(?:ant-)?[A-Za-z0-9_-]{16,}/g),
  regex('token Supabase', /\b(?:sbp_[A-Za-z0-9]{20,}|sb_secret_[A-Za-z0-9_-]{10,})/g),
  regex('chave Stripe', /\b(?:(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{10,}|whsec_[A-Za-z0-9]{16,})/g),
  regex('token Slack', /\bxox[abposr]-[A-Za-z0-9-]{10,}/g),
  regex('webhook Slack', /\b(https?:\/\/hooks\.slack\.com\/)(?:services|workflows|triggers)\/[A-Za-z0-9_/-]+/g, (_m, base) => `${base}[segredo]`),
  regex('chave AWS', /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g),
  regex('chave Google', /\bAIza[A-Za-z0-9_-]{30,}/g),
  scanner('JWT', jwtFinder),
  regex('Bearer', /\b(Bearer)\s+[A-Za-z0-9._~+/=-]{16,}/gi, (_m, word) => `${word} [segredo]`),
  // `postgres://app:p4ss!word@10.0.0.5/db` — any host (IP or name), any character but `@`, `/` and space.
  scanner('senha', urlPasswordFinder),
  scanner('senha', () => namedSecretFinder(false)),
  scanner('senha', () => namedSecretFinder(true)),
  scanner('e-mail', emailFinder),
  // With or without the dots: `123.456.789-00` and `12345678900`.
  regex('CPF', /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, () => '[cpf]'),
];

/** Replaces every secret-looking piece of `text`; `hits` says what was found (never the value). */
export function maskSecrets(text: string): { text: string; hits: MaskHit[] } {
  const hits: MaskHit[] = [];
  let out = text;
  for (const pattern of SECRET_PATTERNS) out = pattern.apply(out, hits);
  return { text: out, hits };
}
