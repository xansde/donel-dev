// 016-jobu-faxina (T009) - reading `~/.claude/projects` for the sweep: which folder each session folder was made for
// (its `cwd`), and when it last had a transcript written. The transcripts are never read whole: the `cwd` is
// taken from the first 128 KB of the first file that has one, with a pattern on the raw text, so even a record cut
// in half by the limit still gives it. Nothing of the conversation is kept or returned.

import { promises as fs } from 'node:fs';
import { join } from 'node:path';

export interface ClaudeProjectFolder {
  /** Folder name under the projects directory. */
  readonly name: string;
  readonly absPath: string;
  /** The `cwd` of the first record that has one; `null` when none of the first files had it. */
  readonly cwd: string | null;
  /** The newest mtime among the `.jsonl` files at the top of the folder, epoch ms; 0 when there is none. */
  readonly newestTranscriptMs: number;
}

const HEAD_BYTES = 128 * 1024;
const MAX_FILES_TRIED = 3;
const CWD_PATTERN = /"cwd"\s*:\s*"((?:[^"\\]|\\.)*)"/;

/** The `cwd` found in the head of one transcript, or `null`. */
export async function readCwdFromHead(file: string): Promise<string | null> {
  let handle: fs.FileHandle | null = null;
  try {
    handle = await fs.open(file, 'r');
    const buffer = Buffer.alloc(HEAD_BYTES);
    const { bytesRead } = await handle.read(buffer, 0, HEAD_BYTES, 0);
    const match = CWD_PATTERN.exec(buffer.toString('utf8', 0, bytesRead));
    if (match === null) return null;
    const value: unknown = JSON.parse(`"${match[1] ?? ''}"`);
    return typeof value === 'string' && value !== '' ? value : null;
  } catch {
    return null;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

/** One entry per folder of the projects directory. An unreadable directory gives an empty list. */
export async function scanClaudeProjects(projectsDir: string): Promise<ClaudeProjectFolder[]> {
  let entries;
  try {
    entries = await fs.readdir(projectsDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const folders: ClaudeProjectFolder[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const absPath = join(projectsDir, entry.name);
    let files: string[];
    try {
      files = (await fs.readdir(absPath)).filter((name) => name.endsWith('.jsonl')).sort();
    } catch {
      continue;
    }
    let newestTranscriptMs = 0;
    for (const name of files) {
      try {
        newestTranscriptMs = Math.max(newestTranscriptMs, (await fs.stat(join(absPath, name))).mtimeMs);
      } catch {
        // a file that vanished while scanning is not news
      }
    }
    let cwd: string | null = null;
    for (const name of files.slice(0, MAX_FILES_TRIED)) {
      cwd = await readCwdFromHead(join(absPath, name));
      if (cwd !== null) break;
    }
    folders.push({ name: entry.name, absPath, cwd, newestTranscriptMs });
  }
  return folders;
}
