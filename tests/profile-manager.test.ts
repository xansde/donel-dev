import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  buildProfileCreationPlan,
  canDeleteProfile,
  createProfile,
  createSystemProfileDeletionIoDeps,
  deleteProfile,
  deleteProfileDirectory,
  executeProfileCreationPlan,
  hasMcpServersDrift,
  listProfiles,
  mergeMcpServersIntoProfile,
  normalizeWindowsPath,
  PRINCIPAL_PROFILE,
  PRINCIPAL_PROFILE_SLUG,
  PROFILE_COPY_FILES,
  PROFILE_LINK_DIRS,
  profileDirPath,
  readActiveProfileConfig,
  repairProfileJunctions,
  runProfileDoctor,
  slugifyProfileName,
  titleCaseFromSlug,
  writeActiveProfileConfig,
  type ProfileCreationIoDeps,
  type ProfileDeletionIoDeps,
  type ProfileDoctorDeps,
  type ProfileInfo,
  type ProfileListDeps,
  type ProfileRepairIoDeps,
} from '../src/main/profile-manager';

// T014 — ProfileManager (FR-005, FR-012 parcial, CA-3). Cobertura conforme
// spike-t001-resultado.md (LEI da task): slug/plano/merge de mcpServers
// (achado novo do spike) e doctor são 100% puros/deps-injetadas — testados
// sem tocar filesystem real (mesmo padrão de claude-executable.test.ts).
// readActiveProfileConfig/writeActiveProfileConfig tocam I/O real numa pasta
// temporária (mesmo padrão de project-config-store.test.ts).

const fakePathDeps = { homedir: () => 'C:\\Users\\fake-user' };

describe('slugifyProfileName (puro)', () => {
  it('kebab-case a partir de nome com espaços e maiúsculas', () => {
    expect(slugifyProfileName('Tecnologia Claude 4')).toBe('tecnologia-claude-4');
  });

  it('remove acentos', () => {
    expect(slugifyProfileName('Conta Compartilhada')).toBe('conta-compartilhada');
  });

  it('colapsa separadores repetidos e apara bordas', () => {
    expect(slugifyProfileName('  --Conta   B--  ')).toBe('conta-b');
  });

  it('nunca fica vazio (fallback "perfil")', () => {
    expect(slugifyProfileName('   ')).toBe('perfil');
    expect(slugifyProfileName('***')).toBe('perfil');
  });
});

describe('titleCaseFromSlug (puro)', () => {
  it('reconstrói um rótulo de exibição plausível a partir do slug', () => {
    expect(titleCaseFromSlug('tecnologia-claude-4')).toBe('Tecnologia Claude 4');
    expect(titleCaseFromSlug('spike-test')).toBe('Spike Test');
  });
});

describe('buildProfileCreationPlan (puro)', () => {
  it('monta o plano na ordem exata do spike: dir -> metadado -> 6 junctions -> 2 cópias -> bootstrap -> merge', () => {
    const plan = buildProfileCreationPlan('Tecnologia Claude 4', fakePathDeps);

    expect(plan.profile).toEqual({
      name: 'Tecnologia Claude 4',
      slug: 'tecnologia-claude-4',
      configDir: 'C:\\Users\\fake-user\\.claude-profiles\\tecnologia-claude-4',
      isPrimary: false,
    });

    const kinds = plan.steps.map((step) => step.kind);
    expect(kinds).toEqual([
      'ensureDir',
      'writeMetadata',
      'junction',
      'junction',
      'junction',
      'junction',
      'junction',
      'junction',
      'copyFile',
      'copyFile',
      'bootstrapClaudeJson',
      'mergeMcpServers',
    ]);
  });

  it('as 6 junctions cobrem exatamente PROFILE_LINK_DIRS, linkando pro ~/.claude real', () => {
    const plan = buildProfileCreationPlan('conta-b', fakePathDeps);
    const junctionSteps = plan.steps.filter((step) => step.kind === 'junction');

    expect(junctionSteps.map((step) => (step as { dirName: string }).dirName)).toEqual([...PROFILE_LINK_DIRS]);
    for (const step of junctionSteps) {
      const s = step as { dirName: string; linkPath: string; targetPath: string };
      expect(s.linkPath).toBe(join(plan.profile.configDir!, s.dirName));
      expect(s.targetPath).toBe(join('C:\\Users\\fake-user\\.claude', s.dirName));
    }
  });

  it('as 2 cópias cobrem exatamente PROFILE_COPY_FILES', () => {
    const plan = buildProfileCreationPlan('conta-b', fakePathDeps);
    const copySteps = plan.steps.filter((step) => step.kind === 'copyFile');
    expect(copySteps.map((step) => (step as { fileName: string }).fileName)).toEqual([...PROFILE_COPY_FILES]);
  });
});

