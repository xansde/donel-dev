// 016-jobu-faxina (T004) - planRepo: from the FACTS measured in a repo to the PLAN, item by item, each with its reason.
// Pure: no git, no disk, no clock besides `now`. All the "nunca tocar" of the owner live here as code, and the plan
// re-checks what the inventory hands over (a junk kind that does not match its path is dropped) so a bug in the
// inventory cannot turn into a deletion.

import { formatDate } from './names';
import type { BranchFact, InstallerFact, JunkFact, PlanItem, RepoFacts, RepoPlan, ScratchEntryFact, SessionFolderFact, UntrackedFileFact, WorktreeFact } from './types';

/** A scratchpad with no write for longer than this is stale (B29, step 5). */
export const STALE_SCRATCHPAD_MS = 7 * 24 * 60 * 60_000;
/** A file of `.esteira/` written in the last day may belong to the delivery in progress: it stays where it is. */
export const ESTEIRA_FRESH_MS = 24 * 60 * 60_000;
/**
 * A worktree touched in the last day stays. A card that was just born (Esteira, an agent) has no commit yet: it is
 * clean and its HEAD is the integration branch, exactly like a dead one.
 */
export const WORKTREE_FRESH_MS = 24 * 60 * 60_000;

const OUTPUT_DIR_NAMES = new Set(['test-results', '.e2e-visual', '.tutorial-shots', '.playwright-cli']);
const PROTOTYPE_MODULES = /^prototypes\/[^/]+\/node_modules$/;
const PROTOTYPE_DIST = /^prototypes\/[^/]+\/dist$/;
const NEVER_BRANCHES = new Set(['main', 'master', 'staging', 'dev']);
/** The worktrees of the installed channels (`<repo>-alfa`, `<repo>-beta`) are what the owner runs. */
const CHANNEL_WORKTREE = /-(alfa|beta)$/i;

// ---------------------------------------------------------------------------
// Never touch
// ---------------------------------------------------------------------------

/** The paths of a repo that no rule of the sweep may delete, whatever the inventory says. */
function isProtectedPath(relPath: string): boolean {
  const segments = relPath.split('/');
  if (segments.some((segment) => segment.startsWith('probe-'))) return true;
  if (relPath === 'node_modules' || relPath === 'out' || relPath === 'dist') return true;
  if (relPath === '.git' || relPath.startsWith('.git/')) return true;
  if (relPath === 'tests/probe' || relPath.startsWith('tests/probe/')) return true;
  if (relPath === 'scripts/publicar.local.json') return true;
  // A node_modules anywhere is protected, except the one the prototypes rule names on purpose.
  return segments.includes('node_modules') && !PROTOTYPE_MODULES.test(relPath);
}

function lastSegment(relPath: string): string {
  return relPath.slice(relPath.lastIndexOf('/') + 1);
}

/** The reason of a junk kind, or `null` when the kind does not fit the path (then it is not output of ours). */
function junkReason(junk: JunkFact): string | null {
  switch (junk.kind) {
    case 'output-dir':
      return OUTPUT_DIR_NAMES.has(lastSegment(junk.relPath)) ? 'saída regenerável (testes, prints, navegador)' : null;
    case 'prototype-modules':
      return PROTOTYPE_MODULES.test(junk.relPath) ? 'node_modules de protótipo: volta com npm install' : null;
    case 'prototype-dist':
      return PROTOTYPE_DIST.test(junk.relPath) ? 'build de protótipo: volta com o build' : null;
    case 'stray-cache':
      return junk.relPath === 'Microsoft' ? 'cache do PowerShell gravado no lugar errado' : null;
  }
}

function planJunk(junk: readonly JunkFact[]): { readonly deletes: PlanItem[]; readonly keeps: PlanItem[] } {
  const deletes: PlanItem[] = [];
  const keeps: PlanItem[] = [];
  for (const entry of junk) {
    if (isProtectedPath(entry.relPath)) continue;
    const reason = junkReason(entry);
    if (reason === null) continue;
    if (entry.tracked) {
      keeps.push({ kind: 'keep', what: 'path', name: entry.relPath, reason: 'o git rastreia arquivos aqui: não é saída gerada' });
      continue;
    }
    deletes.push({ kind: 'delete', group: 'regenerable', path: entry.absPath, label: entry.relPath, bytes: entry.bytes, reason });
  }
  return { deletes, keeps };
}

