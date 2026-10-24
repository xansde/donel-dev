// T084 (014-chat, research R3/R16) - catalog of the `/` menu: pure part.
//
// Three sources are united by `buildCatalog`:
//   1. the CLI's native commands (the static list below; revised when the supported CLI version changes);
//   2. skills/commands on disk (scanned in the main by `command-catalog-scanner.ts`, frontmatter only);
//   3. the `skill_listing` attachment of the session's transcript (names as the session sees them, with `plugin:skill`).
// A native command missing from the list still works when typed; it just does not show in the menu.

import type { CommandEntry, CommandScope, CommandSource } from './ipc';
import { insertRankedSearchResult, normalizeSearchQuery, scoreQueryMatch, type RankedSearchResult } from './t3/searchRanking';

export interface NativeCommand {
  readonly name: string;
  readonly aliases: readonly string[];
  /** pt-BR, one line. */
  readonly description: string;
  /** The command opens a full-screen/interactive screen of the CLI (R16 item 4: the terminal-needed strip is expected). */
  readonly opensScreen: boolean;
  /** `opensScreen` holds only for the bare command: with an argument the command acts inline (`/model opus`). */
  readonly bareOnly?: boolean;
  /** Not offered by the menu (FR-018: `/login` and `/logout` change the account behind the app's back). */
  readonly hidden?: boolean;
}

const cmd = (name: string, description: string, opensScreen: boolean, extra: Partial<NativeCommand> = {}): NativeCommand => ({
  name,
  aliases: [],
  description,
  opensScreen,
  ...extra,
});

/** Native commands of the Claude Code CLI 2.1.29x. */
export const NATIVE_COMMANDS: readonly NativeCommand[] = [
  cmd('add-dir', 'Adiciona um diretório de trabalho à sessão', true, { bareOnly: true }),
  cmd('agents', 'Gerencia os agentes (subagentes)', true),
  cmd('bug', 'Envia feedback sobre o Claude Code', true, { aliases: ['feedback'] }),
  cmd('clear', 'Começa uma conversa nova, limpando o contexto', false, { aliases: ['new', 'reset'] }),
  cmd('color', 'Define a cor da barra da sessão', false),
  cmd('compact', 'Compacta a conversa mantendo um resumo', false),
  cmd('config', 'Abre as configurações', true, { aliases: ['settings'] }),
  cmd('context', 'Mostra como o contexto está sendo usado', false),
  cmd('copy', 'Copia a última resposta para a área de transferência', false),
  cmd('cost', 'Mostra o custo e o tempo da sessão', false),
  cmd('doctor', 'Diagnostica a instalação e as configurações', true),
  cmd('effort', 'Ajusta o esforço de raciocínio do modelo', true, { bareOnly: true }),
  cmd('exit', 'Encerra o Claude Code', false, { aliases: ['quit'] }),
  cmd('export', 'Exporta a conversa para arquivo ou área de transferência', true),
  cmd('fast', 'Liga ou desliga o modo rápido', false),
  cmd('help', 'Mostra a ajuda e os comandos disponíveis', true),
  cmd('hooks', 'Gerencia os hooks das ferramentas', true),
  cmd('ide', 'Gerencia a integração com o editor', true),
  cmd('init', 'Cria o CLAUDE.md do projeto', false),
  cmd('install-github-app', 'Instala o app do Claude Code no GitHub', true),
  cmd('login', 'Entra com uma conta', true, { hidden: true }),
  cmd('logout', 'Sai da conta atual', false, { hidden: true }),
  cmd('mcp', 'Gerencia os servidores MCP', true),
  cmd('memory', 'Edita os arquivos de memória (CLAUDE.md)', true),
  cmd('model', 'Escolhe o modelo', true, { bareOnly: true }),
  cmd('output-style', 'Escolhe o estilo de saída', true, { bareOnly: true }),
  cmd('permissions', 'Gerencia as regras de permissão', true, { aliases: ['allowed-tools'] }),
  cmd('plugin', 'Gerencia plugins e marketplaces', true, { aliases: ['plugins', 'marketplace'] }),
  cmd('pr-comments', 'Traz os comentários de um pull request', false),
  cmd('privacy-settings', 'Ajusta as configurações de privacidade', true),
  cmd('release-notes', 'Mostra as novidades da versão', true),
  cmd('rename', 'Renomeia a conversa', false),
  cmd('resume', 'Retoma uma conversa anterior', true, { aliases: ['continue'] }),
  cmd('review', 'Revisa um pull request', false),
  cmd('rewind', 'Volta a conversa e o código a um ponto anterior', true, { aliases: ['checkpoint'] }),
  cmd('security-review', 'Revisa a segurança das mudanças pendentes', false),
  cmd('skills', 'Lista as skills disponíveis', true),
  cmd('stats', 'Mostra estatísticas de uso', true),
  cmd('status', 'Mostra versão, conta, modelo e conexões', true),
  cmd('statusline', 'Configura a linha de status do terminal', false),
  cmd('tasks', 'Gerencia as tarefas em segundo plano', true, { aliases: ['bashes'] }),
  cmd('terminal-setup', 'Configura as teclas do terminal (Shift+Enter)', false),
  cmd('theme', 'Escolhe o tema de cores', true),
  cmd('upgrade', 'Muda de plano ou atualiza a assinatura', true),
  cmd('usage', 'Mostra o uso e os limites do plano', true),
  cmd('vim', 'Liga ou desliga o modo Vim da caixa de entrada', false),
];

