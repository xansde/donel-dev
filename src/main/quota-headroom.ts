import { spawn } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

// T014 — FR-012 (US-7): % de headroom de quota por perfil, via `quota-axi`
// (`npx -y quota-axi --provider claude --json` — SKILL.md do quota-axi,
// ~/.claude/skills/quota-axi) rodado com `CLAUDE_CONFIG_DIR` apontado pro
// perfil (undefined = perfil Principal, sem override — lê a config global).
//
// GOTCHA descoberto NESTA task (não estava no spike nem na skill do
// quota-axi — confirmado rodando o CLI real): o cache do quota-axi
// (`~/.cache/quota-axi/quotas.json`) é ÚNICO/GLOBAL, NÃO escopado por
// `CLAUDE_CONFIG_DIR`. Reprodução: chamado contra o perfil global
// (autenticado) devolveu `state.status: "fresh"` com números corretos e
// gravou esse payload no cache global; chamado em seguida contra um perfil
// SEM sessão válida devolveu OS MESMOS NÚMEROS do perfil anterior, mas com
// `source: "cache"`, `state.stale: true` e
// `state.error: "Claude sign-in required"` — ou seja, sem essa guarda, a UI
// mostraria a quota de um perfil rotulada como se fosse de outro. Regra
// dura: `state.stale`/`state.error` presentes SEMPRE viram "sem dados"
// (`null`), mesmo com `windows` populado — nunca confiar em números vindos
// de um fallback de cache que pode pertencer a outro perfil (ver
// `parseQuotaAxiHeadroom`).

export interface QuotaAxiWindow {
  readonly id: string;
  readonly kind?: string;
  readonly percentRemaining?: number;
}

export interface QuotaAxiProviderReport {
  readonly provider: string;
  readonly windows?: readonly QuotaAxiWindow[];
  readonly state?: { readonly stale?: boolean; readonly error?: string; readonly status?: string };
}

export interface QuotaAxiOutput {
  readonly providers?: readonly QuotaAxiProviderReport[];
}

/**
 * Janela usada como headroom "principal" do badge (ui-spec §6: um % só por
 * conta) — a sessão de 5h (`five_hour`) é a mais imediatamente acionável
 * ("dá pra continuar trabalhando agora?"); cai pra semanal (`seven_day`) se
 * a janela de sessão não vier no payload (provider ainda sem dado de sessão).
 * Decisão de implementação (não especificada em FR-012/ui-spec, que só pedem
 * "o % de quota restante" sem apontar qual janela).
 */
const PRIMARY_WINDOW_ORDER = ['five_hour', 'seven_day'] as const;

/**
 * Puro — extrai o % de headroom (inteiro, 0-100) do payload `--json` do
 * quota-axi pro provider `claude`, ou `null` quando indisponível/não
 * confiável. Regra dura do gotcha acima: `state.stale`/`state.error`
 * SEMPRE vira `null`, mesmo com `windows` populado.
 */
export function parseQuotaAxiHeadroom(output: QuotaAxiOutput | null | undefined): number | null {
  const claude = output?.providers?.find((provider) => provider.provider === 'claude');
  if (!claude) return null;
  if (claude.state?.stale || claude.state?.error) return null;

  for (const windowId of PRIMARY_WINDOW_ORDER) {
    const found = claude.windows?.find((w) => w.id === windowId);
    if (found && typeof found.percentRemaining === 'number') {
      return Math.round(found.percentRemaining);
    }
  }
  return null;
}

/**
 * FIX (feedback E2E rodada 4, item 8, parte a) — evidência real coletada
 * pelo Alexandre: `npx -y quota-axi --provider claude --json` standalone
 * devolveu JSON VÁLIDO no stdout (percentUsed 32, five_hour) com EXIT CODE
 * 255 (não é um código documentado do quota-axi — SKILL.md só documenta
 * 0/1/2 — indício de que é ruído do wrapper `npx`/`cmd.exe` no Windows, não
 * do próprio quota-axi). INVESTIGAÇÃO desta task: o `close` handler abaixo
 * JÁ NÃO checava `code` antes deste fix (só tentava `JSON.parse(stdout)`
 * incondicionalmente) — a causa raiz do "headroom sumiu" no app não era
 * esta função (era 100% a UI, ver ProfileSwitcher.tsx `HeadroomSlot`).
 * Ainda assim, endurece explicitamente o contrato pedido pela task
 * ("validar pelo CONTEÚDO, nunca pelo exit code"): `parseJsonPayload`
 * abaixo tenta `JSON.parse` direto e, se falhar, tenta extrair o primeiro
 * objeto `{...}` balanceado do stdout — defesa contra ruído
 * extra (warning/prompt do npx) antes/depois do JSON de verdade que
 * poderia quebrar um `JSON.parse` direto em outra máquina/versão do npx.
 * `code`/`signal` do processo NUNCA decidem sucesso/falha — só o conteúdo.
 */
