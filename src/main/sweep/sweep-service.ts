// 016-jobu-faxina (T011) - the sweep from end to end: which repos, what to do in each, doing it, the sweep folder with
// its `resumo.html`, the stamp of the last sweep and the totals the bubble of the Jobu says.
//
//   scan ~/.claude/projects -> known repos -> the ones with work since the last sweep -> inventory -> plan -> execute -> report
//
// Everything that touches the world comes in through `SweepDeps` (git, the clock, the roots, the stamp, the log), so the
// whole flow runs in tests against temporary repos. It never throws: a failure of the whole sweep is a summary with
// `failed: true` and a line in the log, a failure of one repo is a note in the summary, and a failure of one item is a
// line "não foi possível". The stamp (`lastSweepAt`) advances only when no repo was lost on the way, so a repo that could
// not be read is looked at again next time.

import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import type { SweepBubbleSummary } from '../../shared/pet/types';
import { scanClaudeProjects } from './claude-projects';
import { findKnownRepos, latestGitActivityMs, selectActiveRepos, transcriptActivity } from './discovery';
import { executePlan } from './executor';
import { mapLimit } from './fs-utils';
import type { GitRun } from './git';
import { collectRepoFacts } from './inventory';
import { chooseArchiveParent, localDay, nextSweepFolderName, repoFolderNames } from './names';
import { planRepo } from './plan';
import { renderSummary, totalsOf } from './render-summary';
import { isActionable, type RepoPlan, type RepoReport, type SweepReport } from './types';

export interface SweepDeps {
  readonly git: GitRun;
  readonly now: () => number;
  /** The roots of the sidebar (`appConfig.projectRoots`). */
  readonly getRoots: () => readonly string[];
  readonly getLastSweepAt: () => number | null;
  /** Saves the stamp of a sweep that ended well. */
  readonly setLastSweepAt: (ms: number) => void;
  /** `~/.claude/projects`. */
  readonly claudeProjectsDir: string;
  /** `%TEMP%/claude`. */
  readonly tempClaudeDir: string;
  /** One line to the log file in the userData. Must not throw (a failure to log is swallowed here anyway). */
  readonly log: (line: string) => Promise<void> | void;
}

export const SUMMARY_FILE = 'resumo.html';

const FAILED: SweepBubbleSummary = { failed: true, freedBytes: 0, separatedItems: 0, branchesDeleted: 0, worktreesRemoved: 0, folder: null };

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message.split(/\r?\n/)[0] || error.name : String(error);
}

/** The sweep folder, created at most once and only when something is about to go in it. */
function lazySweepFolder(parent: string, day: string): () => Promise<string> {
  let created: Promise<string> | null = null;
  return () => {
    created ??= (async () => {
      const archive = join(parent, '_archive');
      await fs.mkdir(archive, { recursive: true });
      const name = nextSweepFolderName(day, await fs.readdir(archive));
      const folder = join(archive, name);
      await fs.mkdir(folder); // not recursive: if somebody took the name meanwhile this fails instead of sharing
      return folder;
    })();
    return created;
  };
}

/** The sweep, as a function the Jobu calls from its menu. */
export function createSweepRunner(deps: SweepDeps): () => Promise<SweepBubbleSummary> {
  const log = async (line: string): Promise<void> => {
    try {
      await deps.log(line);
    } catch {
      // a log that cannot be written is not a reason to fail a sweep
    }
  };

  return async function runSweep(): Promise<SweepBubbleSummary> {
    const startedAt = deps.now();
    const notes: string[] = [];
    let lostRepos = false;
    try {
      const lastSweepAt = deps.getLastSweepAt();
      const claudeFolders = await scanClaudeProjects(deps.claudeProjectsDir);
      const known = await findKnownRepos(deps.git, deps.getRoots(), claudeFolders);
      const active = await selectActiveRepos(known, lastSweepAt, transcriptActivity(claudeFolders, known), (repo) => latestGitActivityMs(deps.git, repo));
      await log(`faxina: ${known.length} repos conhecidos, ${active.length} com trabalho desde ${lastSweepAt === null ? 'sempre' : new Date(lastSweepAt).toISOString()}`);

      const ctx = { git: deps.git, tempClaudeDir: deps.tempClaudeDir, knownRepos: known, claudeFolders };
      const planned = await mapLimit(active, 2, async (repo): Promise<RepoPlan | null> => {
        try {
          return planRepo(await collectRepoFacts(ctx, repo), startedAt);
        } catch (error) {
          lostRepos = true;
          notes.push(`Um repo não pôde ser lido e ficou de fora desta faxina: ${messageOf(error)}`);
          await log(`faxina: falha ao ler ${repo}: ${messageOf(error)}`);
          return null;
        }
      });
      const plans = planned.flatMap((plan) => (plan !== null && plan.items.some(isActionable) ? [plan] : []));

      const day = localDay(startedAt);
      const folderNames = repoFolderNames(plans.map((plan) => plan.repoPath));
      const sweepFolder = lazySweepFolder(chooseArchiveParent(plans.map((plan) => plan.repoPath)), day);
      const folder: { path: string | null } = { path: null };

      const repos: RepoReport[] = [];
      for (const [index, plan] of plans.entries()) {
        const folderName = folderNames[index] ?? plan.repoName;
        const executed = await executePlan(
          {
            git: deps.git,
            allowedRoots: [plan.repoPath, deps.tempClaudeDir],
            repoFolder: async () => {
              folder.path = await sweepFolder();
              const sub = join(folder.path, folderName);
              await fs.mkdir(sub, { recursive: true });
              return sub;
            },
          },
          plan,
        );
        repos.push({
          repoPath: plan.repoPath,
          repoName: plan.repoName,
          folderName,
          integrationRef: plan.integrationRef,
          fetchError: plan.fetchError,
          executed,
          kept: plan.items.filter((item): item is Extract<typeof item, { kind: 'keep' }> => item.kind === 'keep'),
        });
      }

      const report: SweepReport = { day, folder: folder.path, repos, notes };
      if (folder.path !== null) {
        try {
          await fs.writeFile(join(folder.path, SUMMARY_FILE), renderSummary(report, deps.now()), 'utf8');
        } catch (error) {
          await log(`faxina: não gravou o resumo: ${messageOf(error)}`);
        }
      }

      if (!lostRepos) deps.setLastSweepAt(startedAt);
      const totals = totalsOf(report);
      await log(`faxina: ${totals.freedBytes} bytes liberados, ${totals.separatedItems} separados, ${totals.branchesDeleted} branches, ${totals.worktreesRemoved} worktrees, ${totals.kept} de lado, ${totals.failed} falhas`);
      return {
        failed: false,
        freedBytes: totals.freedBytes,
        separatedItems: totals.separatedItems,
        branchesDeleted: totals.branchesDeleted,
        worktreesRemoved: totals.worktreesRemoved,
        folder: folder.path,
      };
    } catch (error) {
      await log(`faxina: falhou: ${messageOf(error)}`);
      return FAILED;
    }
  };
}
