import { Button, Select, TextInput, Toggle } from '@donel-dev/design-system';
import type { SelectOption } from '@donel-dev/design-system';
import { Bell, FolderTree, MessagesSquare, PlayCircle, Search, Smartphone, Trash2, UserCog, X } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { NotificationPreference, ProjectScanMode } from '../../shared/config';
import type { SessionRenewalPrefs } from '../../shared/sessionRenewal';
import { CelularSection } from './CelularSection';
import { EspelhoSection } from './EspelhoSection';
import styles from './Preferences.module.css';

// Preferências — tela cheia com menu lateral (pedido do dono, 04/11: "como popup não está vingando").
// Cada categoria mostra só os seus ajustes; a busca procura em todas. Mudanças aplicam IMEDIATAMENTE,
// sem botão "Salvar" (mesmo espírito do resto do app).

// FIX ambiente genérico (28/07, teste do colega) — o critério "só pasta com
// .git/CLAUDE.md" parecia bug pra quem não organiza o disco por repositório.
const SCAN_MODE_OPTIONS: SelectOption[] = [
  { value: 'markers', label: 'Só pastas de projeto', description: 'padrão — pastas com .git/ ou CLAUDE.md, até 2 níveis abaixo das raízes' },
  { value: 'all', label: 'Todas as pastas', description: 'toda pasta no 1º nível das raízes, com ou sem marcador de projeto' },
];

// B36 — sessão renovada em voo: the context budget of a session (the owner works with 250k).
/** Limite de sessões abertas por um Líder: sem limite (padrão) ou um número. */
const OPEN_CAP_CHOICES = [1, 2, 3, 4, 5, 6, 8, 10, 15, 20];

function openCapOptions(current: number | null): SelectOption[] {
  const numbers = current !== null && !OPEN_CAP_CHOICES.includes(current) ? [...OPEN_CAP_CHOICES, current].sort((a, b) => a - b) : OPEN_CAP_CHOICES;
  return [{ value: 'sem', label: 'Sem limite' }, ...numbers.map((n) => ({ value: String(n), label: n === 1 ? '1 sessão' : `${n} sessões` }))];
}

const RENEWAL_LIMIT_OPTIONS: SelectOption[] = [150_000, 200_000, 250_000, 300_000, 400_000, 500_000].map((tokens) => ({
  value: String(tokens),
  label: `${tokens / 1000}k de contexto`,
  ...(tokens === 250_000 ? { description: 'padrão' } : {}),
}));

const NOTIFICATION_OPTIONS: SelectOption[] = [
  { value: 'all', label: 'Todas as transições', description: 'avisa quando uma sessão termina, precisa de você, para com erro ou encerra sozinha' },
  { value: 'permission-only', label: 'Só permissão pendente', description: 'padrão — só quando uma sessão precisa de você ou para com erro (ex.: limite de uso)' },
  { value: 'none', label: 'Nenhuma', description: 'desativa notificações do Windows' },
];

/** Sessões remotas — "Onde roda" padrão: the last choice, this computer or a remote place. */
const WHERE_LAST = '';

export interface PreferencesRemotePlace {
  readonly id: string;
  readonly label: string;
}

