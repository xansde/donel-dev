import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearSessionName,
  createSystemConfigIoDeps,
  defaultAppConfig,
  mergeConfigForWrite,
  readAppConfig,
  sanitizeAppConfig,
  setSessionName,
  toAppConfigDto,
  toggleFavorite,
  writeAppConfig,
  type AppConfig,
  type ConfigIoDeps,
  type LegacyConfigPaths,
} from '../src/main/config-store';
import { DEFAULT_PHASE_DEFAULTS } from '../src/shared/devModeDefaults';
import { upsertVisit } from '../src/shared/sessionRegistry';

// T015 — ConfigStore (FR-007). TDD nos módulos puros: escrita atômica (fs
// mockado, sem tocar disco), migração dos JSONs legados de T007/T014, e
// validação de schema. Um bloco final de I/O real (pasta temporária) cobre a
// integração ponta-a-ponta, mesmo espírito de tests/project-config-store.test.ts
// (módulo que este arquivo substitui — deletado nesta task).

const FAKE_ROOTS = ['C:\\Users\\fake\\seazone', 'C:\\Users\\fake\\pessoal'];

function baseDefaults(): AppConfig {
  return defaultAppConfig(FAKE_ROOTS);
}

describe('defaultAppConfig (puro)', () => {
  it('monta a config default com os roots recebidos e os demais campos fixos', () => {
    const config = baseDefaults();
    expect(config).toEqual({
      version: 1,
      projectRoots: FAKE_ROOTS,
      projectScanMode: 'markers',
      favorites: [],
      activeProfileSlug: 'principal',
      launcherDefaults: { model: 'fable', effort: 'high', permissionMode: 'acceptEdits' },
      notificationPreference: 'permission-only',
      sessionNames: {},
      theme: 'dark',
      sessionRegistry: {},
      collapsedFavorites: [],
      devMode: {
        discoveries: {},
        focusedDiscoveryId: null,
        archivedPhaseSessions: {},
        phaseDefaults: DEFAULT_PHASE_DEFAULTS,
        boardConfig: null,
      },
      tabAppearance: {},
      accounts: {
        mod: null,
        autoSwitch: { enabled: true, switchAtLoad: 90, minAdvantage: 20 },
        claudeHome: null,
        seazone: null,
        localAccounts: [],
        activeAccountId: null,
      },
      migration: { startedAt: null, completedAt: null, profiles: {}, archivedTo: null },
      providers: { version: 1, entries: [] },
      chat: { enabled: false, focusMode: true },
      // T014 (015-jobu-pet) — desligado, sem posição lembrada, tamanho Médio.
      pet: { enabled: false, placement: null, size: 140 },
      sweep: { lastSweepAt: null },
      // B36 — sessão renovada em voo: ligada, 250k de contexto.
      sessionRenewal: { enabled: true, limitTokens: 250_000 },
      autoMode: { neverAsks: true },
      yolo: { projects: [] },
      unknownFields: {},
    });
  });
});

describe('toAppConfigDto (puro)', () => {
  it('expõe só o subconjunto que o renderer precisa — sem favorites/activeProfileSlug/version', () => {
    const config: AppConfig = {
      ...baseDefaults(),
      favorites: ['C:\\a'],
      activeProfileSlug: 'tecnologia-claude-2',
    };
    expect(toAppConfigDto(config)).toEqual({
      projectRoots: FAKE_ROOTS,
      projectScanMode: 'markers',
      launcherDefaults: { model: 'fable', effort: 'high', permissionMode: 'acceptEdits' },
      notificationPreference: 'permission-only',
      sessionNames: {},
      theme: 'dark',
      sessionRegistry: {},
      collapsedFavorites: [],
      devMode: {
        discoveries: {},
        focusedDiscoveryId: null,
        archivedPhaseSessions: {},
        phaseDefaults: DEFAULT_PHASE_DEFAULTS,
        boardConfig: null,
      },
      tabAppearance: {},
      chat: { enabled: false, focusMode: true },
      pet: { enabled: false, placement: null, size: 140 },
      sessionRenewal: { enabled: true, limitTokens: 250_000 },
      autoMode: { neverAsks: true },
      yolo: { projects: [] },
    });
  });

  // T402 — o renderer resolve o nome exibido (resolveSessionName, T401), então
  // precisa do mapa; sem ele no DTO a UI não teria como saber o nome custom.
  it('leva o mapa sessionNames para o renderer', () => {
    const config: AppConfig = {
      ...baseDefaults(),
      sessionNames: { 'abc-123': { name: 'Refatorar', seenTitle: null, updatedAt: '2026-07-24T12:00:00.000Z' } },
    };
    expect(toAppConfigDto(config).sessionNames).toEqual({
      'abc-123': { name: 'Refatorar', seenTitle: null, updatedAt: '2026-07-24T12:00:00.000Z' },
    });
  });
});

// T402 (004-nomear-sessoes) — mutações PURAS do mapa `sessionNames`, no estilo
// do `toggleFavorite`: I/O fica por fora (writeAppConfig). A entrada guarda o
// `custom-title` visto no momento da escrita (`seenTitle`) — é o que permite o
// dirty-check do C2 depois (resolveSessionName, T401).
describe('setSessionName / clearSessionName (puros)', () => {
  const NOW = '2026-07-24T15:30:00.000Z';

  it('adiciona uma entrada nova sem mexer nas existentes', () => {
    const before = { 'outra-sessao': { name: 'Outra', seenTitle: null, updatedAt: NOW } };
    const after = setSessionName(before, 'abc-123', { name: 'Refatorar', seenTitle: 'do CLI', updatedAt: NOW });

    expect(after).toEqual({
      'outra-sessao': { name: 'Outra', seenTitle: null, updatedAt: NOW },
      'abc-123': { name: 'Refatorar', seenTitle: 'do CLI', updatedAt: NOW },
    });
  });

  it('não muta o mapa recebido', () => {
    const before = {};
    setSessionName(before, 'abc-123', { name: 'X', seenTitle: null, updatedAt: NOW });
    expect(before).toEqual({});
  });

  it('sobrescreve a entrada existente da mesma sessão', () => {
    const before = { 'abc-123': { name: 'Antigo', seenTitle: null, updatedAt: '2026-07-01T00:00:00.000Z' } };
    const after = setSessionName(before, 'abc-123', { name: 'Novo', seenTitle: 'do CLI', updatedAt: NOW });
    expect(after['abc-123']).toEqual({ name: 'Novo', seenTitle: 'do CLI', updatedAt: NOW });
  });

  it('clearSessionName remove só a sessão pedida', () => {
    const before = {
      'abc-123': { name: 'Vai sair', seenTitle: null, updatedAt: NOW },
      'def-456': { name: 'Fica', seenTitle: null, updatedAt: NOW },
    };
    expect(clearSessionName(before, 'abc-123')).toEqual({ 'def-456': { name: 'Fica', seenTitle: null, updatedAt: NOW } });
  });

  it('clearSessionName de sessão inexistente é no-op (não lança)', () => {
    const before = { 'def-456': { name: 'Fica', seenTitle: null, updatedAt: NOW } };
    expect(clearSessionName(before, 'nao-existe')).toEqual(before);
  });

  it('clearSessionName não muta o mapa recebido', () => {
    const before = { 'abc-123': { name: 'X', seenTitle: null, updatedAt: NOW } };
    clearSessionName(before, 'abc-123');
    expect(Object.keys(before)).toEqual(['abc-123']);
  });
});

describe('toggleFavorite (puro, portado de project-config-store.ts)', () => {
  it('adiciona um caminho novo', () => {
    expect(toggleFavorite([], 'C:\\a', true)).toEqual(['C:\\a']);
  });

  it('não duplica quando o caminho já está favoritado', () => {
    expect(toggleFavorite(['C:\\a'], 'C:\\a', true)).toEqual(['C:\\a']);
  });

  it('remove quando favorite=false', () => {
    expect(toggleFavorite(['C:\\a', 'C:\\b'], 'C:\\a', false)).toEqual(['C:\\b']);
  });

  it('remover um caminho que não está na lista é no-op', () => {
    expect(toggleFavorite(['C:\\b'], 'C:\\a', false)).toEqual(['C:\\b']);
  });
});