describe('mergeMcpServersIntoProfile (puro — achado novo do spike, critério b)', () => {
  it('injeta mcpServers do global no perfil, preservando o resto do perfil intacto', () => {
    const profile = { oauthAccount: undefined, machineID: 'profile-machine', userID: 'profile-user', mcpServers: {} };
    const global = { oauthAccount: { email: 'x' }, machineID: 'global-machine', mcpServers: { taskdex: { url: 'x' }, slack: { url: 'y' } } };

    const merged = mergeMcpServersIntoProfile(profile, global);

    expect(merged.mcpServers).toEqual(global.mcpServers);
    expect(merged.machineID).toBe('profile-machine'); // identidade do PERFIL, nunca sobrescrita
    expect(merged.userID).toBe('profile-user');
    // Correção da auditoria do batch 4 (ciclo 1, achado [baixa]): trava por
    // escrito o invariante de segurança central do critério (b) — merge
    // NUNCA propaga oauthAccount/credencial do global pro perfil. Antes,
    // isso só era garantido por construção ({...profile, mcpServers:
    // global.mcpServers} nunca lê oauthAccount do global); sem esta
    // assertion, um refactor futuro do merge poderia introduzir o vazamento
    // sem quebrar nenhum teste.
    expect(merged.oauthAccount).toBeUndefined();
  });

  it('é no-op quando o global não tem mcpServers', () => {
    const profile = { machineID: 'profile-machine' };
    const global = { oauthAccount: { email: 'x' } };

    expect(mergeMcpServersIntoProfile(profile, global)).toEqual(profile);
  });

  it('sobrescreve um mcpServers antigo do perfil pelo do global (nunca faz union por chave)', () => {
    const profile = { mcpServers: { oldServer: { url: 'stale' } } };
    const global = { mcpServers: { taskdex: { url: 'fresh' } } };

    expect(mergeMcpServersIntoProfile(profile, global).mcpServers).toEqual({ taskdex: { url: 'fresh' } });
  });
});

/** Fake IO em memória — mesmo espírito do `fakeDeps` de claude-executable.test.ts, sem tocar filesystem/processo real. */
function fakeCreationIo(overrides: Partial<ProfileCreationIoDeps> = {}): {
  io: ProfileCreationIoDeps;
  calls: {
    mkdir: string[];
    writeFileText: { path: string; content: string }[];
    copyFile: { from: string; to: string }[];
    createJunction: { target: string; link: string }[];
    runBootstrapPrompt: string[];
    writeClaudeJson: { path: string; content: Record<string, unknown> }[];
  };
  existingPaths: Set<string>;
  claudeJsonStore: Map<string, Record<string, unknown>>;
} {
  const calls = {
    mkdir: [] as string[],
    writeFileText: [] as { path: string; content: string }[],
    copyFile: [] as { from: string; to: string }[],
    createJunction: [] as { target: string; link: string }[],
    runBootstrapPrompt: [] as string[],
    writeClaudeJson: [] as { path: string; content: Record<string, unknown> }[],
  };
  const existingPaths = new Set<string>();
  const claudeJsonStore = new Map<string, Record<string, unknown>>();

  const io: ProfileCreationIoDeps = {
    existsSync: (path) => existingPaths.has(path),
    mkdirSync: (path) => {
      calls.mkdir.push(path);
      existingPaths.add(path);
    },
    writeFileText: (path, content) => {
      calls.writeFileText.push({ path, content });
      existingPaths.add(path);
    },
    copyFile: (sourcePath, destPath) => {
      calls.copyFile.push({ from: sourcePath, to: destPath });
      existingPaths.add(destPath);
    },
    createJunction: (targetPath, linkPath) => {
      calls.createJunction.push({ target: targetPath, link: linkPath });
      existingPaths.add(linkPath);
    },
    runBootstrapPrompt: (configDir) => {
      calls.runBootstrapPrompt.push(configDir);
      return Promise.resolve();
    },
    readClaudeJson: (path) => claudeJsonStore.get(path) ?? null,
    writeClaudeJson: (path, content) => {
      calls.writeClaudeJson.push({ path, content });
      claudeJsonStore.set(path, content);
    },
    globalClaudeJsonPath: 'C:\\Users\\fake-user\\.claude.json',
    ...overrides,
  };

  return { io, calls, existingPaths, claudeJsonStore };
}