function parseJsonPayload(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    const start = raw.indexOf('{');
    if (start === -1) throw new Error('quota-axi: nenhum objeto JSON encontrado no stdout');
    let depth = 0;
    for (let i = start; i < raw.length; i += 1) {
      if (raw[i] === '{') depth += 1;
      else if (raw[i] === '}') {
        depth -= 1;
        if (depth === 0) return JSON.parse(raw.slice(start, i + 1));
      }
    }
    throw new Error('quota-axi: objeto JSON no stdout está incompleto/desbalanceado');
  }
}

/** FR-012: timeout por perfil (as leituras dos N perfis rodam em paralelo — ver `readAllProfilesHeadroom` — um perfil lento nunca trava os demais). 8s (era 3s) porque `npx -y quota-axi` sozinho já mede ~10.8s de overhead de resolução do npx no Windows; rodar o binário resolvido direto via node (ver `resolveQuotaAxiCli`) roda em ~1.6s, mas o fallback pra npx (quando o resolver não acha nada) ainda precisa da folga. */
const DEFAULT_TIMEOUT_MS = 8000;

let cachedCliPath: string | null = null;

/**
 * Varre o cache do npx (`npm-cache/_npx/<hash>/node_modules/quota-axi/dist/bin/quota-axi.js`)
 * e devolve o path do binário mais recente (por mtime), ou `null` se não
 * achar. Raízes de busca: `%LOCALAPPDATA%/npm-cache/_npx` (Windows padrão),
 * fallback `~/AppData/Local/npm-cache/_npx` e `~/.npm/_npx` (POSIX). Nunca
 * lança — qualquer erro de fs (readdir/stat) é ignorado e a varredura
 * continua pra próxima raiz. Memoiza só o hit válido (path que ainda existe);
 * um miss anterior ou um path memoizado que sumiu do disco disparam nova
 * varredura na próxima chamada.
 */
export function resolveQuotaAxiCli(): string | null {
  if (cachedCliPath && existsSync(cachedCliPath)) return cachedCliPath;
  cachedCliPath = null;

  const roots: string[] = [];
  if (process.env.LOCALAPPDATA) roots.push(join(process.env.LOCALAPPDATA, 'npm-cache', '_npx'));
  roots.push(join(homedir(), 'AppData', 'Local', 'npm-cache', '_npx'));
  roots.push(join(homedir(), '.npm', '_npx'));

  let best: { path: string; mtimeMs: number } | null = null;

  for (const root of roots) {
    try {
      if (!existsSync(root)) continue;
      const hashes = readdirSync(root);
      for (const hash of hashes) {
        const cliPath = join(root, hash, 'node_modules', 'quota-axi', 'dist', 'bin', 'quota-axi.js');
        try {
          if (!existsSync(cliPath)) continue;
          const stat = statSync(cliPath);
          if (!best || stat.mtimeMs > best.mtimeMs) {
            best = { path: cliPath, mtimeMs: stat.mtimeMs };
          }
        } catch {
          continue;
        }
      }
    } catch {
      continue;
    }
  }

  cachedCliPath = best?.path ?? null;
  return cachedCliPath;
}

export interface RunQuotaAxiOptions {
  /** `CLAUDE_CONFIG_DIR` do perfil; `undefined` = perfil Principal (sem override, lê `~/.claude` global). */
  readonly configDir: string | undefined;
  readonly timeoutMs?: number;
  /** Env base a partir do qual montar o env do child (injetável pra teste; default = `process.env` no ponto de chamada real). */
  readonly baseEnv?: NodeJS.ProcessEnv;
  /** Resolve o path do binário `quota-axi.js` no cache do npx (injetável pra teste; default = `resolveQuotaAxiCli`). `null` => fallback pro `npx -y quota-axi`. */
  readonly resolveCli?: () => string | null;
  /** Executável node usado pra rodar o binário resolvido (injetável pra teste; default = `process.execPath`). */
  readonly nodeExecPath?: string;
}