describe('sanitizeAppConfig (puro — validação de schema)', () => {
  it('aceita um objeto totalmente válido sem alterações', () => {
    const valid: AppConfig = {
      version: 1,
      projectRoots: ['C:\\x'],
      projectScanMode: 'all',
      favorites: ['C:\\y'],
      activeProfileSlug: 'tecnologia-claude-3',
      launcherDefaults: { model: 'sonnet', effort: 'max', permissionMode: 'plan' },
      notificationPreference: 'all',
      sessionNames: { 'abc-123': { name: 'Refatorar', seenTitle: 'do CLI', updatedAt: '2026-07-24T12:00:00.000Z' } },
      theme: 'dark',
      sessionRegistry: {
        'sess-1': { sessionId: 'sess-1', projectPath: 'C:\\x', label: 'Trabalhando', lastActivityAt: 1000, pinned: true },
      },
      collapsedFavorites: ['C:\\x'],
      devMode: {
        discoveries: { 'card-1': { cardId: 'card-1', repoPath: 'C:\\repo', epicId: 'epic-1', openedAt: 100, closedAt: null } },
        focusedDiscoveryId: 'card-1',
        // Chave v3 (CA-31): cardId:fase, sem marco_id — já no formato final, a migração não altera.
        archivedPhaseSessions: { 'card-1:plano': { sessionId: 'sess-1', accountId: 'principal', archivedAt: 100 } },
        phaseDefaults: DEFAULT_PHASE_DEFAULTS,
        boardConfig: { workspaceId: 'ws-1', teamId: 'team-1' },
      },
      tabAppearance: { 'sess-1': { color: 'accent', order: 0 } },
      accounts: {
        mod: 'local',
        autoSwitch: { enabled: false, switchAtLoad: 85, minAdvantage: 15 },
        claudeHome: 'C:\\custom\\.claude',
        seazone: { baseUrl: 'https://switcher.seazone.dev' },
        localAccounts: [{ id: 'acc-1', label: 'Conta 1', plan: 'pro' }],
        activeAccountId: 'acc-1',
      },
      migration: {
        startedAt: 1000,
        completedAt: null,
        profiles: { 'acc-1': { credentials: 'imported', transcripts: 'imported', mcpReviewed: true } },
        archivedTo: null,
      },
      providers: {
        version: 1,
        entries: [
          { id: 'meu-provider', label: 'Meu provider', class: 'A', command: null, env: { ANTHROPIC_BASE_URL: 'https://x.test' }, secretEnvKeys: ['ANTHROPIC_AUTH_TOKEN'], configDirName: 'meu-provider' },
        ],
      },
      chat: { enabled: true, focusMode: false },
      pet: { enabled: true, placement: { x: 1830, y: 1040 }, size: 200 },
      sweep: { lastSweepAt: null },
      sessionRenewal: { enabled: false, limitTokens: 180_000 },
      autoMode: { neverAsks: false },
      yolo: { projects: ['C:\\repos\\app'] },
      unknownFields: {},
    };
    expect(sanitizeAppConfig(valid, baseDefaults())).toEqual(valid);
  });

  // G1 (011-contas-e-provedores, issue 08) — PASSTHROUGH: chave de topo que
  // este build não conhece (ex.: `migration`, vista por um canal antigo que
  // nasceu antes dela existir) não pode ser dropada — sanitize guarda em
  // `unknownFields` em vez de descartar. Achado real: canal antigo apagando
  // `migration`/zerando `accounts.localAccounts` na coexistência alfa/beta.
  it('chave de topo desconhecida do schema sobrevive à sanitize, em unknownFields', () => {
    const defaults = baseDefaults();
    const parsed = {
      ...defaults,
      favorites: ['C:\\meu\\projeto'], // campo conhecido, junto — prova que o resto do parsing não quebra
      migrationDoFuturo: { etapa: 4, algoQueEsteBuildNaoConhece: true }, // chave inventada, não é campo de AppConfig
    };

    const sanitized = sanitizeAppConfig(parsed, defaults);
    expect(sanitized.favorites).toEqual(['C:\\meu\\projeto']);
    expect(sanitized.unknownFields).toEqual({ migrationDoFuturo: { etapa: 4, algoQueEsteBuildNaoConhece: true } });
  });

  it('múltiplas chaves desconhecidas sobrevivem juntas; nenhum campo conhecido vaza para unknownFields', () => {
    const defaults = baseDefaults();
    const parsed = { ...defaults, campoNovoA: 'x', campoNovoB: [1, 2, 3] };

    const sanitized = sanitizeAppConfig(parsed, defaults);
    expect(sanitized.unknownFields).toEqual({ campoNovoA: 'x', campoNovoB: [1, 2, 3] });
    expect(Object.keys(sanitized.unknownFields)).not.toContain('favorites');
    expect(Object.keys(sanitized.unknownFields)).not.toContain('version');
  });

  it('config sem nenhuma chave desconhecida sanitiza com unknownFields vazio', () => {
    const defaults = baseDefaults();
    expect(sanitizeAppConfig({ ...defaults }, defaults).unknownFields).toEqual({});
  });

  // FIX ambiente genérico (28/07) — o critério da listagem de projetos é
  // config nova; valor desconhecido degrada pro default sem derrubar o resto.
  it("projectScanMode desconhecido cai no default; 'all' é preservado", () => {
    const defaults = baseDefaults();

    const withUnknown = sanitizeAppConfig({ version: 1, projectScanMode: 'tudo-errado' }, defaults);
    expect(withUnknown.projectScanMode).toBe(defaults.projectScanMode);

    const withAll = sanitizeAppConfig({ version: 1, projectScanMode: 'all' }, defaults);
    expect(withAll.projectScanMode).toBe('all');
  });

  it('valor não-objeto (null, array, primitivo) cai inteiro no default', () => {
    const defaults = baseDefaults();
    expect(sanitizeAppConfig(null, defaults)).toEqual(defaults);
    expect(sanitizeAppConfig('lixo', defaults)).toEqual(defaults);
    expect(sanitizeAppConfig(42, defaults)).toEqual(defaults);
    expect(sanitizeAppConfig([1, 2, 3], defaults)).toEqual(defaults);
  });

  it('campo individual corrompido cai no default SÓ daquele campo (resto do objeto bom é preservado)', () => {
    const defaults = baseDefaults();
    const partiallyCorrupted = {
      version: 1,
      projectRoots: 'não é array', // corrompido
      favorites: ['C:\\ok'], // bom
      activeProfileSlug: 42, // corrompido (não é string)
      launcherDefaults: { model: 'sonnet', effort: 'high', permissionMode: 'plan' }, // bom
      notificationPreference: 'not-a-real-value', // corrompido
      theme: 'dark',
      autoMode: { neverAsks: 'sim' },
      yolo: { projects: ['C:\\ok', 42, ''] },
    };
    expect(sanitizeAppConfig(partiallyCorrupted, defaults)).toEqual({
      version: 1,
      projectRoots: defaults.projectRoots, // fallback
      projectScanMode: defaults.projectScanMode, // ausente no objeto → default
      favorites: ['C:\\ok'],
      activeProfileSlug: defaults.activeProfileSlug, // fallback
      launcherDefaults: { model: 'sonnet', effort: 'high', permissionMode: 'plan' },
      notificationPreference: defaults.notificationPreference, // fallback
      sessionNames: {}, // ausente no objeto → default
      theme: 'dark',
      sessionRegistry: {}, // ausente no objeto → default
      collapsedFavorites: [], // ausente no objeto → default
      devMode: defaults.devMode, // ausente no objeto → default
      tabAppearance: {}, // ausente no objeto → default
      accounts: defaults.accounts, // ausente no objeto → default
      migration: defaults.migration, // ausente no objeto → default
      providers: defaults.providers, // ausente no objeto → default
      chat: defaults.chat, // ausente no objeto → default
      pet: defaults.pet, // ausente no objeto → default
      sweep: defaults.sweep,
      sessionRenewal: defaults.sessionRenewal,
      autoMode: defaults.autoMode,
      yolo: { projects: ['C:\\ok'] },
      unknownFields: {}, // nenhuma chave desconhecida no objeto de entrada
    });
  });

  // T402 — a chave é nova: TODO config.json já existente na máquina do
  // Alexandre não a tem. Se o sanitize a descartasse, o app carregaria sem
  // nome nenhum; se lançasse, perderia projectRoots/favorites junto.
  it('config LEGADO sem a chave sessionNames carrega com {} e não perde os demais campos', () => {
    const defaults = baseDefaults();
    const legacyShape = {
      version: 1,
      projectRoots: ['C:\\meu\\root'],
      favorites: ['C:\\meu\\projeto'],
      activeProfileSlug: 'tecnologia-claude-3',
      launcherDefaults: { model: 'opus', effort: 'max', permissionMode: 'auto' },
      notificationPreference: 'all',
      theme: 'dark',
    };
    const sanitized = sanitizeAppConfig(legacyShape, defaults);

    expect(sanitized.sessionNames).toEqual({});
    expect(sanitized.sessionRegistry).toEqual({});
    expect(sanitized.collapsedFavorites).toEqual([]);
    expect(sanitized.projectRoots).toEqual(['C:\\meu\\root']);
    expect(sanitized.favorites).toEqual(['C:\\meu\\projeto']);
    expect(sanitized.activeProfileSlug).toBe('tecnologia-claude-3');
    expect(sanitized.launcherDefaults).toEqual({ model: 'opus', effort: 'max', permissionMode: 'auto' });
    expect(sanitized.notificationPreference).toBe('all');
  });

  it('sessionNames com tipo errado (array, string, null) cai no default {}', () => {
    const defaults = baseDefaults();
    expect(sanitizeAppConfig({ ...defaults, sessionNames: ['a'] }, defaults).sessionNames).toEqual({});
    expect(sanitizeAppConfig({ ...defaults, sessionNames: 'lixo' }, defaults).sessionNames).toEqual({});
    expect(sanitizeAppConfig({ ...defaults, sessionNames: null }, defaults).sessionNames).toEqual({});
  });

  it('sessionNames descarta ENTRADA a ENTRADA o que estiver malformado, preservando as boas', () => {
    const defaults = baseDefaults();
    const parsed = {
      ...defaults,
      sessionNames: {
        boa: { name: 'Refatorar', seenTitle: 'do CLI', updatedAt: '2026-07-24T12:00:00.000Z' },
        'boa-sem-seen': { name: 'Sem título do CLI', seenTitle: null, updatedAt: '2026-07-24T12:00:00.000Z' },
        'ruim-sem-nome': { seenTitle: null, updatedAt: '2026-07-24T12:00:00.000Z' },
        'ruim-nome-vazio': { name: '   ', seenTitle: null, updatedAt: '2026-07-24T12:00:00.000Z' },
        'ruim-tipo': 'não é objeto',
        'ruim-seen-numero': { name: 'X', seenTitle: 7, updatedAt: '2026-07-24T12:00:00.000Z' },
      },
    };
    expect(sanitizeAppConfig(parsed, defaults).sessionNames).toEqual({
      boa: { name: 'Refatorar', seenTitle: 'do CLI', updatedAt: '2026-07-24T12:00:00.000Z' },
      'boa-sem-seen': { name: 'Sem título do CLI', seenTitle: null, updatedAt: '2026-07-24T12:00:00.000Z' },
    });
  });

  it('entrada sem updatedAt válido ainda carrega (o campo é diagnóstico, não decide precedência)', () => {
    const defaults = baseDefaults();
    const parsed = { ...defaults, sessionNames: { abc: { name: 'X', seenTitle: null } } };
    expect(sanitizeAppConfig(parsed, defaults).sessionNames.abc?.name).toBe('X');
  });

  it('launcherDefaults com alias de modelo/esforço/permissão desconhecido cai no default campo a campo', () => {
    const defaults = baseDefaults();
    const parsed = {
      ...defaults,
      launcherDefaults: { model: 'gpt-5-nao-existe', effort: 'high', permissionMode: 'bypassPermissions' },
    };
    expect(sanitizeAppConfig(parsed, defaults).launcherDefaults).toEqual({
      model: defaults.launcherDefaults.model, // fallback só no campo inválido
      effort: 'high',
      permissionMode: 'bypassPermissions',
    });
  });

  it('launcherDefaults.chrome legado (Claude in Chrome, removido em 03/11) é aceito sem erro e descartado', () => {
    const defaults = baseDefaults();
    const base = { model: 'opus', effort: 'max', permissionMode: 'auto' };
    expect(sanitizeAppConfig({ ...defaults, launcherDefaults: { ...base, chrome: true } }, defaults).launcherDefaults).toEqual(base);
    expect(sanitizeAppConfig({ ...defaults, launcherDefaults: { ...base, chrome: false } }, defaults).launcherDefaults).toEqual(base);
    expect(sanitizeAppConfig({ ...defaults, launcherDefaults: { ...base, chrome: 'sim' } }, defaults).launcherDefaults).toEqual(base);
    expect(sanitizeAppConfig({ ...defaults, launcherDefaults: base }, defaults).launcherDefaults).toEqual(base);
  });

  it('launcherDefaults.worktree: true é preservado; ausente, false ou tipo errado some (opcional, só existe ligado)', () => {
    const defaults = baseDefaults();
    const base = { model: 'opus', effort: 'max', permissionMode: 'auto' };
    expect(sanitizeAppConfig({ ...defaults, launcherDefaults: { ...base, worktree: true } }, defaults).launcherDefaults).toEqual({
      ...base,
      worktree: true,
    });
    expect(sanitizeAppConfig({ ...defaults, launcherDefaults: { ...base, chrome: true, worktree: true } }, defaults).launcherDefaults).toEqual({
      ...base,
      worktree: true,
    });
    expect(sanitizeAppConfig({ ...defaults, launcherDefaults: { ...base, worktree: false } }, defaults).launcherDefaults).toEqual(base);
    expect(sanitizeAppConfig({ ...defaults, launcherDefaults: { ...base, worktree: 'sim' } }, defaults).launcherDefaults).toEqual(base);
  });

  it('activeProfileSlug vazio/só espaço cai no default (mesma regra de readActiveProfileConfig)', () => {
    const defaults = baseDefaults();
    expect(sanitizeAppConfig({ ...defaults, activeProfileSlug: '   ' }, defaults).activeProfileSlug).toBe(
      defaults.activeProfileSlug,
    );
  });

  it('version sempre normaliza pra CONFIG_SCHEMA_VERSION atual, mesmo se o arquivo trouxer outra', () => {
    const defaults = baseDefaults();
    expect(sanitizeAppConfig({ ...defaults, version: 99 }, defaults).version).toBe(1);
  });

  // T704 (007-favoritos-sessoes) — chave nova, mesma armadilha da T402/004:
  // se um campo faltar/tiver tipo errado ela é descartada em silêncio na
  // leitura. Testada aqui (não só em tests/sessionRegistry.test.ts) porque é
  // este arquivo que prova os "quatro pontos" do config-store.ts.
  it('sessionRegistry com tipo errado (array, string, null) cai no default {}', () => {
    const defaults = baseDefaults();
    expect(sanitizeAppConfig({ ...defaults, sessionRegistry: ['a'] }, defaults).sessionRegistry).toEqual({});
    expect(sanitizeAppConfig({ ...defaults, sessionRegistry: 'lixo' }, defaults).sessionRegistry).toEqual({});
    expect(sanitizeAppConfig({ ...defaults, sessionRegistry: null }, defaults).sessionRegistry).toEqual({});
  });

  it('sessionRegistry descarta ENTRADA a ENTRADA o que estiver malformado, preservando as boas', () => {
    const defaults = baseDefaults();
    const parsed = {
      ...defaults,
      sessionRegistry: {
        boa: { sessionId: 'boa', projectPath: 'C:\\a', label: 'Refatorar', lastActivityAt: 1000, pinned: true },
        'boa-nao-fixada': { sessionId: 'boa-nao-fixada', projectPath: 'C:\\a', label: 'Outra', lastActivityAt: 2000, pinned: false },
        'ruim-sem-project': { sessionId: 'ruim-sem-project', label: 'X', lastActivityAt: 1000, pinned: false },
        'ruim-label-vazio': { sessionId: 'ruim-label-vazio', projectPath: 'C:\\a', label: '   ', lastActivityAt: 1000, pinned: false },
        'ruim-sem-atividade': { sessionId: 'ruim-sem-atividade', projectPath: 'C:\\a', label: 'X', lastActivityAt: 'ontem', pinned: false },
        'ruim-tipo': 'não é objeto',
      },
    };
    expect(sanitizeAppConfig(parsed, defaults).sessionRegistry).toEqual({
      boa: { sessionId: 'boa', projectPath: 'C:\\a', label: 'Refatorar', lastActivityAt: 1000, pinned: true },
      'boa-nao-fixada': { sessionId: 'boa-nao-fixada', projectPath: 'C:\\a', label: 'Outra', lastActivityAt: 2000, pinned: false },
    });
  });

  it('sessionRegistry: pinned ausente/não-booleano vira false (nunca "fixada" por acidente)', () => {
    const defaults = baseDefaults();
    const parsed = {
      ...defaults,
      sessionRegistry: { s1: { sessionId: 's1', projectPath: 'C:\\a', label: 'X', lastActivityAt: 1000 } },
    };
    expect(sanitizeAppConfig(parsed, defaults).sessionRegistry.s1?.pinned).toBe(false);
  });

  it('sessionRegistry: o sessionId vem da CHAVE do mapa, não do valor (evita divergência)', () => {
    const defaults = baseDefaults();
    const parsed = {
      ...defaults,
      sessionRegistry: { 'chave-real': { sessionId: 'outro-id-no-valor', projectPath: 'C:\\a', label: 'X', lastActivityAt: 1000, pinned: false } },
    };
    expect(sanitizeAppConfig(parsed, defaults).sessionRegistry['chave-real']?.sessionId).toBe('chave-real');
  });

  // T708 — mesma chave nova, mesmo cuidado: array com tipo errado cai no
  // default [] em vez de derrubar o resto da config.
  it('collapsedFavorites com tipo errado (objeto, número, array de não-strings) cai no default []', () => {
    const defaults = baseDefaults();
    expect(sanitizeAppConfig({ ...defaults, collapsedFavorites: { a: true } }, defaults).collapsedFavorites).toEqual([]);
    expect(sanitizeAppConfig({ ...defaults, collapsedFavorites: 42 }, defaults).collapsedFavorites).toEqual([]);
    expect(sanitizeAppConfig({ ...defaults, collapsedFavorites: [1, 2] }, defaults).collapsedFavorites).toEqual([]);
  });

  it('collapsedFavorites válido é preservado', () => {
    const defaults = baseDefaults();
    expect(sanitizeAppConfig({ ...defaults, collapsedFavorites: ['C:\\a', 'C:\\b'] }, defaults).collapsedFavorites).toEqual([
      'C:\\a',
      'C:\\b',
    ]);
  });
});

