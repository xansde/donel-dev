// T015 — tipos IPC do domínio de configuração (FR-007, FR-009, plan.md
// "ConfigStore %APPDATA%\DonelDev\config.json"). O ConfigStore de verdade
// (schema completo, escrita atômica, migração dos JSONs avulsos de T007/
// T014) vive em `src/main/config-store.ts`; aqui só o contrato compartilhado
// com preload/renderer — mesmo padrão de src/shared/accounts.ts.
//
// Só os campos que o RENDERER precisa ler/editar entram no DTO
// (`AppConfigDto`): `favorites` (já servido por `projects:list`) e
// `activeProfileSlug` (campo LEGADO, T1220 — nunca mais escrito, só aceito
// no sanitize; o motor de contas tem canal próprio, `accounts:*`) NÃO
// duplicam aqui — o main process continua sendo a fonte única de verdade
// pros dois, só que agora persistidos dentro do MESMO config.json.

import type { EffortLevel, ModelAlias, PermissionMode } from './commandBuilder';
import type { DevModeState } from './devMode';
import type { StoredSessionName } from './sessionName';
import type { SessionRegistry } from './sessionRegistry';
// 015-jobu-pet — the anchor point of the pet's remembered position (src/shared/pet/types.ts).
import type { PetPoint } from './pet/types';
// CA-26/CA-27 (009-modo-dev-v3) — cor+ordem da aba v3 por sessão claude, ver
// src/shared/tabAppearance.ts (lógica pura) e src/shared/tabChannels.ts
// (canais `tabs:*`).
import type { TabAppearanceMap } from './tabAppearance';

export const CONFIG_CHANNELS = {
  get: 'config:get',
  setProjectRoots: 'config:setProjectRoots',
  setNotificationPreference: 'config:setNotificationPreference',
  setLauncherDefaults: 'config:setLauncherDefaults',
  /** T708 (007-favoritos-sessoes) — estado de colapso do grupo "Favoritos" (CA-1), persistido por projeto. */
  setCollapsedFavorites: 'config:setCollapsedFavorites',
  /** FIX ambiente genérico (28/07) — critério da listagem de projetos configurável. */
  setProjectScanMode: 'config:setProjectScanMode',
  /** T008 (014-chat) — `chat.enabled` / `chat.focusMode`. */
  setChatPrefs: 'config:setChatPrefs',
  /** T014 (015-jobu-pet) — `pet.enabled`; position and size are only written by the main, from the pet's gestures. */
  setPetPrefs: 'config:setPetPrefs',
} as const;

/**
 * FIX ambiente genérico (28/07, teste do colega): 'markers' (default, o
 * comportamento de sempre — só pasta com `.git/` ou `CLAUDE.md`, até 2
 * níveis) × 'all' (toda pasta de 1º nível das raízes, para quem não organiza
 * o disco por repositório). A preferência dele é 'markers'; 'all' existe
 * para a máquina genérica.
 */
export type ProjectScanMode = 'markers' | 'all';

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
  /**
   * "Isolar em worktree" (`--worktree`). Opcional e só gravado quando ligado:
   * configs antigos (e canais mais antigos lendo este) seguem com a forma de
   * sempre. (O antigo `chrome` — Claude in Chrome — saiu em 03/11; o sanitize
   * o descarta.)
   */
  readonly worktree?: boolean;
}

/**
 * T402 (004-nomear-sessoes) — `sessionId` → nome que a UI deu à sessão, com o
 * `custom-title` visto no momento da escrita. Vai para o renderer porque é ele
 * quem resolve o label exibido (`resolveSessionName`, src/shared/sessionName.ts):
 * a regra de precedência mora num lugar só, e aba e sidebar consomem o mesmo
 * valor (CA-5).
 */
export type SessionNamesMap = Readonly<Record<string, StoredSessionName>>;

/** T008 (014-chat) — interruptor do chat (R22) e modo foco global (FR-009). */
export interface ChatPrefs {
  readonly enabled: boolean;
  readonly focusMode: boolean;
}

/**
 * T014 (015-jobu-pet) — the Jobu on the desktop. `enabled` is the Preferences switch
 * (off by default); `placement` is the base point, at the center of the drawing (`null` = default
 * position); `size` is the height of the drawing in DIP (FR-033, 80–320, default 140).
 */
export interface PetPrefs {
  readonly enabled: boolean;
  readonly placement: PetPoint | null;
  readonly size: number;
}

