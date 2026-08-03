// FIX (#32) — "o link do repositório digitado some se não clicar
// 'Adicionar'": lógica PURA (sem React) de normalização do campo "Novo
// repositório GitHub" de `ProjectConfigForm.tsx` — trim + dedup, a MESMA
// regra que `handleAddRepo` já aplicava internamente. Extraída pra este
// módulo porque agora tem DOIS consumidores: o próprio `handleAddRepo` (clique
// em "Adicionar"/Enter) e o submit do formulário PAI (modal "Novo projeto" em
// `ProjectSwitcher.tsx`, engrenagem em `PreviousSessions.tsx`), que precisa
// commitar o texto ainda não adicionado ANTES de gravar `repos.json` — sem
// isso, um repo digitado mas não clicado em "Adicionar" simplesmente sumia
// no submit (o `newRepo` era state local, descartado).
//
// Nome do arquivo (`repoEntryList`, não `projectConfigForm`) é proposital:
// `ProjectConfigForm.tsx` já existe neste mesmo diretório e o Windows
// (NTFS) resolve nomes de arquivo sem diferenciar maiúsculas/minúsculas —
// `projectConfigForm.ts` colidiria com `ProjectConfigForm.tsx` (TS1149/TS1261).

/** Trima e devolve `null` por string vazia/só espaços — nunca uma entrada em branco. */
export function normalizeRepoEntry(raw: string): string | null {
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Acrescenta `candidate` (trimado) ao fim de `repos`, dedup por valor já
 * trimado — devolve sempre uma CÓPIA nova (nunca muta `repos`), mesmo quando
 * nada muda (candidato vazio ou já presente), pra quem chama nunca precisar
 * distinguir "array novo" de "mesmo array".
 */
export function withPendingRepoCommitted(repos: readonly string[], candidate: string): string[] {
  const normalized = normalizeRepoEntry(candidate);
  if (!normalized || repos.includes(normalized)) return [...repos];
  return [...repos, normalized];
}
