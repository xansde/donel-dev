import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeSync } from 'node:fs';
import { dirname } from 'node:path';
import type { AccountsConfig } from '../shared/accounts';
import { defaultAccountsConfig } from '../shared/accounts';
import type { EffortLevel, ModelAlias, PermissionMode } from '../shared/commandBuilder';
import type { AppConfigDto, AppUpdatePrefs, AutoModePrefs, BrowserUploadPrefs, ChatPrefs, LauncherDefaultsDto, NotificationPreference, PetPrefs, ProjectScanMode, SessionNamesMap, SweepPrefs, YoloPrefs } from '../shared/config';
// T014 (015-jobu-pet) — limits of the pet size: the same rule the window uses (placement.ts).
import { PET_SIZE_DEFAULT, clampSize } from '../shared/pet/placement';
import { withUploadFolder } from '../shared/browser/upload';
import type {
  ArchivedPhaseSession,
  ArchivedPhaseSessions,
  DevModeBoardConfig,
  DevModeDiscoveries,
  DevModeDiscovery,
  DevModeState,
  EsteiraPhase,
  PhaseDefault,
  PhaseDefaultsTable,
} from '../shared/devMode';
import { DEFAULT_PHASE_DEFAULTS } from '../shared/devModeDefaults';
import { DEFAULT_SESSION_RENEWAL_PREFS, sanitizeSessionRenewalPrefs, type SessionRenewalPrefs } from '../shared/sessionRenewal';
import { sanitizeAccountsConfig } from './accounts/accounts-config';
import { defaultMigrationState, sanitizeMigrationState, type MigrationState } from './accounts/migration/migration-state';
import { sanitizeProvidersConfig } from './providers/providers-config';
import { defaultProvidersConfig } from '../shared/providers';
import type { ProvidersConfigDto } from '../shared/providers';
import type { StoredSessionName } from '../shared/sessionName';
import type { RegisteredSession, SessionRegistry } from '../shared/sessionRegistry';
// CA-26/CA-27 (009-modo-dev-v3, lote 1) — cor + ordem da aba v3, por sessão claude.
import { isTabColorToken, type TabAppearance, type TabAppearanceMap } from '../shared/tabAppearance';

// T1222 (011-contas-e-provedores, etapa 2) — `profile-manager.ts` morreu na
// demolição; `activeProfileSlug` é campo LEGADO (D15/C30, nunca mais
// escrito, só aceito no sanitize) — o default é o literal que o perfil
// "Principal" sempre usou, sem depender do módulo morto.
const LEGACY_PRINCIPAL_PROFILE_SLUG = 'principal';

// T015 — ConfigStore formal (FR-007): `%APPDATA%\donel-dev\config.json` (na
// prática `app.getPath('userData')`, que resolve pro nome real do app —
// `donel-dev`, com hífen, via `app.setName('donel-dev')` em main/index.ts,
// espelhando o campo `name` do package.json raiz). NOTA (T017, 2026-07-23):
// este comentário dizia "DonelDev" (sem hífen) e alegava que NTFS
// case-insensitive cobria a diferença — errado, `DonelDev` e `donel-dev` não
// são a mesma string (falta o hífen, não é só capitalização); confirmado em
// disco que o path real é `%APPDATA%\donel-dev\`. Corrigido aqui e no roteiro
// batch-5 (specs/001-mvp/roteiros-e2e/batch-5-acabamento-empacotamento-smoke.md).
// Escrita ATÔMICA (temp + rename, FR-007), schema
// versionado (`CONFIG_SCHEMA_VERSION`) e defaults resilientes — nunca lança
// pra config ausente/corrompida (mesmo espírito de todo módulo *-store deste
// projeto: ScanDeps, ProfileCreationIoDeps, etc.).
//
// ABSORVE (unifica num único arquivo, sem perder dado existente):
//  - `project-config.json` (T007, `{ favorites }`) — `project-config-store.ts`
//    foi DELETADO nesta task, exatamente como o comentário de topo dele já
//    previa ("o ConfigStore formal... chega no T015 e absorve este arquivo").
//    `toggleFavorite` (pura) foi portada pra cá sem mudança de comportamento.
//  - `active-profile.json` (T014, `{ activeSlug }`) — o formato `{
//    activeSlug }` original vivia em `profile-manager.ts`
//    (`ActiveProfileConfig`), morto na demolição de perfis (T1222,
//    011-contas-e-provedores etapa 2). A migração abaixo sempre leu o
//    arquivo de forma INDEPENDENTE (parsing próprio, sem importar do
//    módulo) — sobrevive intacta, `activeProfileSlug` é campo legado
//    (D15/C30): aceito no sanitize, nunca mais escrito.
//
// Campos NOVOS neste batch (feedback E2E, specs/001-mvp/feedback-e2e.md):
//  - `projectRoots` (rodada 3) — era hardcoded em `defaultProjectRoots`,
//    nunca persistido/editável; agora configurável pela UI de Preferências.
//  - `notificationPreference` (rodada 4, achado do batch 3) — era binário
//    fixo (sempre avisa waiting+permission), agora configurável com default
//    conservador `permission-only`.

export const CONFIG_SCHEMA_VERSION = 1;

export const CONFIG_FILE_NAME = 'config.json';

/** Nomes dos arquivos legados que este módulo absorve (T007/T014) — usados só pela migração, nunca mais escritos. */
export const LEGACY_PROJECT_CONFIG_FILE_NAME = 'project-config.json';
export const LEGACY_ACTIVE_PROFILE_FILE_NAME = 'active-profile.json';

/** Mesmos defaults visuais do Brief 3 (Launcher.tsx `DEFAULT_MODEL`/`DEFAULT_EFFORT`/`DEFAULT_PERMISSION`) — ponto de partida até um lançamento real persistir uma escolha diferente. */
const DEFAULT_LAUNCHER_DEFAULTS: LauncherDefaultsDto = { model: 'fable', effort: 'high', permissionMode: 'acceptEdits' };

/** Conservador por padrão (feedback E2E rodada 4, achado "notificar toda transição vira spam") — só a transição que de fato trava a sessão. */
const DEFAULT_NOTIFICATION_PREFERENCE: NotificationPreference = 'permission-only';

