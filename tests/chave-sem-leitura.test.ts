import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { keyFileReadDenyRules, sessionHookSettingsDir, writeSessionHooksSettings, writeSessionScopeOnlySettings } from '../src/main/hooks-settings';

// As ferramentas da sessão não leem os arquivos que guardam as chaves dela (08/11): uma sessão que abria
// `meta.json` ou `mcp.json` copiava a chave para o transcript. O CLI real (2.1.319) já foi medido à mão; aqui fica
// guardado que toda pasta com chave entra no `--settings` como regra de negar, que a regra pega a leitura por
// ferramenta e por Bash, e que não pega a busca de código pelo nome da pasta (o trabalho normal de um Dev).

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** The CLI's matching, reduced to what these rules use: `Read(<root>/**)` by prefix, `Bash(...)` with `*` wildcards. */
function denies(rules: readonly string[], tool: 'Read' | 'Bash', target: string): boolean {
  return rules.some((rule) => {
    const match = /^(Read|Bash)\((.*)\)$/.exec(rule);
    if (!match || match[1] !== tool) return false;
    if (tool === 'Read') {
      const root = match[2].replace(/\/\*\*$/, '').replace(/^~(?=\/)/, homedir().replaceAll('\\', '/')).replace(/^\/\//, '/');
      return target.replaceAll('\\', '/').startsWith(`${root}/`);
    }
    const pattern = match[2].split('*').map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*');
    return new RegExp(`^${pattern}$`, 's').test(target);
  });
}

function denyOf(settingsPath: string): string[] {
  return (JSON.parse(readFileSync(settingsPath, 'utf8')) as { permissions?: { deny?: string[] } }).permissions?.deny ?? [];
}

describe('arquivos da chave fora do alcance das ferramentas da sessão', () => {
  it('sessão local: todo arquivo com chave que o app grava fica negado à leitura, com e sem a ponte dos hooks', () => {
    const userDataDir = mkdtempSync(join(tmpdir(), 'chave-leitura-'));
    dirs.push(userDataDir);
    const keyDirs = [sessionHookSettingsDir(userDataDir)];
    const withHooks = writeSessionHooksSettings({ userDataDir, ptyId: 'pty-a', port: 1, token: 'a'.repeat(32), curlPath: null, statusLine: { kind: 'chain', user: { command: 'x' } }, keyDirs });
    const withoutHooks = writeSessionScopeOnlySettings(userDataDir, 'pty-b', null, keyDirs);
    const files = readdirSync(keyDirs[0]).map((name) => join(keyDirs[0], name));
    expect(files.length).toBeGreaterThanOrEqual(4); // settings, header, forwarder and statusline scripts, scope-only

    for (const settingsPath of [withHooks, withoutHooks]) {
      const rules = denyOf(settingsPath);
      for (const file of files) {
        expect(denies(rules, 'Read', file), `Read ${file}`).toBe(true);
        expect(denies(rules, 'Bash', `python3 -c "print(open('${file}').read())"`), `Bash ${file}`).toBe(true);
      }
    }
  });

  it('sessão remota e Windows: a pasta da sessão e o userData do PC, sem pegar a busca de código', () => {
    const remote = keyFileReadDenyRules(['~/.donel/s']);
    const sid = '66666666-7777-4888-9999-000000000000';
    for (const name of ['meta.json', 'mcp.json', 'settings.json', 'hook-header', 'slack-guard.sh']) {
      expect(denies(remote, 'Read', join(homedir(), '.donel', 's', sid, name)), name).toBe(true);
      expect(denies(remote, 'Bash', `cat "$HOME/.donel/s/${sid}/${name}"`), name).toBe(true);
      expect(denies(remote, 'Bash', `node -e "require('fs').readFileSync('/root/.donel/s/${sid}/${name}')"`), name).toBe(true);
    }

    const windows = keyFileReadDenyRules(['C:\\Users\\dono\\AppData\\Roaming\\donel-dev\\hook-settings']);
    expect(windows).toContain('Read(//c/Users/dono/AppData/Roaming/donel-dev/hook-settings/**)'); // the CLI's form for a drive
    expect(denies(windows, 'Bash', 'type C:\\Users\\dono\\AppData\\Roaming\\donel-dev\\hook-settings\\pty.header')).toBe(true);
    expect(denies(windows, 'Bash', 'cat /c/Users/dono/AppData/Roaming/donel-dev/hook-settings/pty.header')).toBe(true);

    for (const search of ['grep -rn "\\.donel/s/" src', 'grep -rn hook-settings src', 'git log -- src/main/hooks-settings.ts']) {
      expect(denies([...remote, ...windows], 'Bash', search), search).toBe(false);
    }
  });
});
