// Memória do Líder no PC (#413, passo 6 de docs/alfa/gerar-alfa-no-pc.md): a memória do projeto antigo vai para a
// pasta da orquestradora sem perder nada e sem duplicar nada (dono). É dado persistido do dono: o que se perdesse
// aqui some da vista do Líder sem ninguém perceber.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { carryMemory, formatReport, mergeMemoryIndex } from '../scripts/levar-memoria-lider.mjs';

const SCRIPT = fileURLToPath(new URL('../scripts/levar-memoria-lider.mjs', import.meta.url));

function dirs(): { old: string; next: string } {
  const root = mkdtempSync(join(tmpdir(), 'memoria-lider-'));
  const old = join(root, 'antiga');
  const next = join(root, 'nova');
  mkdirSync(old);
  mkdirSync(next);
  return { old, next };
}

/** Every file of a folder, with its sha256: to prove the old folder is never touched. */
function snapshot(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (at: string, rel: string): void => {
    for (const name of readdirSync(at)) {
      const full = join(at, name);
      const key = rel ? `${rel}/${name}` : name;
      if (statSync(full).isDirectory()) walk(full, key);
      else out[key] = `${createHash('sha256').update(readFileSync(full)).digest('hex')}:${statSync(full).mtimeMs}`;
    }
  };
  walk(dir, '');
  return out;
}

