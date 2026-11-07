// Cadeiras, fatia 2 — the chair screen (prototype B1, owner 06/11: "Coluna lateral de custo deve ser colapsavel. Mas
// é disparado o melhor"), READ-ONLY in this slice: a chair today is a role on a board, so the screen shows what the
// role gives a session at birth, each line with where it comes from, and the estimated cost in a column that folds
// (remembered on this machine). Saving through this screen is the next slice; for now "Editar em Papéis ▸".

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { addScopeMcp, chairSheet, escapeClosesChairScreen, setScopeAll, setScopeItem, type ScopeAxisName, COST_PER_MCP_MB, COST_PER_MCP_TOKENS, COST_PER_PLUGIN_TOKENS, COST_PER_SKILL_TOKENS, BASE_SESSION_MB, type SheetAxis, type SheetItem, type SheetOrigin } from '../../shared/chair-sheet';
import { EMPTY_INVENTORY, type ClaudeInventory } from '../../shared/role-scope';
import { MAX_ROLE_GUIDANCE_CHARS, roleColorVar, type SessionRole } from '../../shared/roles';
import type { MindscapeBoard } from '../../shared/mindscape/model';
import styles from './ChairScreen.module.css';

const COLLAPSED_KEY = 'donel.chair.costCollapsed';

function readCollapsed(): boolean {
  try {
    return window.localStorage.getItem(COLLAPSED_KEY) === '1';
  } catch {
    return false;
  }
}

function writeCollapsed(collapsed: boolean): void {
  try {
    window.localStorage.setItem(COLLAPSED_KEY, collapsed ? '1' : '0');
  } catch {
    // No storage: the column state lasts only this visit.
  }
}

const ORIGIN_LABEL: Readonly<Record<SheetOrigin, string>> = { donel: 'Donel', papel: 'Papel', usuario: 'Seu ~/.claude' };

function tokensLabel(tokens: number): string {
  return tokens >= 1000 ? `${(tokens / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}k tok` : `${tokens} tok`;
}

function memoryLabel(mb: number): string {
  return mb >= 1000 ? `${(mb / 1024).toLocaleString('pt-BR', { maximumFractionDigits: 2 })} GB` : `${mb} MB`;
}

/** `Donel Dev` → `donel-dev`: the board's part of a chair address. */
function addressSlug(name: string): string {
  return (
    name
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'quadro'
  );
}

function Seal({ origin }: { origin: SheetOrigin }): React.JSX.Element {
  return <span className={`${styles.seal} ${styles[`o-${origin}`]}`}>{ORIGIN_LABEL[origin]}</span>;
}

export interface ChairScreenProps {
  readonly roles: readonly SessionRole[];
  readonly roleId: string;
  readonly projectPath?: string;
  readonly projectName?: string;
  /** The board of the project: the chairs in the left column are the roles that sit on it. */
  readonly board?: MindscapeBoard;
  readonly onPick: (roleId: string) => void;
  readonly onEditRole: (roleId: string) => void;
  readonly onClose: () => void;
  /** Cadeiras, fatia 3 — the list after a save through this screen. */
  readonly onSaved: (roles: SessionRole[]) => void;
}

const MODEL_CHOICES = ['opus', 'sonnet', 'haiku', 'fable'] as const;
const EFFORT_CHOICES = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
const PERMISSION_CHOICES = ['manual', 'acceptEdits', 'auto', 'plan', 'dontAsk', 'bypassPermissions'] as const;

/** Same role, field by field (the draft against what is saved). */
function sameRole(a: SessionRole, b: SessionRole): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

const SECTIONS = [
  ['instrucoes', 'Instruções'],
  ['skills', 'Skills'],
  ['mcps', 'MCPs'],
  ['plugins', 'Plugins'],
  ['modelo', 'Modelo e esforço'],
] as const;

