// T084 (014-chat, research R3) - the I/O half of the `/` menu catalog (`chat:catalog`).
//
// Reads ONLY the frontmatter (`name`, `description`) of skills and commands on disk:
//   <claudeHome>/skills/*/SKILL.md      <claudeHome>/commands/**/*.md        (user)
//   <cwd>/.claude/skills|commands                                             (project)
//   <installPath>/skills|commands of every ENABLED plugin                     (plugin, named `plugin:name`)
// Enabled plugins are resolved the way the CLI does: `enabledPlugins` of `<claudeHome>/settings.json`, then
// `<cwd>/.claude/settings.json` and `settings.local.json` (later wins; `true` = on) crossed with
// `<claudeHome>/plugins/installed_plugins.json` (`installPath`; a `project`-scoped install counts only for its project).
// The third source, `skill_listing`, is read from the head of the session transcript.
//
// Cache per `cwd`, invalidated by `mtime`: every call stats the candidate files (cheap) and re-reads the
// frontmatter only when the signature (`catalogSignature`) changed.

import { promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import { join, relative, resolve, sep } from 'node:path';
import {
  buildCatalog,
  catalogChanged,
  catalogSignature,
  parseFrontmatter,
  parseSkillListing,
  type DiskCommand,
  type FileStamp,
  type ListedSkill,
} from '../../shared/chat/commandCatalog';
import type { CommandEntry } from '../../shared/chat/ipc';

/** How much of a file is read to find the frontmatter. */
const FRONTMATTER_BYTES = 8 * 1024;
/** `skill_listing` is one of the first attachments of a session; the head of the transcript is enough. */
const LISTING_HEAD_BYTES = 1024 * 1024;
const LISTING_RETRY_MS = 5000;
const MAX_DEPTH = 5;

interface Candidate {
  readonly path: string;
  readonly kind: 'skill' | 'command';
  readonly scope: DiskCommand['scope'];
  /** Skill folder name / command path inside `commands/` (`dir:file`), already without `.md`. */
  readonly fallbackName: string;
  /** `plugin:` prefix for plugin entries. */
  readonly prefix: string;
  readonly stamp: FileStamp;
}

interface Root {
  readonly dir: string;
  readonly scope: DiskCommand['scope'];
  readonly prefix: string;
}

export interface CommandCatalogScannerOptions {
  /** The CLI's config dir; default `~/.claude`. */
  readonly claudeHome?: string;
  readonly now?: () => number;
}

export interface CommandCatalogScanner {
  /** Disk + `skill_listing` + natives for the tab's `cwd`. `transcriptPath` may be `null` before the first hook. */
  catalog(cwd: string, transcriptPath: string | null): Promise<CommandEntry[]>;
}

const readJson = async (path: string): Promise<Record<string, unknown> | null> => {
  try {
    const parsed: unknown = JSON.parse(await fs.readFile(path, 'utf8'));
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
};

const statOf = async (path: string): Promise<FileStamp | null> => {
  try {
    const st = await fs.stat(path);
    return st.isFile() ? { path, mtimeMs: st.mtimeMs, size: st.size } : null;
  } catch {
    return null;
  }
};

async function readHead(path: string, bytes: number): Promise<string> {
  const handle = await fs.open(path, 'r');
  try {
    const buffer = Buffer.alloc(bytes);
    const { bytesRead } = await handle.read(buffer, 0, bytes, 0);
    return buffer.subarray(0, bytesRead).toString('utf8');
  } finally {
    await handle.close();
  }
}

async function listMarkdown(dir: string, depth = 0): Promise<string[]> {
  if (depth > MAX_DEPTH) return [];
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules' && entry.name !== '.git') out.push(...(await listMarkdown(full, depth + 1)));
    } else if (entry.name.toLowerCase().endsWith('.md')) {
      out.push(full);
    }
  }
  return out;
}

async function skillDirs(dir: string): Promise<string[]> {
  try {
    return (await fs.readdir(dir, { withFileTypes: true })).filter((e) => e.isDirectory() || e.isSymbolicLink()).map((e) => e.name);
  } catch {
    return [];
  }
}

