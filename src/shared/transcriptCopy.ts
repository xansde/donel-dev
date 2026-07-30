// Lote 8 (009-modo-dev-v3), CA-24/CA-25 — decisão PURA de cópia de
// transcript entre perfis, pro botão "Reiniciar sessão em foco". Achado 14
// da spec: `resolveProjectSessionsDir(projectPath, claudeHome)`
// (`main/session-indexer.ts:99`) é ciente de perfil por desenho — o
// `.jsonl` de uma sessão mora dentro do `CLAUDE_CONFIG_DIR` do perfil em que
// ela rodou. REGRA DURA do CA-24: `resume` acontece na CONTA SELECIONADA
// (o perfil ativo no ProfileSwitcher), copiando o transcript pra dentro do
// perfil dela quando a sessão rodou em outro perfil — `resume` numa conta
// que não é a dona começaria uma sessão nova, calada.
//
// Este módulo só DECIDE (mesma conta vs. contas diferentes) e resolve as
// duas peças de path que dependem só de STRING (nome do arquivo, slug do
// projeto) — o fs (achar as duas raízes reais, copiar o arquivo) fica
// inteiro em `src/main/transcript-copy.ts`. Puro: sem `node:fs`, sem
// `node:path`, sem Electron — testável sem tocar disco.
//
// `slugifyProjectPathForTranscript` duplica DE PROPÓSITO a regra de
// `slugifyProjectPath` (session-indexer.ts, main/): `shared/` nunca importa
// runtime de `main/` (só tipos — mesmo padrão de `boardAnnotation.ts`/
// `devMode.ts`), pra este módulo continuar zero-fs e testável em isolamento.

/** Mesma regra de `slugifyProjectPath` (main/session-indexer.ts) — todo caractere não-alfanumérico vira `-`, um por um, sem colapsar repetições. */
export function slugifyProjectPathForTranscript(absoluteProjectPath: string): string {
  return absoluteProjectPath.replace(/[^a-zA-Z0-9]/g, '-');
}

export interface PlanTranscriptCopyInput {
  readonly sessionId: string;
  readonly projectPath: string;
  /** Perfil de NASCIMENTO da sessão (`sessionProfiles[tab.id]`, App.tsx) — de onde copiar. */
  readonly sourceProfileSlug: string;
  /** Perfil ATIVO agora (ProfileSwitcher) — pra onde copiar, "a conta selecionada" do CA-24. */
  readonly targetProfileSlug: string;
}

export type TranscriptCopyPlan =
  | { readonly kind: 'same-profile' }
  | {
      readonly kind: 'copy-required';
      readonly sessionFileName: string;
      readonly projectSlug: string;
      readonly sourceProfileSlug: string;
      readonly targetProfileSlug: string;
    };

/**
 * CA-24 — mesma conta (ou payload incompleto): `same-profile`, resume
 * direto, nunca copia. Contas diferentes: `copy-required`, com o nome do
 * arquivo (`<sessionId>.jsonl`) e o slug do projeto já resolvidos — o main
 * só precisa achar as DUAS raízes (`profile-manager.ts`) e copiar.
 */
export function planTranscriptCopy(input: PlanTranscriptCopyInput): TranscriptCopyPlan {
  if (!input.sessionId || !input.projectPath || !input.sourceProfileSlug || !input.targetProfileSlug) {
    return { kind: 'same-profile' };
  }
  if (input.sourceProfileSlug === input.targetProfileSlug) return { kind: 'same-profile' };

  return {
    kind: 'copy-required',
    sessionFileName: `${input.sessionId}.jsonl`,
    projectSlug: slugifyProjectPathForTranscript(input.projectPath),
    sourceProfileSlug: input.sourceProfileSlug,
    targetProfileSlug: input.targetProfileSlug,
  };
}

// ---------------------------------------------------------------------------
// Contrato IPC — mesmo padrão de `projectBinding.ts` (lógica pura + contrato
// IPC no mesmo arquivo): canal, DTO e validação de payload vivem aqui;
// `src/main/transcript-copy.ts` implementa o fs, `main/index.ts` registra o
// handler, `preload/index.ts` expõe `window.donel.transcripts`.
// ---------------------------------------------------------------------------

export const TRANSCRIPT_COPY_CHANNELS = {
  copyForResume: 'transcripts:copyForResume',
} as const;

export type CopyTranscriptForResumeIpcInput = PlanTranscriptCopyInput;

/** Espelha `TranscriptCopyResult` (main/transcript-copy.ts) pro lado do preload/renderer — mesmos 2 shapes, sem depender do módulo de fs em runtime. */
export type CopyTranscriptForResumeResult =
  | { readonly copied: false; readonly reason: 'same-profile' | 'source-missing' | 'already-same-file' | 'invalid-payload' }
  | { readonly copied: true };

/** Guarda defensiva de payload IPC — mesmo espírito de `isValidSaveProjectBindingIpcInput` (projectBinding.ts): o main nunca confia cegamente no que o renderer manda. */
export function isValidCopyTranscriptForResumeIpcInput(input: unknown): input is CopyTranscriptForResumeIpcInput {
  if (typeof input !== 'object' || input === null) return false;
  const candidate = input as Partial<CopyTranscriptForResumeIpcInput>;
  return (
    typeof candidate.sessionId === 'string' &&
    candidate.sessionId.trim().length > 0 &&
    typeof candidate.projectPath === 'string' &&
    candidate.projectPath.trim().length > 0 &&
    typeof candidate.sourceProfileSlug === 'string' &&
    candidate.sourceProfileSlug.trim().length > 0 &&
    typeof candidate.targetProfileSlug === 'string' &&
    candidate.targetProfileSlug.trim().length > 0
  );
}

/** API tipada exposta pelo preload em `window.donel.transcripts`. CA-24 — nunca escreve fora do `.jsonl` da própria sessão sendo reiniciada. */
export interface DonelTranscriptsApi {
  copyForResume(input: CopyTranscriptForResumeIpcInput): Promise<CopyTranscriptForResumeResult>;
}