describe('executeProfileCreationPlan (I/O injetada, fake — async: ver comentário de topo sobre não travar o event loop do main)', () => {
  it('roda todos os passos na ordem, criando dir + metadado + 6 junctions + 2 cópias + bootstrap', async () => {
    const { io, calls, existingPaths } = fakeCreationIo();
    existingPaths.add('C:\\Users\\fake-user\\.claude\\settings.json');
    existingPaths.add('C:\\Users\\fake-user\\.claude\\CLAUDE.md');

    const plan = buildProfileCreationPlan('conta-b', fakePathDeps);
    await executeProfileCreationPlan(plan, io);

    expect(calls.mkdir).toEqual([plan.profile.configDir]);
    expect(calls.writeFileText[0]).toEqual({
      path: join(plan.profile.configDir!, '.donel-profile.json'),
      content: JSON.stringify({ name: 'conta-b' }, null, 2),
    });
    expect(calls.createJunction).toHaveLength(6);
    expect(calls.copyFile).toHaveLength(2);
    expect(calls.runBootstrapPrompt).toEqual([plan.profile.configDir]);
  });

  it('pula uma junction que já existe (não recria por cima)', async () => {
    const { io, calls, existingPaths } = fakeCreationIo();
    const plan = buildProfileCreationPlan('conta-b', fakePathDeps);
    const firstLink = (plan.steps.find((s) => s.kind === 'junction') as { linkPath: string }).linkPath;
    existingPaths.add(firstLink);

    await executeProfileCreationPlan(plan, io);

    expect(calls.createJunction.some((c) => c.link === firstLink)).toBe(false);
    expect(calls.createJunction).toHaveLength(5); // as outras 5 continuam sendo criadas
  });

  it('não copia um arquivo cuja fonte não existe (settings.json/CLAUDE.md ausentes no global)', async () => {
    const { io, calls } = fakeCreationIo(); // nenhum path pré-existente
    await executeProfileCreationPlan(buildProfileCreationPlan('conta-b', fakePathDeps), io);

    expect(calls.copyFile).toHaveLength(0);
  });

  it('merge de mcpServers: injeta o mcpServers do global no .claude.json do perfil após o bootstrap', async () => {
    const { io, calls, claudeJsonStore } = fakeCreationIo();
    const plan = buildProfileCreationPlan('conta-b', fakePathDeps);

    // Simula o bootstrap real do CLI (spike seção 4/5): ao rodar, o `.claude.json`
    // do perfil passa a existir com identidade própria, SEM mcpServers.
    claudeJsonStore.set(join(plan.profile.configDir!, '.claude.json'), { machineID: 'profile-machine', userID: 'profile-user' });
    claudeJsonStore.set(io.globalClaudeJsonPath, { mcpServers: { taskdex: { url: 'x' } } });

    await executeProfileCreationPlan(plan, io);

    const finalWrite = calls.writeClaudeJson.at(-1);
    expect(finalWrite?.content).toEqual({
      machineID: 'profile-machine',
      userID: 'profile-user',
      mcpServers: { taskdex: { url: 'x' } },
    });
  });

  it('degrada com graça quando o bootstrap não gerou .claude.json (CA-5 — claude ausente): merge vira no-op, não lança', async () => {
    const { io, calls } = fakeCreationIo();
    const plan = buildProfileCreationPlan('conta-b', fakePathDeps);

    await expect(executeProfileCreationPlan(plan, io)).resolves.not.toThrow();
    expect(calls.writeClaudeJson).toHaveLength(0);
  });

  it('propaga um bootstrap lento sem travar (aguarda o Promise de runBootstrapPrompt de verdade, não dispara-e-esquece)', async () => {
    let resolveBootstrap: () => void = () => {};
    const bootstrapPromise = new Promise<void>((resolve) => {
      resolveBootstrap = resolve;
    });
    const bootstrapCalls: string[] = [];
    const { io } = fakeCreationIo({
      runBootstrapPrompt: (configDir) => {
        bootstrapCalls.push(configDir);
        return bootstrapPromise;
      },
    });
    const plan = buildProfileCreationPlan('conta-b', fakePathDeps);

    let settled = false;
    const execution = executeProfileCreationPlan(plan, io).then(() => {
      settled = true;
    });

    await Promise.resolve(); // deixa microtasks pendentes rodarem
    expect(bootstrapCalls).toEqual([plan.profile.configDir]); // bootstrap já foi chamado...
    expect(settled).toBe(false); // ...mas a execução ainda não terminou — está esperando o Promise de verdade

    resolveBootstrap();
    await execution;
    expect(settled).toBe(true);
  });
});