// ---------------------------------------------------------------------------
// Installers
// ---------------------------------------------------------------------------

export interface ParsedInstaller {
  readonly product: string;
  readonly version: string;
  readonly blockmap: boolean;
}

/** `<Produto>-Setup-<semver>.exe` and its `.blockmap`; anything else is not ours to judge. */
export function parseInstallerName(name: string): ParsedInstaller | null {
  const match = /^(.+)-Setup-(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\.exe(\.blockmap)?$/.exec(name);
  if (match === null) return null;
  return { product: match[1] ?? '', version: match[2] ?? '', blockmap: match[3] !== undefined };
}

function parseVersion(version: string): { readonly core: readonly number[]; readonly pre: string | null } {
  const dash = version.indexOf('-');
  const core = (dash < 0 ? version : version.slice(0, dash)).split('.').map((part) => Number.parseInt(part, 10));
  return { core, pre: dash < 0 ? null : version.slice(dash + 1) };
}

/** Semver order: the numbers first; a pre-release is older than the release of the same number. */
export function compareVersions(a: string, b: string): number {
  const left = parseVersion(a);
  const right = parseVersion(b);
  for (let i = 0; i < 3; i += 1) {
    const diff = (left.core[i] ?? 0) - (right.core[i] ?? 0);
    if (diff !== 0) return diff;
  }
  if (left.pre === right.pre) return 0;
  if (left.pre === null) return 1;
  if (right.pre === null) return -1;
  return left.pre < right.pre ? -1 : 1;
}

function planInstallers(installers: readonly InstallerFact[]): PlanItem[] {
  const parsed = installers.flatMap((file) => {
    const info = parseInstallerName(file.name);
    return info === null ? [] : [{ file, info }];
  });
  const newestByProduct = new Map<string, string>();
  for (const { info } of parsed) {
    const key = info.product.toLowerCase();
    const current = newestByProduct.get(key);
    if (current === undefined || compareVersions(info.version, current) > 0) newestByProduct.set(key, info.version);
  }
  const items: PlanItem[] = [];
  for (const { file, info } of parsed) {
    const newest = newestByProduct.get(info.product.toLowerCase());
    if (file.tracked || newest === undefined || compareVersions(info.version, newest) >= 0) continue;
    items.push({ kind: 'delete', group: 'installer', path: file.absPath, label: `release/${file.name}`, bytes: file.bytes, reason: `instalador antigo (${newest} segue em release/)` });
  }
  return items;
}

// ---------------------------------------------------------------------------
// Worktrees and branches
// ---------------------------------------------------------------------------

function worktreeBasename(path: string): string {
  return path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? path;
}

function planWorktree(worktree: WorktreeFact, integrationRef: string | null, now: number): PlanItem | null {
  if (worktree.isMain) return null;
  const keep = (reason: string): PlanItem => ({ kind: 'keep', what: 'worktree', name: worktree.path, reason });
  if (worktree.locked) return keep('travada (git worktree lock)');
  if (CHANNEL_WORKTREE.test(worktreeBasename(worktree.path))) return keep('canal instalado');
  if (worktree.missing) {
    return { kind: 'removeWorktree', path: worktree.path, branch: worktree.branch, missing: true, reason: 'a pasta já não existia (só registro no git)' };
  }
  if (!worktree.clean) return keep('mudança não commitada');
  if (!worktree.headInIntegration && !worktree.headEqualsRemote) return keep('commit que só existe aqui');
  if (now - worktree.lastActivityMs < WORKTREE_FRESH_MS) return keep('usada nas últimas 24 h');
  if (worktree.headInIntegration) {
    return { kind: 'removeWorktree', path: worktree.path, branch: worktree.branch, missing: false, reason: integrationRef === null ? 'já incorporada' : `já em ${integrationRef}` };
  }
  return { kind: 'removeWorktree', path: worktree.path, branch: worktree.branch, missing: false, reason: 'publicada no remoto com o mesmo SHA' };
}

function onlyHereReason(branch: BranchFact): string {
  if (branch.onlyHereCount === 0) return 'todos os commits estão no remoto, mas a branch local difere dele';
  const noun = branch.onlyHereCount === 1 ? 'commit' : 'commits';
  return `${branch.onlyHereCount} ${noun} só aqui, último em ${formatDate(branch.lastCommitMs)}`;
}

function planBranch(branch: BranchFact, integrationRef: string | null): PlanItem | null {
  if (NEVER_BRANCHES.has(branch.name)) return null;
  if (branch.name.startsWith('backup/')) return { kind: 'keep', what: 'branch', name: branch.name, reason: 'backup/* nunca é tocado' };
  if (branch.checkedOut) return null;
  const deleteWith = (reason: string): PlanItem => ({ kind: 'deleteBranch', name: branch.name, sha: branch.sha, reason });
  if (integrationRef !== null && branch.ancestorOfIntegration) return deleteWith(`já incorporada em ${integrationRef}`);
  if (integrationRef !== null && branch.cherryClean) return deleteWith(`conteúdo já em ${integrationRef} (git cherry)`);
  if (branch.publishedSameSha) return deleteWith('publicada no remoto com o mesmo SHA');
  return { kind: 'keep', what: 'branch', name: branch.name, reason: onlyHereReason(branch) };
}

// ---------------------------------------------------------------------------
// Scratchpads, sessions, .esteira
// ---------------------------------------------------------------------------

function planScratchpad(entry: ScratchEntryFact, now: number): PlanItem | null {
  if (now - entry.newestWriteMs <= STALE_SCRATCHPAD_MS) return null;
  return { kind: 'delete', group: 'scratchpad', path: entry.absPath, label: entry.label, bytes: entry.bytes, reason: 'scratchpad de sessão sem escrita há mais de 7 dias' };
}

function planSession(session: SessionFolderFact, repoPath: string): PlanItem | null {
  if (session.owner !== repoPath || session.cwd === null || !session.cwdGone) return null;
  return {
    kind: 'separate',
    group: 'sessoes-claude',
    from: session.absPath,
    destRel: `sessoes-claude/${session.name}`,
    bytes: session.bytes,
    mtimeMs: session.mtimeMs,
    reason: 'a pasta de trabalho dela não existe mais',
    restore: 'mova a pasta de volta para ~/.claude/projects/',
  };
}

function planEsteiraFile(file: UntrackedFileFact, now: number): PlanItem | null {
  if (!file.relPath.startsWith('.esteira/')) return null;
  if (now - file.mtimeMs < ESTEIRA_FRESH_MS) {
    return { kind: 'keep', what: 'path', name: file.relPath, reason: 'escrito nas últimas 24 h: pode ser da entrega em curso' };
  }
  return {
    kind: 'separate',
    group: 'esteira',
    from: file.absPath,
    destRel: file.relPath,
    bytes: file.bytes,
    mtimeMs: file.mtimeMs,
    reason: 'arquivo não versionado da Esteira',
    restore: `copie de volta para ${file.relPath} no repo`,
  };
}

// ---------------------------------------------------------------------------
// The plan
// ---------------------------------------------------------------------------

const byBranchName = (a: BranchFact, b: BranchFact): number => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

/**
 * The plan of one repo. Order: worktrees to remove, branches to delete, deletions, separations, then what was left
 * alone. The executor follows it (a worktree goes before its branch can be judged free; see executor.ts).
 */
export function planRepo(facts: RepoFacts, now: number): RepoPlan {
  const removals: PlanItem[] = [];
  const branchDeletes: PlanItem[] = [];
  const deletes: PlanItem[] = [];
  const separations: PlanItem[] = [];
  const keeps: PlanItem[] = [];

  const sort = (item: PlanItem | null, actionable: PlanItem[]): void => {
    if (item === null) return;
    (item.kind === 'keep' ? keeps : actionable).push(item);
  };

  for (const worktree of facts.worktrees) sort(planWorktree(worktree, facts.integrationRef, now), removals);
  for (const branch of [...facts.branches].sort(byBranchName)) sort(planBranch(branch, facts.integrationRef), branchDeletes);

  const junk = planJunk(facts.junk);
  deletes.push(...junk.deletes);
  keeps.push(...junk.keeps);
  deletes.push(...planInstallers(facts.installers));
  for (const entry of facts.scratchpads) sort(planScratchpad(entry, now), deletes);

  for (const session of facts.sessions) sort(planSession(session, facts.repoPath), separations);
  for (const file of facts.esteiraFiles) sort(planEsteiraFile(file, now), separations);

  return {
    repoPath: facts.repoPath,
    repoName: facts.repoName,
    integrationRef: facts.integrationRef,
    fetchError: facts.fetchError,
    items: [...removals, ...branchDeletes, ...deletes, ...separations, ...keeps],
  };
}
