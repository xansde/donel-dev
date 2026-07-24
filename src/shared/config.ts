// T015 — tipos IPC do domínio de configuração (FR-007, FR-009, plan.md
// "ConfigStore %APPDATA%\DonelDev\config.json"). O ConfigStore de verdade
// (schema completo, escrita atômica, migração dos JSONs avulsos de T007/
// T014) vive em `src/main/config-store.ts`; aqui só o contrato compartilhado
// com preload/renderer — mesmo padrão de src/shared/profiles.ts.
//
// Só os campos que o RENDERER precisa ler/editar entram no DTO
// (`AppConfigDto`): `favorites` (já servido por `projects:list`) e
// `activeProfileSlug` (já servido por `profiles:list`, campo `active`) NÃO
// duplicam aqui — o main process continua sendo a fonte única de verdade
// pros dois, só que agora persistidos dentro do MESMO config.json.

import type { EffortLevel, ModelAlias, PermissionMode } from './commandBuilder';
import type { StoredSessionName } from './sessionName';

export const CONFIG_CHANNELS = {
  get: 'config:get',
  setProjectRoots: 'config:setProjectRoots',
  setNotificationPreference: 'config:setNotificationPreference',
  setLauncherDefaults: 'config:setLauncherDefaults',
} as const;

/**
 * FIX (feedback E2E rodada 4/batch 3, achado "notificar toda transição vira
 * spam"): 'all' preserva o comportamento antigo (waiting + permission
 * disparam toast), 'permission-only' é o novo default conservador (só a
 * transição que de fato TRAVA a sessão), 'none' desliga.
 */
export type NotificationPreference = 'all' | 'permission-only' | 'none';

export interface LauncherDefaultsDto {
  readonly model: ModelAlias;
  readonly effort: EffortLevel;
  readonly permissionMode: PermissionMode;
}

/**
 * T402 (004-nomear-sessoes) — `sessionId` → nome que a UI deu à sessão, com o
 * `custom-title` visto no momento da escrita. Vai para o renderer porque é ele
 * quem resolve o label exibido (`resolveSessionName`, src/shared/sessionName.ts):
 * a regra de precedência mora num lugar só, e aba e sidebar consomem o mesmo
 * valor (CA-5).
 */
export type SessionNamesMap = Readonly<Record<string, StoredSessionName>>;

/** Subconjunto do `AppConfig` (main) exposto ao renderer — ver comentário de topo. */
export interface AppConfigDto {
  readonly projectRoots: readonly string[];
  readonly launcherDefaults: LauncherDefaultsDto;
  readonly notificationPreference: NotificationPreference;
  readonly sessionNames: SessionNamesMap;
  /** P1 (tasks.md "Fora deste ciclo": temas) — persistido desde já (FR-007), sem UI de troca no P0. */
  readonly theme: 'dark';
}

/** API tipada exposta pelo preload em `window.donel.config`. */
export interface DonelConfigApi {
  get(): Promise<AppConfigDto>;
  /** Substitui a lista inteira de roots (UI de Preferências, feedback E2E rodada 3); dispara re-scan — quem chama refaz `projects.list()` em seguida. */
  setProjectRoots(roots: string[]): Promise<AppConfigDto>;
  setNotificationPreference(preference: NotificationPreference): Promise<AppConfigDto>;
  /** Gravado a cada "▶ Iniciar" do Launcher — semeia a config do PRÓXIMO Launcher aberto (FR-007 "defaults do launcher"). */
  setLauncherDefaults(defaults: LauncherDefaultsDto): Promise<AppConfigDto>;
}