describe('createProfile (conveniência ponta-a-ponta)', () => {
  it('monta e executa o plano, devolvendo o ProfileInfo', async () => {
    const { io } = fakeCreationIo();
    const profile = await createProfile('Tecnologia Claude 9', fakePathDeps, io);
    expect(profile.slug).toBe('tecnologia-claude-9');
    expect(profile.isPrimary).toBe(false);
  });
});

describe('listProfiles (I/O injetada, fake)', () => {
  function fakeListDeps(overrides: Partial<ProfileListDeps> = {}): ProfileListDeps {
    return {
      homedir: () => 'C:\\Users\\fake-user',
      existsSync: () => true,
      readDirNames: () => [],
      readFileText: () => null,
      ...overrides,
    };
  }

  it('devolve só o Principal quando o diretório de perfis não existe', () => {
    const deps = fakeListDeps({ existsSync: () => false });
    expect(listProfiles(deps)).toEqual([PRINCIPAL_PROFILE]);
  });

  it('Principal sempre primeiro, seguido dos perfis em disco (ordem alfabética pelo nome de exibição)', () => {
    const deps = fakeListDeps({ readDirNames: () => ['zeta-account', 'alpha-account'] });
    const result = listProfiles(deps);

    expect(result[0]).toEqual(PRINCIPAL_PROFILE);
    expect(result.map((p) => p.name)).toEqual(['Principal', 'Alpha Account', 'Zeta Account']);
  });

  it('usa o nome do metadado (.donel-profile.json) quando presente; cai pro título derivado do slug quando ausente (ex.: spike-test, criado à mão)', () => {
    const deps = fakeListDeps({
      readDirNames: () => ['tecnologia-claude-4', 'spike-test'],
      readFileText: (path) =>
        path.endsWith('tecnologia-claude-4\\.donel-profile.json') ? JSON.stringify({ name: 'Tecnologia Claude 4' }) : null,
    });
    const result = listProfiles(deps);

    const byName = Object.fromEntries(result.map((p) => [p.slug, p.name]));
    expect(byName['tecnologia-claude-4']).toBe('Tecnologia Claude 4');
    expect(byName['spike-test']).toBe('Spike Test'); // fallback titleCaseFromSlug
  });

  it('metadado corrompido cai pro fallback (nunca lança)', () => {
    const deps = fakeListDeps({ readDirNames: () => ['conta-b'], readFileText: () => '{ isso não é json' });
    expect(listProfiles(deps).find((p) => p.slug === 'conta-b')?.name).toBe('Conta B');
  });
});

describe('readActiveProfileConfig / writeActiveProfileConfig (I/O real em pasta temporária)', () => {
  let dir: string;
  let filePath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'donel-dev-active-profile-'));
    filePath = join(dir, 'nested', 'active-profile.json');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('default = Principal quando o arquivo não existe', () => {
    expect(readActiveProfileConfig(filePath)).toEqual({ activeSlug: 'principal' });
  });

  it('grava e relê, criando diretórios intermediários', () => {
    writeActiveProfileConfig(filePath, { activeSlug: 'tecnologia-claude-4' });
    expect(readActiveProfileConfig(filePath)).toEqual({ activeSlug: 'tecnologia-claude-4' });
  });

  it('cai no default se o JSON estiver corrompido', () => {
    writeActiveProfileConfig(filePath, { activeSlug: 'tecnologia-claude-4' });
    writeFileSync(filePath, '{ isso não é json', 'utf8');
    expect(readActiveProfileConfig(filePath)).toEqual({ activeSlug: 'principal' });
  });

  it('cai no default se activeSlug vier vazio/ausente (JSON válido, campo inválido)', () => {
    const emptyFieldPath = join(dir, 'empty.json'); // `dir` já existe (mkdtempSync no beforeEach) — sem diretório intermediário aqui.
    writeFileSync(emptyFieldPath, '{}', 'utf8');
    expect(readActiveProfileConfig(emptyFieldPath)).toEqual({ activeSlug: 'principal' });
  });
});