export function ChairScreen({ roles, roleId, projectPath, projectName, board, onPick, onEditRole, onClose, onSaved }: ChairScreenProps): React.JSX.Element {
  const [inventory, setInventory] = useState<ClaudeInventory | null>(null);
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const sectionRef = useRef<HTMLElement>(null);
  useEffect(() => {
    let alive = true;
    void window.donel.roles
      .inventory(projectPath)
      .then((next) => {
        if (alive) setInventory(next);
      })
      .catch(() => {
        if (alive) setInventory(EMPTY_INVENTORY);
      });
    return () => {
      alive = false;
    };
  }, [projectPath]);
  useEffect(() => {
    sectionRef.current?.focus({ preventScroll: true });
  }, []);
  // Esc is heard on the window: a button that folds away ("Recolher ›", "mostrar os N desligados") drops the focus on
  // the page, out of the screen. A dialog over it (Papéis) keeps its own Esc.
  const closeRef = useRef(onClose);
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const active = document.activeElement;
      const close = escapeClosesChairScreen({
        key: event.key,
        defaultPrevented: event.defaultPrevented,
        focusInScreen: Boolean(active && sectionRef.current?.contains(active)),
        focusOnPage: !active || active === document.body,
      });
      if (!close) return;
      event.preventDefault();
      closeRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const savedRole = roles.find((candidate) => candidate.id === roleId);
  // Cadeiras, fatia 3 — the edits live in a draft of the role until "Salvar"; the cost follows the draft.
  const [draft, setDraft] = useState<{ readonly id: string; readonly role: SessionRole; readonly dropped: readonly string[] } | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [mcpName, setMcpName] = useState('');
  const liveDraft = draft && draft.id === roleId ? draft : null;
  const role = liveDraft?.role ?? savedRole;
  const dirty = Boolean(liveDraft && savedRole && !sameRole(liveDraft.role, savedRole));
  const edit = (change: (current: SessionRole) => SessionRole, dropped?: (current: readonly string[]) => readonly string[]): void => {
    if (!role) return;
    const next = change(role);
    setDraft({ id: roleId, role: next, dropped: dropped ? dropped(liveDraft?.dropped ?? []) : (liveDraft?.dropped ?? []) });
    setSaveError(null);
  };
  const discard = (): void => {
    setDraft(null);
    setSaveError(null);
  };
  /** Leaving with unsaved edits asks first (another chair, ✕ or Esc). */
  const leaveOk = (): boolean => !dirty || window.confirm(`Descartar as mudanças em ${role?.name ?? 'esta cadeira'}?`);
  const save = async (): Promise<void> => {
    if (!liveDraft || saving) return;
    setSaving(true);
    const result = await window.donel.roles.save(liveDraft.role).catch(() => null);
    setSaving(false);
    if (!result || !result.ok) {
      setSaveError('Não foi possível salvar o papel.');
      return;
    }
    onSaved(result.roles);
    setDraft(null);
  };
  const toggle = (axis: ScopeAxisName, name: string, on: boolean): void => {
    edit(
      (current) => setScopeItem(current, axis, name, on, inventory ?? EMPTY_INVENTORY),
      axis === 'mcps' ? (dropped) => (on ? dropped.filter((entry) => entry !== name) : [...dropped, name]) : undefined,
    );
  };
  const rigName = projectName ?? 'Sem projeto';
  const placeCounts = new Map<string, number>();
  for (const card of Object.values(board?.cards ?? {})) {
    if (card.kind === 'session' && card.roleId) placeCounts.set(card.roleId, (placeCounts.get(card.roleId) ?? 0) + 1);
  }
  const chairsOfRig = roles.filter((candidate) => placeCounts.has(candidate.id));
  const otherRoles = roles.filter((candidate) => !placeCounts.has(candidate.id));
  const inv = inventory ?? EMPTY_INVENTORY;
  const sheet = role ? chairSheet(role, inv) : null;
  const global = role ? chairSheet({ ...role, scope: undefined }, inv) : null;
  const toggleCollapsed = (): void => {
    setCollapsed((current) => {
      writeCollapsed(!current);
      return !current;
    });
  };
  const goTo = (id: string): void => {
    sectionRef.current?.querySelector(`[data-section="${id}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  const sectionCount = (id: (typeof SECTIONS)[number][0]): string => {
    if (!sheet) return '';
    const axis = id === 'skills' ? sheet.skills : id === 'mcps' ? sheet.mcps : id === 'plugins' ? sheet.plugins : null;
    if (!axis) return id === 'instrucoes' ? String(sheet.guidance ? 2 : 1) : '';
    return axis.onCount === null ? 'todos' : `${axis.onCount}/${axis.items.length}`;
  };

  closeRef.current = () => {
    if (leaveOk()) onClose();
  };
  const chairRow = (candidate: SessionRole): React.JSX.Element => (
    <button
      key={candidate.id}
      type="button"
      className={candidate.id === roleId ? `${styles.treeRow} ${styles.treeRowOn}` : styles.treeRow}
      onClick={() => {
        if (candidate.id === roleId || !leaveOk()) return;
        discard();
        onPick(candidate.id);
      }}
    >
      <span className={styles.dot} style={{ background: roleColorVar(candidate.color) }} />
      <span>{candidate.name}</span>
      <span className={styles.muted}>{placeCounts.get(candidate.id) ?? ''}</span>
    </button>
  );

  return (
    <section
      ref={sectionRef}
      className={styles.screen}
      aria-label="Cadeira"
      data-testid="chair-screen"
      tabIndex={-1}
    >
      <header className={styles.crumbs}>
        <span>
          <b>Cadeiras</b> · Rig <b>{rigName}</b> › <b className={styles.mono}>{role ? `${role.id}@${addressSlug(rigName)}` : roleId}</b>
        </span>
        <button type="button" className={styles.close} onClick={() => closeRef.current()} aria-label="Fechar">
          ✕
        </button>
      </header>
      <div className={collapsed ? `${styles.body} ${styles.bodyCollapsed}` : styles.body}>
        <nav className={styles.tree} aria-label="Cadeiras">
          <h4>Cadeiras</h4>
          <div className={styles.treeRig}>
            <span className={styles.kind}>Rig</span> {rigName}
          </div>
          {chairsOfRig.map(chairRow)}
          {otherRoles.length > 0 ? (
            <>
              <h4>Papéis sem lugar neste quadro</h4>
              {otherRoles.map(chairRow)}
            </>
          ) : null}
        </nav>
        <nav className={styles.sections} aria-label="Seções">
          <h4>Seções</h4>
          {SECTIONS.map(([id, label]) => (
            <button key={id} type="button" className={styles.sectionRow} onClick={() => goTo(id)}>
              <span>{label}</span>
              <span className={styles.muted}>{sectionCount(id)}</span>
            </button>
          ))}
        </nav>
        <main className={styles.main}>
          {!role || !sheet ? (
            <p className={styles.muted}>Este papel não existe mais em Papéis.</p>
          ) : (
            <>
              <div className={styles.titleRow}>
                <span className={styles.dot} style={{ background: roleColorVar(role.color) }} />
                <h2>{role.name}</h2>
                <span className={styles.mono}>
                  {role.id}@{addressSlug(rigName)}
                </span>
                <span className={styles.kind}>Cadeira</span>
              </div>
              <p className={styles.lead}>
                Papel <b>{role.name}</b> sentado no rig <b>{rigName}</b>. Cada linha diz de onde vem.
              </p>
              <div className={dirty ? `${styles.banner} ${styles.bannerDirty}` : styles.banner}>
                <span>
                  {dirty ? <b>Mudanças não salvas. </b> : <b>Editando o papel {role.name}. </b>}
                  Salvar grava o papel: vale para todo lugar com o papel {role.name}.
                  {saveError ? <span className={styles.error}> {saveError}</span> : null}
                </span>
                <span className={styles.bannerActions}>
                  <button type="button" className={styles.button} onClick={() => onEditRole(role.id)} title="Nome, cor e motor">
                    Papéis ▸
                  </button>
                  <button type="button" className={styles.button} onClick={discard} disabled={!dirty || saving}>
                    Descartar
                  </button>
                  <button type="button" className={`${styles.button} ${styles.primary}`} onClick={() => void save()} disabled={!dirty || saving} data-testid="chair-save">
                    {saving ? 'Salvando…' : 'Salvar'}
                  </button>
                </span>
              </div>

              <section className={styles.card} data-section="instrucoes">
                <header className={styles.cardHead}>
                  <h3>Instruções iniciais</h3>
                  <span className={styles.muted}>o que a sessão lê ao nascer, nesta ordem</span>
                  <span className={styles.right}>{tokensLabel(sheet.frameTokens + sheet.guidanceTokens)}</span>
                </header>
                <div className={`${styles.layer} ${styles.layerDonel}`}>
                  <div className={styles.layerHead}>
                    <Seal origin="donel" />
                    <b>Moldura do Donel</b>
                    <span className={styles.right}>{tokensLabel(sheet.frameTokens)}</span>
                  </div>
                  <p className={styles.text}>{sheet.frame}</p>
                </div>
                <div className={`${styles.layer} ${styles.layerPapel}`}>
                  <div className={styles.layerHead}>
                    <Seal origin="papel" />
                    <b>Papel {role.name}</b>
                    <span className={styles.muted}>papel reutilizável</span>
                    <span className={styles.right}>{tokensLabel(sheet.guidanceTokens)}</span>
                  </div>
                  <textarea
                    className={styles.guidance}
                    value={role.guidance}
                    maxLength={MAX_ROLE_GUIDANCE_CHARS}
                    rows={Math.min(16, Math.max(4, role.guidance.split('\n').length + 1))}
                    placeholder="O que este papel faz, o que não faz e como entrega."
                    aria-label={`Orientação do papel ${role.name}`}
                    onChange={(event) => {
                      const guidance = event.target.value;
                      edit((current) => ({ ...current, guidance }));
                    }}
                  />
                </div>
                <div className={styles.stillRow}>
                  <span className={styles.muted}>Continuam valendo</span>
                  <span>
                    CLAUDE.md do projeto e o seu ~/.claude <span className={styles.muted}>(lidos pelo CLI, como hoje)</span>
                  </span>
                  <Seal origin="usuario" />
                  <span className={styles.muted}>fora do Donel</span>
                </div>
              </section>

              <AxisCard
                id="skills"
                title="Skills suas"
                hint="as suas, de ~/.claude/skills; as de plugin vão com o plugin"
                axis={sheet.skills}
                unit={COST_PER_SKILL_TOKENS}
                onToggle={(name, on) => toggle('skills', name, on)}
                onAll={() => edit((current) => setScopeAll(current, 'skills'))}
              />
              <AxisCard
                id="mcps"
                title="MCPs"
                hint="o donel fica sempre; os outros só se o papel nomear"
                axis={
                  sheet.mcps.mode === 'list'
                    ? { ...sheet.mcps, items: [...sheet.mcps.items, ...(liveDraft?.dropped ?? []).filter((name) => !sheet.mcps.items.some((item) => item.name === name)).map((name) => ({ name, on: false, origin: 'papel' as const }))] }
                    : sheet.mcps
                }
                unit={COST_PER_MCP_TOKENS}
                allNote="O papel não escolhe: todos os seus MCPs valem. O Donel não lê a lista deles, porque ela guarda segredos."
                onToggle={(name, on) => toggle('mcps', name, on)}
                onAll={() => edit((current) => setScopeAll(current, 'mcps'), () => [])}
                extra={
                  sheet.mcps.mode === 'list' ? (
                    <form
                      className={styles.addRow}
                      onSubmit={(event) => {
                        event.preventDefault();
                        const name = mcpName;
                        edit((current) => addScopeMcp(current, name), (dropped) => dropped.filter((entry) => entry !== name.trim()));
                        setMcpName('');
                      }}
                    >
                      <input className={styles.input} value={mcpName} placeholder="nome do MCP (como no seu ~/.claude.json)" aria-label="Nome do MCP" onChange={(event) => setMcpName(event.target.value)} />
                      <button type="submit" className={styles.button} disabled={!mcpName.trim()}>
                        + Ligar
                      </button>
                    </form>
                  ) : (
                    <button
                      type="button"
                      className={styles.link}
                      onClick={() => {
                        if (window.confirm('Ficar só com os MCPs que você nomear? Os seus outros MCPs deixam de valer para este papel.')) {
                          edit((current) => ({ ...current, scope: { ...current.scope, mcps: [] } }));
                        }
                      }}
                    >
                      nomear só alguns MCPs
                    </button>
                  )
                }
              />
              <AxisCard
                id="plugins"
                title="Plugins"
                hint="desligar o plugin tira as skills e os hooks dele"
                axis={sheet.plugins}
                unit={COST_PER_PLUGIN_TOKENS}
                onToggle={(name, on) => toggle('plugins', name, on)}
                onAll={() => edit((current) => setScopeAll(current, 'plugins'))}
              />

              <section className={styles.card} data-section="modelo">
                <header className={styles.cardHead}>
                  <h3>Modelo e esforço</h3>
                  <span className={styles.muted}>sugeridos no Launcher; quem abre a sessão ainda pode trocar</span>
                </header>
                <div className={styles.settingRow}>
                  <span className={styles.muted}>Motor</span>
                  <span>
                    {role.engine ?? <span className={styles.muted}>conta ativa</span>} <span className={styles.muted}>· troca em Papéis</span>
                  </span>
                  <Seal origin={role.engine ? 'papel' : 'usuario'} />
                </div>
                {(
                  [
                    ['model', 'Modelo', MODEL_CHOICES, 'o padrão do CLI'],
                    ['effort', 'Esforço', EFFORT_CHOICES, 'o padrão do CLI'],
                    ['permissionMode', 'Permissão', PERMISSION_CHOICES, 'a do seu ~/.claude'],
                  ] as const
                ).map(([key, label, choices, fallback]) => (
                  <div key={key} className={styles.settingRow}>
                    <span className={styles.muted}>{label}</span>
                    <select
                      className={styles.select}
                      value={role[key] ?? ''}
                      aria-label={label}
                      onChange={(event) => {
                        const value = event.target.value;
                        edit((current) => {
                          const { [key]: _old, ...rest } = current;
                          return (value ? { ...rest, [key]: value } : rest) as SessionRole;
                        });
                      }}
                    >
                      <option value="">{fallback}</option>
                      {choices.map((choice) => (
                        <option key={choice} value={choice}>
                          {choice}
                        </option>
                      ))}
                    </select>
                    <Seal origin={role[key] ? 'papel' : 'usuario'} />
                  </div>
                ))}
              </section>
            </>
          )}
        </main>
        <aside className={styles.cost} aria-label="Custo estimado por sessão" data-testid="chair-cost" data-collapsed={collapsed ? 'true' : 'false'}>
          {collapsed ? (
            <div className={styles.costStrip}>
              <button type="button" className={styles.foldButton} onClick={toggleCollapsed} aria-label="Abrir a coluna de custo" title="Abrir a coluna de custo">
                ‹
              </button>
              {sheet ? (
                <>
                  <b>{tokensLabel(sheet.cost.tokens).replace(' tok', '')}</b>
                  <span className={styles.muted}>tok</span>
                  <b>{memoryLabel(sheet.cost.memoryMb).replace(/ (MB|GB)$/, '')}</b>
                  <span className={styles.muted}>{sheet.cost.memoryMb >= 1000 ? 'GB' : 'MB'}</span>
                </>
              ) : null}
              <span className={styles.vertical}>custo por sessão</span>
            </div>
          ) : (
            <div className={styles.costBody}>
              <div className={styles.costHead}>
                <h4>Custo estimado por sessão</h4>
                <button type="button" className={styles.button} onClick={toggleCollapsed}>
                  Recolher ›
                </button>
              </div>
              {sheet && global ? (
                <>
                  <div className={styles.metric}>
                    <span className={styles.muted}>Contexto inicial</span>
                    <b>≈ {tokensLabel(sheet.cost.tokens)}</b>
                    <Meter value={sheet.cost.tokens} max={Math.max(global.cost.tokens, sheet.cost.tokens) * 1.25} />
                    <span className={styles.muted}>
                      com tudo do seu ~/.claude: ≈ {tokensLabel(global.cost.tokens)} + os seus MCPs
                    </span>
                  </div>
                  <div className={styles.metric}>
                    <span className={styles.muted}>Memória</span>
                    <b>≈ {memoryLabel(sheet.cost.memoryMb)}</b>
                    <Meter value={sheet.cost.memoryMb} max={Math.max(sheet.cost.memoryMb, 730)} />
                    <span className={styles.muted}>{sheet.cost.mcpsUncounted ? '+ os seus MCPs, que o Donel não conta' : 'cada MCP nomeado contado como local'}</span>
                  </div>
                  <h4>De onde vem</h4>
                  <ul className={styles.breakdown}>
                    <li>
                      <span>Instruções</span>
                      <span>{tokensLabel(sheet.frameTokens + sheet.guidanceTokens)}</span>
                    </li>
                    {(
                      [
                        ['Skills', sheet.skills, COST_PER_SKILL_TOKENS],
                        ['Plugins', sheet.plugins, COST_PER_PLUGIN_TOKENS],
                        ['MCPs', sheet.mcps, COST_PER_MCP_TOKENS],
                      ] as const
                    ).map(([label, axis, unit]) => {
                      const on = axis.items.filter((item) => item.on).length;
                      return (
                        <li key={label}>
                          <span>
                            {label} <span className={styles.muted}>× {on}</span>
                          </span>
                          <span>{tokensLabel(on * unit)}</span>
                        </li>
                      );
                    })}
                  </ul>
                </>
              ) : null}
              <h4>Herança</h4>
              <ul className={styles.legend}>
                <li>
                  <Seal origin="donel" /> não sai: moldura, semáforo, MCP donel
                </li>
                <li>
                  <Seal origin="papel" /> vale para todo lugar com este papel
                </li>
                <li>
                  <Seal origin="usuario" /> seu ambiente, hoje global
                </li>
              </ul>
              <p className={styles.footnote}>
                Estimativa, não medição: instruções contadas pelo texto (≈ 4 caracteres por token); cada skill ≈ {COST_PER_SKILL_TOKENS}, plugin ≈ {COST_PER_PLUGIN_TOKENS} e MCP ≈{' '}
                {COST_PER_MCP_TOKENS.toLocaleString('pt-BR')} tokens; memória ≈ {BASE_SESSION_MB} MB por sessão + {COST_PER_MCP_MB} MB por MCP local. Rig e pod entram quando existirem.
              </p>
            </div>
          )}
        </aside>
      </div>
      <footer className={styles.status}>
        <span>Vale para quem sentar depois de salvar o papel; os sentados pegam na próxima continuação.</span>
        <span>Esc fecha</span>
      </footer>
    </section>
  );
}

function Meter({ value, max }: { value: number; max: number }): React.JSX.Element {
  const ratio = max > 0 ? Math.min(1, value / max) : 0;
  return (
    <span className={styles.meter}>
      <span style={{ '--fill': `${Math.round(ratio * 100)}%` } as CSSProperties} />
    </span>
  );
}

/** Off items stay folded until asked (the role starts from what it names). */
function AxisCard({
  id,
  title,
  hint,
  axis,
  unit,
  allNote,
  onToggle,
  onAll,
  extra,
}: {
  id: string;
  title: string;
  hint: string;
  axis: SheetAxis;
  unit: number;
  allNote?: string;
  onToggle: (name: string, on: boolean) => void;
  onAll: () => void;
  extra?: React.ReactNode;
}): React.JSX.Element {
  const [showOff, setShowOff] = useState(false);
  const on = axis.items.filter((item) => item.on);
  const off = axis.items.filter((item) => !item.on);
  const row = (item: SheetItem): React.JSX.Element => (
    <div key={item.name} className={item.on ? styles.itemRow : `${styles.itemRow} ${styles.itemOff}`}>
      <button
        type="button"
        className={item.on ? `${styles.toggle} ${styles.toggleOn}` : styles.toggle}
        role="switch"
        aria-checked={item.on}
        aria-label={item.name}
        disabled={item.origin === 'donel' || (id === 'mcps' && axis.mode === 'all')}
        title={item.origin === 'donel' ? 'O MCP do Donel fica sempre' : item.on ? 'Desligar' : 'Ligar'}
        onClick={() => onToggle(item.name, !item.on)}
      />
      <span>{item.name}</span>
      <span className={styles.mono}>{item.on ? `≈ ${tokensLabel(unit)}` : ''}</span>
      <Seal origin={item.origin} />
    </div>
  );
  return (
    <section className={styles.card} data-section={id}>
      <header className={styles.cardHead}>
        <h3>{title}</h3>
        <span className={styles.muted}>{hint}</span>
        <span className={styles.right}>{axis.onCount === null ? 'todos ligados' : `${axis.onCount} ligado${axis.onCount === 1 ? '' : 's'} · ${off.length} fora`}</span>
      </header>
      {axis.mode === 'all' ? <p className={styles.note}>{allNote ?? 'O papel não escolhe: valem todas as suas. Desligar uma passa a lista para o papel.'}</p> : null}
      {on.map(row)}
      {on.length === 0 && axis.mode === 'list' ? <p className={styles.note}>Nenhum: o papel não leva nada daqui.</p> : null}
      {off.length > 0 ? (
        showOff ? (
          off.map(row)
        ) : (
          <button type="button" className={styles.link} onClick={() => setShowOff(true)}>
            {off.length === 1 ? 'mostrar o 1 desligado' : `mostrar os ${off.length} desligados`}
          </button>
        )
      ) : null}
      <div className={styles.cardFoot}>
        {extra}
        {axis.mode === 'list' ? (
          <button type="button" className={styles.link} onClick={onAll}>
            usar todos os seus
          </button>
        ) : null}
      </div>
    </section>
  );
}
