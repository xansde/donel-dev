import { describe, expect, it } from 'vitest';
import { summarizeTool } from '../src/shared/chat/toolSummary';
import { commandDisplayText } from '../src/shared/chat/t3/commandLabel';

const cwd = 'C:\\work\\atlas';
const posixCwd = '/home/u/atlas';

describe('summarizeTool — Read', () => {
  it('summarizes a full read with a path relative to cwd', () => {
    const r = summarizeTool({ name: 'Read', input: { file_path: 'C:\\work\\atlas\\src\\a.ts' }, cwd });
    expect(r.category).toBe('read');
    expect(r.summary).toEqual({ verb: 'Leu', target: 'src/a.ts' });
  });

  it('shows the line range when the read is partial (from the result)', () => {
    const r = summarizeTool({
      name: 'Read',
      input: { file_path: '/home/u/atlas/a.ts', offset: 10, limit: 5 },
      result: { type: 'text', file: { filePath: '/home/u/atlas/a.ts', startLine: 10, numLines: 5, totalLines: 100 } },
      cwd: posixCwd,
    });
    expect(r.summary).toEqual({ verb: 'Leu', target: 'a.ts', stats: 'linhas 10–14' });
  });

  it('falls back to the input offset/limit while the result is not there yet', () => {
    const r = summarizeTool({ name: 'Read', input: { file_path: '/home/u/atlas/a.ts', offset: 3, limit: 4 }, cwd: posixCwd });
    expect(r.summary.stats).toBe('linhas 3–6');
  });

  it('does not report a range when the whole file was read', () => {
    const r = summarizeTool({
      name: 'Read',
      input: { file_path: '/home/u/atlas/a.ts' },
      result: { type: 'text', file: { startLine: 1, numLines: 40, totalLines: 40 } },
      cwd: posixCwd,
    });
    expect(r.summary.stats).toBeUndefined();
  });

  it('describes images and PDFs', () => {
    const img = summarizeTool({ name: 'Read', input: { file_path: '/x/y.png' }, result: { type: 'image', file: {} }, cwd: posixCwd });
    expect(img.summary.verb).toBe('Viu a imagem');
    const pdf = summarizeTool({ name: 'Read', input: { file_path: '/x/y.pdf' }, result: { type: 'pdf' }, cwd: posixCwd });
    expect(pdf.summary.verb).toBe('Leu o PDF');
  });
});

describe('summarizeTool — paths', () => {
  it('uses the file name for files outside cwd, with the full path as title', () => {
    const r = summarizeTool({ name: 'Read', input: { file_path: 'D:\\other\\beacon\\notes.md' }, cwd });
    expect(r.summary.target).toBe('notes.md');
    expect(r.title).toBe('D:\\other\\beacon\\notes.md');
  });

  it('does not treat a sibling folder with the same prefix as inside cwd', () => {
    const r = summarizeTool({ name: 'Read', input: { file_path: '/home/u/atlas-extra/z.ts' }, cwd: posixCwd });
    expect(r.summary.target).toBe('z.ts');
  });

  it('matches cwd case-insensitively on Windows paths', () => {
    const r = summarizeTool({ name: 'Read', input: { file_path: 'c:\\WORK\\atlas\\src\\a.ts' }, cwd });
    expect(r.summary.target).toBe('src/a.ts');
  });
});

describe('summarizeTool — Write / Edit', () => {
  it('Write create counts lines', () => {
    const r = summarizeTool({
      name: 'Write',
      input: { file_path: '/home/u/atlas/n.ts', content: 'a\nb\nc' },
      result: { type: 'create', filePath: '/home/u/atlas/n.ts', content: 'a\nb\nc', structuredPatch: [] },
      cwd: posixCwd,
    });
    expect(r.category).toBe('write');
    expect(r.summary).toEqual({ verb: 'Criou', target: 'n.ts', stats: '3 linhas' });
  });

  it('Write update shows +a −b', () => {
    const r = summarizeTool({
      name: 'Write',
      input: { file_path: '/home/u/atlas/n.ts', content: 'x' },
      result: { type: 'update', structuredPatch: [{ lines: [' k', '-old', '+new1', '+new2'] }] },
      cwd: posixCwd,
    });
    expect(r.summary).toEqual({ verb: 'Reescreveu', target: 'n.ts', stats: '+2 −1' });
  });

  it('Edit sums every hunk of the structuredPatch', () => {
    const r = summarizeTool({
      name: 'Edit',
      input: { file_path: '/home/u/atlas/App.tsx' },
      result: {
        structuredPatch: [
          { lines: [' c', '+a', '+b', '-x'] },
          { lines: ['-y', '+z', ' c'] },
        ],
      },
      cwd: posixCwd,
    });
    expect(r.category).toBe('edit');
    expect(r.summary).toEqual({ verb: 'Editou', target: 'App.tsx', stats: '+3 −2' });
  });

  it('Edit without result has no stats', () => {
    const r = summarizeTool({ name: 'Edit', input: { file_path: '/home/u/atlas/App.tsx' }, cwd: posixCwd });
    expect(r.summary).toEqual({ verb: 'Editou', target: 'App.tsx' });
  });
});