export interface AppConfig {
  readonly version: number;
  readonly projectRoots: readonly string[];
  /** FIX ambiente genérico (28/07) — critério da listagem de projetos; 'markers' é o comportamento de sempre. */
  readonly projectScanMode: ProjectScanMode;
  readonly favorites: readonly string[];
  readonly activeProfileSlug: string;
  readonly launcherDefaults: LauncherDefaultsDto;
  readonly notificationPreference: NotificationPreference;
  /** T402 (004) — `sessionId` → nome dado pela UI. Ver `sessionNames` em src/shared/config.ts. */
  readonly sessionNames: SessionNamesMap;
  /** P1 (tasks.md "Fora deste ciclo": temas) — único valor válido no P0. */
  readonly theme: 'dark';
  /** T704 (007) — registro de sessões recentes/fixadas por projeto favoritado. Ver src/shared/sessionRegistry.ts. */
  readonly sessionRegistry: SessionRegistry;
  /** T708 (007) — projetos favoritados com o grupo COLAPSADO (CA-1). Ausência = expandido. */
  readonly collapsedFavorites: readonly string[];
  /** T306 (003-modo-dev) — estado próprio do Modo Dev. Ver src/shared/devMode.ts. */
  readonly devMode: DevModeState;
  /** CA-26/CA-27 (009-modo-dev-v3) — cor + ordem da aba v3, por `claudeSessionId`. Ver src/shared/tabAppearance.ts. */
  readonly tabAppearance: TabAppearanceMap;
  /**
   * T1105 (011-contas-e-provedores, etapa 1) — config NÃO sensível do motor
   * de contas (mod ativo, política de auto-switch, metadado do pool local).
   * Nasce `defaultAccountsConfig()` (mod: null, motor inerte, C2). NÃO
   * exposta via `AppConfigDto`/`config:get` — tem canal IPC próprio
   * (`accounts:getConfig`/`setConfig`, src/shared/accounts.ts) para não
   * misturar dois domínios num DTO só. Segredo nunca mora aqui (cofre
   * separado, accounts-vault.json).
   */
  readonly accounts: AccountsConfig;
  /**
   * T1209 (011-contas-e-provedores, etapa 2) — estado da migração assistida
   * (perfis → cofre). Nasce `defaultMigrationState()` (nada iniciado).
   * Não exposta via `AppConfigDto`/`config:get` — tem canal IPC próprio
   * (`migration:*`, contracts/migration-etapa-2.md), mesmo padrão de `accounts`.
   */
  readonly migration: MigrationState;
  /**
   * T1305 (011-contas-e-provedores, etapa 3) — registry de providers classe
   * A (`providers-config.ts`). Nasce `defaultProvidersConfig()` (`entries:
   * []`, C14/D6) — registry inerte, comportamento de hoje byte a byte. NÃO
   * exposta via `AppConfigDto`/`config:get` — canal IPC próprio
   * (`PROVIDER_CHANNELS`, src/shared/providers.ts), mesmo padrão de
   * `accounts`/`migration`. Segredo nunca mora aqui (cofre separado,
   * namespace `provider:<id>`, accounts-vault.json reusado).
   */
  readonly providers: ProvidersConfigDto;
  /** T008 (014-chat) — interruptor da entrega incremental (R22) e modo foco global (FR-009). Exposta no DTO. */
  readonly chat: ChatPrefs;
  /**
   * T014 (015-jobu-pet) — the Jobu on the desktop: switch (off by default), remembered position
   * and size. Exposed in the DTO. A TOP-LEVEL key on purpose (R20): a build without the 015 keeps it
   * in `unknownFields` and writes it back intact, which a new subkey of `chat` would not get.
   */
  readonly pet: PetPrefs;
  /**
   * 016-jobu-faxina — the stamp of the last sweep that ended well. A TOP-LEVEL key (like `pet`, R20), NOT in
   * the DTO: only the main reads it.
   */
  readonly sweep: SweepPrefs;
  /**
   * Sessão renovada em voo (B36) — a TOP-LEVEL key (like `pet`, R20): a channel without it keeps it in
   * `unknownFields` and writes it back intact. Exposed in the DTO.
   */
  readonly sessionRenewal: SessionRenewalPrefs;
  /** Modo auto — a TOP-LEVEL key (like `pet`, R20): a channel without it keeps it in `unknownFields`. In the DTO. */
  readonly autoMode: AutoModePrefs;
  /** Modo YOLO — a TOP-LEVEL key (like `pet`, R20): a channel without it keeps it in `unknownFields`. In the DTO. */
  readonly yolo: YoloPrefs;
  /** B33 — the installers folder of the in-app update. A TOP-LEVEL key (like `pet`, R20). Not in the DTO. */
  readonly appUpdate: AppUpdatePrefs;
  /** Navegador integrado — the authorized upload folders. A TOP-LEVEL key (like `pet`, R20). Not in the DTO. */
  readonly browserUploads: BrowserUploadPrefs;
  /**
   * G1 (011-contas-e-provedores, issue 08) — chaves de TOPO que este build
   * não reconhece (ex.: um campo que só um canal/versão mais nova entende).
   * `sanitizeAppConfig` NUNCA as descarta — guarda aqui em vez de jogar fora
   * (mesmo espírito de `claude-state.ts` preservando chaves desconhecidas do
   * `.credentials.json`). Nunca exposta via `AppConfigDto`; na hora de
   * gravar, o conteúdo é espalhado de volta no nível raiz do JSON (nunca
   * aninhado sob um campo `unknownFields` literal) — ver
   * `mergeConfigForWrite`. Serve principalmente de rede de segurança: quem
   * garante a sobrevivência de verdade contra escrita concorrente é o
   * read-merge-write de `writeAppConfig`, que relê o disco na hora de gravar
   * e por isso nem precisa consultar este campo no caminho comum.
   */
  readonly unknownFields: Readonly<Record<string, unknown>>;
}

/** `projectRoots` não tem um default universal (depende do homedir da máquina) — quem chama monta com `defaultProjectRoots(homedir)` (project-scanner.ts) e passa aqui. */
export function defaultAppConfig(projectRoots: readonly string[]): AppConfig {
  return {
    version: CONFIG_SCHEMA_VERSION,
    projectRoots,
    projectScanMode: 'markers',
    favorites: [],
    activeProfileSlug: LEGACY_PRINCIPAL_PROFILE_SLUG,
    launcherDefaults: DEFAULT_LAUNCHER_DEFAULTS,
    notificationPreference: DEFAULT_NOTIFICATION_PREFERENCE,
    sessionNames: {},
    theme: 'dark',
    sessionRegistry: {},
    collapsedFavorites: [],
    devMode: defaultDevModeState(),
    tabAppearance: {},
    accounts: defaultAccountsConfig(),
    migration: defaultMigrationState(),
    providers: defaultProvidersConfig(),
    chat: defaultChatPrefs(),
    pet: defaultPetPrefs(),
    sweep: defaultSweepPrefs(),
    sessionRenewal: DEFAULT_SESSION_RENEWAL_PREFS,
    autoMode: defaultAutoModePrefs(),
    yolo: defaultYoloPrefs(),
    appUpdate: { installersDir: null },
    browserUploads: { folders: [] },
    unknownFields: {},
  };
}