describe('writeAppConfig (escrita atômica — fs mockado, DoD explícito da task)', () => {
  function makeMockIo(overrides: Partial<ConfigIoDeps> = {}): { io: ConfigIoDeps; calls: string[] } {
    const calls: string[] = [];
    const io: ConfigIoDeps = {
      existsSync: vi.fn(() => true),
      readFileText: vi.fn(() => null),
      writeFileText: vi.fn((path: string) => {
        calls.push(`write:${path}`);
      }),
      renameFile: vi.fn((from: string, to: string) => {
        calls.push(`rename:${from}->${to}`);
      }),
      mkdirSync: vi.fn((path: string) => {
        calls.push(`mkdir:${path}`);
      }),
      unlinkFile: vi.fn((path: string) => {
        calls.push(`unlink:${path}`);
      }),
      ...overrides,
    };
    return { io, calls };
  }

  // `baseline: null` nestes testes = 1ª escrita da sessão (nunca sincronizou
  // com o disco) — dump completo, mesmo comportamento de antes do G1. O que
  // estes testes cobrem é mecânica de escrita atômica, não merge; o merge
  // por chave de topo tem describe própria mais abaixo.

  it('grava num arquivo TEMPORÁRIO primeiro, só então faz rename pro path final (nunca escreve o arquivo final direto)', () => {
    const { io, calls } = makeMockIo();
    writeAppConfig('C:\\fake\\config.json', baseDefaults(), io, null);

    expect(calls).toHaveLength(2);
    const [writeCall, renameCall] = calls;
    expect(writeCall).toMatch(/^write:C:\\fake\\config\.json\.tmp-/);
    const tmpPathWritten = writeCall.slice('write:'.length);
    expect(renameCall).toBe(`rename:${tmpPathWritten}->C:\\fake\\config.json`);
  });

  it('conteúdo gravado é o JSON serializado da config recebida (unknownFields vazio não aparece como chave literal)', () => {
    const written: Record<string, string> = {};
    const { io } = makeMockIo({
      writeFileText: vi.fn((path: string, content: string) => {
        written[path] = content;
      }),
    });
    const config = baseDefaults();
    writeAppConfig('C:\\fake\\config.json', config, io, null);

    const tmpPath = Object.keys(written)[0];
    // `unknownFields` é o BAG em memória, nunca um campo literal do JSON —
    // seu conteúdo (aqui vazio) é espalhado no nível raiz, não aninhado.
    const { unknownFields: _unknownFields, ...expectedRaw } = config;
    expect(JSON.parse(written[tmpPath])).toEqual(expectedRaw);
  });

  it('cria o diretório pai quando ele não existe', () => {
    const { io, calls } = makeMockIo({ existsSync: vi.fn(() => false) });
    writeAppConfig('C:\\fake\\nested\\config.json', baseDefaults(), io, null);

    expect(calls[0]).toBe('mkdir:C:\\fake\\nested');
  });

  it('não cria diretório quando ele já existe', () => {
    const { io, calls } = makeMockIo({ existsSync: vi.fn(() => true) });
    writeAppConfig('C:\\fake\\config.json', baseDefaults(), io, null);

    expect(calls.some((call) => call.startsWith('mkdir:'))).toBe(false);
  });

  it('rename falhando limpa o arquivo temporário (best-effort) e propaga o erro', () => {
    const { io, calls } = makeMockIo({
      renameFile: vi.fn(() => {
        throw new Error('EPERM simulado');
      }),
    });

    expect(() => writeAppConfig('C:\\fake\\config.json', baseDefaults(), io, null)).toThrow('EPERM simulado');
    expect(calls.some((call) => call.startsWith('unlink:'))).toBe(true);
  });

  it('duas escritas seguidas usam nomes de arquivo temporário DIFERENTES (sem colisão)', () => {
    const { io, calls } = makeMockIo();
    writeAppConfig('C:\\fake\\config.json', baseDefaults(), io, null);
    writeAppConfig('C:\\fake\\config.json', baseDefaults(), io, null);

    const tmpNames = calls.filter((call) => call.startsWith('write:')).map((call) => call.slice('write:'.length));
    expect(tmpNames[0]).not.toBe(tmpNames[1]);
  });
});