/** 016-jobu-faxina — the stamp of the last sweep that ended well (epoch ms), or `null` if none ever did. Main only; not in the DTO. */
export interface SweepPrefs {
  readonly lastSweepAt: number | null;
}

/** What the renderer may ask of the main: only the switch. */
export interface PetPrefsInput {
  readonly enabled?: boolean;
}

/** Subconjunto do `AppConfig` (main) exposto ao renderer — ver comentário de topo. */
export interface AppConfigDto {
  readonly projectRoots: readonly string[];
  readonly projectScanMode: ProjectScanMode;
  readonly launcherDefaults: LauncherDefaultsDto;
  readonly notificationPreference: NotificationPreference;
  readonly sessionNames: SessionNamesMap;
  /** P1 (tasks.md "Fora deste ciclo": temas) — persistido desde já (FR-007), sem UI de troca no P0. */
  readonly theme: 'dark';
  /**
   * T704 (007-favoritos-sessoes) — registro de sessões recentes/fixadas por
   * projeto favoritado (CA-7/D9: fonte da lista no boot, sem varrer disco).
   * O RENDERER é o único escritor (plan.md §Fatia 2); vai no DTO porque é ele
   * quem monta o grupo "Favoritos" da sidebar a partir deste mapa.
   */
  readonly sessionRegistry: SessionRegistry;
  /**
   * T708 (007) — caminhos de projetos favoritados cujo grupo está COLAPSADO
   * (CA-1: estado de colapso persiste entre execuções). Ausência = expandido
   * (default) — evita crescer a lista a cada favorito novo.
   */
  readonly collapsedFavorites: readonly string[];
  /**
   * T306 (003-modo-dev) — estado próprio do Modo Dev (CA-21/CA-22): tudo o
   * que disco/board não sabem (discoveries abertos, foco, session-id
   * arquivado, tabela de defaults do CA-4). Exposto inteiro ao renderer —
   * diferente de `sessionRegistry`, não há campo a esconder aqui (nenhum é
   * "só do main").
   */
  readonly devMode: DevModeState;
  /**
   * CA-26/CA-27 (009-modo-dev-v3) — cor + ordem da aba v3, por `claudeSessionId`
   * (chave a mesma de `sessionNames`). Ausência de entrada = cor `'none'` e
   * ordem "no fim" (App.tsx decide o índice na hora de renderizar) — nunca um
   * valor fabricado. Abas `shell` (terminal comum) não entram aqui (ver
   * comentário de `TabAppearanceMap`, src/shared/tabAppearance.ts).
   */
  readonly tabAppearance: TabAppearanceMap;
  /** T008 (014-chat) — preferências do chat. */
  readonly chat: ChatPrefs;
  /** T014 (015-jobu-pet) — the Jobu's preferences on the desktop. */
  readonly pet: PetPrefs;
}

/** API tipada exposta pelo preload em `window.donel.config`. */
export interface DonelConfigApi {
  get(): Promise<AppConfigDto>;
  /** Substitui a lista inteira de roots (UI de Preferências, feedback E2E rodada 3); dispara re-scan — quem chama refaz `projects.list()` em seguida. */
  setProjectRoots(roots: string[]): Promise<AppConfigDto>;
  setNotificationPreference(preference: NotificationPreference): Promise<AppConfigDto>;
  /** Gravado a cada "▶ Iniciar" do Launcher — semeia a config do PRÓXIMO Launcher aberto (FR-007 "defaults do launcher"). */
  setLauncherDefaults(defaults: LauncherDefaultsDto): Promise<AppConfigDto>;
  /** T708 (007) — substitui a lista INTEIRA de projetos favoritados colapsados (CA-1). */
  setCollapsedFavorites(collapsed: string[]): Promise<AppConfigDto>;
  /** FIX ambiente genérico (28/07) — troca o critério da listagem; quem chama refaz `projects.list()` em seguida. */
  setProjectScanMode(mode: ProjectScanMode): Promise<AppConfigDto>;
  /** T008 (014-chat) — atualização parcial: só os campos boolean enviados mudam. */
  setChatPrefs(prefs: Partial<ChatPrefs>): Promise<AppConfigDto>;
  /** T014 (015-jobu-pet) — turns the Jobu on/off; applies at once, without a restart. */
  setPetPrefs(prefs: PetPrefsInput): Promise<AppConfigDto>;
}