/** 016-jobu-faxina — no sweep yet: every known repo enters the first one. */
export function defaultSweepPrefs(): SweepPrefs {
  return { lastSweepAt: null };
}

/** 016 — `lastSweepAt` is a finite, positive epoch in ms; anything else means "never swept". */
export function sanitizeSweepPrefs(value: unknown, fallback: SweepPrefs = defaultSweepPrefs()): SweepPrefs {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return fallback;
  const at = (value as Record<string, unknown>).lastSweepAt;
  if (at === null) return { lastSweepAt: null };
  return typeof at === 'number' && Number.isFinite(at) && at > 0 ? { lastSweepAt: Math.floor(at) } : fallback;
}

/** T008 (014-chat) — `enabled` false até a Fase 7 (R22); `focusMode` true (FR-009). */
export function defaultChatPrefs(): ChatPrefs {
  return { enabled: false, focusMode: true };
}

/** T008 — campo a campo: valor que não é boolean cai no default daquele campo. */
export function sanitizeChatPrefs(value: unknown, fallback: ChatPrefs = defaultChatPrefs()): ChatPrefs {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return fallback;
  const candidate = value as Record<string, unknown>;
  return {
    enabled: typeof candidate.enabled === 'boolean' ? candidate.enabled : fallback.enabled,
    focusMode: typeof candidate.focusMode === 'boolean' ? candidate.focusMode : fallback.focusMode,
  };
}

export function defaultAutoModePrefs(): AutoModePrefs {
  return { neverAsks: true };
}

/** Anything that is not a boolean keeps the fallback: the switch is on unless the owner turned it off. */
export function sanitizeAutoModePrefs(value: unknown, fallback: AutoModePrefs = defaultAutoModePrefs()): AutoModePrefs {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return fallback;
  const { neverAsks } = value as Record<string, unknown>;
  return { neverAsks: typeof neverAsks === 'boolean' ? neverAsks : fallback.neverAsks };
}

export function defaultYoloPrefs(): YoloPrefs {
  return { projects: [] };
}

/** Errs towards asking: anything that is not a project path is dropped, never kept as "on". */
export function sanitizeYoloPrefs(value: unknown): YoloPrefs {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return defaultYoloPrefs();
  const { projects } = value as Record<string, unknown>;
  if (!Array.isArray(projects)) return defaultYoloPrefs();
  return { projects: [...new Set(projects.filter((path): path is string => typeof path === 'string' && path.trim() !== ''))] };
}

/** B33 — a non-empty path, or `null` (the default folder of the alpha). */
export function sanitizeAppUpdatePrefs(value: unknown): AppUpdatePrefs {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return { installersDir: null };
  const { installersDir } = value as Record<string, unknown>;
  return { installersDir: typeof installersDir === 'string' && installersDir.trim() !== '' ? installersDir.trim() : null };
}

/**
 * Navegador integrado — only non-empty paths, once each (paths compare like Windows does). Errs towards fewer
 * folders: anything else is dropped, never kept as authorized. The browser service checks each one again with
 * `refusedUploadFolder` before using it.
 */
export function sanitizeBrowserUploadPrefs(value: unknown): BrowserUploadPrefs {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return { folders: [] };
  const { folders } = value as Record<string, unknown>;
  if (!Array.isArray(folders)) return { folders: [] };
  return {
    folders: folders.reduce<string[]>(
      (list, folder) => (typeof folder === 'string' && folder.trim() !== '' ? withUploadFolder(list, folder.trim()) : list),
      [],
    ),
  };
}

/** T014 (015-jobu-pet) — off, no remembered position (= default corner), Medium size. */
export function defaultPetPrefs(): PetPrefs {
  return { enabled: false, placement: null, size: PET_SIZE_DEFAULT };
}

/**
 * T014 — field by field, like `chat`: an invalid field falls back to the default of THAT field and does not take
 * the good ones with it. `placement` is only valid with finite `x` and `y` (never half a point: a crooked value goes back to the
 * default corner); `size` is an integer between 80 and 320.
 */
export function sanitizePetPrefs(value: unknown, fallback: PetPrefs = defaultPetPrefs()): PetPrefs {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return fallback;
  const candidate = value as Record<string, unknown>;
  return {
    enabled: typeof candidate.enabled === 'boolean' ? candidate.enabled : fallback.enabled,
    placement: sanitizePetPlacement(candidate.placement, fallback.placement),
    size: typeof candidate.size === 'number' && Number.isFinite(candidate.size) ? clampSize(candidate.size) : fallback.size,
    ...sanitizePetTalkSize(candidate.talkSize, fallback.talkSize),
  };
}

/** t-29e1327b — the chosen bubble size: two positive finite numbers, or nothing (automatic). */
function sanitizePetTalkSize(value: unknown, fallback: PetPrefs['talkSize']): Pick<PetPrefs, 'talkSize'> {
  if (value === undefined) return fallback === undefined ? {} : { talkSize: fallback };
  if (value === null) return { talkSize: null };
  if (typeof value !== 'object' || Array.isArray(value)) return {};
  const size = value as Record<string, unknown>;
  const ok = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0;
  return ok(size.width) && ok(size.height) ? { talkSize: { width: Math.round(size.width), height: Math.round(size.height) } } : {};
}

function sanitizePetPlacement(value: unknown, fallback: PetPrefs['placement']): PetPrefs['placement'] {
  if (value === null) return null;
  if (typeof value !== 'object' || Array.isArray(value)) return fallback;
  const point = value as Record<string, unknown>;
  if (typeof point.x !== 'number' || !Number.isFinite(point.x)) return fallback;
  if (typeof point.y !== 'number' || !Number.isFinite(point.y)) return fallback;
  return { x: point.x, y: point.y };
}

/** T306 — estado inicial do Modo Dev: nada aberto, tabela de defaults do C6. */
function defaultDevModeState(): DevModeState {
  return {
    discoveries: {},
    focusedDiscoveryId: null,
    archivedPhaseSessions: {},
    phaseDefaults: DEFAULT_PHASE_DEFAULTS,
    boardConfig: null,
  };
}

