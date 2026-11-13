// Memória do Líder no PC (#413, passo 6 de docs/alfa/gerar-alfa-no-pc.md): a memória do projeto antigo vai para a
// pasta da orquestradora sem perder nada e sem duplicar nada (dono). É dado persistido do dono: o que se perdesse
// aqui some da vista do Líder sem ninguém perceber.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { carryMemory, formatReport, mergeMemoryIndex } from '../scripts/levar-memoria-lider.mjs';

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

  it('a mesma entrada (mesmo arquivo) com outra descrição não duplica: o link decide', () => {
    expect(mergeMemoryIndex('- [Hindsight](hindsight.md) — descrição antiga\n# Índice\n', '# Índice\n- [Hindsight é a memória](hindsight.md) — nova\n')).toEqual({
      text: '# Índice\n- [Hindsight é a memória](hindsight.md) — nova\n',
      added: [],
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

  it('pasta nova que ainda não existe: é criada e recebe a memória toda', () => {
    const { old, next } = dirs();
    const target = join(next, 'ainda-nao-existe');
    writeFileSync(join(old, 'MEMORY.md'), '- [A](a.md) — a\n');
    writeFileSync(join(old, 'a.md'), 'a\n');
    const report = carryMemory(old, target, { apply: true });
    expect(report.copied).toEqual(['MEMORY.md', 'a.md']);
    expect(readFileSync(join(target, 'MEMORY.md'), 'utf8')).toBe('- [A](a.md) — a\n');
  });
});
