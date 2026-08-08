import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// 012 Esteira 4.0 — item `wi-esteira4-layout-esteira-dir`.
// A spec `specs/012-esteira-4/layout-esteira.md` é a FONTE: este teste não
// redeclara o padrão de nome de run, ele LÊ o padrão e os exemplos do próprio
// documento (seção 4) e os confronta. Editar a spec e quebrar os próprios
// exemplos derruba o teste — que é a única forma de um layout em prosa não
// divergir do disco na primeira semana.
//
// O teste também pina as evidências `[E]` que a spec cita. Quando o código
// mudar, o erro aqui diz que A SPEC ENVELHECEU — em vez de a spec seguir
// afirmando o que não é mais verdade.

const REPO_ROOT = join(__dirname, '..');
const SPEC_PATH = join(REPO_ROOT, 'specs', '012-esteira-4', 'layout-esteira.md');
const ESTEIRA_ROOT = join(REPO_ROOT, '.esteira');
const CICLO = 'dsc-15a7e7f5-fbb';
const ITEM = 'wi-esteira4-layout-esteira-dir';

const specText = readFileSync(SPEC_PATH, 'utf-8');

/** Blocos cercados da seção 4, na ordem: gabarito, regex, casam, não casam. */
function fencedBlocksOfSection(title: string): string[] {
  const start = specText.indexOf(title);
  if (start < 0) throw new Error(`seção não encontrada na spec: ${title}`);
  const rest = specText.slice(start);
  const end = rest.indexOf('\n## ', 1);
  const section = end < 0 ? rest : rest.slice(0, end);
  return [...section.matchAll(/```[a-z]*\n([\s\S]*?)```/g)].map((m) => m[1].trim());
}

const SECTION_4 = fencedBlocksOfSection('## 4. O nome do arquivo de run é contrato');

/** Primeira coluna de cada linha — os exemplos "não casam" trazem `← porquê`. */
function filenames(block: string): string[] {
  return block
    .split('\n')
    .map((line) => line.trim().split(/\s+/)[0])
    .filter((name) => name.endsWith('.json'));
}

describe('layout v2 — o padrão de nome de run é contrato (seção 4 da spec)', () => {
  const [gabarito, regexBlock, casamBlock, naoCasamBlock] = SECTION_4;
  const pattern = new RegExp(regexBlock);

  it('a seção 4 declara gabarito, regex e os dois conjuntos de exemplo', () => {
    expect(gabarito).toBe('<UTC compacto>--<fase>--<run_id>.json');
    expect(regexBlock.startsWith('^') && regexBlock.endsWith('$')).toBe(true);
    expect(filenames(casamBlock).length).toBeGreaterThanOrEqual(3);
    expect(filenames(naoCasamBlock).length).toBeGreaterThanOrEqual(3);
  });

  it.each(filenames(SECTION_4[2]))('casa: %s', (name) => {
    expect(pattern.test(name)).toBe(true);
  });

  it.each(filenames(SECTION_4[3]))('não casa: %s', (name) => {
    expect(pattern.test(name)).toBe(false);
  });

  it('o formato 2.1.0 (um arquivo por fase) é recusado — é a sobrescrita da seção 1.2', () => {
    expect(pattern.test('validar-result.json')).toBe(false);
    expect(pattern.test('implementar-result.json')).toBe(false);
  });

  it('complemento e revisão são runs NOVOS — os sufixos do contrato v1 casam', () => {
    expect(pattern.test('20260808T0932Z--implementar--run-b70e2f19-55c.c1.json')).toBe(true);
    expect(pattern.test('20260808T1041Z--validar--run-b70e2f19-55c.rev2.json')).toBe(true);
  });

  it('a ordem cronológica sai da ordem lexicográfica, sem abrir arquivo', () => {
    const embaralhado = [
      '20260808T0932Z--implementar--run-b70e2f19-55c.json',
      '20260807T2312Z--discovery--run-3f2ab1c4-902.json',
      '20260808T0018Z--plano--run-9c14e77a-4d1.json',
    ];
    expect([...embaralhado].sort()).toEqual([
      '20260807T2312Z--discovery--run-3f2ab1c4-902.json',
      '20260808T0018Z--plano--run-9c14e77a-4d1.json',
      '20260808T0932Z--implementar--run-b70e2f19-55c.json',
    ]);
  });
});