describe('readAppConfig (migração dos JSONs legados T007/T014 — fs mockado)', () => {
  const legacy: LegacyConfigPaths = {
    projectConfigPath: 'C:\\fake\\project-config.json',
    activeProfilePath: 'C:\\fake\\active-profile.json',
  };

  function makeMockIo(files: Record<string, string>): ConfigIoDeps {
    return {
      existsSync: () => true,
      readFileText: (path: string) => files[path] ?? null,
      writeFileText: vi.fn(),
      renameFile: vi.fn(),
      mkdirSync: vi.fn(),
      unlinkFile: vi.fn(),
    };
  }

  it('config.json presente e válido é a fonte de verdade — legados nunca são consultados', () => {
    const defaults = baseDefaults();
    const stored: AppConfig = { ...defaults, favorites: ['C:\\from-config-json'], activeProfileSlug: 'tecnologia-claude-9' };
    const io = makeMockIo({
      'C:\\fake\\config.json': JSON.stringify(stored),
      [legacy.projectConfigPath]: JSON.stringify({ favorites: ['C:\\NUNCA-deveria-aparecer'] }),
      [legacy.activeProfilePath]: JSON.stringify({ activeSlug: 'nunca-deveria-aparecer' }),
    });

    expect(readAppConfig('C:\\fake\\config.json', defaults, legacy, io)).toEqual(stored);
  });

  it('config.json ausente + ambos os legados presentes: migra favorites + activeProfileSlug pros defaults', () => {
    const defaults = baseDefaults();
    const io = makeMockIo({
      [legacy.projectConfigPath]: JSON.stringify({ favorites: ['C:\\a', 'C:\\b'] }),
      [legacy.activeProfilePath]: JSON.stringify({ activeSlug: 'tecnologia-claude-4' }),
    });

    expect(readAppConfig('C:\\fake\\config.json', defaults, legacy, io)).toEqual({
      ...defaults,
      favorites: ['C:\\a', 'C:\\b'],
      activeProfileSlug: 'tecnologia-claude-4',
    });
  });

  it('config.json ausente + só project-config.json legado presente: favorites migra, activeProfileSlug cai no default', () => {
    const defaults = baseDefaults();
    const io = makeMockIo({ [legacy.projectConfigPath]: JSON.stringify({ favorites: ['C:\\a'] }) });

    expect(readAppConfig('C:\\fake\\config.json', defaults, legacy, io)).toEqual({ ...defaults, favorites: ['C:\\a'] });
  });

  it('config.json ausente + nenhum legado presente: defaults puros (1ª execução real, nunca usou o app antes)', () => {
    const defaults = baseDefaults();
    const io = makeMockIo({});

    expect(readAppConfig('C:\\fake\\config.json', defaults, legacy, io)).toEqual(defaults);
  });

  it('legado com JSON corrompido é ignorado silenciosamente (cai no default daquele campo, nunca lança)', () => {
    const defaults = baseDefaults();
    const io = makeMockIo({ [legacy.projectConfigPath]: '{ isso não é json' });

    expect(readAppConfig('C:\\fake\\config.json', defaults, legacy, io)).toEqual(defaults);
  });

  it('config.json presente mas corrompido: cai nos defaults SEM tentar migrar (config.json já existia, não é "1ª vez")', () => {
    const defaults = baseDefaults();
    const io = makeMockIo({
      'C:\\fake\\config.json': '{ corrompido',
      [legacy.projectConfigPath]: JSON.stringify({ favorites: ['C:\\NUNCA-deveria-aparecer'] }),
    });

    expect(readAppConfig('C:\\fake\\config.json', defaults, legacy, io)).toEqual(defaults);
  });
});