/** Every native name and alias, lowercase. The send machine classifies `/name` against this. */
export const NATIVE_COMMAND_NAMES: ReadonlySet<string> = new Set(NATIVE_COMMANDS.flatMap((c) => [c.name, ...c.aliases]));

const NATIVE_BY_NAME: ReadonlyMap<string, NativeCommand> = new Map(NATIVE_COMMANDS.flatMap((c) => [c.name, ...c.aliases].map((n) => [n, c] as const)));

/** FR-018: the badge shown when `/login` or `/logout` is typed (plan: same badge as the `!` shell mark). */
export const ACCOUNT_COMMAND_WARNING = 'afeta a conta — use o painel de Contas';

export interface TypedCommandInfo {
  /** The word after `/`, as typed (`''` when the text is not a command). */
  readonly name: string;
  /** A native command (and not shadowed by a custom one). */
  readonly known: boolean;
  /** Typing this sends a command that opens a CLI screen (feeds `SendInput.opensScreen`). */
  readonly opensScreen: boolean;
  /** `/login`/`/logout`: show `ACCOUNT_COMMAND_WARNING`. */
  readonly accountWarning: boolean;
}

/** What the composer needs to know about the text being typed/sent. `customNames`: custom commands/skills (they win). */
export function inspectTypedCommand(text: string, customNames?: ReadonlySet<string>): TypedCommandInfo {
  const match = /^\/(\S*)(\s[\s\S]*)?$/.exec(text.trimStart());
  if (match === null) return { name: '', known: false, opensScreen: false, accountWarning: false };
  const name = match[1] ?? '';
  const lower = name.toLowerCase();
  const hasArgs = (match[2] ?? '').trim() !== '';
  const none = { name, known: false, opensScreen: false, accountWarning: false };
  if (customNames?.has(name) || customNames?.has(lower)) return none;
  const native = NATIVE_BY_NAME.get(lower);
  if (native === undefined) return none;
  return {
    name,
    known: true,
    opensScreen: native.opensScreen && !(native.bareOnly === true && hasArgs),
    accountWarning: native.name === 'login' || native.name === 'logout',
  };
}

// ---------------------------------------------------------------- disk / listing

/** A skill or command found on disk, before the union. */
export interface DiskCommand {
  readonly name: string;
  readonly description: string;
  readonly source: Exclude<CommandSource, 'builtin'>;
  readonly scope: Exclude<CommandScope, 'builtin'>;
}

export interface ListedSkill {
  readonly name: string;
  readonly description: string;
}

/** `content` of the `skill_listing` attachment: one `- name: description` line per skill; indented lines continue the previous one. */
export function parseSkillListing(content: unknown): ListedSkill[] {
  if (typeof content !== 'string' || content.trim() === '') return [];
  const out: { name: string; description: string }[] = [];
  for (const raw of content.split(/\r?\n/)) {
    const line = raw.trimEnd();
    if (line.startsWith('- ')) {
      const body = line.slice(2);
      const sep = body.indexOf(': ');
      if (sep > 0) out.push({ name: body.slice(0, sep).trim(), description: body.slice(sep + 2).trim() });
      else if (body.trim() !== '') out.push({ name: body.trim().replace(/:$/, ''), description: '' });
    } else if (line.trim() !== '' && out.length > 0) {
      const last = out[out.length - 1]!;
      last.description = `${last.description} ${line.trim()}`.trim();
    }
  }
  return out;
}

const unquote = (value: string): string => {
  const v = value.trim();
  if (v.length >= 2 && ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))) {
    return v.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  }
  return v;
};

