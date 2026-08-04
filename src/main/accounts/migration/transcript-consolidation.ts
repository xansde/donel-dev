// T1207 (011-contas-e-provedores, etapa 2) — plano de consolidação de
// transcripts (`data-model-etapa-2.md` §3, D11/C26). PURO: recebe os
// `realpath` JÁ RESOLVIDOS (quem resolve é o chamador, com `fs.realpathSync`
// injetável) e devolve o plano; nenhuma I/O acontece aqui. Compara realpath,
// nunca confia na topologia — `projects` é junction em todo perfil criado
// pelo app, então na máquina real não há o que copiar (achado A7).

import { join } from 'node:path';

export type ConsolidationOutcome =
  | { readonly kind: 'already-consolidated'; readonly reason: 'junction' | 'same-realpath' }
  | { readonly kind: 'nothing-to-copy'; readonly reason: 'missing' }
  | { readonly kind: 'copy'; readonly operations: readonly TranscriptCopyOperation[] };

export interface TranscriptCopyOperation {
  readonly sourcePath: string;
  readonly targetPath: string;
  /** Destino existente ⇒ `skip-existing`; nunca sobrescreve. */
  readonly mode: 'copy' | 'skip-existing';
}

export interface TranscriptConsolidationInput {
  /** `realpath(<perfil>/projects)`, ou `null` se o diretório não existir/resolver. */
  readonly profileProjectsRealpath: string | null;
  /** `realpath(~/.claude/projects)`, ou `null`. */
  readonly globalProjectsRealpath: string | null;
  /** Nomes de arquivo `.jsonl` (não paths) sob `<perfil>/projects`. */
  readonly profileJsonlFiles: readonly string[];
  readonly globalProjectsPath: string;
  readonly profileProjectsPath: string;
  /** Nomes de arquivo `.jsonl` já existentes sob `~/.claude/projects` — nunca sobrescritos. */
  readonly existingGlobalFiles: readonly string[];
}

/** Puro — nenhuma I/O. Compara realpath, nunca confia na topologia (D11). */
export function planTranscriptConsolidation(input: TranscriptConsolidationInput): ConsolidationOutcome {
  if (input.profileProjectsRealpath === null) {
    return { kind: 'nothing-to-copy', reason: 'missing' };
  }

  if (input.globalProjectsRealpath !== null && input.profileProjectsRealpath === input.globalProjectsRealpath) {
    return { kind: 'already-consolidated', reason: 'same-realpath' };
  }

  const existing = new Set(input.existingGlobalFiles);
  const operations: TranscriptCopyOperation[] = input.profileJsonlFiles.map((fileName) => ({
    sourcePath: join(input.profileProjectsPath, fileName),
    targetPath: join(input.globalProjectsPath, fileName),
    mode: existing.has(fileName) ? 'skip-existing' : 'copy',
  }));

  return { kind: 'copy', operations };
}