export interface PreferencesProps {
  open: boolean;
  onClose: () => void;
  projectRoots: readonly string[];
  projectScanMode: ProjectScanMode;
  notificationPreference: NotificationPreference;
  onAddRoot: (root: string) => void;
  onRemoveRoot: (root: string) => void;
  onChangeProjectScanMode: (mode: ProjectScanMode) => void;
  onChangeNotificationPreference: (preference: NotificationPreference) => void;
  /** T056 (014-chat) — interruptor "Chat (experimental)" (`chat.enabled`). */
  chatEnabled: boolean;
  /** `chat.enabled` só vale depois de reiniciar o app: true quando o valor salvo difere do que a janela abriu. */
  chatRestartPending: boolean;
  onChangeChatEnabled: (enabled: boolean) => void;
  /** T022 (015-jobu-pet) — "Jobu na área de trabalho" switch (`pet.enabled`); applies at once. */
  petEnabled: boolean;
  onChangePetEnabled: (enabled: boolean) => void;
  /** B36 — sessão renovada em voo (`sessionRenewal`); applies at once. */
  sessionRenewal: SessionRenewalPrefs;
  onChangeSessionRenewal: (prefs: Partial<SessionRenewalPrefs>) => void;
  /** Limite de sessões abertas por um Líder (`team.openCap`, `null` = sem limite); applies at once. */
  openCap: number | null;
  onChangeOpenCap: (openCap: number | null) => void;
  /** "Modo auto nunca pede permissão" (`autoMode.neverAsks`); applies at once. */
  autoNeverAsks: boolean;
  onChangeAutoNeverAsks: (neverAsks: boolean) => void;
  /** Oráculo no centro (`layout.oracleCenter`); off = the old layout. Applies at once. */
  oracleCenter: boolean;
  onChangeOracleCenter: (oracleCenter: boolean) => void;
  /** Sessões remotas — places for the "Onde roda" default; `[]` hides the setting. */
  remotes?: readonly PreferencesRemotePlace[];
  /** `launcherDefaults.where`: `undefined` = last choice / first place with an account, `'local'` = this computer. */
  launcherWhere?: string;
  onChangeLauncherWhere?: (where: string | undefined) => void;
  /** Líder único na VPS — `leader.where`: `'local'` or a remote place. The next message through the Jobu moves it. */
  leaderWhere?: string;
  onChangeLeaderWhere?: (where: string) => void;
  /** Papéis de sessão — opens the roles editor. */
  onManageRoles?: () => void;
}

type CategoryId = 'projetos' | 'sessoes' | 'chat' | 'avisos' | 'celular' | 'papeis';

interface SettingBlock {
  readonly id: string;
  readonly category: CategoryId;
  readonly title: string;
  /** Extra words the search matches (the hint text is matched too). */
  readonly keywords: string;
  readonly hint?: string;
  readonly body: ReactNode;
}

const CATEGORIES: ReadonlyArray<{ id: CategoryId; label: string; icon: ReactNode }> = [
  { id: 'projetos', label: 'Projetos', icon: <FolderTree size={16} strokeWidth={1.5} aria-hidden="true" /> },
  { id: 'sessoes', label: 'Sessões', icon: <PlayCircle size={16} strokeWidth={1.5} aria-hidden="true" /> },
  { id: 'chat', label: 'Chat', icon: <MessagesSquare size={16} strokeWidth={1.5} aria-hidden="true" /> },
  { id: 'avisos', label: 'Avisos e Jobu', icon: <Bell size={16} strokeWidth={1.5} aria-hidden="true" /> },
  { id: 'celular', label: 'Celular', icon: <Smartphone size={16} strokeWidth={1.5} aria-hidden="true" /> },
  { id: 'papeis', label: 'Papéis', icon: <UserCog size={16} strokeWidth={1.5} aria-hidden="true" /> },
];