export function createCommandCatalogScanner(options: CommandCatalogScannerOptions = {}): CommandCatalogScanner {
  const claudeHome = options.claudeHome ?? join(homedir(), '.claude');
  const now = options.now ?? Date.now;
  const diskCache = new Map<string, { signature: string; entries: DiskCommand[] }>();
  const listingCache = new Map<string, ListedSkill[]>();
  const listingMiss = new Map<string, number>();

  async function enabledPluginRoots(cwd: string, stamps: FileStamp[]): Promise<Root[]> {
    const settingsFiles = [join(claudeHome, 'settings.json'), join(cwd, '.claude', 'settings.json'), join(cwd, '.claude', 'settings.local.json')];
    const enabled = new Map<string, boolean>();
    for (const file of settingsFiles) {
      const stamp = await statOf(file);
      if (stamp === null) continue;
      stamps.push(stamp);
      const plugins = (await readJson(file))?.enabledPlugins;
      if (plugins === null || typeof plugins !== 'object') continue;
      for (const [key, value] of Object.entries(plugins as Record<string, unknown>)) if (typeof value === 'boolean') enabled.set(key, value);
    }
    const installedFile = join(claudeHome, 'plugins', 'installed_plugins.json');
    const installedStamp = await statOf(installedFile);
    if (installedStamp === null) return [];
    stamps.push(installedStamp);
    const installed = (await readJson(installedFile))?.plugins;
    if (installed === null || typeof installed !== 'object') return [];

    const roots: Root[] = [];
    for (const [key, on] of enabled) {
      if (!on) continue;
      const installs = (installed as Record<string, unknown>)[key];
      if (!Array.isArray(installs)) continue;
      const mine = installs
        .map((i) => (i !== null && typeof i === 'object' ? (i as Record<string, unknown>) : {}))
        .filter((i) => typeof i.installPath === 'string')
        .filter((i) => {
          if (i.scope !== 'project' && i.scope !== 'local') return true;
          return typeof i.projectPath === 'string' && resolve(i.projectPath) === resolve(cwd);
        });
      const chosen = mine[mine.length - 1];
      if (chosen === undefined) continue;
      const installPath = chosen.installPath as string;
      const manifestName = (await readJson(join(installPath, '.claude-plugin', 'plugin.json')))?.name;
      const name = typeof manifestName === 'string' && manifestName !== '' ? manifestName : key.split('@')[0]!;
      roots.push({ dir: installPath, scope: 'plugin', prefix: `${name}:` });
    }
    return roots;
  }

  async function collect(cwd: string): Promise<{ candidates: Candidate[]; stamps: FileStamp[] }> {
    const stamps: FileStamp[] = [];
    const candidates: Candidate[] = [];
    const roots: Root[] = [
      { dir: claudeHome, scope: 'user', prefix: '' },
      ...(cwd !== '' ? [{ dir: join(cwd, '.claude'), scope: 'project' as const, prefix: '' }] : []),
      ...(await enabledPluginRoots(cwd, stamps)),
    ];
    for (const root of roots) {
      for (const name of await skillDirs(join(root.dir, 'skills'))) {
        const path = join(root.dir, 'skills', name, 'SKILL.md');
        const stamp = await statOf(path);
        if (stamp !== null) candidates.push({ path, kind: 'skill', scope: root.scope, fallbackName: name, prefix: root.prefix, stamp });
      }
      const commandsDir = join(root.dir, 'commands');
      for (const path of await listMarkdown(commandsDir)) {
        const stamp = await statOf(path);
        if (stamp === null) continue;
        const rel = relative(commandsDir, path).slice(0, -3).split(sep).join(':');
        candidates.push({ path, kind: 'command', scope: root.scope, fallbackName: rel, prefix: root.prefix, stamp });
      }
    }
    for (const c of candidates) stamps.push(c.stamp);
    return { candidates, stamps };
  }

  async function diskEntries(cwd: string): Promise<DiskCommand[]> {
    const { candidates, stamps } = await collect(cwd);
    const signature = catalogSignature(stamps);
    const cached = diskCache.get(cwd);
    if (cached !== undefined && !catalogChanged(cached.signature, signature)) return cached.entries;

    const entries: DiskCommand[] = [];
    for (const c of candidates) {
      let meta: { name?: string; description?: string } = {};
      try {
        meta = parseFrontmatter(await readHead(c.path, FRONTMATTER_BYTES));
      } catch {
        // unreadable file: keep the entry with its fallback name and no description
      }
      // Commands are named by their path (`pasta:nome`); skills by the frontmatter, falling back to the folder.
      const base = c.kind === 'skill' ? (meta.name ?? c.fallbackName) : c.fallbackName;
      entries.push({
        name: `${c.prefix}${base}`,
        description: (meta.description ?? '').replace(/\s+/g, ' ').trim(),
        source: c.scope === 'plugin' ? 'plugin' : c.kind,
        scope: c.scope,
      });
    }
    diskCache.set(cwd, { signature, entries });
    return entries;
  }

  async function listing(transcriptPath: string | null): Promise<ListedSkill[]> {
    if (transcriptPath === null || transcriptPath === '') return [];
    const hit = listingCache.get(transcriptPath);
    if (hit !== undefined) return hit;
    const missedAt = listingMiss.get(transcriptPath);
    if (missedAt !== undefined && now() - missedAt < LISTING_RETRY_MS) return [];
    let head: string;
    try {
      head = await readHead(transcriptPath, LISTING_HEAD_BYTES);
    } catch {
      return [];
    }
    const found = new Map<string, ListedSkill>();
    for (const line of head.split('\n')) {
      if (!line.includes('"skill_listing"')) continue;
      try {
        const attachment = (JSON.parse(line) as { attachment?: { type?: unknown; content?: unknown } }).attachment;
        if (attachment?.type === 'skill_listing') for (const item of parseSkillListing(attachment.content)) found.set(item.name, item);
      } catch {
        // a line cut by the byte limit
      }
    }
    if (found.size === 0) {
      listingMiss.set(transcriptPath, now());
      return [];
    }
    const result = [...found.values()];
    listingCache.set(transcriptPath, result);
    return result;
  }

  return {
    async catalog(cwd, transcriptPath) {
      const [disk, listed] = await Promise.all([diskEntries(cwd), listing(transcriptPath)]);
      return buildCatalog({ disk, listing: listed });
    },
  };
}
