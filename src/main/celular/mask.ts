// Ledger no celular — what a command output may carry out of the PC. The proofs go over the Tailscale to the
// phone, and an agent's command output can hold a key: a simple mask of the usual shapes before it leaves.
// It is a seat belt, not a vault: a secret with no known shape still passes, so the summary stays short.

const HIDDEN = '••••••';

/** Token shapes that are a secret on their own. */
const TOKEN_PATTERNS: readonly RegExp[] = [
  /\bsk-[A-Za-z0-9_-]{10,}/g, // OpenAI / Anthropic (sk-ant-…)
  /\bgh[pousr]_[A-Za-z0-9]{20,}/g, // GitHub
  /\bgithub_pat_[A-Za-z0-9_]{20,}/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/g, // Slack
  /\bAKIA[0-9A-Z]{16}\b/g, // AWS access key
  /\bAIza[0-9A-Za-z_-]{30,}/g, // Google API key
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, // JWT
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g,
];

/** `Bearer …` / `Basic …`: keeps the word, hides the credential. */
const AUTH_HEADER = /\b(Bearer|Basic|Token)(\s+)[A-Za-z0-9._~+/=-]{8,}/gi;

/** `API_KEY=…`, `"password": "…"`: a secret-looking name keeps its name, the value goes. */
const NAMED_SECRET = /\b([A-Za-z0-9_.-]*(?:key|token|secret|senha|password|passwd|pwd|credential|auth)[A-Za-z0-9_.-]*["']?\s*[=:]\s*["']?)([^\s"',;]{6,})/gi;

/** Any `NAME=value` whose value is long and token-like (no spaces, no path separators). */
const LONG_ASSIGNMENT = /\b([A-Za-z_][A-Za-z0-9_]*=)([A-Za-z0-9+/_=-]{24,})/g;

/** `postgres://user:password@host`: keeps scheme, user and host; the password goes (it may itself hold an `@`). */
const URL_CREDENTIAL = /(\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:)([^\s/]+)(@)/gi;

/** `curl -u user:password` / `--user=user:password` (quoted or not): keeps the user, the password goes. */
const CURL_USER = /((?:^|\s)(?:-u|--user)(?:\s+|=)["']?[^\s:"']+:)([^\s"']+)/g;

export function maskSecrets(text: string): string {
  let out = text.replace(URL_CREDENTIAL, (_match, head: string, _password: string, at: string) => `${head}${HIDDEN}${at}`);
  out = out.replace(CURL_USER, (_match, head: string) => `${head}${HIDDEN}`);
  for (const pattern of TOKEN_PATTERNS) out = out.replace(pattern, (match) => `${match.slice(0, 3)}${HIDDEN}`);
  out = out.replace(AUTH_HEADER, (_match, word: string, space: string) => `${word}${space}${HIDDEN}`);
  out = out.replace(NAMED_SECRET, (_match, name: string) => `${name}${HIDDEN}`);
  out = out.replace(LONG_ASSIGNMENT, (_match, name: string) => `${name}${HIDDEN}`);
  return out;
}

/** What the card shows before it is opened: a few lines of the masked output. */
export const SUMMARY_CHARS = 400;
export const SUMMARY_LINES = 8;

export function summarize(text: string): { readonly texto: string; readonly cortado: boolean } {
  const masked = maskSecrets(text);
  const lines = masked.split('\n');
  let summary = lines.slice(0, SUMMARY_LINES).join('\n');
  if (summary.length > SUMMARY_CHARS) summary = summary.slice(0, SUMMARY_CHARS);
  const cortado = summary.length < masked.length;
  return { texto: cortado ? `${summary.trimEnd()}\n…` : summary, cortado };
}