describe('readAppConfig / writeAppConfig — I/O real em pasta temporária (integração)', () => {
  let dir: string;
  let filePath: string;
  let legacy: LegacyConfigPaths;
  let io: ConfigIoDeps;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'donel-dev-config-store-'));
    filePath = join(dir, 'nested', 'config.json');
    legacy = { projectConfigPath: join(dir, 'project-config.json'), activeProfilePath: join(dir, 'active-profile.json') };
    io = createSystemConfigIoDeps();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('grava e relê, criando diretórios intermediários', () => {
    const config = baseDefaults();
    writeAppConfig(filePath, config, io, null);

    expect(readAppConfig(filePath, config, legacy, io)).toEqual(config);
  });

  it('escrita é atômica de ponta a ponta: o arquivo final nunca fica com conteúdo truncado/parcial, e overwrite funciona', () => {
    const first = baseDefaults();
    writeAppConfig(filePath, first, io, null);
    const { unknownFields: _unknownFields1, ...firstRaw } = first;
    expect(JSON.parse(readFileSync(filePath, 'utf8'))).toEqual(firstRaw);

    // baseline = first: é o que ESTA sessão sincronizou por último com o
    // disco (a escrita anterior, linha acima) — só favorites/notificationPreference
    // mudaram desde então, então só essas duas chaves precisam ser sobrescritas
    // (as demais vêm do disco fresco, que ainda é `first`).
    const second: AppConfig = { ...first, favorites: ['C:\\segunda-escrita'], notificationPreference: 'all' };
    writeAppConfig(filePath, second, io, first);
    const { unknownFields: _unknownFields2, ...secondRaw } = second;
    expect(JSON.parse(readFileSync(filePath, 'utf8'))).toEqual(secondRaw);

    // Nenhum arquivo .tmp-* sobra pra trás depois de um rename bem-sucedido.
    const leftovers = readdirSync(join(filePath, '..')).filter((name) => name.includes('.tmp-'));
    expect(leftovers).toHaveLength(0);
  });

  it('migração real: JSONs legados no formato exato de T007/T014 na pasta, config.json ainda não existe', () => {
    writeFileSync(legacy.projectConfigPath, JSON.stringify({ favorites: ['C:\\legado-a'] }), 'utf8');
    writeFileSync(legacy.activeProfilePath, JSON.stringify({ activeSlug: 'tecnologia-claude-7' }), 'utf8');

    const defaults = baseDefaults();
    const migrated = readAppConfig(filePath, defaults, legacy, io);
    expect(migrated.favorites).toEqual(['C:\\legado-a']);
    expect(migrated.activeProfileSlug).toBe('tecnologia-claude-7');

    // Persiste o resultado migrado — a partir daqui config.json é a fonte
    // única (próxima leitura NÃO reconsulta os legados, mesmo que mudem).
    writeAppConfig(filePath, migrated, io, null);
    writeFileSync(legacy.projectConfigPath, JSON.stringify({ favorites: ['C:\\mudou-depois-nao-deveria-aparecer'] }), 'utf8');

    const rereadAfterMigration = readAppConfig(filePath, defaults, legacy, io);
    expect(rereadAfterMigration.favorites).toEqual(['C:\\legado-a']);
  });

  // T402 — CA-6: o nome tem de sobreviver a reiniciar o app, o que na prática
  // é este round-trip (grava → processo morre → lê de novo).
  it('sessionNames sobrevive ao round-trip em disco (CA-6)', () => {
    const config: AppConfig = {
      ...baseDefaults(),
      sessionNames: setSessionName({}, 'abc-123', {
        name: 'Nomear sessões',
        seenTitle: null,
        updatedAt: '2026-07-24T15:30:00.000Z',
      }),
    };
    writeAppConfig(filePath, config, io, null);

    const reread = readAppConfig(filePath, baseDefaults(), legacy, io);
    expect(reread.sessionNames).toEqual({
      'abc-123': { name: 'Nomear sessões', seenTitle: null, updatedAt: '2026-07-24T15:30:00.000Z' },
    });
  });

  it('config.json LEGADO real no disco (sem a chave) relê com {} e mantém o resto', () => {
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(
      filePath,
      JSON.stringify({
        version: 1,
        projectRoots: ['C:\\meu\\root'],
        favorites: ['C:\\meu\\projeto'],
        activeProfileSlug: 'tecnologia-claude-3',
        launcherDefaults: { model: 'opus', effort: 'max', permissionMode: 'auto' },
        notificationPreference: 'all',
        theme: 'dark',
      }),
      'utf8',
    );

    const loaded = readAppConfig(filePath, baseDefaults(), legacy, io);
    expect(loaded.sessionNames).toEqual({});
    expect(loaded.sessionRegistry).toEqual({});
    expect(loaded.projectRoots).toEqual(['C:\\meu\\root']);
    expect(loaded.favorites).toEqual(['C:\\meu\\projeto']);
    expect(loaded.launcherDefaults).toEqual({ model: 'opus', effort: 'max', permissionMode: 'auto' });
  });

  // T704 — CA-5: fixar/registro tem de sobreviver a fechar e reabrir o app.
  it('sessionRegistry sobrevive ao round-trip em disco', () => {
    const registry = upsertVisit({}, { sessionId: 'sess-1', projectPath: 'C:\\meu\\projeto', label: 'Trabalhando', atMs: 1000 });
    const config: AppConfig = { ...baseDefaults(), sessionRegistry: registry };
    writeAppConfig(filePath, config, io, null);

    const reread = readAppConfig(filePath, baseDefaults(), legacy, io);
    expect(reread.sessionRegistry).toEqual(registry);
  });

  it('config.json corrompido no disco (I/O real) cai nos defaults sem lançar', () => {
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, '{ não é json válido', 'utf8');
    expect(readAppConfig(filePath, baseDefaults(), legacy, io)).toEqual(baseDefaults());
  });

  // T306 (003-modo-dev, Batch A) — devMode sobrevive ao round-trip real em
  // disco, incluindo config LEGADO (sem a chave) e uma entrada malformada
  // isolada não derrubando as demais (mesma armadilha da 007/T704).
  it('devMode sobrevive ao round-trip em disco', () => {
    const config: AppConfig = {
      ...baseDefaults(),
      devMode: {
        discoveries: { 'card-1': { cardId: 'card-1', repoPath: 'C:\\repo', epicId: null, openedAt: 100, closedAt: null } },
        focusedDiscoveryId: 'card-1',
        // Chave v3 (CA-31): já cardId:fase — round-trip é identidade, sem migração de por meio.
        archivedPhaseSessions: { 'card-1:plano': { sessionId: 'sess-1', accountId: 'principal', archivedAt: 200 } },
        phaseDefaults: DEFAULT_PHASE_DEFAULTS,
        boardConfig: { workspaceId: 'ws-1', teamId: 'team-1' },
      },
    };
    writeAppConfig(filePath, config, io, null);

    const reread = readAppConfig(filePath, baseDefaults(), legacy, io);
    expect(reread.devMode).toEqual(config.devMode);
  });

  it('config.json LEGADO real no disco (sem a chave devMode) relê com os defaults e mantém o resto', () => {
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(
      filePath,
      JSON.stringify({
        version: 1,
        projectRoots: ['C:\\meu\\root'],
        favorites: [],
        activeProfileSlug: 'principal',
        launcherDefaults: { model: 'fable', effort: 'high', permissionMode: 'acceptEdits' },
        notificationPreference: 'permission-only',
        sessionNames: {},
        theme: 'dark',
        sessionRegistry: {},
        collapsedFavorites: [],
        // sem `devMode` — config gravada por uma versão anterior a esta feature.
      }),
      'utf8',
    );

    const loaded = readAppConfig(filePath, baseDefaults(), legacy, io);
    expect(loaded.devMode).toEqual(baseDefaults().devMode);
    expect(loaded.projectRoots).toEqual(['C:\\meu\\root']);
  });

  // G1 (011-contas-e-provedores, issue 08) — round-trip PONTA A PONTA (I/O
  // real): uma chave de topo que este build não conhece (simula um canal
  // mais novo, ex.: `migration`) sobrevive a ler (sanitize guarda em
  // `unknownFields`), mutar um campo qualquer e gravar de novo
  // (read-merge-write) — "sobrevive a sanitize+gravação" da issue 08.
  it('chave desconhecida sobrevive a um ciclo real de sanitize + read-merge-write + sanitize de novo', () => {
    mkdirSync(dirname(filePath), { recursive: true });
    const onDiskFromNewerChannel = {
      ...baseDefaults(),
      favorites: ['C:\\projeto-existente'],
      campoDeUmCanalMaisNovo: { versaoDoSchema: 99, dado: 'não pode sumir' },
    };
    writeFileSync(filePath, JSON.stringify(onDiskFromNewerChannel), 'utf8');

    // 1) Lê com ESTE build (que não conhece `campoDeUmCanalMaisNovo`) — a
    // chave não é dropada, sobrevive em unknownFields.
    const baseline = readAppConfig(filePath, baseDefaults(), legacy, io);
    expect(baseline.unknownFields).toEqual({ campoDeUmCanalMaisNovo: { versaoDoSchema: 99, dado: 'não pode sumir' } });
    expect(baseline.favorites).toEqual(['C:\\projeto-existente']);

    // 2) Muda só um campo CONHECIDO e regrava (read-merge-write) — este
    // processo nunca "viu"/tocou campoDeUmCanalMaisNovo, então ele nem entra
    // no diff; sobrevive só por estar fresco no disco relido na hora de gravar.
    const mutated: AppConfig = { ...baseline, favorites: [...baseline.favorites, 'C:\\projeto-novo'] };
    writeAppConfig(filePath, mutated, io, baseline);

    // 3) Relê: o campo desconhecido ainda está lá, e o campo conhecido
    // mudado nesta sessão reflete a mudança.
    const reread = readAppConfig(filePath, baseDefaults(), legacy, io);
    expect(reread.unknownFields).toEqual({ campoDeUmCanalMaisNovo: { versaoDoSchema: 99, dado: 'não pode sumir' } });
    expect(reread.favorites).toEqual(['C:\\projeto-existente', 'C:\\projeto-novo']);

    // E a chave nunca aparece aninhada sob um campo unknownFields literal no
    // JSON cru — sempre espalhada no nível raiz (senão um canal mais novo que
    // ENTENDE aquela chave deixaria de encontrá-la em `config.<chave>`).
    const raw = JSON.parse(readFileSync(filePath, 'utf8'));
    expect(raw.campoDeUmCanalMaisNovo).toEqual({ versaoDoSchema: 99, dado: 'não pode sumir' });
    expect(raw.unknownFields).toBeUndefined();
  });
});

