import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { keepClearedBoxText } from '../src/main/chat/cleared-box-store';

// 08/11 — o texto que o app apaga da caixa do terminal (pode ser um rascunho do dono) fica guardado: cada limpeza se
// acrescenta ao arquivo da conversa, nenhuma apaga a anterior, e um id estranho nunca vira caminho fora da pasta.
const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

it('guarda cada texto apagado no arquivo da conversa, sem perder o anterior', () => {
  const dir = mkdtempSync(join(tmpdir(), 'caixa-limpa-'));
  dirs.push(dir);
  const first = keepClearedBoxText(dir, 'aaaaaaaa-0000-4000-8000-000000000001', 'rascunho do dono', new Date('2026-11-08T18:00:00Z'));
  const second = keepClearedBoxText(dir, 'aaaaaaaa-0000-4000-8000-000000000001', '[Pasted text #8 +12 lines]', new Date('2026-11-08T18:05:00Z'));
  expect(second).toBe(first);
  const content = readFileSync(first, 'utf8');
  expect(content).toContain('rascunho do dono');
  expect(content).toContain('[Pasted text #8 +12 lines]');
  expect(content.indexOf('2026-11-08T18:00:00.000Z')).toBeLessThan(content.indexOf('2026-11-08T18:05:00.000Z'));
  expect(keepClearedBoxText(dir, '../../fora', 'x')).toBe(join(dir, 'sem-sessao.txt'));
});
