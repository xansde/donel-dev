import { Button, Select, SegmentedControl, TextInput, Toggle } from '@donel-dev/design-system';
import type { SegmentedControlOption, SelectOption } from '@donel-dev/design-system';
import { useEffect, useState } from 'react';
import type { ProjectInfo, ProviderSummaryDto } from '../../shared';
import type { EffortLevel, ModelAlias, PermissionMode } from '../../shared/commandBuilder';
import type { SessionRole } from '../../shared/roles';
import { ProviderPicker } from './ProviderPicker';
import styles from './Launcher.module.css';

// T008 — Launcher real (ui-spec §4, FR-003, CA-1). Este componente só
// coleta o estado dos controles e devolve as opções resolvidas via
// `onLaunch` — quem chama `buildClaudeArgs` e abre a aba é o App.tsx, para
// o CommandBuilder (T006) continuar puro/sem I/O e 100% coberto por vitest
// sem precisar simular DOM aqui (ui-spec/tasks.md: PTY/UI validam por smoke).

const MODEL_OPTIONS: SegmentedControlOption[] = [
  { value: 'fable', label: 'fable' },
  { value: 'opus', label: 'opus' },
  { value: 'sonnet', label: 'sonnet' },
  { value: 'haiku', label: 'haiku' },
];

// Rótulo "med" só por densidade visual (fidelidade ao Brief 3 do design
// reference) — o value continua "medium", o alias que o CommandBuilder/CLI
// realmente espera (FR-003, EffortLevel).
const EFFORT_OPTIONS: SegmentedControlOption[] = [
  { value: 'low', label: 'low' },
  { value: 'medium', label: 'med' },
  { value: 'high', label: 'high' },
  { value: 'xhigh', label: 'xhigh' },
  { value: 'max', label: 'max' },
];

// Mesmos rótulo/descrição do Brief 3 (design reference), que já batem com
// a tabela FR-003/PermissionMode.
const PERMISSION_OPTIONS: SelectOption[] = [
  { value: 'manual', label: 'manual', description: 'pede confirmação a cada ação' },
  { value: 'acceptEdits', label: 'acceptEdits', description: 'aceita edições de arquivo automaticamente' },
  { value: 'auto', label: 'auto', description: 'roda ferramentas sem confirmar' },
  { value: 'plan', label: 'plan', description: 'só planeja, não executa' },
  { value: 'dontAsk', label: 'dontAsk', description: 'não pergunta, mas respeita bloqueios' },
  { value: 'bypassPermissions', label: 'bypassPermissions', description: 'ignora todas as barreiras (cuidado)' },
];

// Defaults do Brief 3 (design reference): fable/high/acceptEdits — mesmo
// ponto de partida do ConfigStore (T015, config-store.ts
// `DEFAULT_LAUNCHER_DEFAULTS`) até o primeiro "▶ Iniciar" real persistir uma
// escolha diferente (fallback só pra quando `launcherDefaults` ainda não
// chegou do main process, ex. primeiro paint antes do `config:get` resolver).
const DEFAULT_MODEL: ModelAlias = 'fable';
const DEFAULT_EFFORT: EffortLevel = 'high';
const DEFAULT_PERMISSION: PermissionMode = 'acceptEdits';

export interface LauncherLaunchOptions {
  model: ModelAlias;
  effort: EffortLevel;
  permissionMode: PermissionMode;
  /** Já trim()ado; string vazia = flag `-n` omitida (FR-003, "nome vazio = ok"). */
  sessionName: string;
  projectPath: string;
  projectName: string;
  /**
   * T1320 (011-contas-e-provedores, etapa 3, C13) — provider classe A
   * escolhido nesta sessão; `null` = "Claude (conta)" (comportamento de
   * hoje). Mutuamente exclusivo com o motor de contas (D2).
   */
  providerId: string | null;
  /** "Isolar em worktree" → `--worktree <nome>` (o nome é escolhido por quem lança, no App). */
  worktree: boolean;
  /** Papéis de sessão (item 12a) — role of the session; `null` = no role. */
  roleId: string | null;
}

export interface LauncherProps {
  /** Lista de projetos conhecidos (sidebar) — alimenta o seletor "Projeto-alvo". */
  projects: ProjectInfo[];
  /** Herdado da seleção da sidebar (ui-spec §4); o campo abaixo continua editável depois. */
  defaultProjectPath?: string;
  /** T015 (FR-007 "defaults do launcher") — última escolha persistida no ConfigStore; `undefined` até `config:get` resolver (cai nos `DEFAULT_*` locais). */
  launcherDefaults?: { model: ModelAlias; effort: EffortLevel; permissionMode: PermissionMode; worktree?: boolean };
  /** T1320 — registry de providers classe A; `[]` = campo "Provedor" nem aparece (C14/D6). */
  providers?: readonly ProviderSummaryDto[];
  /** Papéis de sessão (item 12a) — `[]` = the "Papel" field does not show. */
  roles?: readonly SessionRole[];
  /** Item 12b — "Papéis…": the screen to create and edit roles. */
  onManageRoles?: () => void;
  onLaunch: (options: LauncherLaunchOptions) => void;
}