describe('sanitizeAppConfig — devMode (T306)', () => {
  it('discovery malformado (sem repoPath) é descartado isolado, preservando os demais', () => {
    const parsed = {
      devMode: {
        discoveries: {
          'card-1': { cardId: 'card-1', repoPath: 'C:\\repo', epicId: null, openedAt: 100, closedAt: null },
          'card-2': { cardId: 'card-2', epicId: null, openedAt: 100, closedAt: null }, // sem repoPath
        },
        focusedDiscoveryId: null,
        archivedPhaseSessions: {},
        phaseDefaults: DEFAULT_PHASE_DEFAULTS,
        boardConfig: null,
      },
    };

    const sanitized = sanitizeAppConfig(parsed, baseDefaults());
    expect(Object.keys(sanitized.devMode.discoveries)).toEqual(['card-1']);
  });

  it('phaseDefaults malformado cai no DEFAULT_PHASE_DEFAULTS inteiro (não mistura fase boa com fase quebrada)', () => {
    const parsed = {
      devMode: {
        discoveries: {},
        focusedDiscoveryId: null,
        archivedPhaseSessions: {},
        phaseDefaults: {
          ...DEFAULT_PHASE_DEFAULTS,
          validar: { ...DEFAULT_PHASE_DEFAULTS.validar, model: 'modelo-inventado' },
        },
        boardConfig: null,
      },
    };

    const sanitized = sanitizeAppConfig(parsed, baseDefaults());
    expect(sanitized.devMode.phaseDefaults).toEqual(DEFAULT_PHASE_DEFAULTS);
  });

  it('phaseDefaults faltando uma fase inteira cai no DEFAULT_PHASE_DEFAULTS inteiro', () => {
    const { concluir: _concluir, ...withoutConcluir } = DEFAULT_PHASE_DEFAULTS;
    const parsed = {
      devMode: {
        discoveries: {},
        focusedDiscoveryId: null,
        archivedPhaseSessions: {},
        phaseDefaults: withoutConcluir,
        boardConfig: null,
      },
    };

    const sanitized = sanitizeAppConfig(parsed, baseDefaults());
    expect(sanitized.devMode.phaseDefaults).toEqual(DEFAULT_PHASE_DEFAULTS);
  });

  // Chaves no formato v2 (cardId:marcoId:fase) — a migração CA-31 roda por
  // cima da sanitização de schema, então a sobrevivente aparece já como
  // cardId:fase (marco_id descartado).
  it('archivedPhaseSessions descarta entrada malformada (sessionId vazio) isolada', () => {
    const parsed = {
      devMode: {
        discoveries: {},
        focusedDiscoveryId: null,
        archivedPhaseSessions: {
          'card-1:M1:plano': { sessionId: 'sess-1', profileSlug: 'principal', archivedAt: 100 },
          'card-1:M1:validar': { sessionId: '', profileSlug: 'principal', archivedAt: 200 },
        },
        phaseDefaults: DEFAULT_PHASE_DEFAULTS,
        boardConfig: null,
      },
    };

    const sanitized = sanitizeAppConfig(parsed, baseDefaults());
    expect(Object.keys(sanitized.devMode.archivedPhaseSessions)).toEqual(['card-1:plano']);
  });

  // CA-31 (009-modo-dev-v3) — migração da chave v2→v3 na leitura do config.
  describe('archivedPhaseSessions — migração CA-31 (cardId:marcoId:fase → cardId:fase)', () => {
    it('discovery/plano migram para cardId:fase, sem marco_id', () => {
      const parsed = {
        devMode: {
          discoveries: {},
          focusedDiscoveryId: null,
          archivedPhaseSessions: {
            'card-1:M1:discovery': { sessionId: 'sess-a', profileSlug: 'principal', archivedAt: 100 },
            'card-2:M2:plano': { sessionId: 'sess-b', profileSlug: 'principal', archivedAt: 200 },
          },
          phaseDefaults: DEFAULT_PHASE_DEFAULTS,
          boardConfig: null,
        },
      };

      const sanitized = sanitizeAppConfig(parsed, baseDefaults());
      expect(sanitized.devMode.archivedPhaseSessions).toEqual({
        'card-1:discovery': { sessionId: 'sess-a', accountId: 'principal', archivedAt: 100 },
        'card-2:plano': { sessionId: 'sess-b', accountId: 'principal', archivedAt: 200 },
      });
    });

    it('implementar/validar são descartadas (registro antigo não tem fase_num — D16 do discovery)', () => {
      const parsed = {
        devMode: {
          discoveries: {},
          focusedDiscoveryId: null,
          archivedPhaseSessions: {
            'card-1:M1:implementar': { sessionId: 'sess-a', profileSlug: 'principal', archivedAt: 100 },
            'card-1:M1:validar': { sessionId: 'sess-b', profileSlug: 'principal', archivedAt: 200 },
            'card-1:M1:concluir': { sessionId: 'sess-c', profileSlug: 'principal', archivedAt: 300 },
          },
          phaseDefaults: DEFAULT_PHASE_DEFAULTS,
          boardConfig: null,
        },
      };

      const sanitized = sanitizeAppConfig(parsed, baseDefaults());
      expect(sanitized.devMode.archivedPhaseSessions).toEqual({});
    });

    it('chave já no formato v3 (2 partes) passa direto — migração idempotente', () => {
      const parsed = {
        devMode: {
          discoveries: {},
          focusedDiscoveryId: null,
          archivedPhaseSessions: {
            'card-1:plano': { sessionId: 'sess-a', profileSlug: 'principal', archivedAt: 100 },
          },
          phaseDefaults: DEFAULT_PHASE_DEFAULTS,
          boardConfig: null,
        },
      };

      const sanitized = sanitizeAppConfig(parsed, baseDefaults());
      expect(sanitized.devMode.archivedPhaseSessions).toEqual({
        'card-1:plano': { sessionId: 'sess-a', accountId: 'principal', archivedAt: 100 },
      });
    });

    it('chave em formato desconhecido (1 ou 4+ partes) é descartada, nunca fabricada', () => {
      const parsed = {
        devMode: {
          discoveries: {},
          focusedDiscoveryId: null,
          archivedPhaseSessions: {
            'card-sozinho': { sessionId: 'sess-a', profileSlug: 'principal', archivedAt: 100 },
            'a:b:c:d': { sessionId: 'sess-b', profileSlug: 'principal', archivedAt: 200 },
          },
          phaseDefaults: DEFAULT_PHASE_DEFAULTS,
          boardConfig: null,
        },
      };

      const sanitized = sanitizeAppConfig(parsed, baseDefaults());
      expect(sanitized.devMode.archivedPhaseSessions).toEqual({});
    });
  });

  // T1220 (011-contas-e-provedores, etapa 2, C30/D15) — config GRAVADA POR
  // CANAL ANTIGO (`profileSlug`, nunca `accountId`): o sanitize aceita sem
  // erro e LÊ o legado como `accountId` — nunca escreve `profileSlug` de
  // volta. Cobre o risco "canal alfa/beta/stable aberto depois destrói
  // estado novo" (CLAUDE.md).
  it('archivedPhaseSessions gravado por canal antigo (só profileSlug, sem accountId) é lido como accountId', () => {
    const parsed = {
      devMode: {
        discoveries: {},
        focusedDiscoveryId: null,
        archivedPhaseSessions: {
          'card-1:plano': { sessionId: 'sess-1', profileSlug: 'tecnologia-claude-4', archivedAt: 100 },
        },
        phaseDefaults: DEFAULT_PHASE_DEFAULTS,
        boardConfig: null,
      },
    };

    const sanitized = sanitizeAppConfig(parsed, baseDefaults());
    expect(sanitized.devMode.archivedPhaseSessions['card-1:plano']).toEqual({
      sessionId: 'sess-1',
      accountId: 'tecnologia-claude-4',
      archivedAt: 100,
    });
    expect(JSON.stringify(sanitized.devMode.archivedPhaseSessions)).not.toContain('profileSlug');
  });

  it('boardConfig malformado (sem teamId) cai em null', () => {
    const parsed = { devMode: { ...baseDefaults().devMode, boardConfig: { workspaceId: 'ws-1' } } };
    const sanitized = sanitizeAppConfig(parsed, baseDefaults());
    expect(sanitized.devMode.boardConfig).toBeNull();
  });

  it('focusedDiscoveryId apontando para um discovery que não sobreviveu ao sanitize vira null', () => {
    const parsed = {
      devMode: {
        discoveries: { 'card-2': { cardId: 'card-2', epicId: null, openedAt: 100, closedAt: null } }, // sem repoPath, será descartado
        focusedDiscoveryId: 'card-2',
        archivedPhaseSessions: {},
        phaseDefaults: DEFAULT_PHASE_DEFAULTS,
        boardConfig: null,
      },
    };

    const sanitized = sanitizeAppConfig(parsed, baseDefaults());
    expect(sanitized.devMode.focusedDiscoveryId).toBeNull();
  });

  it('devMode ausente inteiro cai no default inteiro (config legado)', () => {
    const sanitized = sanitizeAppConfig({}, baseDefaults());
    expect(sanitized.devMode).toEqual(baseDefaults().devMode);
  });
});