/** Renderer só vê o subconjunto relevante (ver comentário de topo de src/shared/config.ts). */
export function toAppConfigDto(config: AppConfig): AppConfigDto {
  return {
    projectRoots: config.projectRoots,
    projectScanMode: config.projectScanMode,
    launcherDefaults: config.launcherDefaults,
    notificationPreference: config.notificationPreference,
    sessionNames: config.sessionNames,
    theme: config.theme,
    sessionRegistry: config.sessionRegistry,
    collapsedFavorites: config.collapsedFavorites,
    devMode: config.devMode,
    tabAppearance: config.tabAppearance,
    chat: config.chat,
    pet: config.pet,
    sessionRenewal: config.sessionRenewal,
    autoMode: config.autoMode,
    yolo: config.yolo,
  };
}

// ---------------------------------------------------------------------------
// I/O injetável — mesmo padrão de ScanDeps/ProfileCreationIoDeps: puro o
// suficiente pra testar com fs MOCKADO (TDD desta task: escrita atômica,
// migração, validação de schema — ver tests/config-store.test.ts).
// ---------------------------------------------------------------------------

export interface ConfigIoDeps {
  existsSync: (path: string) => boolean;
  /** `null` = ausente/ilegível — nunca lança. */
  readFileText: (path: string) => string | null;
  writeFileText: (path: string, content: string) => void;
  renameFile: (fromPath: string, toPath: string) => void;
  /** Recursivo (mesmo contrato de `mkdirSync(path, { recursive: true })`). */
  mkdirSync: (path: string) => void;
  /** Best-effort — limpeza do temp file se o rename falhar no meio (nunca deve lançar). */
  unlinkFile: (path: string) => void;
}