describe('normalizeWindowsPath (puro)', () => {
  it('remove o prefixo de long-path \\\\?\\ e ignora case', () => {
    expect(normalizeWindowsPath('\\\\?\\C:\\Users\\x\\.claude\\skills')).toBe(normalizeWindowsPath('C:\\Users\\x\\.claude\\SKILLS'));
  });
});

describe('hasMcpServersDrift (puro)', () => {
  it('false quando o global não tem mcpServers (nada a exigir)', () => {
    expect(hasMcpServersDrift(null, {})).toBe(false);
    expect(hasMcpServersDrift({}, { mcpServers: {} })).toBe(false);
  });

  it('true quando o global tem servers e o perfil não', () => {
    expect(hasMcpServersDrift(null, { mcpServers: { taskdex: {} } })).toBe(true);
    expect(hasMcpServersDrift({ mcpServers: {} }, { mcpServers: { taskdex: {} } })).toBe(true);
  });

  it('false quando ambos têm servers configurados', () => {
    expect(hasMcpServersDrift({ mcpServers: { taskdex: {} } }, { mcpServers: { taskdex: {} } })).toBe(false);
  });
});

describe('runProfileDoctor (I/O injetada, fake)', () => {
  const claudeHome = 'C:\\Users\\fake-user\\.claude';
  const profile: ProfileInfo = {
    name: 'Conta B',
    slug: 'conta-b',
    configDir: 'C:\\Users\\fake-user\\.claude-profiles\\conta-b',
    isPrimary: false,
  };

  function fakeDoctorDeps(overrides: Partial<ProfileDoctorDeps> = {}): ProfileDoctorDeps {
    return {
      linkEntryExists: () => true,
      existsSync: () => true,
      readJunctionTarget: (linkPath) => {
        const dirName = linkPath.split('\\').pop()!;
        return join(claudeHome, dirName);
      },
      readClaudeJson: () => ({}),
      globalClaudeJsonPath: 'C:\\Users\\fake-user\\.claude.json',
      ...overrides,
    };
  }

  it('Principal é sempre saudável (não é isolado por junctions)', () => {
    const report = runProfileDoctor(PRINCIPAL_PROFILE, claudeHome, fakeDoctorDeps());
    expect(report).toEqual({ slug: 'principal', junctionIssues: [], settingsMissing: false, claudeMdMissing: false, mcpServersDrift: false, healthy: true });
  });

  it('perfil saudável: todas as junctions corretas, settings/CLAUDE.md presentes, sem drift', () => {
    const report = runProfileDoctor(profile, claudeHome, fakeDoctorDeps());
    expect(report.healthy).toBe(true);
    expect(report.junctionIssues).toEqual([]);
  });

  it('detecta junction ausente', () => {
    const deps = fakeDoctorDeps({ linkEntryExists: (path) => !path.endsWith('skills') });
    const report = runProfileDoctor(profile, claudeHome, deps);
    expect(report.healthy).toBe(false);
    expect(report.junctionIssues).toEqual([{ dirName: 'skills', kind: 'missing' }]);
  });

  it('detecta junction com alvo errado (as outras 5 continuam corretas)', () => {
    const correctTarget = (linkPath: string): string => join(claudeHome, linkPath.split('\\').pop()!);
    const deps = fakeDoctorDeps({
      readJunctionTarget: (linkPath) => (linkPath.endsWith('plugins') ? 'C:\\lugar-errado' : correctTarget(linkPath)),
    });

    const report = runProfileDoctor(profile, claudeHome, deps);

    expect(report.junctionIssues).toEqual([
      { dirName: 'plugins', kind: 'wrong-target', actualTarget: 'C:\\lugar-errado', expectedTarget: join(claudeHome, 'plugins') },
    ]);
    expect(report.healthy).toBe(false);
  });

  it('detecta settings.json/CLAUDE.md ausentes', () => {
    const deps = fakeDoctorDeps({ existsSync: (path) => !path.endsWith('settings.json') && !path.endsWith('CLAUDE.md') });
    const report = runProfileDoctor(profile, claudeHome, deps);
    expect(report.settingsMissing).toBe(true);
    expect(report.claudeMdMissing).toBe(true);
    expect(report.healthy).toBe(false);
  });

  it('detecta drift de mcpServers (global com servers, perfil sem)', () => {
    const deps = fakeDoctorDeps({
      readClaudeJson: (path) => (path === 'C:\\Users\\fake-user\\.claude.json' ? { mcpServers: { taskdex: {} } } : {}),
    });
    const report = runProfileDoctor(profile, claudeHome, deps);
    expect(report.mcpServersDrift).toBe(true);
    expect(report.healthy).toBe(false);
  });
});

