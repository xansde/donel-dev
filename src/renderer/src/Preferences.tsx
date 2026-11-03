import { Button, Modal, Select, TextInput, Toggle } from '@donel-dev/design-system';
import type { SelectOption } from '@donel-dev/design-system';
import { Trash2 } from 'lucide-react';
import { useState } from 'react';
import type { NotificationPreference, ProjectScanMode } from '../../shared/config';
import type { SessionRenewalPrefs } from '../../shared/sessionRenewal';
import styles from './Preferences.module.css';

// T015 — UI de Preferências (FR-007, feedback E2E rodada 3 "roots de
// projetos precisam ser configuráveis pela UI" + rodada 4 "notificação
// configurável"). Tela mínima (ui-spec §2 já previa isso pro P1; puxado pro
// P0 pelo feedback humano) — sem instrumento de tema (P1, "Fora deste
// ciclo" em tasks.md) nem defaults do launcher (esses são semeados
// automaticamente a cada "▶ Iniciar", App.tsx `handleLaunch`, sem precisar
// de um campo editável aqui). Mudanças aplicam IMEDIATAMENTE (add/remove de
// root já dispara re-scan; troca de notificação já persiste) — sem botão
// "Salvar" separado, mesmo espírito instantâneo do resto do app (favoritar
// projeto, trocar perfil).

// FIX ambiente genérico (28/07, teste do colega) — o critério "só pasta com
// .git/CLAUDE.md" parecia bug pra quem não organiza o disco por repositório.
const SCAN_MODE_OPTIONS: SelectOption[] = [
  { value: 'markers', label: 'Só pastas de projeto', description: 'padrão — pastas com .git/ ou CLAUDE.md, até 2 níveis abaixo das raízes' },
  { value: 'all', label: 'Todas as pastas', description: 'toda pasta no 1º nível das raízes, com ou sem marcador de projeto' },
];

// B36 — sessão renovada em voo: the context budget of a session (the owner works with 250k).
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
}

export function Preferences({
  open,
  onClose,
  projectRoots,
  projectScanMode,
  notificationPreference,
  onAddRoot,
  onRemoveRoot,
  onChangeProjectScanMode,
  onChangeNotificationPreference,
  chatEnabled,
  chatRestartPending,
  onChangeChatEnabled,
  petEnabled,
  onChangePetEnabled,
  sessionRenewal,
  onChangeSessionRenewal,
}: PreferencesProps): React.JSX.Element {
  const [newRoot, setNewRoot] = useState('');

  const handleAdd = (): void => {
    const trimmed = newRoot.trim();
    if (!trimmed) return;
    onAddRoot(trimmed);
    setNewRoot('');
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Preferências"
      actions={
        <Button variant="primary" onClick={onClose}>
          Fechar
        </Button>
      }
    >
      <div className={styles.section} data-testid="preferences-roots-section">
        <h3 className={styles.sectionTitle}>Pastas-raiz de projetos</h3>
        <p className={styles.sectionHint}>Onde a sidebar procura projetos — o critério do que aparece é a seção abaixo.</p>
        <ul className={styles.rootList}>
          {projectRoots.length === 0 ? <li className={styles.hint}>Nenhuma pasta-raiz configurada.</li> : null}
          {projectRoots.map((root) => (
            <li key={root} className={styles.rootRow}>
              <span className={styles.rootPath} title={root}>
                {root}
              </span>
              <button
                type="button"
                className={styles.removeRootButton}
                onClick={() => onRemoveRoot(root)}
                aria-label={`Remover pasta ${root}`}
              >
                <Trash2 size={12} strokeWidth={1.5} aria-hidden="true" />
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
      </div>

      <div className={styles.section} data-testid="preferences-scan-mode-section">
        <h3 className={styles.sectionTitle}>O que aparece como projeto</h3>
        <p className={styles.sectionHint}>Se uma pasta sua não aparece na sidebar, o critério provavelmente é este.</p>
        <div data-testid="project-scan-mode-select">
          <Select
            value={projectScanMode}
            options={SCAN_MODE_OPTIONS}
            onChange={(value) => onChangeProjectScanMode(value as ProjectScanMode)}
          />
        </div>
      </div>

      <div className={styles.section} data-testid="preferences-notification-section">
        <h3 className={styles.sectionTitle}>Notificação do Windows</h3>
        <p className={styles.sectionHint}>
          Quando uma sessão fora da sua vista precisa da sua atenção. Com o Jobu ligado, quem avisa é ele. O número no ícone da
          barra de tarefas conta as sessões esperando você.
        </p>
        <div data-testid="notification-preference-select">
          <Select
            value={notificationPreference}
            options={NOTIFICATION_OPTIONS}
            onChange={(value) => onChangeNotificationPreference(value as NotificationPreference)}
          />
        </div>
      </div>
      <div className={styles.section} data-testid="preferences-chat-section">
        <h3 className={styles.sectionTitle}>Chat (experimental)</h3>
        <p className={styles.sectionHint}>
          Mostra a conversa de cada sessão do Claude como um chat, com o terminal a um atalho de distância (Ctrl+`).
          Vale a partir da próxima vez que o app abrir.
        </p>
        <Toggle
          checked={chatEnabled}
          onChange={onChangeChatEnabled}
          label="Chat (experimental)"
          description={chatRestartPending ? 'Reinicie o app para aplicar.' : undefined}
        />
      </div>
      <div className={styles.section} data-testid="preferences-renewal-section">
        <h3 className={styles.sectionTitle}>Sessão renovada em voo</h3>
        <p className={styles.sectionHint}>
          Quando o contexto de uma sessão passa do limite, no fim de um turno ela escreve uma passagem de bastão e o Donel abre
          uma sessão nova na mesma aba, que começa lendo essa passagem. Nunca no meio de uma tarefa nem com trabalho em segundo
          plano rodando.
        </p>
        <Toggle
          checked={sessionRenewal.enabled}
          onChange={(enabled) => onChangeSessionRenewal({ enabled })}
          label="Renovar a sessão ao chegar no limite"
        />
        <div data-testid="renewal-limit-select">
          <Select
            value={
              RENEWAL_LIMIT_OPTIONS.some((option) => option.value === String(sessionRenewal.limitTokens))
                ? String(sessionRenewal.limitTokens)
                : '250000'
            }
            options={RENEWAL_LIMIT_OPTIONS}
            onChange={(value) => onChangeSessionRenewal({ limitTokens: Number(value) })}
          />
        </div>
      </div>
      <div className={styles.section} data-testid="preferences-pet-section">
        <h3 className={styles.sectionTitle}>Jobu Donel</h3>
        <div data-testid="preferences-pet-toggle">
          <Toggle
            checked={petEnabled}
            onChange={onChangePetEnabled}
            label="Jobu na área de trabalho"
            description="Avisa quando uma sessão termina ou espera você, e quando a conta muda."
          />
        </div>
      </div>
    </Modal>
  );
}