export function createSystemConfigIoDeps(): ConfigIoDeps {
  return {
    existsSync,
    readFileText: (path) => {
      try {
        return readFileSync(path, 'utf8');
      } catch {
        return null;
      }
    },
    // T017 correção ciclo 1 (achado "durabilidade contra power-loss") —
    // `renameSync` já torna a TROCA de arquivo atômica pra quem lê
    // (leitores nunca veem um `config.json` truncado), mas sem fsync do
    // arquivo temp antes do rename, os bytes podem ainda estar só no cache
    // de página do SO — uma queda de energia entre o `write` e o flush do
    // filesystem pode perder a ÚLTIMA escrita (o arquivo final reverte pra
    // uma versão anterior, não fica corrompido/truncado). `fsyncSync` força
    // o SO a persistir o conteúdo do temp em disco ANTES do rename, o que
    // fecha essa janela para o conteúdo em si.
    // Fsync do DIRETÓRIO pai (padrão comum em POSIX/ext4, onde a entrada de
    // diretório do rename também precisa de fsync explícito) foi avaliado e
    // DESCARTADO aqui: o app é Windows-primeiro (NFR, spec.md) e o NTFS já
    // journala metadados de diretório (incluindo renomes) como parte do seu
    // próprio log de transações — ao contrário do ext4, não depende de um
    // fsync explícito do caller pra isso. Abrir um handle de diretório via
    // `fs.openSync` no Windows também não é uma operação suportada de forma
    // confiável pela API do Node (não há `O_DIRECTORY` real). Garantia real
    // desta implementação: conteúdo não-truncado (rename atômico) + conteúdo
    // durável contra power-loss (fsync do arquivo). NÃO é uma garantia de
    // durabilidade da entrada de diretório em si além do que o NTFS já dá.
    writeFileText: (path, content) => {
      const fd = openSync(path, 'w');
      try {
        writeSync(fd, content, null, 'utf8');
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
    },
    renameFile: (fromPath, toPath) => renameSync(fromPath, toPath),
    mkdirSync: (path) => mkdirSync(path, { recursive: true }),
    unlinkFile: (path) => {
      try {
        unlinkSync(path);
      } catch {
        // best-effort — ver comentário do campo na interface.
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Validação de schema (puro) — nunca lança; qualquer campo ausente/com tipo
// errado cai no default CORRESPONDENTE, campo a campo (corrupção parcial não
// derruba o resto de um config bom — mesmo espírito defensivo do resto do
// projeto, ex. readProjectConfig/readActiveProfileConfig).
// ---------------------------------------------------------------------------

const KNOWN_MODEL_ALIASES: readonly ModelAlias[] = ['fable', 'opus', 'sonnet', 'haiku'];
const KNOWN_EFFORT_LEVELS: readonly EffortLevel[] = ['low', 'medium', 'high', 'xhigh', 'max'];
const KNOWN_PERMISSION_MODES: readonly PermissionMode[] = [
  'manual',
  'acceptEdits',
  'auto',
  'plan',
  'dontAsk',
  'bypassPermissions',
];
const KNOWN_NOTIFICATION_PREFERENCES: readonly NotificationPreference[] = ['all', 'permission-only', 'none'];

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isOneOf<T extends string>(value: unknown, known: readonly T[]): value is T {
  return typeof value === 'string' && (known as readonly string[]).includes(value);
}

/**
 * T402 — sanitiza o mapa `sessionNames` ENTRADA A ENTRADA: uma entrada
 * malformada (nome vazio, `seenTitle` de tipo errado) é descartada sozinha,
 * sem levar junto o resto do mapa nem o resto da config (mesmo espírito campo
 * a campo do `sanitizeAppConfig`). `updatedAt` inválido não invalida a
 * entrada — é diagnóstico, a precedência do C2 não usa tempo.
 */
function sanitizeSessionNames(value: unknown): SessionNamesMap {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};

  const sanitized: Record<string, StoredSessionName> = {};
  for (const [sessionId, entry] of Object.entries(value as Record<string, unknown>)) {
    if (!sessionId || typeof entry !== 'object' || entry === null || Array.isArray(entry)) continue;
    const candidate = entry as Partial<StoredSessionName>;
    if (typeof candidate.name !== 'string' || !candidate.name.trim()) continue;
    if (candidate.seenTitle !== null && typeof candidate.seenTitle !== 'string') continue;

    sanitized[sessionId] = {
      name: candidate.name,
      seenTitle: candidate.seenTitle ?? null,
      updatedAt: typeof candidate.updatedAt === 'string' ? candidate.updatedAt : '',
    };
  }
  return sanitized;
}

/**
 * T704 (007-favoritos-sessoes) — sanitiza `sessionRegistry` ENTRADA A ENTRADA,
 * mesmo espírito de `sanitizeSessionNames`: um projeto novo (chave nova neste
 * batch) chega SEMPRE sem esta chave em todo `config.json` já existente na
 * máquina do Alexandre — se o sanitize a descartasse por completo por engano,
 * ok (vira `{}`, semeadura do CA-8 cobre); mas uma entrada malformada não pode
 * levar as demais junto. `sessionId` vem da CHAVE do mapa (nunca do valor —
 * evita um `sessionId` interno divergente da chave que indexa o registro).
 */
function sanitizeSessionRegistry(value: unknown): SessionRegistry {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};

  const sanitized: Record<string, RegisteredSession> = {};
  for (const [sessionId, entry] of Object.entries(value as Record<string, unknown>)) {
    if (!sessionId || typeof entry !== 'object' || entry === null || Array.isArray(entry)) continue;
    const candidate = entry as Partial<RegisteredSession>;
    if (typeof candidate.projectPath !== 'string' || !candidate.projectPath) continue;
    if (typeof candidate.label !== 'string' || !candidate.label.trim()) continue;
    if (typeof candidate.lastActivityAt !== 'number' || !Number.isFinite(candidate.lastActivityAt)) continue;

    sanitized[sessionId] = {
      sessionId,
      projectPath: candidate.projectPath,
      label: candidate.label,
      lastActivityAt: candidate.lastActivityAt,
      pinned: candidate.pinned === true,
    };
  }
  return sanitized;
}

/**
 * CA-26/CA-27 (009-modo-dev-v3) — sanitiza `tabAppearance` ENTRADA A ENTRADA,
 * mesmo espírito de `sanitizeSessionRegistry`: uma entrada malformada (cor
 * fora dos 4 tokens conhecidos, `order` não-finita) é descartada sozinha, sem
 * levar o resto do mapa. `sessionId` vem da CHAVE (nunca do valor).
 */
function sanitizeTabAppearance(value: unknown): TabAppearanceMap {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};

  const sanitized: Record<string, TabAppearance> = {};
  for (const [sessionId, entry] of Object.entries(value as Record<string, unknown>)) {
    if (!sessionId || typeof entry !== 'object' || entry === null || Array.isArray(entry)) continue;
    const candidate = entry as Partial<TabAppearance>;
    if (!isTabColorToken(candidate.color)) continue;
    if (typeof candidate.order !== 'number' || !Number.isFinite(candidate.order)) continue;

    sanitized[sessionId] = { color: candidate.color, order: candidate.order };
  }
  return sanitized;
}

// ---------------------------------------------------------------------------
// T306 (003-modo-dev) — sanitização de `devMode`, mesmo espírito campo a campo
// do resto do arquivo. `phaseDefaults` é a ÚNICA exceção "tudo ou nada"
// (tabela inconsistente é pior que a tabela default inteira — checklist
// explícito da task).
// ---------------------------------------------------------------------------

const KNOWN_ESTEIRA_PHASES: readonly EsteiraPhase[] = [
  'discovery',
  'plano',
  'implementar',
  'validar',
  'documentar',
  'cliente',
  'concluir',
];

function isValidPhaseDefault(value: unknown): value is PhaseDefault {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<PhaseDefault>;
  return (
    isOneOf(candidate.model, KNOWN_MODEL_ALIASES) &&
    isOneOf(candidate.effort, KNOWN_EFFORT_LEVELS) &&
    typeof candidate.commandTemplate === 'string' &&
    candidate.commandTemplate.trim().length > 0 &&
    typeof candidate.opensOwnSession === 'boolean'
  );
}

/**
 * Tudo ou nada por design (T306 DoD): uma fase malformada ou ausente invalida
 * a tabela inteira, que cai no `DEFAULT_PHASE_DEFAULTS` completo — nunca
 * mistura fase boa com fase quebrada (tabela inconsistente seria pior).
 */
/** Exportado — `main/index.ts` reusa para validar o payload de `devMode:setDefaults` (T307) antes de persistir. */
export function sanitizePhaseDefaultsTable(value: unknown): PhaseDefaultsTable {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return DEFAULT_PHASE_DEFAULTS;
  const candidate = value as Partial<Record<EsteiraPhase, unknown>>;

  const allValid = KNOWN_ESTEIRA_PHASES.every((phase) => isValidPhaseDefault(candidate[phase]));
  return allValid ? (candidate as unknown as PhaseDefaultsTable) : DEFAULT_PHASE_DEFAULTS;
}

/** Uma entrada malformada (sem `repoPath`) é descartada isolada — as demais sobrevivem. */
function sanitizeDevModeDiscoveries(value: unknown): DevModeDiscoveries {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};

  const sanitized: Record<string, DevModeDiscovery> = {};
  for (const [cardId, entry] of Object.entries(value as Record<string, unknown>)) {
    if (!cardId || typeof entry !== 'object' || entry === null || Array.isArray(entry)) continue;
    const candidate = entry as Partial<DevModeDiscovery>;
    if (typeof candidate.repoPath !== 'string' || !candidate.repoPath) continue;
    if (typeof candidate.openedAt !== 'number' || !Number.isFinite(candidate.openedAt)) continue;

    sanitized[cardId] = {
      cardId,
      repoPath: candidate.repoPath,
      epicId: typeof candidate.epicId === 'string' ? candidate.epicId : null,
      openedAt: candidate.openedAt,
      closedAt: typeof candidate.closedAt === 'number' && Number.isFinite(candidate.closedAt) ? candidate.closedAt : null,
    };
  }
  return sanitized;
}

/**
 * Chave vem do mapa (evita divergência), mesmo espírito de
 * `sanitizeSessionRegistry`. T1220 (011-contas-e-provedores, etapa 2, C30) —
 * leitura TOLERANTE do campo legado `profileSlug`: `accountId` é lido dele
 * quando o campo novo não existe. Nunca escrito de novo — só aceito. Motivo
 * direto do CLAUDE.md: os canais alfa/beta/stable compartilham `userData`, e
 * um canal antigo aberto depois não pode ter o estado destruído por um
 * sanitize novo.
 */
function sanitizeArchivedPhaseSessions(value: unknown): ArchivedPhaseSessions {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};

  const sanitized: Record<string, ArchivedPhaseSession> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (!key || typeof entry !== 'object' || entry === null || Array.isArray(entry)) continue;
    const candidate = entry as Partial<ArchivedPhaseSession> & { profileSlug?: unknown };
    if (typeof candidate.sessionId !== 'string' || !candidate.sessionId) continue;
    const accountId = typeof candidate.accountId === 'string' && candidate.accountId
      ? candidate.accountId
      : typeof candidate.profileSlug === 'string' && candidate.profileSlug
        ? candidate.profileSlug
        : null;
    if (accountId === null) continue;
    if (typeof candidate.archivedAt !== 'number' || !Number.isFinite(candidate.archivedAt)) continue;

    sanitized[key] = { sessionId: candidate.sessionId, accountId, archivedAt: candidate.archivedAt };
  }
  return sanitized;
}