// ---------------------------------------------------------------------------
// G1 (011-contas-e-provedores, issue 08) — read-merge-write. Dois defeitos
// reais da coexistência de canais (alfa/beta/stable no mesmo userData):
//   (a) sanitize sem passthrough dropava chave de topo desconhecida deste
//       build (ex.: `migration`, visto por um canal antigo);
//   (b) gravação last-writer-wins clobberava até chave CONHECIDA
//       (`accounts.localAccounts`) com a cópia velha em memória de outro
//       processo. `mergeConfigForWrite` é a função pura que resolve os dois:
//       só a chave que ESTA sessão mudou desde `baseline` sobrescreve o
//       disco; toda outra chave vem do disco FRESCO (`diskRaw`).
// ---------------------------------------------------------------------------

describe('mergeConfigForWrite (puro) — G1 (issue 08): merge por chave de topo', () => {
  it('baseline null (1ª escrita da sessão) trata toda chave conhecida como mudada — dump completo, sem unknownFields como chave literal', () => {
    const current = { ...baseDefaults(), favorites: ['C:\\a'] };
    const merged = mergeConfigForWrite({}, null, current);

    const { unknownFields: _unknownFields, ...expectedRaw } = current;
    expect(merged).toEqual(expectedRaw);
  });

  // Defeito (b) — o coração do achado da issue 08: `accounts.localAccounts`
  // foi mudado por OUTRO processo (8 contas migradas) depois que esta sessão
  // sincronizou pela última vez; esta sessão nunca tocou `accounts`, só
  // `favorites` — a chave que ela não mudou não pode reverter a escrita alheia.
  it('chave CONHECIDA não tocada por esta sessão vem do disco fresco, mesmo que o disco divirja do baseline (não perde escrita concorrente)', () => {
    const defaults = baseDefaults();
    const baseline = defaults; // o que esta sessão leu/gravou por último
    const current = { ...baseline, favorites: ['C:\\favorito-desta-sessao'] }; // só favorites mudou aqui

    const accountsFromOtherProcess = {
      ...defaults.accounts,
      localAccounts: [
        { id: 'acc-1', label: 'Conta migrada 1', plan: null },
        { id: 'acc-2', label: 'Conta migrada 2', plan: null },
      ],
    };
    const diskRaw = { ...defaults, accounts: accountsFromOtherProcess, favorites: [] }; // disco fresco: outro processo migrou contas

    const merged = mergeConfigForWrite(diskRaw as unknown as Record<string, unknown>, baseline, current);

    // accounts não foi tocado por esta sessão → disco fresco vence (8→2 contas preservadas).
    expect(merged.accounts).toEqual(accountsFromOtherProcess);
    // favorites FOI tocado por esta sessão → o valor desta sessão vence.
    expect(merged.favorites).toEqual(['C:\\favorito-desta-sessao']);
  });

  it('chave CONHECIDA tocada por esta sessão sobrescreve o disco, mesmo quando o disco também divergiu nela (sem coordenação entre processos, o dado da sessão atual prevalece no que ELA mudou)', () => {
    const defaults = baseDefaults();
    const baseline = defaults;
    const current = { ...baseline, favorites: ['C:\\valor-desta-sessao'] };
    const diskRaw = { ...defaults, favorites: ['C:\\valor-de-outro-processo'] };

    const merged = mergeConfigForWrite(diskRaw as unknown as Record<string, unknown>, baseline, current);
    expect(merged.favorites).toEqual(['C:\\valor-desta-sessao']);
  });

  // Defeito (a) — chave de topo que não existe no shape de `AppConfig` deste
  // build (simula um canal mais novo, ex.: `migration` visto por um canal
  // antigo). Nunca entra no loop de `knownAppConfigKeys` — sobrevive só por
  // estar em `diskRaw`.
  it('chave de topo desconhecida ao schema atual sobrevive intacta a uma gravação que só mexe em campo conhecido', () => {
    const defaults = baseDefaults();
    const diskRaw = { ...defaults, campoQueEsteBuildNaoConhece: { x: 1, y: ['a', 'b'] } };
    const baseline = defaults;
    const current = { ...baseline, favorites: ['C:\\a'] };

    const merged = mergeConfigForWrite(diskRaw as unknown as Record<string, unknown>, baseline, current);
    expect(merged.campoQueEsteBuildNaoConhece).toEqual({ x: 1, y: ['a', 'b'] });
    expect(merged.favorites).toEqual(['C:\\a']);
  });

  it('chave conhecida ausente do disco (arquivo mais velho que o schema) é semeada a partir da config atual, mesmo sem mudança detectável', () => {
    const defaults = baseDefaults();
    const { providers: _providers, ...diskRawWithoutProviders } = defaults;

    const merged = mergeConfigForWrite(diskRawWithoutProviders as unknown as Record<string, unknown>, defaults, defaults);
    expect(merged.providers).toEqual(defaults.providers);
  });

  it('unknownFields da config atual entra só como fallback quando o disco não tem mais aquela chave — disco fresco, quando presente, sempre vence', () => {
    const defaults = baseDefaults();
    const current = { ...defaults, unknownFields: { campoLembrado: 'valor-antigo' } };

    // Caso 1: disco não tem a chave (ex.: arquivo recriado) → usa o que a sessão lembra.
    const mergedSemDisco = mergeConfigForWrite({ ...defaults }, defaults, current);
    expect(mergedSemDisco.campoLembrado).toBe('valor-antigo');

    // Caso 2: disco TEM a chave, com valor mais fresco → disco vence sobre o lembrado.
    const diskComValorFresco = { ...defaults, campoLembrado: 'valor-fresco-do-disco' };
    const mergedComDisco = mergeConfigForWrite(diskComValorFresco as unknown as Record<string, unknown>, defaults, current);
    expect(mergedComDisco.campoLembrado).toBe('valor-fresco-do-disco');
  });
});