function normalize(text: string): string {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

export function Preferences(props: PreferencesProps): React.JSX.Element | null {
  const { open, onClose, remotes = [] } = props;
  const [category, setCategory] = useState<CategoryId>('projetos');
  const [query, setQuery] = useState('');
  const [newRoot, setNewRoot] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    searchRef.current?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const handleAdd = (): void => {
    const trimmed = newRoot.trim();
    if (!trimmed) return;
    props.onAddRoot(trimmed);
    setNewRoot('');
  };

  const whereOptions: SelectOption[] = [
    { value: WHERE_LAST, label: 'A última escolha', description: 'sem escolha ainda: o primeiro lugar remoto com conta' },
    { value: 'local', label: 'Este computador' },
    ...remotes.map((place) => ({ value: place.id, label: place.label })),
  ];

  const blocks: SettingBlock[] = [
    {
      id: 'roots',
      category: 'projetos',
      title: 'Pastas-raiz de projetos',
      keywords: 'pasta raiz root sidebar adicionar remover',
      hint: 'Onde a barra lateral procura projetos.',
      body: (
        <>
          <ul className={styles.rootList}>
            {props.projectRoots.length === 0 ? <li className={styles.hint}>Nenhuma pasta-raiz configurada.</li> : null}
            {props.projectRoots.map((root) => (
              <li key={root} className={styles.rootRow}>
                <span className={styles.rootPath} title={root}>
                  {root}
                </span>
                <button type="button" className={styles.removeRootButton} onClick={() => props.onRemoveRoot(root)} aria-label={`Remover pasta ${root}`}>
                  <Trash2 size={14} strokeWidth={1.5} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
          <div className={styles.addRootRow}>
            <TextInput
              className={styles.addRootInput}
              placeholder="C:\Users\voce\pasta"
              aria-label="Nova pasta-raiz"
              value={newRoot}
              onChange={(event) => setNewRoot(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  handleAdd();
                }
              }}
            />
            <Button variant="secondary" onClick={handleAdd} disabled={!newRoot.trim()}>
              Adicionar
            </Button>
          </div>
        </>
      ),
    },
    {
      id: 'scan',
      category: 'projetos',
      title: 'O que aparece como projeto',
      keywords: 'projeto pasta git claude.md sidebar',
      hint: 'Se uma pasta sua não aparece na barra lateral, o critério provavelmente é este.',
      body: <Select value={props.projectScanMode} options={SCAN_MODE_OPTIONS} onChange={(value) => props.onChangeProjectScanMode(value as ProjectScanMode)} />,
    },
    ...(remotes.length > 0 && props.onChangeLauncherWhere
      ? [
          {
            id: 'where',
            category: 'sessoes' as const,
            title: 'Onde a sessão nova roda',
            keywords: 'onde roda vps remoto servidor launcher padrão ram',
            hint: 'O valor que o campo "Onde roda" do Launcher já traz. Num lugar remoto a sessão continua trabalhando com o app fechado.',
            body: (
              <Select
                value={props.launcherWhere ?? WHERE_LAST}
                options={whereOptions}
                onChange={(value) => props.onChangeLauncherWhere?.(value === WHERE_LAST ? undefined : value)}
              />
            ),
          },
        ]
      : []),
    {
      id: 'auto',
      category: 'sessoes',
      title: 'Modo auto',
      keywords: 'permissão aprovar automático auto',
      body: (
        <Toggle
          checked={props.autoNeverAsks}
          onChange={props.onChangeAutoNeverAsks}
          label="Modo auto nunca pede permissão"
          description="O Donel aprova o pedido na hora e deixa uma linha no chat. Perguntas e planos continuam chegando para você."
        />
      ),
    },
    {
      id: 'renewal',
      category: 'sessoes',
      title: 'Sessão renovada em voo',
      keywords: 'contexto limite renovar passagem de bastão handoff',
      hint: 'Quando o contexto passa do limite, no fim de um turno a sessão escreve uma passagem de bastão e uma sessão nova continua na mesma aba. Nunca no meio de uma tarefa nem com trabalho em segundo plano.',
      body: (
        <>
          <Toggle checked={props.sessionRenewal.enabled} onChange={(enabled) => props.onChangeSessionRenewal({ enabled })} label="Renovar a sessão ao chegar no limite" />
          {props.sessionRenewal.enabled ? (
            <Select
              value={RENEWAL_LIMIT_OPTIONS.some((option) => option.value === String(props.sessionRenewal.limitTokens)) ? String(props.sessionRenewal.limitTokens) : '250000'}
              options={RENEWAL_LIMIT_OPTIONS}
              onChange={(value) => props.onChangeSessionRenewal({ limitTokens: Number(value) })}
            />
          ) : null}
        </>
      ),
    },
    {
      id: 'open-cap',
      category: 'sessoes',
      title: 'Limite de sessões abertas por um Líder',
      keywords: 'limite sessões líder abrir time precisa de você mindscape',
      hint: 'Quantas sessões uma mesma sessão (um Líder, ou o Líder único em cada quadro) pode ter abertas ao mesmo tempo antes de pedir sua permissão em "Precisa de você". Sem limite, ela abre quantas precisar.',
      body: (
        <Select
          value={props.openCap === null ? 'sem' : String(props.openCap)}
          options={openCapOptions(props.openCap)}
          onChange={(value) => props.onChangeOpenCap(value === 'sem' ? null : Number(value))}
        />
      ),
    },
    {
      id: 'chat',
      category: 'chat',
      title: 'Chat',
      keywords: 'chat conversa terminal experimental',
      hint: 'Mostra a conversa de cada sessão como um chat, com o terminal a um atalho de distância (Ctrl+`).',
      body: (
        <Toggle
          checked={props.chatEnabled}
          onChange={props.onChangeChatEnabled}
          label="Chat (experimental)"
          description={props.chatRestartPending ? 'Reinicie o app para aplicar.' : 'Vale a partir da próxima vez que o app abrir.'}
        />
      ),
    },
    {
      id: 'notifications',
      category: 'avisos',
      title: 'Notificação do Windows',
      keywords: 'notificação aviso windows barra de tarefas',
      hint: 'Quando uma sessão fora da sua vista precisa de você. Com o Jobu ligado, quem avisa é ele. O número no ícone da barra de tarefas conta as sessões esperando você.',
      body: (
        <Select
          value={props.notificationPreference}
          options={NOTIFICATION_OPTIONS}
          onChange={(value) => props.onChangeNotificationPreference(value as NotificationPreference)}
        />
      ),
    },
    {
      id: 'pet',
      category: 'avisos',
      title: 'Jobu Donel',
      keywords: 'jobu pet mascote área de trabalho',
      body: (
        <Toggle
          checked={props.petEnabled}
          onChange={props.onChangePetEnabled}
          label="Jobu na área de trabalho"
          description="Avisa quando uma sessão termina ou espera você, e quando a conta muda."
        />
      ),
    },
    ...(remotes.length > 0 && props.onChangeLeaderWhere
      ? [
          {
            id: 'leader-where',
            category: 'avisos' as const,
            title: 'Onde o Líder roda',
            keywords: 'líder lider jobu onde roda vps remoto servidor ram memória',
            hint: 'O Líder com quem você fala pelo Jobu. Ao trocar, ele muda de lugar na próxima mensagem, com a mesma conversa; se estiver trabalhando, muda quando terminar.',
            body: (
              <Select
                value={props.leaderWhere && remotes.some((place) => place.id === props.leaderWhere) ? props.leaderWhere : 'local'}
                options={[{ value: 'local', label: 'Este computador', description: 'padrão' }, ...remotes.map((place) => ({ value: place.id, label: place.label }))]}
                onChange={(value) => props.onChangeLeaderWhere?.(value)}
              />
            ),
          },
        ]
      : []),
    {
      id: 'oracle-center',
      category: 'avisos',
      title: 'Oráculo no lugar da conversa do Líder',
      keywords: 'oráculo oraculo cartas líder lider jobu layout terminais tela centro antigo',
      hint: 'Você fala com o Líder pelo Jobu. A janela mostra as cartas que esperam você, e as sessões ficam a um clique, em "Terminais" (Ctrl+Shift+O).',
      body: (
        <Toggle
          checked={props.oracleCenter}
          onChange={props.onChangeOracleCenter}
          label="Mostrar o Oráculo no centro"
          description="Desligado, volta o layout antigo: só as abas, com a do Líder entre elas."
        />
      ),
    },
    {
      id: 'celular',
      category: 'celular',
      title: 'Oráculo Harrow no celular',
      keywords: 'celular telefone oráculo harrow ledger entregas validar aceitar rejeitar tailscale parear qr pwa firewall',
      hint: 'Valide as entregas que esperam você pelo celular, uma carta por tela: arraste para a direita para aceitar e para a esquerda para rejeitar com motivo.',
      body: <CelularSection />,
    },
    {
      id: 'espelho',
      category: 'celular',
      title: 'Registro das tarefas fora do PC',
      keywords: 'oráculo harrow tarefas registro histórico supabase espelho backup demandas planilha',
      hint: 'Cada mudança no Oráculo vai, em até um minuto, para uma tabela no seu Supabase pessoal: o histórico sobrevive ao PC e abre no navegador ou no celular. Prints e vídeos ficam só aqui.',
      body: <EspelhoSection />,
    },
    ...(props.onManageRoles
      ? [
          {
            id: 'roles',
            category: 'papeis' as const,
            title: 'Papéis de sessão',
            keywords: 'papel dev revisor pesquisa prompt',
            hint: 'Dev, Revisor, Pesquisa e os seus. Texto, cor e sugestões de modelo, esforço e permissão de cada um.',
            body: (
              <div>
                <Button variant="secondary" onClick={props.onManageRoles}>
                  Editar papéis…
                </Button>
              </div>
            ),
          },
        ]
      : []),
  ];

  const searching = query.trim().length > 0;
  const visible = ((): SettingBlock[] => {
    if (!searching) return blocks.filter((block) => block.category === category);
    const words = normalize(query).split(/\s+/).filter(Boolean);
    return blocks.filter((block) => {
      const haystack = normalize(`${block.title} ${block.hint ?? ''} ${block.keywords} ${CATEGORIES.find((c) => c.id === block.category)?.label ?? ''}`);
      return words.every((word) => haystack.includes(word));
    });
  })();

  if (!open) return null;
  const countOf = (id: CategoryId): number => blocks.filter((block) => block.category === id).length;

  return (
    <div className={styles.screen} role="dialog" aria-modal="true" aria-label="Preferências" data-testid="preferences">
      <nav className={styles.nav} aria-label="Categorias das preferências">
        <div className={styles.navHeader}>Preferências</div>
        <label className={styles.search}>
          <Search size={14} strokeWidth={1.5} aria-hidden="true" />
          <input
            ref={searchRef}
            className={styles.searchInput}
            placeholder="Buscar ajuste"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label="Buscar ajuste"
          />
        </label>
        <ul className={styles.navList}>
          {CATEGORIES.filter((entry) => countOf(entry.id) > 0).map((entry) => (
            <li key={entry.id}>
              <button
                type="button"
                className={!searching && category === entry.id ? styles.navItemActive : styles.navItem}
                onClick={() => {
                  setQuery('');
                  setCategory(entry.id);
                }}
              >
                {entry.icon}
                <span>{entry.label}</span>
              </button>
            </li>
          ))}
        </ul>
        <p className={styles.navFoot}>Contas e Provedores ficam nos botões do topo.</p>
      </nav>

      <main className={styles.content}>
        <header className={styles.contentHeader}>
          <h2 className={styles.contentTitle}>{searching ? `Busca: “${query.trim()}”` : CATEGORIES.find((entry) => entry.id === category)?.label}</h2>
          <button type="button" className={styles.closeButton} onClick={onClose} aria-label="Fechar preferências" title="Fechar (Esc)">
            <X size={18} strokeWidth={1.5} aria-hidden="true" />
          </button>
        </header>
        <div className={styles.cards}>
          {visible.length === 0 ? <p className={styles.hint}>Nenhum ajuste com esse nome.</p> : null}
          {visible.map((block) => (
            <section key={block.id} className={styles.card} data-testid={`preferences-${block.id}`}>
              <div className={styles.cardHead}>
                <h3 className={styles.sectionTitle}>{block.title}</h3>
                {searching ? <span className={styles.badge}>{CATEGORIES.find((entry) => entry.id === block.category)?.label}</span> : null}
              </div>
              {block.hint ? <p className={styles.sectionHint}>{block.hint}</p> : null}
              <div className={styles.cardBody}>{block.body}</div>
            </section>
          ))}
        </div>
      </main>
    </div>
  );
}