describe('layout v2 — a árvore materializada obedece à seção 3', () => {
  it('o cabeçalho existe e declara layout_version 2', () => {
    const header = JSON.parse(readFileSync(join(ESTEIRA_ROOT, 'esteira.json'), 'utf-8'));
    expect(header.layout_version).toBe(2);
    expect(header.cycles_root).toBe('ciclos');
    expect(header.anchor_repo).toBe('donel-dev');
    expect(typeof header.contract_version).toBe('string');
  });

  it('a zona local não é versionada — o .gitignore do canal a exclui', () => {
    const ignore = readFileSync(join(ESTEIRA_ROOT, '.gitignore'), 'utf-8');
    expect(ignore.split('\n').map((l) => l.trim())).toContain('local/');
  });

  it('artefato de item mora no caminho de quatro segmentos ciclos/<dsc>/itens/<wi>/<fase>/', () => {
    const design = join(ESTEIRA_ROOT, 'ciclos', CICLO, 'itens', ITEM, 'design');
    expect(existsSync(join(design, 'mockup-layout-esteira.html'))).toBe(true);
    expect(existsSync(join(design, 'diagrama-arquitetura.md'))).toBe(true);
  });

  it('o layout 2.1.0 deste item não sobreviveu ao movimento — não há duas cópias', () => {
    expect(existsSync(join(ESTEIRA_ROOT, 'design', ITEM))).toBe(false);
  });
});

describe('layout v2 — as evidências [E] que a spec cita continuam verdadeiras', () => {
  it('a raiz de estado da 2.x ainda está FORA do repo (é o que a spec reverte)', () => {
    const main = readFileSync(join(REPO_ROOT, 'src', 'main', 'index.ts'), 'utf-8');
    expect(main).toContain("join(homedir(), '.claude', 'esteira-state')");
  });

  it('a ida da 3.0 ainda vem de inbox/outbox fora do repo (é o acoplamento que a spec extingue)', () => {
    const dispatch = readFileSync(join(REPO_ROOT, 'src', 'main', 'esteira-dispatch.ts'), 'utf-8');
    expect(dispatch).toContain("'.claude', 'esteira-donel', 'inbox'");
  });

  it('review-policy.json segue na raiz do canal — a zona de config nasce dele', () => {
    expect(existsSync(join(ESTEIRA_ROOT, 'review-policy.json'))).toBe(true);
  });

  it('os três campos sanitizados por [P-2] são anuláveis no contrato v1', () => {
    const schemaPath = join(REPO_ROOT, 'src', 'shared', 'esteira', 'contract', 'v1', 'esteira-result.schema.json');
    const schema = JSON.parse(readFileSync(schemaPath, 'utf-8'));
    const workspace = schema.$defs.workspace.properties;
    const actor = schema.$defs.actor.properties;
    expect(workspace.repo_path.type).toContain('null');
    expect(workspace.worktree_path.type).toContain('null');
    expect(actor.cli_session_id.type).toContain('null');
    // target_repo é o que VIAJA: obrigatório, e por isso nunca sanitizado.
    expect(schema.$defs.workspace.required).toContain('target_repo');
  });

  it('subject só exige discovery_id — é o que sustenta [P-1] (pasta por ciclo)', () => {
    const schemaPath = join(REPO_ROOT, 'src', 'shared', 'esteira', 'contract', 'v1', 'esteira-result.schema.json');
    const schema = JSON.parse(readFileSync(schemaPath, 'utf-8'));
    expect(schema.$defs.subject.required).toEqual(['discovery_id']);
  });
});