describe('writeAppConfig (fs mockado) — G1 (issue 08): escrita concorrente simulada', () => {
  function makeMockIoWithDisk(diskContent: Record<string, unknown> | null): { io: ConfigIoDeps; written: Record<string, string> } {
    const written: Record<string, string> = {};
    const io: ConfigIoDeps = {
      existsSync: vi.fn(() => true),
      readFileText: vi.fn(() => (diskContent === null ? null : JSON.stringify(diskContent))),
      writeFileText: vi.fn((path: string, content: string) => {
        written[path] = content;
      }),
      renameFile: vi.fn(),
      mkdirSync: vi.fn(),
      unlinkFile: vi.fn(),
    };
    return { io, written };
  }

  // Nome do achado real da issue 08: MigrationWizard rodado num canal migrou
  // 8 contas pro cofre + gravou `accounts.localAccounts`/`migration`; um
  // canal desatualizado (cópia em memória de ANTES da migração) fez uma
  // gravação não relacionada (favoritos) e clobberou as duas chaves. Este
  // teste reproduz o formato exato do achado e prova que não reproduz mais.
  it('escrita concorrente simulada não perde chave conhecida alterada no disco por outro processo', () => {
    const defaults = baseDefaults();
    const baseline = defaults; // esta sessão nunca tocou accounts/migration

    const accountsAposMigracao = {
      ...defaults.accounts,
      mod: 'local' as const,
      localAccounts: Array.from({ length: 8 }, (_, i) => ({ id: `acc-${i}`, label: `Conta ${i}`, plan: null })),
    };
    const migrationAposMigracao = { startedAt: 1000, completedAt: 2000, profiles: {}, archivedTo: null };
    // "disco fresco": o que outro processo/canal gravou nesse meio-tempo.
    const diskAgora = { ...defaults, accounts: accountsAposMigracao, migration: migrationAposMigracao };

    const { io, written } = makeMockIoWithDisk(diskAgora);

    // Esta sessão só mexeu em favoritos — nunca leu o resultado da migração.
    const current = { ...baseline, favorites: ['C:\\projeto-favoritado-nesta-sessao'] };
    writeAppConfig('C:\\fake\\config.json', current, io, baseline);

    const tmpPath = Object.keys(written)[0];
    const persisted = JSON.parse(written[tmpPath]);

    expect(persisted.accounts.localAccounts).toHaveLength(8);
    expect(persisted.accounts.localAccounts).toEqual(accountsAposMigracao.localAccounts);
    expect(persisted.migration).toEqual(migrationAposMigracao);
    expect(persisted.favorites).toEqual(['C:\\projeto-favoritado-nesta-sessao']);
  });

  it('chave de topo desconhecida deste build sobrevive a uma gravação real (fs mockado) que só mexe em campo conhecido', () => {
    const defaults = baseDefaults();
    const baseline = defaults;
    const diskAgora = { ...defaults, providerExperimentalDoCanalBeta: { flag: true } };

    const { io, written } = makeMockIoWithDisk(diskAgora);
    const current = { ...baseline, notificationPreference: 'all' as const };
    writeAppConfig('C:\\fake\\config.json', current, io, baseline);

    const tmpPath = Object.keys(written)[0];
    const persisted = JSON.parse(written[tmpPath]);

    expect(persisted.providerExperimentalDoCanalBeta).toEqual({ flag: true });
    expect(persisted.notificationPreference).toBe('all');
    // Nunca aninhada sob uma chave "unknownFields" literal.
    expect(persisted.unknownFields).toBeUndefined();
  });
});
