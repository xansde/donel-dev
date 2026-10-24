// T084 (014-chat) - disk scanner of the `/` menu: skills, commands, project, enabled plugins, skill_listing, mtime cache.
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createCommandCatalogScanner } from '../src/main/chat/command-catalog-scanner';

let base: string;
let home: string;
let cwd: string;
const put = (path: string, body: string): void => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, body);
};
const skill = (dir: string, name: string, description: string, fm = `name: ${name}\n`): void =>
  put(join(dir, 'skills', name, 'SKILL.md'), `---\n${fm}description: ${description}\n---\nbody that must not matter`);

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'donel-catalog-'));
  home = join(base, 'home');
  cwd = join(base, 'project');
  mkdirSync(home, { recursive: true });
  mkdirSync(cwd, { recursive: true });
});
afterEach(() => rmSync(base, { recursive: true, force: true }));

describe('createCommandCatalogScanner', () => {
  it('reads user and project skills and commands (subfolder becomes folder:name)', async () => {
    skill(home, 'tdd', 'Test first');
    put(join(home, 'commands', 'deploy.md'), '---\ndescription: Ship it\n---\n');
    put(join(home, 'commands', 'git', 'sync.md'), '---\ndescription: Sync branches\n---\n');
    skill(join(cwd, '.claude'), 'local-skill', 'Only here');
    put(join(cwd, '.claude', 'commands', 'proj.md'), 'no frontmatter');
    const catalog = await createCommandCatalogScanner({ claudeHome: home }).catalog(cwd, null);
    const by = (n: string) => catalog.find((e) => e.name === n);
    expect(by('tdd')).toMatchObject({ source: 'skill', scope: 'user', description: 'Test first' });
    expect(by('deploy')).toMatchObject({ source: 'command', scope: 'user', description: 'Ship it' });
    expect(by('git:sync')).toMatchObject({ source: 'command', description: 'Sync branches' });
    expect(by('local-skill')).toMatchObject({ source: 'skill', scope: 'project' });
    expect(by('proj')).toMatchObject({ source: 'command', scope: 'project', description: '' });
    expect(by('model')).toMatchObject({ source: 'builtin' });
  });

  it('uses the folder name when a skill has no name in the frontmatter', async () => {
    put(join(home, 'skills', 'folder-name', 'SKILL.md'), '---\ndescription: d\n---\n');
    const catalog = await createCommandCatalogScanner({ claudeHome: home }).catalog(cwd, null);
    expect(catalog.map((e) => e.name)).toContain('folder-name');
  });

  it('includes only ENABLED plugins, namespaced, crossing settings with installed_plugins.json', async () => {
    const on = join(base, 'plugins', 'on');
    const off = join(base, 'plugins', 'off');
    skill(on, 'helper', 'Helps');
    put(join(on, 'commands', 'run.md'), '---\ndescription: Runs\n---\n');
    put(join(on, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'nice' }));
    skill(off, 'hidden', 'Nope');
    put(
      join(home, 'plugins', 'installed_plugins.json'),
      JSON.stringify({
        version: 2,
        plugins: {
          'nice@mk': [{ scope: 'user', installPath: on }],
          'off@mk': [{ scope: 'user', installPath: off }],
          'projonly@mk': [{ scope: 'project', projectPath: join(base, 'elsewhere'), installPath: off }],
        },
      }),
    );
    put(join(home, 'settings.json'), JSON.stringify({ enabledPlugins: { 'nice@mk': true, 'off@mk': false, 'projonly@mk': true } }));
    const catalog = await createCommandCatalogScanner({ claudeHome: home }).catalog(cwd, null);
    const names = catalog.map((e) => e.name);
    expect(names).toEqual(expect.arrayContaining(['nice:helper', 'nice:run']));
    expect(names.some((n) => n.endsWith(':hidden') || n === 'hidden')).toBe(false);
    expect(catalog.find((e) => e.name === 'nice:helper')).toMatchObject({ source: 'plugin', scope: 'plugin' });
  });

  it('lets the project settings switch a plugin off over the user ones', async () => {
    const dir = join(base, 'plugins', 'p');
    skill(dir, 's', 'x');
    put(join(home, 'plugins', 'installed_plugins.json'), JSON.stringify({ plugins: { 'p@mk': [{ scope: 'user', installPath: dir }] } }));
    put(join(home, 'settings.json'), JSON.stringify({ enabledPlugins: { 'p@mk': true } }));
    put(join(cwd, '.claude', 'settings.local.json'), JSON.stringify({ enabledPlugins: { 'p@mk': false } }));
    const names = (await createCommandCatalogScanner({ claudeHome: home }).catalog(cwd, null)).map((e) => e.name);
    expect(names).not.toContain('p:s');
  });

  it('reads skill_listing from the head of the transcript (names only the session knows)', async () => {
    const transcript = join(base, 'session.jsonl');
    const listing = { type: 'attachment', attachment: { type: 'skill_listing', content: '- remote-skill: From the session\n- pl:tool: Plugin one' } };
    put(transcript, `${JSON.stringify({ type: 'user', message: 'hi' })}\n${JSON.stringify(listing)}\n`);
    const catalog = await createCommandCatalogScanner({ claudeHome: home }).catalog(cwd, transcript);
    expect(catalog.find((e) => e.name === 'remote-skill')).toMatchObject({ source: 'skill', description: 'From the session' });
    expect(catalog.find((e) => e.name === 'pl:tool')).toMatchObject({ source: 'plugin' });
  });

  it('survives a missing or unreadable transcript', async () => {
    const catalog = await createCommandCatalogScanner({ claudeHome: home }).catalog(cwd, join(base, 'missing.jsonl'));
    expect(catalog.length).toBeGreaterThan(10);
  });

  it('rebuilds when a file mtime changes and when files appear', async () => {
    skill(home, 'alpha', 'first');
    const scanner = createCommandCatalogScanner({ claudeHome: home });
    expect((await scanner.catalog(cwd, null)).find((e) => e.name === 'alpha')?.description).toBe('first');
    const file = join(home, 'skills', 'alpha', 'SKILL.md');
    writeFileSync(file, '---\nname: alpha\ndescription: second\n---\n');
    utimesSync(file, new Date(), new Date(Date.now() + 5000));
    expect((await scanner.catalog(cwd, null)).find((e) => e.name === 'alpha')?.description).toBe('second');
    skill(home, 'beta', 'new one');
    expect((await scanner.catalog(cwd, null)).map((e) => e.name)).toContain('beta');
  });
});