describe('Memória do Líder no PC — nada se perde, nada duplica', () => {
  it('MEMORY.md de destino sem quebra de linha no fim: a linha nova não cola, e a 2ª rodada não duplica (caso do Revisor)', () => {
    const { old, next } = dirs();
    writeFileSync(join(old, 'MEMORY.md'), '- [A](a.md) — a\n- [B](b.md) — b\n');
    writeFileSync(join(next, 'MEMORY.md'), '- [A](a.md) — a\n- [C](c.md) — c');

    carryMemory(old, next, { apply: true });
    const once = readFileSync(join(next, 'MEMORY.md'), 'utf8');
    expect(once).toBe('- [A](a.md) — a\n- [C](c.md) — c\n- [B](b.md) — b\n');

    const second = carryMemory(old, next, { apply: true });
    expect(readFileSync(join(next, 'MEMORY.md'), 'utf8')).toBe(once);
    expect(second.addedLines).toEqual([]);
  });

  it('a mesma entrada (mesmo arquivo) com outra descrição não duplica: o link decide, e o gancho antigo vira conflito', () => {
    expect(mergeMemoryIndex('- [Hindsight](hindsight.md) — descrição antiga\n# Índice\n', '# Índice\n- [Hindsight é a memória](hindsight.md) — nova\n')).toEqual({
      text: '# Índice\n- [Hindsight é a memória](hindsight.md) — nova\n',
      added: [],
      conflicts: [{ link: 'hindsight.md', old: '- [Hindsight](hindsight.md) — descrição antiga', new: '- [Hindsight é a memória](hindsight.md) — nova' }],
    });
  });

  it('o índice preserva o fim de linha do destino (\\r\\n) e grava sem BOM', () => {
    const { old, next } = dirs();
    writeFileSync(join(old, 'MEMORY.md'), '﻿- [B](b.md) — b\n');
    writeFileSync(join(next, 'MEMORY.md'), '- [A](a.md) — a\r\n');
    carryMemory(old, next, { apply: true });
    const bytes = readFileSync(join(next, 'MEMORY.md'));
    expect(bytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))).toBe(false);
    expect(bytes.toString('utf8')).toBe('- [A](a.md) — a\r\n- [B](b.md) — b\r\n');
  });

  it('mesmo nome com conteúdo diferente: não sobrescreve; a versão antiga fica ao lado, entra no índice e aparece nos conflitos', () => {
    const { old, next } = dirs();
    writeFileSync(join(old, 'MEMORY.md'), '- [Regra](regra.md) — a regra antiga\n');
    writeFileSync(join(old, 'regra.md'), 'versão do projeto antigo\n');
    writeFileSync(join(next, 'MEMORY.md'), '- [Regra](regra.md) — a regra nova\n');
    writeFileSync(join(next, 'regra.md'), 'versão da orquestradora\n');

    const report = carryMemory(old, next, { apply: true });

    expect(readFileSync(join(next, 'regra.md'), 'utf8')).toBe('versão da orquestradora\n');
    expect(readFileSync(join(next, 'regra.do-projeto-antigo.md'), 'utf8')).toBe('versão do projeto antigo\n');
    expect(report.conflicts).toEqual([{ name: 'regra.md', savedAs: 'regra.do-projeto-antigo.md', status: 'save' }]);
    expect(readFileSync(join(next, 'MEMORY.md'), 'utf8')).toBe('- [Regra](regra.md) — a regra nova\n- [Regra](regra.do-projeto-antigo.md) — a regra antiga\n');
    expect(formatReport(report)).toContain('regra.md');
    expect(formatReport(report)).toContain('regra.do-projeto-antigo.md');
  });

  it('a cópia já guardada ao lado com outro conteúdo: lista o conflito e não grava nada', () => {
    const { old, next } = dirs();
    writeFileSync(join(old, 'regra.md'), 'antiga\n');
    writeFileSync(join(old, 'so-na-antiga.md'), 'x\n');
    writeFileSync(join(next, 'regra.md'), 'nova\n');
    writeFileSync(join(next, 'regra.do-projeto-antigo.md'), 'outra coisa\n');
    const before = snapshot(next);

    const report = carryMemory(old, next, { apply: true });

    expect(report.blocked).toBe(true);
    expect(report.applied).toBe(false);
    expect(report.conflicts).toEqual([{ name: 'regra.md', savedAs: 'regra.do-projeto-antigo.md', status: 'blocked' }]);
    expect(snapshot(next)).toEqual(before);
  });

  it('copia o que só existe na antiga (também em subpasta), deixa o igual; sem --aplicar, só mostra o plano', () => {
    const { old, next } = dirs();
    writeFileSync(join(old, 'nova-regra.md'), 'n\n');
    writeFileSync(join(old, 'igual.md'), 'mesmo\n');
    mkdirSync(join(old, 'sub'));
    writeFileSync(join(old, 'sub', 'nota.md'), 's\n');
    writeFileSync(join(next, 'igual.md'), 'mesmo\n');

    const plan = carryMemory(old, next, { apply: false });
    expect(plan.applied).toBe(false);
    expect(existsSync(join(next, 'nova-regra.md'))).toBe(false);
    expect(plan.copied).toEqual(['nova-regra.md', 'sub/nota.md']);
    expect(plan.same).toEqual(['igual.md']);

    const done = carryMemory(old, next, { apply: true });
    expect(done.applied).toBe(true);
    expect(readFileSync(join(next, 'nova-regra.md'), 'utf8')).toBe('n\n');
    expect(readFileSync(join(next, 'sub', 'nota.md'), 'utf8')).toBe('s\n');
  });

  it('rodar duas vezes: a 2ª não muda nada; a pasta antiga nunca é tocada', () => {
    const { old, next } = dirs();
    writeFileSync(join(old, 'MEMORY.md'), '- [A](a.md) — a\n- [B](b.md) — b\nnota solta sem link\n');
    writeFileSync(join(old, 'a.md'), 'a antiga\n');
    writeFileSync(join(old, 'b.md'), 'b\n');
    writeFileSync(join(next, 'MEMORY.md'), '- [A](a.md) — a');
    writeFileSync(join(next, 'a.md'), 'a nova\n');
    const oldBefore = snapshot(old);

    carryMemory(old, next, { apply: true });
    const after = snapshot(next);
    const second = carryMemory(old, next, { apply: true });

    expect(snapshot(next)).toEqual(after);
    expect(second.copied).toEqual([]);
    expect(second.addedLines).toEqual([]);
    expect(second.conflicts).toEqual([{ name: 'a.md', savedAs: 'a.do-projeto-antigo.md', status: 'already-saved' }]);
    expect(snapshot(old)).toEqual(oldBefore);
    const index = readFileSync(join(next, 'MEMORY.md'), 'utf8');
    expect(index.match(/nota solta sem link/g)).toHaveLength(1);
    expect(index.match(/\(b\.md\)/g)).toHaveLength(1);
  });

  it('pasta nova sem MEMORY.md e com a.md diferente: o índice levado aponta a cópia antiga, e a 2ª rodada não muda nada', () => {
    const { old, next } = dirs();
    writeFileSync(join(old, 'MEMORY.md'), '- [A](a.md) — a\n');
    writeFileSync(join(old, 'a.md'), 'old');
    writeFileSync(join(next, 'a.md'), 'new');

    carryMemory(old, next, { apply: true });
    const index = readFileSync(join(next, 'MEMORY.md'), 'utf8');
    expect(readFileSync(join(next, 'a.md'), 'utf8')).toBe('new');
    expect(readFileSync(join(next, 'a.do-projeto-antigo.md'), 'utf8')).toBe('old');
    expect(index).toContain('(a.do-projeto-antigo.md)');
    expect(index).toBe('- [A](a.do-projeto-antigo.md) — a\n');

    const after = snapshot(next);
    const second = carryMemory(old, next, { apply: true });
    expect(snapshot(next)).toEqual(after);
    expect(second.copied).toEqual([]);
    expect(second.addedLines).toEqual([]);
  });

  it('linha sem link que só difere por espaço no fim não duplica', () => {
    expect(mergeMemoryIndex('# Titulo \n', '# Titulo\n')).toEqual({ text: '# Titulo\n', added: [], conflicts: [] });
    expect(mergeMemoryIndex('# Titulo\n', '# Titulo   \n')).toEqual({ text: '# Titulo   \n', added: [], conflicts: [] });
  });

  it('a antiga já tem <nome>.do-projeto-antigo.md e o <nome> entra em conflito: PARADO, nada gravado, antiga intacta', () => {
    const { old, next } = dirs();
    writeFileSync(join(old, 'MEMORY.md'), '- [A](a.md) — a\n- [Aold](a.do-projeto-antigo.md) — a de antes\n');
    writeFileSync(join(old, 'a.md'), 'a antiga\n');
    writeFileSync(join(old, 'a.do-projeto-antigo.md'), 'a de antes, guardada na antiga\n');
    writeFileSync(join(next, 'MEMORY.md'), '- [A](a.md) — a\n');
    writeFileSync(join(next, 'a.md'), 'a nova\n');
    const oldBefore = snapshot(old);
    const nextBefore = snapshot(next);

    const report = carryMemory(old, next, { apply: true });

    expect(report.blocked).toBe(true);
    expect(report.applied).toBe(false);
    expect(report.conflicts).toContainEqual(expect.objectContaining({ name: 'a.md', savedAs: 'a.do-projeto-antigo.md', status: 'blocked' }));
    expect(snapshot(next)).toEqual(nextBefore);
    expect(snapshot(old)).toEqual(oldBefore);
    expect(formatReport(report)).toContain('PARADO');
    expect(formatReport(report)).toContain('a.do-projeto-antigo.md');
    expect(formatReport(report)).toContain('Nada foi gravado');
  });

  it('mesmo texto com fim de linha ou BOM diferente é igual: sem cópia ao lado e sem entrada nova no índice', () => {
    const { old, next } = dirs();
    writeFileSync(join(old, 'MEMORY.md'), '- [A](a.md) — a\n');
    writeFileSync(join(old, 'a.md'), 'x\r\n');
    writeFileSync(join(next, 'MEMORY.md'), '- [A](a.md) — a\n');
    writeFileSync(join(next, 'a.md'), '﻿x\n');
    const before = snapshot(next);

    const report = carryMemory(old, next, { apply: true });

    expect(report.same).toEqual(['a.md']);
    expect(report.conflicts).toEqual([]);
    expect(report.addedLines).toEqual([]);
    expect(existsSync(join(next, 'a.do-projeto-antigo.md'))).toBe(false);
    expect(snapshot(next)).toEqual(before);
  });

  it('pasta nova que ainda não existe: é criada e recebe a memória toda', () => {
    const { old, next } = dirs();
    const target = join(next, 'ainda-nao-existe');
    writeFileSync(join(old, 'MEMORY.md'), '- [A](a.md) — a\n');
    writeFileSync(join(old, 'a.md'), 'a\n');
    const report = carryMemory(old, target, { apply: true });
    expect(report.copied).toEqual(['MEMORY.md', 'a.md']);
    expect(readFileSync(join(target, 'MEMORY.md'), 'utf8')).toBe('- [A](a.md) — a\n');
  });

  const INDEX_WITH_SECTIONS = '# Memória\n\n## Regras\n- [A](a.md) — primeira\nVeja também [A](a.md) — nota só aqui\n\n## Outras\n- [B](b.md) — b\n';

  it('pasta nova sem MEMORY.md: o índice antigo vai igual, com seções, linhas em branco e a 2ª linha do mesmo link', () => {
    const { old, next } = dirs();
    writeFileSync(join(old, 'MEMORY.md'), INDEX_WITH_SECTIONS);
    writeFileSync(join(old, 'b.md'), 'b\n');

    carryMemory(old, next, { apply: true });

    expect(readFileSync(join(next, 'MEMORY.md'), 'utf8')).toBe(INDEX_WITH_SECTIONS);
  });

  it('pasta nova sem MEMORY.md: BOM e \\r\\n do índice antigo ficam, e só o link do conflito muda', () => {
    const { old, next } = dirs();
    const oldIndex = '﻿# M\r\n\r\n- [A](a.md) — a\r\nVeja também [A](a.md) — nota\r\n';
    writeFileSync(join(old, 'MEMORY.md'), oldIndex);
    writeFileSync(join(old, 'a.md'), 'old');
    writeFileSync(join(next, 'a.md'), 'new');

    carryMemory(old, next, { apply: true });

    expect(readFileSync(join(next, 'MEMORY.md')).equals(Buffer.from(oldIndex.replace(/\(a\.md\)/g, '(a.do-projeto-antigo.md)'), 'utf8'))).toBe(true);
    const after = snapshot(next);
    expect(carryMemory(old, next, { apply: true }).addedLines).toEqual([]);
    expect(snapshot(next)).toEqual(after);
  });

  it('pasta nova com a entrada de A: a entrada antiga de A é pulada, a nota "Veja também" com o mesmo link entra', () => {
    const { old, next } = dirs();
    writeFileSync(join(old, 'MEMORY.md'), INDEX_WITH_SECTIONS);
    writeFileSync(join(next, 'MEMORY.md'), '- [A](a.md) — primeira\n');

    const report = carryMemory(old, next, { apply: true });

    expect(report.addedLines).toEqual(['# Memória', '## Regras', 'Veja também [A](a.md) — nota só aqui', '## Outras', '- [B](b.md) — b']);
    expect(readFileSync(join(next, 'MEMORY.md'), 'utf8')).toBe(
      '- [A](a.md) — primeira\n# Memória\n## Regras\nVeja também [A](a.md) — nota só aqui\n## Outras\n- [B](b.md) — b\n',
    );
    const after = snapshot(next);
    expect(carryMemory(old, next, { apply: true }).addedLines).toEqual([]);
    expect(snapshot(next)).toEqual(after);
  });

  it('duas entradas da antiga com o mesmo link, ausente na nova: entram as duas', () => {
    expect(mergeMemoryIndex('- [A](a.md) — um\n- [A](a.md) — dois\n', '- [Z](z.md) — z\n').added).toEqual(['- [A](a.md) — um', '- [A](a.md) — dois']);
  });

  it('.md que não é UTF-8 válido compara byte a byte: "caf\\xE9" e "caf\\xE8" são um conflito, não iguais', () => {
    const { old, next } = dirs();
    writeFileSync(join(old, 'a.md'), Buffer.from([0x63, 0x61, 0x66, 0xe9]));
    writeFileSync(join(next, 'a.md'), Buffer.from([0x63, 0x61, 0x66, 0xe8]));

    const report = carryMemory(old, next, { apply: true });

    expect(report.same).toEqual([]);
    expect(report.conflicts).toEqual([{ name: 'a.md', savedAs: 'a.do-projeto-antigo.md', status: 'save' }]);
    expect(readFileSync(join(next, 'a.do-projeto-antigo.md')).equals(Buffer.from([0x63, 0x61, 0x66, 0xe9]))).toBe(true);
  });

  it('destino que precisa ser pasta e é arquivo: PARADO, nada gravado (nem o que caberia), sem exceção', () => {
    const { old, next } = dirs();
    writeFileSync(join(old, 'a.md'), 'a\n');
    mkdirSync(join(old, 'sub'));
    writeFileSync(join(old, 'sub', 'x.md'), 'x\n');
    writeFileSync(join(next, 'sub'), 'sou um arquivo\n');
    const before = snapshot(next);

    const report = carryMemory(old, next, { apply: true });

    expect(report.blocked).toBe(true);
    expect(report.applied).toBe(false);
    expect(snapshot(next)).toEqual(before);
    expect(existsSync(join(next, 'a.md'))).toBe(false);
    expect(formatReport(report)).toContain('PARADO');
    expect(formatReport(report)).toContain('sub/x.md');
  });

  it('MEMORY.md da pasta nova é uma pasta: PARADO, nada gravado, sem exceção', () => {
    const { old, next } = dirs();
    writeFileSync(join(old, 'MEMORY.md'), '- [A](a.md) — a\n');
    writeFileSync(join(old, 'a.md'), 'a\n');
    mkdirSync(join(next, 'MEMORY.md'));
    const before = snapshot(next);

    const report = carryMemory(old, next, { apply: true });

    expect(report.blocked).toBe(true);
    expect(snapshot(next)).toEqual(before);
  });

  it('Windows não diferencia maiúsculas: A.md em conflito e a.do-projeto-antigo.md na antiga é colisão, PARADO', () => {
    const { old, next } = dirs();
    writeFileSync(join(old, 'A.md'), 'A antiga\n');
    writeFileSync(join(old, 'a.do-projeto-antigo.md'), 'outra nota\n');
    writeFileSync(join(next, 'A.md'), 'A nova\n');
    const before = snapshot(next);

    const report = carryMemory(old, next, { apply: true });

    expect(report.blocked).toBe(true);
    expect(report.applied).toBe(false);
    expect(report.conflicts).toContainEqual(expect.objectContaining({ name: 'A.md', status: 'blocked', reason: 'collision' }));
    expect(snapshot(next)).toEqual(before);
  });
  it('mesma entrada com gancho mais curto: o gancho antigo não some calado nem duplica; vira conflito com as duas linhas', () => {
    const { old, next } = dirs();
    writeFileSync(join(old, 'MEMORY.md'), '- [A](a.md) — gancho antigo detalhe\n');
    writeFileSync(join(next, 'MEMORY.md'), '- [A](a.md) — gancho\n');
    const before = snapshot(next);

    const report = carryMemory(old, next, { apply: true });

    expect(report.addedLines).toEqual([]);
    expect(report.indexConflicts).toEqual([{ link: 'a.md', old: '- [A](a.md) — gancho antigo detalhe', new: '- [A](a.md) — gancho' }]);
    expect(snapshot(next)).toEqual(before);
    const text = formatReport(report);
    expect(text).toContain('Conflitos');
    expect(text).toContain('- [A](a.md) — gancho antigo detalhe');
    expect(text).toContain('- [A](a.md) — gancho');
  });

  it('mesma entrada com o mesmo texto (só espaço no fim de diferença): nada, nem conflito', () => {
    expect(mergeMemoryIndex('- [A](a.md) — g   \n', '- [A](a.md) — g\n')).toEqual({ text: '- [A](a.md) — g\n', added: [], conflicts: [] });
  });

  it('lista numerada também é entrada de índice: "1. [A](a.md)" contra "- [A](a.md)" com outro gancho é conflito, sem duplicar', () => {
    expect(mergeMemoryIndex('1. [A](a.md) — g velho\n', '- [A](a.md) — g\n')).toEqual({
      text: '- [A](a.md) — g\n',
      added: [],
      conflicts: [{ link: 'a.md', old: '1. [A](a.md) — g velho', new: '- [A](a.md) — g' }],
    });
  });

  it('o link da entrada compara sem maiúsculas: "(Regra.md)" e "(regra.md)" são a mesma entrada', () => {
    expect(mergeMemoryIndex('- [R](Regra.md) — r\n', '- [R](regra.md) — r\n')).toEqual({ text: '- [R](regra.md) — r\n', added: [], conflicts: [] });
    const other = mergeMemoryIndex('- [R](Regra.md) — r antiga\n', '- [R](regra.md) — r\n');
    expect(other.added).toEqual([]);
    expect(other.conflicts).toHaveLength(1);
  });

  it('entrada cujo primeiro link é .md conta mesmo com outro link depois', () => {
    const merged = mergeMemoryIndex('- [A](a.md) — ver também [B](b.md), antigo\n', '- [A](a.md) — ver também [B](b.md)\n');
    expect(merged.added).toEqual([]);
    expect(merged.conflicts).toHaveLength(1);
  });

  it('link com âncora para arquivo em conflito aponta a cópia antiga, com a âncora', () => {
    const { old, next } = dirs();
    writeFileSync(join(old, 'MEMORY.md'), '- [A](a.md#sec) — a\nVeja [A](a.md#outra)\n');
    writeFileSync(join(old, 'a.md'), 'old');
    writeFileSync(join(next, 'a.md'), 'new');

    carryMemory(old, next, { apply: true });

    expect(readFileSync(join(next, 'MEMORY.md'), 'utf8')).toBe('- [A](a.do-projeto-antigo.md#sec) — a\nVeja [A](a.do-projeto-antigo.md#outra)\n');
    expect(mergeMemoryIndex('Veja [A](a.md#sec)\n', '# M\n', { 'a.md': 'a.do-projeto-antigo.md' }).added).toEqual(['Veja [A](a.do-projeto-antigo.md#sec)']);
  });

  it('MEMORY.md antigo fora do UTF-8 e a nova com índice: PARADO, nada gravado, dizendo que não é UTF-8', () => {
    const { old, next } = dirs();
    writeFileSync(join(old, 'MEMORY.md'), Buffer.concat([Buffer.from('- [B](b.md) — caf', 'utf8'), Buffer.from([0xe9, 0x0a])]));
    writeFileSync(join(old, 'b.md'), 'b\n');
    writeFileSync(join(next, 'MEMORY.md'), '- [A](a.md) — a\n');
    const before = snapshot(next);

    const report = carryMemory(old, next, { apply: true });

    expect(report.blocked).toBe(true);
    expect(report.applied).toBe(false);
    expect(snapshot(next)).toEqual(before);
    expect(formatReport(report)).toContain('PARADO');
    expect(formatReport(report)).toContain('não é UTF-8');
  });

  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)(
    'gravação que falha no meio (pasta sem permissão): GRAVAÇÃO PARCIAL com o gravado e o que faltou, MEMORY.md por último; a 2ª rodada completa sem duplicar',
    () => {
      const { old, next } = dirs();
      writeFileSync(join(old, 'MEMORY.md'), '- [A](a.md) — a\n- [X](sub/x.md) — x\n');
      writeFileSync(join(old, 'a.md'), 'a\n');
      mkdirSync(join(old, 'sub'));
      writeFileSync(join(old, 'sub', 'x.md'), 'x\n');
      writeFileSync(join(next, 'MEMORY.md'), '- [Z](z.md) — z\n');
      mkdirSync(join(next, 'sub'));
      chmodSync(join(next, 'sub'), 0o500);
      try {
        const report = carryMemory(old, next, { apply: true });

        expect(report.applied).toBe(false);
        expect(report.partial).toEqual(expect.objectContaining({ written: ['a.md'], missing: ['sub/x.md', 'MEMORY.md'] }));
        expect(readFileSync(join(next, 'MEMORY.md'), 'utf8')).toBe('- [Z](z.md) — z\n');
        const text = formatReport(report);
        expect(text).toContain('GRAVAÇÃO PARCIAL');
        expect(text).toContain('a.md');
        expect(text).toContain('sub/x.md');
        expect(text).toContain('rode de novo');
      } finally {
        chmodSync(join(next, 'sub'), 0o700);
      }

      const again = carryMemory(old, next, { apply: true });
      expect(again.partial).toBeUndefined();
      expect(again.applied).toBe(true);
      expect(again.same).toContain('a.md');
      expect(readFileSync(join(next, 'sub', 'x.md'), 'utf8')).toBe('x\n');
      expect(readFileSync(join(next, 'MEMORY.md'), 'utf8')).toBe('- [Z](z.md) — z\n- [A](a.md) — a\n- [X](sub/x.md) — x\n');
    },
  );

  it.skipIf(process.platform === 'win32')(
    'escrita cortada no meio do MEMORY.md (ulimit -f): o índice da nova fica inteiro, sem temporário, saída não 0; a 2ª rodada completa',
    () => {
      const { old, next } = dirs();
      writeFileSync(join(old, 'MEMORY.md'), '- [B](b.md) — b\n');
      const before = Array.from({ length: 60 }, (_, i) => `- [N${i}](n${i}.md) — nota ${i} da pasta nova\n`).join('');
      writeFileSync(join(next, 'MEMORY.md'), before);
      expect(Buffer.byteLength(before)).toBeGreaterThan(2048);
      const run = (limit: string): ReturnType<typeof spawnSync> =>
        spawnSync('bash', ['-c', `${limit}exec node "$0" "$1" "$2" --aplicar`, SCRIPT, old, next], { encoding: 'utf8' });

      const cut = run('ulimit -f 1; ');

      expect(cut.status).not.toBe(0);
      expect(cut.stdout).toContain('GRAVAÇÃO PARCIAL');
      expect(readFileSync(join(next, 'MEMORY.md'), 'utf8')).toBe(before);
      expect(readdirSync(next).filter((name) => name.includes('.levando-'))).toEqual([]);

      const again = run('');
      expect(again.status).toBe(0);
      expect(again.stdout).toContain('Gravado.');
      expect(readFileSync(join(next, 'MEMORY.md'), 'utf8')).toBe(`${before}- [B](b.md) — b\n`);
      expect(readdirSync(next).filter((name) => name.includes('.levando-'))).toEqual([]);
    },
  );

  it.skipIf(process.platform === 'win32')('chamado por link simbólico: faz o trabalho e sai 0; sem trabalho, imprime o relatório (nunca sai calado)', () => {
    const { old, next } = dirs();
    writeFileSync(join(old, 'a.md'), 'a\n');
    const bin = mkdtempSync(join(tmpdir(), 'memoria-lider-bin-'));
    const link = join(bin, 'levar.mjs');
    symlinkSync(SCRIPT, link);

    const first = spawnSync(process.execPath, [link, old, next, '--aplicar'], { encoding: 'utf8' });
    expect(first.status).toBe(0);
    expect(readFileSync(join(next, 'a.md'), 'utf8')).toBe('a\n');
    expect(first.stdout).toContain('Gravado.');

    const second = spawnSync(process.execPath, [link, old, next, '--aplicar'], { encoding: 'utf8' });
    expect(second.status).toBe(0);
    expect(second.stdout).toContain('Nada a gravar');
  });

  it.skipIf(process.platform === 'win32')('link simbólico na pasta antiga: não é seguido, e aparece como ignorado no relatório', () => {
    const { old, next } = dirs();
    writeFileSync(join(old, 'a.md'), 'a\n');
    symlinkSync(join(old, 'a.md'), join(old, 'atalho.md'));

    const report = carryMemory(old, next, { apply: true });

    expect(report.ignored).toEqual(['atalho.md']);
    expect(existsSync(join(next, 'atalho.md'))).toBe(false);
    expect(formatReport(report)).toContain('atalho.md: ignorado (link simbólico)');
  });
});