/** Only `name` and `description` of the leading `---` block; folded (`>`) and literal (`|`) scalars included. */
export function parseFrontmatter(text: string): { name?: string; description?: string } {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/);
  if (lines[0]?.trim() !== '---') return {};
  const end = lines.findIndex((l, i) => i > 0 && l.trim() === '---');
  if (end === -1) return {};
  const out: { name?: string; description?: string } = {};
  for (let i = 1; i < end; i += 1) {
    const m = /^(name|description)\s*:\s*(.*)$/.exec(lines[i]!);
    if (m === null) continue;
    const key = m[1] as 'name' | 'description';
    const rest = (m[2] ?? '').trim();
    const block = /^([>|])[+-]?$/.exec(rest);
    if (block !== null) {
      const parts: string[] = [];
      while (i + 1 < end && (/^\s+/.test(lines[i + 1]!) || lines[i + 1]!.trim() === '')) {
        i += 1;
        parts.push(lines[i]!.trim());
      }
      while (parts.length > 0 && parts[parts.length - 1] === '') parts.pop();
      const value = block[1] === '>' ? parts.join(' ').replace(/\s+/g, ' ') : parts.join('\n');
      if (value !== '') out[key] = value;
    } else if (rest !== '') {
      const parts = [unquote(rest)];
      // plain multi-line scalar: indented continuation lines belong to the value
      while (i + 1 < end && /^\s+\S/.test(lines[i + 1]!) && !/^\s*[\w-]+\s*:/.test(lines[i + 1]!)) {
        i += 1;
        parts.push(lines[i]!.trim());
      }
      out[key] = parts.join(' ');
    }
  }
  return out;
}

// ---------------------------------------------------------------- union

const SCOPE_RANK: Record<DiskCommand['scope'], number> = { user: 0, plugin: 1, project: 2 };

export interface CatalogInput {
  readonly disk: readonly DiskCommand[];
  readonly listing: readonly ListedSkill[];
}

/**
 * Natives first (in list order), then everything else by name. A skill/command wins over a native of the same name
 * (as in `classifyOutgoing`); on disk, project beats plugin beats user; the disk origin beats the listing's guess.
 */
export function buildCatalog(input: CatalogInput): CommandEntry[] {
  const custom = new Map<string, CommandEntry>();
  const diskScopes = new Map<string, DiskCommand['scope']>();

  for (const item of input.listing) {
    if (item.name === '') continue;
    const isPlugin = item.name.includes(':');
    custom.set(item.name, {
      name: item.name,
      aliases: [],
      description: item.description,
      source: isPlugin ? 'plugin' : 'skill',
      scope: isPlugin ? 'plugin' : 'user',
      opensScreen: false,
    });
  }
  for (const item of input.disk) {
    if (item.name === '') continue;
    const previous = diskScopes.get(item.name);
    if (previous !== undefined && SCOPE_RANK[previous] > SCOPE_RANK[item.scope]) continue;
    diskScopes.set(item.name, item.scope);
    const listed = custom.get(item.name);
    custom.set(item.name, {
      name: item.name,
      aliases: [],
      description: item.description !== '' ? item.description : (listed?.description ?? ''),
      source: item.source,
      scope: item.scope,
      opensScreen: false,
    });
  }

  const natives: CommandEntry[] = NATIVE_COMMANDS.filter((c) => c.hidden !== true && !custom.has(c.name)).map((c) => ({
    name: c.name,
    aliases: c.aliases,
    description: c.description,
    source: 'builtin',
    scope: 'builtin',
    opensScreen: c.opensScreen,
  }));
  const rest = [...custom.values()].sort((a, b) => a.name.localeCompare(b.name));
  return [...natives, ...rest];
}

// ---------------------------------------------------------------- invalidation (pure part)

export interface FileStamp {
  readonly path: string;
  readonly mtimeMs: number;
  readonly size: number;
}

/** Order-independent fingerprint of the files the catalog was built from; the scanner rebuilds only when it changes. */
export function catalogSignature(stamps: readonly FileStamp[]): string {
  return [...stamps]
    .map((s) => `${s.path}\u0000${s.mtimeMs}\u0000${s.size}`)
    .sort()
    .join('\n');
}

export const catalogChanged = (previous: string | null, next: string): boolean => previous !== next;

// ---------------------------------------------------------------- filtering

/** Menu `/` filter: name (and aliases) first, description as a weak fallback. Empty query keeps catalog order. */
export function filterCatalog(entries: readonly CommandEntry[], query: string, limit: number): CommandEntry[] {
  const q = normalizeSearchQuery(query, { trimLeadingPattern: /^\/+/ });
  if (q === '') return entries.slice(0, Math.max(0, limit));
  const ranked: RankedSearchResult<CommandEntry>[] = [];
  for (const entry of entries) {
    let best: number | null = null;
    for (const label of [entry.name, ...entry.aliases]) {
      const score = scoreQueryMatch({
        value: label.toLowerCase(),
        query: q,
        exactBase: 0,
        prefixBase: 10,
        boundaryBase: 20,
        includesBase: 30,
        fuzzyBase: 50,
        boundaryMarkers: [':', '-', '_', ' '],
      });
      if (score !== null && (best === null || score < best)) best = score;
    }
    if (best === null && entry.description !== '') {
      const d = scoreQueryMatch({ value: entry.description.toLowerCase(), query: q, exactBase: 200, includesBase: 200 });
      if (d !== null) best = d;
    }
    if (best !== null) insertRankedSearchResult(ranked, { item: entry, score: best, tieBreaker: entry.name }, limit);
  }
  return ranked.map((r) => r.item);
}