describe('repairProfileJunctions (I/O injetada, fake)', () => {
  const claudeHome = 'C:\\Users\\fake-user\\.claude';
  const profile: ProfileInfo = {
    name: 'Conta B',
    slug: 'conta-b',
    configDir: 'C:\\Users\\fake-user\\.claude-profiles\\conta-b',
    isPrimary: false,
  };

  function fakeRepairIo(overrides: Partial<ProfileRepairIoDeps> = {}): {
    io: ProfileRepairIoDeps;
    removed: string[];
    created: { target: string; link: string }[];
  } {
    const removed: string[] = [];
    const created: { target: string; link: string }[] = [];
    const io: ProfileRepairIoDeps = {
      linkEntryExists: () => true,
      removeJunction: (linkPath) => removed.push(linkPath),
      createJunction: (targetPath, linkPath) => created.push({ target: targetPath, link: linkPath }),
      ...overrides,
    };
    return { io, removed, created };
  }

  it('missing: recria sem tentar remover antes', () => {
    const { io, removed, created } = fakeRepairIo();
    const report = { slug: 'conta-b', junctionIssues: [{ dirName: 'skills', kind: 'missing' as const }], settingsMissing: false, claudeMdMissing: false, mcpServersDrift: false, healthy: false };

    repairProfileJunctions(profile, report, claudeHome, io);

    expect(removed).toEqual([]);
    expect(created).toEqual([{ target: join(claudeHome, 'skills'), link: join(profile.configDir!, 'skills') }]);
  });

  it('wrong-target: remove o link antigo antes de recriar', () => {
    const { io, removed, created } = fakeRepairIo();
    const report = {
      slug: 'conta-b',
      junctionIssues: [{ dirName: 'plugins', kind: 'wrong-target' as const, actualTarget: 'C:\\errado', expectedTarget: join(claudeHome, 'plugins') }],
      settingsMissing: false,
      claudeMdMissing: false,
      mcpServersDrift: false,
      healthy: false,
    };

    repairProfileJunctions(profile, report, claudeHome, io);

    expect(removed).toEqual([join(profile.configDir!, 'plugins')]);
    expect(created).toEqual([{ target: join(claudeHome, 'plugins'), link: join(profile.configDir!, 'plugins') }]);
  });

  it('Principal — no-op (não é isolado por junctions)', () => {
    const { io, removed, created } = fakeRepairIo();
    repairProfileJunctions(PRINCIPAL_PROFILE, { slug: 'principal', junctionIssues: [], settingsMissing: false, claudeMdMissing: false, mcpServersDrift: false, healthy: true }, claudeHome, io);
    expect(removed).toEqual([]);
    expect(created).toEqual([]);
  });
});

describe('profileDirPath (puro)', () => {
  it('junta o root de perfis com o slug', () => {
    expect(profileDirPath('conta-b', fakePathDeps)).toBe('C:\\Users\\fake-user\\.claude-profiles\\conta-b');
  });
});

// ---------------------------------------------------------------------------
// Item 3 (rodada de feedback 30/07) — "excluir um perfil, não apenas
// adicionar". REGRAS DURAS: nunca o Principal, nunca o perfil ATIVO. O
// ACHADO da junction (spike + CLAUDE.md gotcha): `~/.claude-profiles/<slug>/
// projects` pode ser junction pro `~/.claude/projects` GLOBAL — remover o
// perfil precisa desfazer a junction com `rmdir` (não recursivo NO ALVO,
// só no reparse point), nunca seguir o link apagando o conteúdo apontado.
// ---------------------------------------------------------------------------

