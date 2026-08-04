import { Button } from '@donel-dev/design-system';
import { useCallback, useEffect, useState } from 'react';
import type { MigrationPlan } from '../../shared';
import styles from './MigrationWizard.module.css';

// T1215 (011-contas-e-provedores, etapa 2) — assistente de migração dos
// perfis (`~/.claude-profiles`) para o cofre do motor. Temporário: só
// aparece enquanto o inventário tiver alguma entrada (contracts/
// migration-etapa-2.md). Nunca exibe segredo — o par nunca atravessa este
// componente, o retorno de `importCredentials` é sempre um enum.

function emptyPlan(): MigrationPlan {
  return { entries: [], canArchive: true };
}

const CREDENTIALS_LABEL: Record<string, string> = {
  pending: 'pendente',
  imported: 'importado',
  skipped: 'pulado',
  absent: 'sem credencial',
  failed: 'falhou',
};

interface MigrationWizardProps {
  onClose: () => void;
}

export function MigrationWizard({ onClose }: MigrationWizardProps): React.JSX.Element {
  const [plan, setPlan] = useState<MigrationPlan>(emptyPlan());
  const [loading, setLoading] = useState(false);
  const [busySlug, setBusySlug] = useState<string | null>(null);
  const [archiving, setArchiving] = useState(false);
  const [archiveMessage, setArchiveMessage] = useState<string | null>(null);

  const refresh = useCallback((): void => {
    setLoading(true);
    void window.donel.migration.scan().then(setPlan).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const handleImport = (slug: string): void => {
    setBusySlug(slug);
    void window.donel.migration
      .importCredentials(slug)
      .then(() => window.donel.migration.consolidateTranscripts(slug))
      .then(() => window.donel.migration.scan())
      .then(setPlan)
      .finally(() => setBusySlug(null));
  };

  const handleMarkMcpReviewed = (slug: string): void => {
    setBusySlug(slug);
    void window.donel.migration
      .markMcpReviewed(slug)
      .then(setPlan)
      .finally(() => setBusySlug(null));
  };

  const handleArchive = (): void => {
    setArchiving(true);
    setArchiveMessage(null);
    void window.donel.migration
      .archive()
      .then((outcome) => {
        if (outcome.kind === 'archived') {
          setArchiveMessage(`Perfis arquivados em ${outcome.archivedTo}.`);
        } else if (outcome.kind === 'aborted') {
          setArchiveMessage(
            outcome.reason === 'junction-unlink-failed'
              ? `Não foi possível desfazer o link do perfil "${outcome.profileSlug}" — nada foi renomeado.`
              : 'Não foi possível renomear a pasta de perfis.',
          );
        } else {
          setArchiveMessage('Ainda há perfis pendentes — nada foi arquivado.');
        }
        refresh();
      })
      .finally(() => setArchiving(false));
  };

  return (
    <div className={styles.body} data-testid="migration-wizard">
      <p className={styles.hint}>
        Assistente de migração dos perfis antigos (<code>~/.claude-profiles</code>) para o cofre único do motor. Importe
        as credenciais perfil a perfil — nada é aplicado automaticamente.
      </p>

      <div className={styles.toolbar}>
        <Button variant="secondary" data-testid="migration-refresh" onClick={refresh} disabled={loading}>
          {loading ? 'Atualizando…' : 'Atualizar'}
        </Button>
      </div>

      <ul className={styles.list}>
        {plan.entries.map((entry) => (
          <li key={entry.slug} className={styles.row} data-testid="migration-row" data-profile-slug={entry.slug}>
            <div className={styles.rowHeader}>
              <span className={styles.label}>{entry.displayName}</span>
              <span className={styles.status} data-testid="migration-status">
                {CREDENTIALS_LABEL[entry.credentials] ?? entry.credentials}
              </span>
            </div>

            {entry.mcp.onlyInProfile.length > 0 || entry.mcp.onlyInGlobal.length > 0 ? (
              <div className={styles.mcpDiff} data-testid="migration-mcp-diff">
                {entry.mcp.onlyInProfile.length > 0 ? <p className={styles.hint}>Só no perfil: {entry.mcp.onlyInProfile.join(', ')}</p> : null}
                {entry.mcp.onlyInGlobal.length > 0 ? <p className={styles.hint}>Só no global: {entry.mcp.onlyInGlobal.join(', ')}</p> : null}
              </div>
            ) : null}

            <div className={styles.rowActions}>
              <Button
                variant="secondary"
                data-testid="migration-import"
                onClick={() => handleImport(entry.slug)}
                disabled={busySlug === entry.slug || entry.credentials === 'imported'}
              >
                {entry.credentials === 'imported' ? 'Importado' : 'Importar'}
              </Button>
              <Button
                variant="secondary"
                data-testid="migration-mark-mcp-reviewed"
                onClick={() => handleMarkMcpReviewed(entry.slug)}
                disabled={busySlug === entry.slug}
              >
                Revisado
              </Button>
            </div>
          </li>
        ))}
        {plan.entries.length === 0 ? <li className={styles.hint}>Nenhum perfil antigo encontrado.</li> : null}
      </ul>

      {archiveMessage ? (
        <p className={styles.hint} data-testid="migration-archive-message">
          {archiveMessage}
        </p>
      ) : null}

      <div className={styles.toolbar}>
        <Button variant="secondary" data-testid="migration-archive" onClick={handleArchive} disabled={!plan.canArchive || archiving}>
          {archiving ? 'Arquivando…' : 'Arquivar perfis antigos'}
        </Button>
        <Button variant="secondary" onClick={onClose} data-testid="migration-close">
          Fechar
        </Button>
      </div>
    </div>
  );
}