/**
 * CA-31 (009-modo-dev-v3) — migra a chave v2 `cardId:marcoId:fase` para a
 * chave v3 `cardId:fase` (`archivedPhaseSessionKey`, devMode.ts): `marco_id`
 * morreu no disco (v3 nunca mais grava esse campo), e o `cardId` do 1º slot
 * JÁ era o card_id do próprio card de plano (é o que o app sempre passou
 * para `archivePhaseSession` — o `marcoId` do meio era só rótulo decorativo,
 * "M1"/"M2"). `discovery`/`plano` sobrevivem com a chave nova;
 * `implementar`/`validar` são DESCARTADAS — o registro antigo não tem
 * `fase_num`, e assumir `fase 1` ofereceria retomar a sessão errada num nó
 * errado (D16 do discovery, CA-31). Chave já no formato novo (2 partes) passa
 * direto — migração idempotente, roda a cada leitura do config (mesmo padrão
 * de sanitização campo a campo deste arquivo; não é um passo "só na 1ª vez",
 * como `migrateFromLegacyFiles`, porque esta migração precisa alcançar
 * `config.json` já existentes, não só a 1ª execução).
 */
function migrateArchivedPhaseSessionKeys(sessions: ArchivedPhaseSessions): ArchivedPhaseSessions {
  const migrated: Record<string, ArchivedPhaseSession> = {};

  for (const [key, entry] of Object.entries(sessions)) {
    const parts = key.split(':');

    if (parts.length === 2) {
      migrated[key] = entry; // já no formato v3
      continue;
    }

    if (parts.length === 3) {
      const [cardId, , fase] = parts;
      if (fase === 'discovery' || fase === 'plano') {
        migrated[`${cardId}:${fase}`] = entry;
      }
      // implementar/validar/concluir/outro: descartado de propósito (CA-31).
      continue;
    }

    // formato desconhecido (0, 1 ou 4+ partes): descartado, nunca fabricado (C4).
  }

  return migrated;
}

function sanitizeDevModeBoardConfig(value: unknown): DevModeBoardConfig | null {
  if (typeof value !== 'object' || value === null) return null;
  const candidate = value as Partial<DevModeBoardConfig>;
  if (typeof candidate.workspaceId !== 'string' || !candidate.workspaceId) return null;
  if (typeof candidate.teamId !== 'string' || !candidate.teamId) return null;
  return { workspaceId: candidate.workspaceId, teamId: candidate.teamId };
}

function sanitizeDevModeState(value: unknown, fallback: DevModeState): DevModeState {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return fallback;
  const candidate = value as Partial<DevModeState>;

  const discoveries = sanitizeDevModeDiscoveries(candidate.discoveries);
  const focusedDiscoveryId =
    typeof candidate.focusedDiscoveryId === 'string' && candidate.focusedDiscoveryId in discoveries
      ? candidate.focusedDiscoveryId
      : null;

  return {
    discoveries,
    focusedDiscoveryId,
    // CA-31 — migração da chave v2→v3 roda por cima do resultado já sanitizado.
    archivedPhaseSessions: migrateArchivedPhaseSessionKeys(sanitizeArchivedPhaseSessions(candidate.archivedPhaseSessions)),
    phaseDefaults: sanitizePhaseDefaultsTable(candidate.phaseDefaults),
    boardConfig: sanitizeDevModeBoardConfig(candidate.boardConfig),
  };
}

function sanitizeLauncherDefaults(value: unknown, fallback: LauncherDefaultsDto): LauncherDefaultsDto {
  if (typeof value !== 'object' || value === null) return fallback;
  const candidate = value as Partial<LauncherDefaultsDto>;
  return {
    model: isOneOf(candidate.model, KNOWN_MODEL_ALIASES) ? candidate.model : fallback.model,
    effort: isOneOf(candidate.effort, KNOWN_EFFORT_LEVELS) ? candidate.effort : fallback.effort,
    permissionMode: isOneOf(candidate.permissionMode, KNOWN_PERMISSION_MODES) ? candidate.permissionMode : fallback.permissionMode,
    // `chrome` (toggle Claude in Chrome, removido em 03/11 pelo navegador integrado) não é mais lido:
    // um config antigo que o tenha gravado é aceito e o campo simplesmente some aqui.
    ...(candidate.worktree === true ? { worktree: true } : {}),
    ...(typeof candidate.where === 'string' && candidate.where.length > 0 && candidate.where.length <= 128 ? { where: candidate.where } : {}),
  };
}

/**
 * Nomes de campo do schema atual, derivados do próprio objeto — nunca uma
 * lista hardcoded separada (que desatualizaria sozinha a cada campo novo).
 * Exclui `unknownFields`: não é um campo real do JSON gravado, é o BAG
 * (conteúdo espalhado no nível raiz na hora de serializar — ver
 * `mergeConfigForWrite`). Usado tanto pelo sanitize (o que é "conhecido",
 * pra decidir o que sobra pro bag) quanto pelo read-merge-write da escrita.
 */
function knownAppConfigKeys(sample: AppConfig): string[] {
  return Object.keys(sample).filter((key) => key !== 'unknownFields');
}

/**
 * Puro (testável sem I/O): preenche campo a campo a partir de `defaults`
 * quando `parsed` não é um objeto, ou um campo individual tem tipo/valor
 * inválido — nunca lança, nunca deixa um campo `undefined`. `version`
 * sempre normaliza pra `CONFIG_SCHEMA_VERSION` atual (a leitura já devolve a
 * versão corrente); uma migração real de schema (campo renomeado/formato
 * mudado entre versões) entraria aqui verificando `candidate.version` antes
 * de sanitizar — não necessária ainda, só existe a versão 1.
 *
 * G1 (issue 08) — PASSTHROUGH: qualquer chave de TOPO em `parsed` que não é
 * um campo conhecido de `AppConfig` (ex.: `migration` visto por um build que
 * nasceu antes dela existir) não é descartada — sobra em `unknownFields`.
 */
