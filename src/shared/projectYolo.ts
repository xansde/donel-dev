// Modo YOLO por projeto (docs/refinamentos/auto-sem-permissao.md): which project a tab belongs to and the list of
// projects in YOLO. Pure, shared by the main (it answers the requests) and the renderer (it shows the mark), so the
// two never disagree. A wrong answer here approves actions without the owner noticing.

/** For comparing paths on Windows: lower case, one kind of slash, no trailing slash. */
function comparable(path: string): string {
  return path.toLowerCase().replace(/\\/g, '/').replace(/\/+$/, '');
}

function isInsideOrEqual(path: string, folder: string): boolean {
  return folder !== '' && (path === folder || path.startsWith(`${folder}/`));
}

/** The project that holds the first folder any of `projects` holds; the deepest one when they nest. `null` = none. */
export function projectOfFolders(folders: readonly string[], projects: readonly string[]): string | null {
  for (const folder of folders) {
    const target = comparable(folder);
    let owner: string | null = null;
    for (const project of projects) {
      if (!isInsideOrEqual(target, comparable(project))) continue;
      if (owner === null || comparable(project).length > comparable(owner).length) owner = project;
    }
    if (owner !== null) return owner;
  }
  return null;
}

/**
 * The folders that stand for a tab, most telling first. `mainRepoRoot` is the main checkout of the repo the tab's
 * folder is in: a subfolder or a `.claude/worktrees/*` is already under it, but a linked worktree elsewhere on the
 * disk only reaches its project through it.
 */
export function tabFolders(cwd: string, mainRepoRoot: string | null): string[] {
  if (mainRepoRoot === null || isInsideOrEqual(comparable(cwd), comparable(mainRepoRoot))) return [cwd];
  return [mainRepoRoot, cwd];
}

/** Turning off also removes a parent folder in YOLO: after the click, `path` is really out. */
export function withProjectYolo(projects: readonly string[], path: string, enabled: boolean): string[] {
  if (enabled) return projectOfFolders([path], projects) !== null ? [...projects] : [...projects, path];
  return projects.filter((project) => !isInsideOrEqual(comparable(path), comparable(project)));
}