describe('canDeleteProfile (puro)', () => {
  const contaB: ProfileInfo = { name: 'Conta B', slug: 'conta-b', configDir: 'C:\\perfis\\conta-b', isPrimary: false };

  it('perfil comum, não ativo: ok', () => {
    expect(canDeleteProfile(contaB, 'outro-slug')).toEqual({ ok: true });
  });

  it('Principal: nunca — mesmo se "ativo" viria de outro slug', () => {
    expect(canDeleteProfile(PRINCIPAL_PROFILE, 'outro-slug')).toEqual({ ok: false, reason: 'is-primary' });
  });

  it('perfil ATIVO (mesmo não-Principal): nunca — troque antes de excluir', () => {
    expect(canDeleteProfile(contaB, 'conta-b')).toEqual({ ok: false, reason: 'is-active' });
  });

  it('perfil inexistente (undefined): not-found', () => {
    expect(canDeleteProfile(undefined, 'conta-b')).toEqual({ ok: false, reason: 'not-found' });
  });

  it('Principal ativo E Principal — is-primary vence (checagem mais forte primeiro)', () => {
    expect(canDeleteProfile(PRINCIPAL_PROFILE, PRINCIPAL_PROFILE_SLUG)).toEqual({ ok: false, reason: 'is-primary' });
  });
});

describe('deleteProfileDirectory (I/O injetada, fake)', () => {
  const profile: ProfileInfo = { name: 'Conta B', slug: 'conta-b', configDir: 'C:\\perfis\\conta-b', isPrimary: false };

  function fakeDeletionIo(overrides: Partial<ProfileDeletionIoDeps> = {}): {
    io: ProfileDeletionIoDeps;
    removedJunctions: string[];
    removedDirs: string[];
  } {
    const removedJunctions: string[] = [];
    const removedDirs: string[] = [];
    const io: ProfileDeletionIoDeps = {
      linkEntryExists: () => true,
      removeJunction: (linkPath) => removedJunctions.push(linkPath),
      removeDirRecursive: (path) => removedDirs.push(path),
      ...overrides,
    };
    return { io, removedJunctions, removedDirs };
  }

  it('remove as 6 junctions ANTES do resto do diretório — nunca através do link', () => {
    const { io, removedJunctions, removedDirs } = fakeDeletionIo();
    deleteProfileDirectory(profile, io);

    expect(removedJunctions).toEqual(PROFILE_LINK_DIRS.map((dirName) => join(profile.configDir!, dirName)));
    expect(removedDirs).toEqual([profile.configDir]);
  });

  it('junction ausente (já quebrada/removida): pula o removeJunction daquela, segue pras outras', () => {
    const { io, removedJunctions } = fakeDeletionIo({
      linkEntryExists: (path) => !path.endsWith('skills'),
    });
    deleteProfileDirectory(profile, io);
    expect(removedJunctions.some((path) => path.endsWith('skills'))).toBe(false);
    expect(removedJunctions).toHaveLength(PROFILE_LINK_DIRS.length - 1);
  });

  it('Principal (sem configDir): no-op — nunca chama nenhuma I/O de remoção', () => {
    const { io, removedJunctions, removedDirs } = fakeDeletionIo();
    deleteProfileDirectory(PRINCIPAL_PROFILE, io);
    expect(removedJunctions).toEqual([]);
    expect(removedDirs).toEqual([]);
  });
});

