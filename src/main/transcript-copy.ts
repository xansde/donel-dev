import { copyFileSync, existsSync, mkdirSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { planTranscriptCopy, type PlanTranscriptCopyInput } from '../shared/transcriptCopy';
import { claudeHomeDir, PRINCIPAL_PROFILE_SLUG, profileDirPath, type ProfilePathsDeps } from './profile-manager';

// Lote 8 (009-modo-dev-v3), CA-24 — o fs REAL da cópia de transcript entre
// perfis, pro botão "Reiniciar sessão em foco". A DECISÃO (mesma conta vs.
// contas diferentes, quais paths) é pura (`shared/transcriptCopy.ts`); este
// módulo só resolve as duas raízes reais (`profile-manager.ts`, o mesmo
// helper que a criação de perfil usa) e copia o arquivo — sempre injetável
// (mesmo padrão de `esteira-reader.ts`/`profile-manager.ts`), nunca lança.
//
// ACHADO (medido nesta máquina, 2026-07-30): `~/.claude-profiles/<slug>/projects`
// é um Windows Junction pra `~/.claude/projects` GLOBAL (criado por
// `buildProfileCreationPlan`, `PROFILE_LINK_DIRS` inclui `'projects'`) — TODO
// perfil aponta pro MESMO diretório físico. Na topologia de hoje, origem e
// destino de uma cópia entre dois perfis costumam já ser o MESMO arquivo. A
// guarda de `realpathOrNull` cobre esse caso (pula a cópia, sem erro) sem
// abandonar o desenho pedido — se um dia `projects/` deixar de ser
// compartilhado, a cópia volta a ser necessária de verdade e o mesmo código
// já cobre os dois mundos.

export interface TranscriptCopyIoDeps {
  existsSync: (path: string) => boolean;
  mkdirSync: (path: string) => void;
  copyFileSync: (source: string, dest: string) => void;
  /** `fs.realpathSync`, mas nunca lança — path inexistente/quebrado vira `null` (o chamador já sabe que "não existe" é um caso válido). */
  realpathOrNull: (path: string) => string | null;
}

export function createSystemTranscriptCopyIoDeps(): TranscriptCopyIoDeps {
  return {
    existsSync,
    mkdirSync: (path) => mkdirSync(path, { recursive: true }),
    copyFileSync,
    realpathOrNull: (path) => {
      try {
        return realpathSync(path);
      } catch {
        return null;
      }
    },
  };
}

export type TranscriptCopyResult =
  | { readonly copied: false; readonly reason: 'same-profile' | 'source-missing' | 'already-same-file' }
  | { readonly copied: true };

/** Mesma resolução que `buildProfileCreationPlan` usa pro junction de `projects` (profile-manager.ts) — "principal" é `~/.claude`, sem override. */
function profileProjectsDir(profileSlug: string, deps: ProfilePathsDeps): string {
  return profileSlug === PRINCIPAL_PROFILE_SLUG ? join(claudeHomeDir(deps), 'projects') : join(profileDirPath(profileSlug, deps), 'projects');
}

/**
 * CA-24 — copia o `.jsonl` da sessão do perfil de ORIGEM pro perfil de
 * DESTINO, só quando os dois são diferentes e a origem existe. Nunca lança:
 * qualquer degradação (`same-profile`/`source-missing`/`already-same-file`)
 * é reportada, nunca um throw — quem chama decide como seguir (o resume
 * tenta de qualquer forma; se a fonte não existia, o pior caso é idêntico ao
 * de hoje sem este botão).
 */
export function copyTranscriptForResume(
  input: PlanTranscriptCopyInput,
  pathDeps: ProfilePathsDeps,
  io: TranscriptCopyIoDeps,
): TranscriptCopyResult {
  const plan = planTranscriptCopy(input);
  if (plan.kind === 'same-profile') return { copied: false, reason: 'same-profile' };

  const sourceDir = join(profileProjectsDir(plan.sourceProfileSlug, pathDeps), plan.projectSlug);
  const targetDir = join(profileProjectsDir(plan.targetProfileSlug, pathDeps), plan.projectSlug);
  const sourceFile = join(sourceDir, plan.sessionFileName);
  const targetFile = join(targetDir, plan.sessionFileName);

  if (!io.existsSync(sourceFile)) return { copied: false, reason: 'source-missing' };

  const sourceReal = io.realpathOrNull(sourceFile);
  const targetReal = io.realpathOrNull(targetFile);
  if (sourceReal && targetReal && sourceReal === targetReal) {
    return { copied: false, reason: 'already-same-file' };
  }

  if (!io.existsSync(targetDir)) io.mkdirSync(targetDir);
  io.copyFileSync(sourceFile, targetFile);
  return { copied: true };
}