export function sanitizeAppConfig(parsed: unknown, defaults: AppConfig): AppConfig {
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return defaults;
  const candidate = parsed as Partial<AppConfig> & Record<string, unknown>;

  const known = new Set(knownAppConfigKeys(defaults));
  const unknownFields: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(candidate)) {
    // `unknownFields` nunca é, ele mesmo, uma chave "desconhecida" — é o BAG.
    // `parsed` nunca deveria trazer essa chave literal de verdade (o
    // read-merge-write jamais a escreve — ver `mergeConfigForWrite`), mas um
    // candidato construído por spread de um `AppConfig` já sanitizado
    // (`{...defaults, ...}`, comum em teste) TEM essa chave — sem esta
    // exclusão ela se aninharia dentro de si mesma a cada leitura.
    if (key === 'unknownFields') continue;
    if (!known.has(key)) unknownFields[key] = value;
  }

  return {
    version: CONFIG_SCHEMA_VERSION,
    projectRoots: isStringArray(candidate.projectRoots) ? candidate.projectRoots : defaults.projectRoots,
    projectScanMode: candidate.projectScanMode === 'all' ? 'all' : defaults.projectScanMode,
    favorites: isStringArray(candidate.favorites) ? candidate.favorites : defaults.favorites,
    activeProfileSlug:
      typeof candidate.activeProfileSlug === 'string' && candidate.activeProfileSlug.trim()
        ? candidate.activeProfileSlug
        : defaults.activeProfileSlug,
    launcherDefaults: sanitizeLauncherDefaults(candidate.launcherDefaults, defaults.launcherDefaults),
    notificationPreference: isOneOf(candidate.notificationPreference, KNOWN_NOTIFICATION_PREFERENCES)
      ? candidate.notificationPreference
      : defaults.notificationPreference,
    sessionNames: sanitizeSessionNames(candidate.sessionNames),
    theme: 'dark',
    sessionRegistry: sanitizeSessionRegistry(candidate.sessionRegistry),
    collapsedFavorites: isStringArray(candidate.collapsedFavorites) ? candidate.collapsedFavorites : defaults.collapsedFavorites,
    devMode: sanitizeDevModeState(candidate.devMode, defaults.devMode),
    tabAppearance: sanitizeTabAppearance(candidate.tabAppearance),
    accounts: sanitizeAccountsConfig(candidate.accounts, defaults.accounts),
    migration: sanitizeMigrationState(candidate.migration, defaults.migration),
    providers: sanitizeProvidersConfig(candidate.providers),
    chat: sanitizeChatPrefs(candidate.chat, defaults.chat),
    pet: sanitizePetPrefs(candidate.pet, defaults.pet),
    sweep: sanitizeSweepPrefs(candidate.sweep, defaults.sweep),
    sessionRenewal: sanitizeSessionRenewalPrefs(candidate.sessionRenewal, defaults.sessionRenewal),
    autoMode: sanitizeAutoModePrefs(candidate.autoMode, defaults.autoMode),
    yolo: sanitizeYoloPrefs(candidate.yolo),
    appUpdate: sanitizeAppUpdatePrefs(candidate.appUpdate),
    browserUploads: sanitizeBrowserUploadPrefs(candidate.browserUploads),
    unknownFields,
  };
}

/**
 * T402 (004) — mutações PURAS do mapa de nomes, no mesmo estilo do
 * `toggleFavorite`: devolvem um mapa novo, sem I/O (quem chama persiste com
 * `writeAppConfig`). `entry.seenTitle` carimba o `custom-title` que o `.jsonl`
 * tinha no instante da escrita — é o insumo do dirty-check do C2
 * (`resolveSessionName`, src/shared/sessionName.ts).
 */
export function setSessionName(
  sessionNames: SessionNamesMap,
  sessionId: string,
  entry: StoredSessionName,
): SessionNamesMap {
  return { ...sessionNames, [sessionId]: entry };
}

/** Remove a entrada da sessão (o "vazio apaga" do C5, e o descarte do caso CLI-vence). No-op se não existir. */
export function clearSessionName(sessionNames: SessionNamesMap, sessionId: string): SessionNamesMap {
  if (!(sessionId in sessionNames)) return { ...sessionNames };
  const next = { ...sessionNames };
  delete next[sessionId];
  return next;
}

/** Toggle puro (sem I/O) — adiciona/remove `path` da lista, sem duplicar. Portado de project-config-store.ts (T007), comportamento idêntico. */
export function toggleFavorite(favorites: readonly string[], path: string, favorite: boolean): string[] {
  const set = new Set(favorites);
  if (favorite) {
    set.add(path);
  } else {
    set.delete(path);
  }
  return [...set];
}

// ---------------------------------------------------------------------------
// Migração dos JSONs avulsos T007/T014 — só roda quando `config.json` ainda
// NÃO existe (1ª leitura nesta máquina depois deste batch); um `config.json`
// já existente é sempre a fonte de verdade única (nunca reconsulta os
// arquivos legados por cima de um config já migrado, mesmo que eles ainda
// existam no disco ou mudem depois).
// ---------------------------------------------------------------------------

export interface LegacyConfigPaths {
  readonly projectConfigPath: string;
  readonly activeProfilePath: string;
}

/** Parsing independente do formato `{ favorites: string[] }` (T007) — não importa de `project-config-store.ts` (deletado nesta task). */
function extractLegacyFavorites(raw: string | null): string[] | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { favorites?: unknown };
    return isStringArray(parsed.favorites) ? parsed.favorites : null;
  } catch {
    return null;
  }
}

/** Parsing independente do formato `{ activeSlug: string }` (T014, profile-manager.ts `ActiveProfileConfig`) — ver comentário de topo do arquivo (por que não importar de lá). */
function extractLegacyActiveSlug(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { activeSlug?: unknown };
    return typeof parsed.activeSlug === 'string' && parsed.activeSlug.trim() ? parsed.activeSlug : null;
  } catch {
    return null;
  }
}

function migrateFromLegacyFiles(defaults: AppConfig, legacy: LegacyConfigPaths, io: ConfigIoDeps): AppConfig {
  const favorites = extractLegacyFavorites(io.readFileText(legacy.projectConfigPath));
  const activeProfileSlug = extractLegacyActiveSlug(io.readFileText(legacy.activeProfilePath));

  return {
    ...defaults,
    favorites: favorites ?? defaults.favorites,
    activeProfileSlug: activeProfileSlug ?? defaults.activeProfileSlug,
  };
}

// ---------------------------------------------------------------------------
// Leitura/escrita
// ---------------------------------------------------------------------------

/**
 * `config.json` ausente = 1ª execução nesta máquina depois deste batch:
 * migra dos arquivos legados se existirem (favorites/activeProfileSlug),
 * senão cai nos defaults puros. `config.json` presente = fonte de verdade
 * única — JSON corrompido cai nos defaults SEM tentar migrar por cima (o
 * arquivo já existia, não é "1ª vez"; migrar aqui arriscaria reviver dado
 * velho por cima de uma escrita mais recente que só falhou em ler agora).
 */
