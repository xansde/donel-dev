// T1303/T1306 (011-contas-e-provedores, etapa 3) — lista de nomes de env que
// NENHUMA entrada de provider pode declarar (nem em `env`, nem em
// `secretEnvKeys`): `CLAUDE_CONFIG_DIR` é resolvido pelo app
// (session-config-dir.ts), nunca pela entrada; os marcadores de
// sessão-filha são os mesmos que `pty-manager.ts`
// (`INHERITED_CLAUDE_SESSION_MARKERS`) remove do env herdado — se uma
// entrada de provider os declarasse, o override do provider os traria de
// volta por uma porta lateral. Arquivo separado (em vez de importar de
// `pty-manager.ts`) para `src/main/providers/**` continuar sem depender do
// PTY manager — só o contrato do NOME é compartilhado, não o módulo.

const CHILD_SESSION_MARKER_PREFIXES = ['CLAUDE_CODE_'] as const;
const CHILD_SESSION_MARKER_EXACT = ['CLAUDECODE'] as const;

export function isReservedProviderEnvKey(key: string): boolean {
  if (key === 'CLAUDE_CONFIG_DIR') return true;
  if ((CHILD_SESSION_MARKER_EXACT as readonly string[]).includes(key)) return true;
  return CHILD_SESSION_MARKER_PREFIXES.some((prefix) => key.startsWith(prefix));
}