describe('summarizeTool — Bash / PowerShell', () => {
  it('uses the command label without shell wrappers', () => {
    const r = summarizeTool({ name: 'Bash', input: { command: "bash -lc 'npm test'" }, cwd });
    expect(r.category).toBe('bash');
    expect(r.summary).toEqual({ verb: 'Rodou', target: 'npm test' });
  });

  it('strips a powershell -Command wrapper', () => {
    const r = summarizeTool({
      name: 'PowerShell',
      input: { command: 'powershell -NoProfile -Command "Get-ChildItem src"' },
      cwd,
    });
    expect(r.summary.target).toBe('Get-ChildItem src');
  });

  it('keeps only a one-line label of at most 60 characters', () => {
    const long = 'echo ' + 'x'.repeat(200);
    const r = summarizeTool({ name: 'Bash', input: { command: `${long}\nsecond line` }, cwd });
    expect(r.summary.target!.length).toBeLessThanOrEqual(60);
    expect(r.summary.target!.endsWith('…')).toBe(true);
    expect(r.summary.target).not.toContain('\n');
  });

  it('marks background runs', () => {
    const r = summarizeTool({ name: 'Bash', input: { command: 'npm run dev', run_in_background: true }, cwd });
    expect(r.summary.verb).toBe('Rodou em segundo plano');
    expect(r.summary.target).toBe('npm run dev');
  });

  it('agrees with commandDisplayText for plain commands', () => {
    expect(commandDisplayText("bash -lc 'ls -la'")).toBe('ls -la');
  });
});

describe('summarizeTool — search and web', () => {
  it('Grep with matches', () => {
    const r = summarizeTool({
      name: 'Grep',
      input: { pattern: 'foo.*' },
      result: { mode: 'files_with_matches', numFiles: 4, filenames: [] },
      cwd,
    });
    expect(r.category).toBe('search');
    expect(r.summary).toEqual({ verb: 'Buscou', target: "'foo.*'", stats: 'em 4 arquivos' });
  });

  it('Grep singular and empty', () => {
    expect(summarizeTool({ name: 'Grep', input: { pattern: 'a' }, result: { numFiles: 1 }, cwd }).summary.stats).toBe('em 1 arquivo');
    expect(summarizeTool({ name: 'Grep', input: { pattern: 'a' }, result: { numFiles: 0 }, cwd }).summary.stats).toBe('nada encontrado');
  });

  it('Glob', () => {
    const r = summarizeTool({ name: 'Glob', input: { pattern: 'src/**/*.ts' }, result: { numFiles: 12, filenames: [] }, cwd });
    expect(r.summary).toEqual({ verb: 'Listou', target: 'src/**/*.ts', stats: '12 arquivos' });
  });

  it('WebFetch shows the domain and WebSearch the query', () => {
    const f = summarizeTool({ name: 'WebFetch', input: { url: 'https://docs.example.com/a/b?q=1' }, cwd });
    expect(f.category).toBe('web');
    expect(f.summary).toEqual({ verb: 'Abriu', target: 'docs.example.com' });
    const s = summarizeTool({ name: 'WebSearch', input: { query: 'vitest mock' }, cwd });
    expect(s.summary).toEqual({ verb: 'Pesquisou na web', target: "'vitest mock'" });
  });

  it('WebFetch tolerates an invalid URL', () => {
    const f = summarizeTool({ name: 'WebFetch', input: { url: 'not a url' }, cwd });
    expect(f.summary.verb).toBe('Abriu');
  });
});

describe('summarizeTool — task and misc tools', () => {
  it('task tools', () => {
    for (const name of ['TodoWrite', 'TaskCreate', 'TaskUpdate']) {
      const r = summarizeTool({ name, input: {}, cwd });
      expect(r.category).toBe('task');
      expect(r.summary).toEqual({ verb: 'Atualizou a lista de tarefas' });
    }
  });

  it('ToolSearch', () => {
    const r = summarizeTool({ name: 'ToolSearch', input: { query: 'select:Foo' }, cwd });
    expect(r.summary.verb).toBe('Carregou ferramentas');
    expect(r.category).toBe('other');
  });

  it('Monitor, TaskStop, SendMessage, Workflow', () => {
    expect(summarizeTool({ name: 'Monitor', input: {}, cwd }).summary.verb).toBe('Acompanhou tarefa');
    expect(summarizeTool({ name: 'TaskStop', input: { task_id: 'bx1' }, cwd }).summary).toEqual({ verb: 'Parou tarefa', target: 'bx1' });
    expect(summarizeTool({ name: 'SendMessage', input: { to: 'vega' }, cwd }).summary).toEqual({ verb: 'Mandou mensagem', target: 'vega' });
    expect(summarizeTool({ name: 'Workflow', input: { workflow: 'beacon' }, cwd }).summary).toEqual({ verb: 'Rodou workflow', target: 'beacon' });
  });
});

describe('summarizeTool — MCP and unknown', () => {
  it('MCP shows server · tool', () => {
    const r = summarizeTool({ name: 'mcp__atlas_srv__list_items', input: {}, cwd });
    expect(r.category).toBe('mcp');
    expect(r.summary).toEqual({ verb: 'Usou', target: 'atlas_srv · list_items' });
  });

  it('MCP keeps double underscores inside the tool name', () => {
    const r = summarizeTool({ name: 'mcp__beacon__a__b', input: {}, cwd });
    expect(r.summary.target).toBe('beacon · a__b');
  });

  it('unknown tools show their name', () => {
    const r = summarizeTool({ name: 'VegaThing', input: { a: 1 }, cwd });
    expect(r.category).toBe('other');
    expect(r.summary).toEqual({ verb: 'Usou', target: 'VegaThing' });
  });

  it('never throws on malformed input', () => {
    expect(() => summarizeTool({ name: 'Read', input: null, cwd })).not.toThrow();
    expect(() => summarizeTool({ name: 'Bash', input: 'x', result: 5, cwd })).not.toThrow();
    expect(summarizeTool({ name: 'Read', input: {}, cwd }).summary.verb).toBe('Leu');
  });
});
