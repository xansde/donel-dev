import { describe, expect, it } from 'vitest';
import { normalizeRepoEntry, withPendingRepoCommitted } from '../src/renderer/src/repoEntryList';

// FIX (#32) — "o link do repositório digitado some se não clicar
// 'Adicionar'": `ProjectConfigForm.tsx` guardava o texto pendente do campo
// "Novo repositório GitHub" num state LOCAL (`newRepo`), descartado quando o
// formulário PAI (modal "Novo projeto"/engrenagem) submetia sem que o
// usuário tivesse clicado "Adicionar" (ou apertado Enter) antes. TDD da
// lógica PURA de normalização (trim + dedup) que tanto o `handleAddRepo`
// interno quanto o submit do formulário PAI (via `ProjectConfigFormHandle
// .getPendingRepo()`) agora compartilham — nenhuma duplicação de regra.

describe('normalizeRepoEntry', () => {
  it('trima espaços e devolve a string', () => {
    expect(normalizeRepoEntry('  org/repo  ')).toBe('org/repo');
  });

  it('string vazia (ou só espaços) vira null', () => {
    expect(normalizeRepoEntry('')).toBeNull();
    expect(normalizeRepoEntry('   ')).toBeNull();
  });
});

describe('withPendingRepoCommitted', () => {
  it('acrescenta o candidato trimado no fim da lista', () => {
    expect(withPendingRepoCommitted(['org/a'], '  org/b  ')).toEqual(['org/a', 'org/b']);
  });

  it('candidato vazio (ou só espaços): devolve a lista original, sem entrada nova', () => {
    expect(withPendingRepoCommitted(['org/a'], '')).toEqual(['org/a']);
    expect(withPendingRepoCommitted(['org/a'], '   ')).toEqual(['org/a']);
  });

  it('candidato já presente na lista: não duplica', () => {
    expect(withPendingRepoCommitted(['org/a', 'org/b'], 'org/a')).toEqual(['org/a', 'org/b']);
  });

  it('candidato já presente mas com espaços em volta: ainda detecta o dedup (compara o valor trimado)', () => {
    expect(withPendingRepoCommitted(['org/a'], '  org/a  ')).toEqual(['org/a']);
  });

  it('lista vazia + candidato válido: lista com um item', () => {
    expect(withPendingRepoCommitted([], 'org/novo')).toEqual(['org/novo']);
  });

  it('lista vazia + candidato vazio: continua vazia', () => {
    expect(withPendingRepoCommitted([], '')).toEqual([]);
  });

  it('nunca muta o array original (devolve sempre uma cópia nova)', () => {
    const original = ['org/a'];
    const result = withPendingRepoCommitted(original, 'org/b');
    expect(result).not.toBe(original);
    expect(original).toEqual(['org/a']);
  });
});