describe('deleteProfile (orquestração — guarda + deleção, I/O injetada fake)', () => {
  const contaB: ProfileInfo = { name: 'Conta B', slug: 'conta-b', configDir: 'C:\\perfis\\conta-b', isPrimary: false };
  const profiles = [PRINCIPAL_PROFILE, contaB];

  function fakeDeletionIo(): { io: ProfileDeletionIoDeps; removedDirs: string[] } {
    const removedDirs: string[] = [];
    const io: ProfileDeletionIoDeps = {
      linkEntryExists: () => true,
      removeJunction: () => undefined,
      removeDirRecursive: (path) => removedDirs.push(path),
    };
    return { io, removedDirs };
  }

  it('perfil comum, não ativo: exclui de fato', () => {
    const { io, removedDirs } = fakeDeletionIo();
    const result = deleteProfile('conta-b', 'principal', profiles, io);
    expect(result).toEqual({ ok: true });
    expect(removedDirs).toEqual(['C:\\perfis\\conta-b']);
  });

  it('bloqueia o Principal SEM tocar disco', () => {
    const { io, removedDirs } = fakeDeletionIo();
    const result = deleteProfile('principal', 'conta-b', profiles, io);
    expect(result).toEqual({ ok: false, reason: 'is-primary' });
    expect(removedDirs).toEqual([]);
  });

  it('bloqueia o perfil ATIVO SEM tocar disco', () => {
    const { io, removedDirs } = fakeDeletionIo();
    const result = deleteProfile('conta-b', 'conta-b', profiles, io);
    expect(result).toEqual({ ok: false, reason: 'is-active' });
    expect(removedDirs).toEqual([]);
  });

  it('slug inexistente: not-found, sem tocar disco', () => {
    const { io, removedDirs } = fakeDeletionIo();
    const result = deleteProfile('fantasma', 'principal', profiles, io);
    expect(result).toEqual({ ok: false, reason: 'not-found' });
    expect(removedDirs).toEqual([]);
  });
});

describe('createSystemProfileDeletionIoDeps — integração com JUNCTION REAL em pasta temporária (prova crítica: exclusão não segue o link)', () => {
  let tmpRoot: string;
  let globalTarget: string; // simula ~/.claude/projects GLOBAL — NUNCA pode ser tocado
  let profileConfigDir: string; // simula ~/.claude-profiles/<slug>

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'donel-dev-profile-delete-'));
    globalTarget = join(tmpRoot, 'claude-home', 'projects');
    profileConfigDir = join(tmpRoot, 'claude-profiles', 'conta-b');
    mkdirSync(globalTarget, { recursive: true });
    mkdirSync(profileConfigDir, { recursive: true });

    // Conteúdo GLOBAL real — se a exclusão seguisse a junction e apagasse o
    // ALVO em vez do link, este arquivo desapareceria (é exatamente o que o
    // achado do spike/CLAUDE.md gotcha manda nunca acontecer).
    writeFileSync(join(globalTarget, 'sessao-real-do-usuario.jsonl'), '{"transcript":"nao pode sumir"}', 'utf8');

    // A junction de verdade — mesmo `fs.symlinkSync(target, path, 'junction')`
    // do gotcha documentado (não pede admin no Windows).
    symlinkSync(globalTarget, join(profileConfigDir, 'projects'), 'junction');

    // Um arquivo comum do perfil (não-junction) — prova que o resto do
    // diretório É removido normalmente.
    writeFileSync(join(profileConfigDir, 'settings.json'), '{}', 'utf8');
  });

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('remove o perfil (junction + resto do diretório) SEM apagar o conteúdo do ALVO da junction', () => {
    const profile: ProfileInfo = { name: 'Conta B', slug: 'conta-b', configDir: profileConfigDir, isPrimary: false };
    const io = createSystemProfileDeletionIoDeps();

    deleteProfileDirectory(profile, io);

    // O diretório do PERFIL sumiu inteiro (junction + settings.json).
    expect(existsSync(profileConfigDir)).toBe(false);

    // O ALVO da junction (o "global" simulado) e o arquivo dentro dele
    // continuam INTACTOS — a prova de que a remoção nunca seguiu o link.
    expect(existsSync(globalTarget)).toBe(true);
    expect(existsSync(join(globalTarget, 'sessao-real-do-usuario.jsonl'))).toBe(true);
    expect(readdirSync(globalTarget)).toEqual(['sessao-real-do-usuario.jsonl']);
  });

  it('sanity check da junction ANTES da exclusão — prova que o setup do teste é uma junction de verdade', () => {
    const linkPath = join(profileConfigDir, 'projects');
    const stat = lstatSync(linkPath);
    expect(stat.isSymbolicLink() || stat.isDirectory()).toBe(true); // reparse point Windows: lstat não marca isSymbolicLink() sempre, mas é distinto do alvo
    expect(existsSync(join(linkPath, 'sessao-real-do-usuario.jsonl'))).toBe(true); // através do link, o conteúdo é visível (prova que é a MESMA pasta)
  });
});