/**
 * I/O — spawna o quota-axi. FIX (batch A, 002-quota-headroom): `npx -y
 * quota-axi` sozinho tem ~10.8s de overhead de resolução no Windows (matava
 * no timeout antigo de 3s, resultando em "—" sempre). Preferência: resolver
 * o binário `quota-axi.js` já baixado no cache do npx
 * (`resolveQuotaAxiCli`) e rodá-lo direto via `nodeExecPath` (com
 * `ELECTRON_RUN_AS_NODE=1`, sem `shell: true`) — ~1.6s. Fallback (binário
 * não encontrado no cache): `npx -y quota-axi --provider claude --json` com
 * `shell: true` (npx no Windows é `.cmd`/`.ps1`), como antes. Nunca lança:
 * timeout, erro de spawn ou JSON inválido viram `null` (mesmo espírito de
 * "sem dados" do resto do app — SessionIndexer, ProjectScanner).
 */
export function readQuotaAxiHeadroom(options: RunQuotaAxiOptions): Promise<number | null> {
  return new Promise((resolve) => {
    const env: NodeJS.ProcessEnv = { ...(options.baseEnv ?? process.env) };
    if (options.configDir) {
      env.CLAUDE_CONFIG_DIR = options.configDir;
    } else {
      delete env.CLAUDE_CONFIG_DIR;
    }

    const resolveCli = options.resolveCli ?? resolveQuotaAxiCli;
    const cliPath = resolveCli();

    let child: ReturnType<typeof spawn>;
    try {
      if (cliPath) {
        const nodeExecPath = options.nodeExecPath ?? process.execPath;
        child = spawn(nodeExecPath, [cliPath, '--provider', 'claude', '--json'], {
          env: { ...env, ELECTRON_RUN_AS_NODE: '1' },
          windowsHide: true,
        });
      } else {
        child = spawn('npx', ['-y', 'quota-axi', '--provider', 'claude', '--json'], { env, windowsHide: true, shell: true });
      }
    } catch {
      resolve(null);
      return;
    }

    let stdout = '';
    let settled = false;
    const finish = (result: number | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    const timer = setTimeout(() => {
      child.kill();
      finish(null);
    }, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);

    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.on('error', () => finish(null));
    // `code`/`signal` recebidos de propósito (documentam a decisão) mas
    // NUNCA usados pra decidir sucesso/falha — só o conteúdo de `stdout`
    // decide (ver comentário de `parseJsonPayload` acima, fix rodada 4
    // item 8: exit code do quota-axi via npx no Windows não é confiável).
    child.on('close', (_code, _signal) => {
      try {
        finish(parseQuotaAxiHeadroom(parseJsonPayload(stdout) as QuotaAxiOutput));
      } catch {
        finish(null);
      }
    });
  });
}

// ---------------------------------------------------------------------------
// Cache de 60s por perfil (FR-012) — em memória, vive no main process
// (mesmo módulo/instância reaproveitada entre chamadas de `profiles:headroom`).
// ---------------------------------------------------------------------------

const HEADROOM_CACHE_TTL_MS = 60_000;

interface CacheEntry {
  readonly percent: number | null;
  readonly cachedAt: number;
}

export class HeadroomCache {
  private readonly entries = new Map<string, CacheEntry>();
  private readonly now: () => number;

  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  /** `undefined` = sem entrada válida (nunca lido, ou TTL expirado) — chamador deve ler de verdade. */
  get(slug: string): number | null | undefined {
    const entry = this.entries.get(slug);
    if (!entry) return undefined;
    if (this.now() - entry.cachedAt > HEADROOM_CACHE_TTL_MS) return undefined;
    return entry.percent;
  }

  set(slug: string, percent: number | null): void {
    this.entries.set(slug, { percent, cachedAt: this.now() });
  }
}

export interface ProfileHeadroomTarget {
  readonly slug: string;
  readonly configDir: string | undefined;
}

/**
 * FR-012 — leituras em PARALELO (`Promise.all`, nunca sequencial: um perfil
 * lento não atrasa os outros); cada leitura individual já carrega seu
 * próprio timeout de 3s (`readQuotaAxiHeadroom`/`reader`). Cache de 60s
 * evita reabrir processo `npx` toda vez que o dropdown é aberto.
 */
export async function readAllProfilesHeadroom(
  profiles: readonly ProfileHeadroomTarget[],
  cache: HeadroomCache,
  reader: (options: RunQuotaAxiOptions) => Promise<number | null> = readQuotaAxiHeadroom,
): Promise<Record<string, number | null>> {
  const entries = await Promise.all(
    profiles.map(async (profile): Promise<readonly [string, number | null]> => {
      const cached = cache.get(profile.slug);
      if (cached !== undefined) return [profile.slug, cached];

      const percent = await reader({ configDir: profile.configDir });
      cache.set(profile.slug, percent);
      return [profile.slug, percent];
    }),
  );
  return Object.fromEntries(entries);
}
