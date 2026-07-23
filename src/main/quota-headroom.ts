import { spawn } from 'node:child_process';

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

/** FR-012: timeout de 3s por perfil (as leituras dos N perfis rodam em paralelo — ver `readAllProfilesHeadroom` — um perfil lento nunca trava os demais). */
const DEFAULT_TIMEOUT_MS = 3000;

export interface RunQuotaAxiOptions {
  /** `CLAUDE_CONFIG_DIR` do perfil; `undefined` = perfil Principal (sem override, lê `~/.claude` global). */
  readonly configDir: string | undefined;
  readonly timeoutMs?: number;
  /** Env base a partir do qual montar o env do child (injetável pra teste; default = `process.env` no ponto de chamada real). */
  readonly baseEnv?: NodeJS.ProcessEnv;
}

/**
 * I/O — spawna `npx -y quota-axi --provider claude --json`. Nunca lança:
 * timeout, erro de spawn ou JSON inválido viram `null` (mesmo espírito de
 * "sem dados" do resto do app — SessionIndexer, ProjectScanner). `shell:
 * true` porque `npx` no Windows é um `.cmd`/`.ps1` conforme a instalação
 * (nvm, volta, etc.) — deixar o shell resolver evita hardcodar a extensão.
 */
export function readQuotaAxiHeadroom(options: RunQuotaAxiOptions): Promise<number | null> {
  return new Promise((resolve) => {
    const env: NodeJS.ProcessEnv = { ...(options.baseEnv ?? process.env) };
    if (options.configDir) {
      env.CLAUDE_CONFIG_DIR = options.configDir;
    } else {
      delete env.CLAUDE_CONFIG_DIR;
    }

    let child: ReturnType<typeof spawn>;
    try {
      child = spawn('npx', ['-y', 'quota-axi', '--provider', 'claude', '--json'], { env, windowsHide: true, shell: true });
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
    child.on('close', () => {
      try {
        finish(parseQuotaAxiHeadroom(JSON.parse(stdout) as QuotaAxiOutput));
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