export function readAppConfig(filePath: string, defaults: AppConfig, legacy: LegacyConfigPaths, io: ConfigIoDeps): AppConfig {
  const raw = io.readFileText(filePath);
  if (raw === null) return migrateFromLegacyFiles(defaults, legacy, io);

  try {
    return sanitizeAppConfig(JSON.parse(raw), defaults);
  } catch {
    return defaults;
  }
}

/** Lê `filePath` como objeto JSON cru (sem tipar/sanitizar pro schema) — só para o read-merge-write de `writeAppConfig`; a leitura pública (`readAppConfig`) sempre passa por `sanitizeAppConfig`. Ausente/ilegível/não-objeto vira `{}`, nunca lança (mesmo espírito defensivo do resto do arquivo). */
function readRawConfigObject(filePath: string, io: ConfigIoDeps): Record<string, unknown> {
  const raw = io.readFileText(filePath);
  if (raw === null) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Igualdade estrutural (objetos/arrays/primitivos — o bastante pro shape JSON deste arquivo; nunca precisa lidar com Date/Map/etc). Usada só para decidir, campo a campo, se ESTA sessão mudou o valor desde `baseline`. */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, index) => deepEqual(item, b[index]));
  }
  const aObj = a as Record<string, unknown>;
  const bObj = b as Record<string, unknown>;
  const aKeys = Object.keys(aObj);
  const bKeys = Object.keys(bObj);
  return aKeys.length === bKeys.length && aKeys.every((key) => key in bObj && deepEqual(aObj[key], bObj[key]));
}

/**
 * G1 (011-contas-e-provedores, issue 08) — mescla por CHAVE DE TOPO em vez
 * de despejar a config inteira da memória: só a chave que ESTA sessão mudou
 * desde `baseline` (comparação estrutural, não `===`) sobrescreve o disco;
 * toda outra chave — conhecida e intocada, OU desconhecida deste build —
 * vem de `diskRaw`, relido imediatamente antes de gravar. Corrige os dois
 * defeitos da issue 08 de uma vez:
 *   (a) canal antigo que não conhece uma chave nova (ex.: `migration`) nunca
 *       a apaga — a chave nem entra no loop (não está em
 *       `knownAppConfigKeys`), sobrevive só por estar em `diskRaw`.
 *   (b) canal com cópia em memória desatualizada de uma chave CONHECIDA
 *       (ex.: `accounts.localAccounts` mudado por outro processo enquanto
 *       este dormia) não reverte a escrita mais recente alheia — só
 *       sobrescreve o que ele mesmo mudou desde o último sync.
 * `baseline === null` (nunca sincronizado nesta sessão — 1ª escrita) trata
 * toda chave conhecida como mudada, ou seja, dump completo (comportamento
 * anterior a este batch) — correto pra quem está escrevendo pela 1ª vez.
 * `current.unknownFields` entra como camada de baixo (fallback) só para o
 * caso raro de `diskRaw` não ter mais aquela chave (ex.: arquivo recriado
 * entre o boot e esta escrita) — disco fresco, quando presente, sempre vence.
 */
export function mergeConfigForWrite(diskRaw: Record<string, unknown>, baseline: AppConfig | null, current: AppConfig): Record<string, unknown> {
  // `unknownFields` nunca é, ela mesma, uma chave de passthrough válida — é o
  // nome reservado do BAG (nunca escrito como campo literal por este
  // caminho). Se `diskRaw` tiver uma por algum motivo externo (arquivo
  // adulterado à mão, versão anterior a este fix), ela é descartada aqui —
  // nunca ressurge como chave literal no JSON gravado.
  const { unknownFields: _staleLiteralKey, ...diskRawKnownAndUnknown } = diskRaw;
  const merged: Record<string, unknown> = { ...current.unknownFields, ...diskRawKnownAndUnknown };
  const currentRaw = current as unknown as Record<string, unknown>;
  const baselineRaw = baseline as unknown as Record<string, unknown> | null;

  for (const key of knownAppConfigKeys(current)) {
    const changedSinceSync = baselineRaw === null || !deepEqual(currentRaw[key], baselineRaw[key]);
    if (changedSinceSync || !(key in merged)) {
      merged[key] = currentRaw[key];
    }
  }

  return merged;
}

/**
 * Escrita atômica (FR-007: "temp + rename") — nunca deixa uma janela em que
 * `config.json` fica truncado: grava tudo num arquivo temporário e só então
 * troca pelo nome final via `rename` (operação atômica do SO; no Windows,
 * `fs.renameSync` já sobrescreve o destino existente via `MoveFileExW` com
 * `MOVEFILE_REPLACE_EXISTING`, o próprio libuv do Node). Nome do temp inclui
 * pid+timestamp — duas escritas (mesmo daquele improvável de duas instâncias
 * do app rodando ao mesmo tempo) não colidem no MESMO arquivo temporário.
 *
 * T017 correção ciclo 1 — `io.writeFileText` (impl real,
 * `createSystemConfigIoDeps`) faz `fsync` do arquivo temp ANTES deste
 * `rename`, então a garantia cobre tanto "nunca truncado" (rename atômico)
 * quanto "conteúdo durável contra power-loss" (fsync). Ver comentário do
 * `writeFileText` pra por que fsync do DIRETÓRIO pai não se aplica aqui
 * (Windows/NTFS, não POSIX/ext4).
 *
 * G1 (issue 08) — READ-MERGE-WRITE: relê `filePath` no disco AGORA (não usa
 * uma cópia antiga) e mescla por chave de topo com `mergeConfigForWrite`
 * antes de serializar — nunca mais despeja a config inteira da memória por
 * cima do que outro processo/canal possa ter escrito nesse meio-tempo.
 * `baseline` é a config como este processo a viu pela última vez em sync com
 * o disco (o retorno da última `readAppConfig`/`writeAppConfig`); `null` só
 * na 1ª escrita da sessão (nunca sincronizou, então tudo conta como mudado).
 */
export function writeAppConfig(filePath: string, config: AppConfig, io: ConfigIoDeps, baseline: AppConfig | null): void {
  const dir = dirname(filePath);
  if (!io.existsSync(dir)) io.mkdirSync(dir);

  const diskRaw = readRawConfigObject(filePath, io);
  const merged = mergeConfigForWrite(diskRaw, baseline, config);

  const tmpPath = `${filePath}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  io.writeFileText(tmpPath, JSON.stringify(merged, null, 2));
  try {
    io.renameFile(tmpPath, filePath);
  } catch (error) {
    io.unlinkFile(tmpPath);
    throw error;
  }
}
