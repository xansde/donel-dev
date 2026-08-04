import { describe, expect, it } from 'vitest';
import { defaultMigrationState, sanitizeMigrationState } from '../src/main/accounts/migration/migration-state';
import { buildMigrationPlan } from '../src/main/accounts/migration/migration-plan';
import type { ProfileInventoryEntry } from '../src/main/accounts/migration/profile-inventory';
import type { McpDiff } from '../src/main/accounts/migration/mcp-diff';

function emptyDiff(slug: string): McpDiff {
  return { profileSlug: slug, onlyInProfile: [], onlyInGlobal: [] };
}

// T1208 (011-contas-e-provedores, etapa 2) — `sanitizeMigrationState`
// resiliente (mesmo padrão de `sanitizeAppConfig`) + idempotência do plano
// puro (`migration-plan.ts`, data-model-etapa-2.md §4-§5).

function entry(overrides: Partial<ProfileInventoryEntry> = {}): ProfileInventoryEntry {
  return {
    slug: 'acc-1',
    displayName: 'Conta 1',
    path: 'C:\\home\\.claude-profiles\\acc-1',
    hasCredentials: true,
    projectsDir: 'junction',
    mcpServerNames: [],
    settingsDiffers: false,
    claudeMdDiffers: false,
    ...overrides,
  };
}

describe('sanitizeMigrationState (puro)', () => {
  const defaults = defaultMigrationState();

  it('ausente/corrompido cai nos defaults', () => {
    expect(sanitizeMigrationState(undefined, defaults)).toEqual(defaults);
    expect(sanitizeMigrationState(null, defaults)).toEqual(defaults);
    expect(sanitizeMigrationState('not-an-object', defaults)).toEqual(defaults);
    expect(sanitizeMigrationState([1, 2, 3], defaults)).toEqual(defaults);
  });

  it('step desconhecido cai em pending', () => {
    const result = sanitizeMigrationState(
      { profiles: { 'acc-1': { credentials: 'bogus-step', transcripts: 'imported', mcpReviewed: true } } },
      defaults,
    );
    expect(result.profiles['acc-1']?.credentials).toBe('pending');
    expect(result.profiles['acc-1']?.transcripts).toBe('imported');
  });

  it('slug vazio é descartado', () => {
    const result = sanitizeMigrationState({ profiles: { '': { credentials: 'imported', transcripts: 'imported', mcpReviewed: true } } }, defaults);
    expect(result.profiles).toEqual({});
  });

  it('mcpReviewed tipo errado cai em false', () => {
    const result = sanitizeMigrationState(
      { profiles: { 'acc-1': { credentials: 'imported', transcripts: 'imported', mcpReviewed: 'yes' } } },
      defaults,
    );
    expect(result.profiles['acc-1']?.mcpReviewed).toBe(false);
  });

  it('startedAt/completedAt/archivedTo preservados quando válidos', () => {
    const result = sanitizeMigrationState({ startedAt: 100, completedAt: 200, archivedTo: 'C:\\home\\.claude-profiles.old', profiles: {} }, defaults);
    expect(result.startedAt).toBe(100);
    expect(result.completedAt).toBe(200);
    expect(result.archivedTo).toBe('C:\\home\\.claude-profiles.old');
  });
});

describe('buildMigrationPlan (puro) — idempotência e estado', () => {
  it('perfil já importado (credentials: imported) não reaparece como pending', () => {
    const state = sanitizeMigrationState(
      { profiles: { 'acc-1': { credentials: 'imported', transcripts: 'imported', mcpReviewed: true } } },
      defaultMigrationState(),
    );
    const plan = buildMigrationPlan([entry()], state, [emptyDiff('acc-1')]);
    expect(plan.entries[0]?.credentials).toBe('imported');
    expect(plan.entries[0]?.credentials).not.toBe('pending');
  });

  it('perfil ainda não tocado ⇒ pending', () => {
    const plan = buildMigrationPlan([entry()], defaultMigrationState(), [emptyDiff('acc-1')]);
    expect(plan.entries[0]?.credentials).toBe('pending');
  });

  it('perfil skipped/failed é retomável (continua elegível, não vira imported sozinho)', () => {
    const state = sanitizeMigrationState(
      { profiles: { 'acc-1': { credentials: 'skipped', transcripts: 'pending', mcpReviewed: false } } },
      defaultMigrationState(),
    );
    const plan = buildMigrationPlan([entry()], state, [emptyDiff('acc-1')]);
    expect(plan.entries[0]?.credentials).toBe('skipped');
    expect(plan.canArchive).toBe(true); // skipped não é pending
  });

  it('canArchive só true quando ZERO perfis credentials=pending', () => {
    const pendingState = defaultMigrationState();
    const pendingPlan = buildMigrationPlan([entry()], pendingState, [emptyDiff('acc-1')]);
    expect(pendingPlan.canArchive).toBe(false);

    const importedState = sanitizeMigrationState(
      { profiles: { 'acc-1': { credentials: 'imported', transcripts: 'imported', mcpReviewed: true } } },
      defaultMigrationState(),
    );
    const importedPlan = buildMigrationPlan([entry()], importedState, [emptyDiff('acc-1')]);
    expect(importedPlan.canArchive).toBe(true);
  });

  it('sem perfil nenhum (inventário vazio) ⇒ canArchive true (nada pendente)', () => {
    const plan = buildMigrationPlan([], defaultMigrationState(), []);
    expect(plan.entries).toEqual([]);
    expect(plan.canArchive).toBe(true);
  });
});