const NO_ROLE = '';

export function Launcher({ projects, defaultProjectPath, launcherDefaults, providers = [], roles = [], onManageRoles, onLaunch }: LauncherProps): React.JSX.Element {
  const [roleId, setRoleId] = useState<string>(NO_ROLE);
  const [model, setModel] = useState<ModelAlias>(launcherDefaults?.model ?? DEFAULT_MODEL);
  const [effort, setEffort] = useState<EffortLevel>(launcherDefaults?.effort ?? DEFAULT_EFFORT);
  const [permissionMode, setPermissionMode] = useState<PermissionMode>(launcherDefaults?.permissionMode ?? DEFAULT_PERMISSION);
  const [worktree, setWorktree] = useState<boolean>(launcherDefaults?.worktree === true);
  const [sessionName, setSessionName] = useState('');
  const [projectPath, setProjectPath] = useState(defaultProjectPath ?? '');
  // T1320 (C13) — `null` = "Claude (conta)"; provider selecionado desabilita
  // modelo/esforço (C18/D7, a flag não existe fora da assinatura Anthropic).
  const [providerId, setProviderId] = useState<string | null>(null);
  const hasProvider = providerId !== null;

  // "Herdado da seleção da sidebar": cada nova seleção reflete aqui — mas
  // só até o próximo clique na sidebar; edições manuais no meio-tempo não
  // são sobrescritas (o efeito só dispara quando o valor herdado muda).
  useEffect(() => {
    setProjectPath(defaultProjectPath ?? '');
  }, [defaultProjectPath]);

  const projectOptions: SelectOption[] = projects.map((project) => ({
    value: project.path,
    label: project.name,
  }));
  const selectedProject = projects.find((project) => project.path === projectPath);
  const canLaunch = projectPath.trim().length > 0;

  const handleLaunch = (): void => {
    if (!canLaunch) return;
    onLaunch({
      model,
      effort,
      permissionMode,
      sessionName: sessionName.trim(),
      projectPath,
      projectName: selectedProject?.name ?? projectPath,
      providerId,
      worktree,
      roleId: roleId === NO_ROLE ? null : roleId,
    });
  };

  // Item 12a — picking a role fills its suggestions in; every field stays editable afterwards.
  const pickRole = (next: string): void => {
    setRoleId(next);
    const role = roles.find((candidate) => candidate.id === next);
    if (!role) return;
    if (role.model) setModel(role.model);
    if (role.effort) setEffort(role.effort);
    if (role.permissionMode) setPermissionMode(role.permissionMode);
    setProviderId(role.engine && providers.some((provider) => provider.id === role.engine) ? role.engine : null);
  };
  const roleOptions: SelectOption[] = [
    { value: NO_ROLE, label: 'Sem papel' },
    ...roles.map((role) => ({ value: role.id, label: role.name })),
  ];

  return (
    <div className={styles.launcher} data-testid="launcher">
      <h2 className={styles.sectionTitle}>Lançar sessão</h2>

      {roles.length > 0 ? (
        <div className={styles.field}>
          <Select label="Papel" value={roleId} options={roleOptions} onChange={pickRole} />
          {onManageRoles ? (
            <Button variant="ghost" onClick={onManageRoles}>
              Papéis…
            </Button>
          ) : null}
        </div>
      ) : null}

      <ProviderPicker providers={providers} value={providerId} onChange={setProviderId} />

      <div className={styles.field}>
        <span className={styles.label}>Modelo</span>
        <SegmentedControl
          options={MODEL_OPTIONS}
          value={model}
          onChange={(value) => setModel(value as ModelAlias)}
          ariaLabel="Modelo"
          disabled={hasProvider}
        />
        {hasProvider ? <span className={styles.label}>Vem da configuração do provedor.</span> : null}
      </div>

      <div className={styles.field}>
        <span className={styles.label}>Esforço</span>
        <SegmentedControl
          options={EFFORT_OPTIONS}
          value={effort}
          onChange={(value) => setEffort(value as EffortLevel)}
          ariaLabel="Esforço"
          disabled={hasProvider}
        />
      </div>

      <Select
        label="Permissões"
        value={permissionMode}
        options={PERMISSION_OPTIONS}
        onChange={(value) => setPermissionMode(value as PermissionMode)}
      />

      <Toggle
        label="Isolar em worktree"
        description="Cópia própria do repositório em .claude/worktrees (--worktree). Ao fechar a aba, some sozinha se não tiver trabalho pendente."
        checked={worktree}
        onChange={setWorktree}
      />

      <TextInput
        label="Nome"
        placeholder="opcional"
        value={sessionName}
        onChange={(event) => setSessionName(event.target.value)}
      />

      <div className={styles.field}>
        <span className={styles.label}>Projeto-alvo</span>
        <Select
          value={projectPath}
          options={projectOptions}
          onChange={setProjectPath}
          placeholder="Selecione um projeto"
        />
      </div>

      <Button variant="primary" fullWidth onClick={handleLaunch} disabled={!canLaunch}>
        ▶ Iniciar
      </Button>
    </div>
  );
}
