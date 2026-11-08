import { Button, Modal, Select, TextInput } from '@donel-dev/design-system';
import type { SelectOption } from '@donel-dev/design-system';
import { useEffect, useState, type CSSProperties } from 'react';
import type { ProviderSummaryDto } from '../../shared';
import type { EffortLevel, ModelAlias, PermissionMode } from '../../shared/commandBuilder';
import { factoryRole, MAX_ROLE_GUIDANCE_CHARS, MAX_ROLE_NAME_CHARS, ROLE_COLORS, roleColorVar, roleIdFromName, type RoleColor, type RoleScope, type SessionRole } from '../../shared/roles';
import styles from './RolesEditor.module.css';

// Item 12b — the simple screen to create and edit roles: the text (guidance) and the suggestions.
// No "change the role of a place" here: a role is fixed per place once it started.

const NONE = '';

const MODEL_OPTIONS: SelectOption[] = [
  { value: NONE, label: '—' },
  ...(['fable', 'opus', 'sonnet', 'haiku'] as const).map((value) => ({ value, label: value })),
];
const EFFORT_OPTIONS: SelectOption[] = [
  { value: NONE, label: '—' },
  ...(['low', 'medium', 'high', 'xhigh', 'max'] as const).map((value) => ({ value, label: value })),
];
const PERMISSION_OPTIONS: SelectOption[] = [
  { value: NONE, label: '—' },
  ...(['manual', 'acceptEdits', 'auto', 'plan', 'dontAsk', 'bypassPermissions'] as const).map((value) => ({ value, label: value })),
];

interface Draft {
  /** `null` = a new role (the id is made from the name on save). */
  readonly id: string | null;
  readonly name: string;
  readonly color: RoleColor;
  readonly engine: string;
  readonly model: string;
  readonly effort: string;
  readonly permissionMode: string;
  /** Not edited on this screen (it lives in the file's header); carried so a save keeps it. */
  readonly scope: RoleScope | undefined;
  /** `lugar: qualquer` — not edited on this screen either; carried so a save keeps it. */
  readonly anyPlace: boolean;
  readonly guidance: string;
}

function draftOf(role: SessionRole | undefined): Draft {
  return {
    id: role?.id ?? null,
    name: role?.name ?? '',
    color: role?.color ?? ROLE_COLORS[0]!,
    engine: role?.engine ?? NONE,
    model: role?.model ?? NONE,
    effort: role?.effort ?? NONE,
    permissionMode: role?.permissionMode ?? NONE,
    scope: role?.scope,
    anyPlace: role?.anyPlace === true,
    guidance: role?.guidance ?? '',
  };
}

export interface RolesEditorProps {
  readonly open: boolean;
  readonly roles: readonly SessionRole[];
  readonly providers: readonly ProviderSummaryDto[];
  readonly onClose: () => void;
  /** The list after a save. */
  readonly onSaved: (roles: SessionRole[]) => void;
  /** Cadeiras, fatia 2 — the role shown when the screen opens (else the first). */
  readonly initialRoleId?: string;
  /** Cadeiras, fatia 2 — "Ver como cadeira ▸": the chair screen of the role in the editor. */
  readonly onOpenChair?: (roleId: string) => void;
}

export function RolesEditor({ open, roles, providers, onClose, onSaved, initialRoleId, onOpenChair }: RolesEditorProps): React.JSX.Element | null {
  const [draft, setDraft] = useState<Draft>(() => draftOf(roles[0]));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (open) {
      setDraft(draftOf(roles.find((role) => role.id === initialRoleId) ?? roles[0]));
      setError(null);
    }
    // Only when the screen opens: the list changing under an edit must not drop the draft.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const engineOptions: SelectOption[] = [{ value: NONE, label: 'Conta ativa' }, ...providers.map((provider) => ({ value: provider.id, label: provider.label }))];
  const change = (patch: Partial<Draft>): void => setDraft((current) => ({ ...current, ...patch }));
  const canSave = draft.name.trim().length > 0 && !saving;

  const save = async (): Promise<void> => {
    if (!canSave) return;
    const id = draft.id ?? roleIdFromName(draft.name, new Set(roles.map((role) => role.id)));
    const role: SessionRole = {
      id,
      name: draft.name.trim(),
      color: draft.color,
      ...(draft.engine ? { engine: draft.engine } : {}),
      ...(draft.model ? { model: draft.model as ModelAlias } : {}),
      ...(draft.effort ? { effort: draft.effort as EffortLevel } : {}),
      ...(draft.permissionMode ? { permissionMode: draft.permissionMode as PermissionMode } : {}),
      ...(draft.scope ? { scope: draft.scope } : {}),
      ...(draft.anyPlace ? { anyPlace: true } : {}),
      guidance: draft.guidance,
    };
    setSaving(true);
    const result = await window.donel.roles.save(role).catch(() => null);
    setSaving(false);
    if (!result || !result.ok) {
      setError('Não foi possível salvar o papel.');
      return;
    }
    setError(null);
    onSaved(result.roles);
    setDraft(draftOf(result.roles.find((candidate) => candidate.id === id)));
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Papéis"
      className={styles.dialog}
      actions={
        <>
          {onOpenChair && draft.id !== null ? (
            <Button
              variant="secondary"
              onClick={() => {
                const id = draft.id;
                if (id) onOpenChair(id);
              }}
            >
              Ver como cadeira ▸
            </Button>
          ) : null}
          <Button variant="secondary" onClick={onClose}>
            Fechar
          </Button>
          <Button variant="primary" onClick={() => void save()} disabled={!canSave}>
            Salvar
          </Button>
        </>
      }
    >
      <div className={styles.list} role="listbox" aria-label="Papéis">
        {roles.map((role) => (
          <button
            key={role.id}
            type="button"
            role="option"
            aria-selected={draft.id === role.id}
            className={styles.chip}
            style={{ '--role': roleColorVar(role.color) } as CSSProperties}
            onClick={() => {
              setDraft(draftOf(role));
              setError(null);
            }}
          >
            {role.name}
          </button>
        ))}
        <button
          type="button"
          role="option"
          aria-selected={draft.id === null}
          className={`${styles.chip} ${styles.chipNew}`}
          onClick={() => {
            setDraft(draftOf(undefined));
            setError(null);
          }}
        >
          ＋ Novo
        </button>
      </div>

      <TextInput label="Nome" value={draft.name} maxLength={MAX_ROLE_NAME_CHARS} placeholder="Ex.: Revisor de UI" onChange={(event) => change({ name: event.target.value })} />

      <div className={styles.field}>
        <span className={styles.label}>Cor</span>
        <div className={styles.swatches} role="radiogroup" aria-label="Cor do selo">
          {ROLE_COLORS.map((color) => (
            <button
              key={color}
              type="button"
              role="radio"
              aria-checked={draft.color === color}
              aria-label={color}
              title={color}
              className={styles.swatch}
              style={{ '--role': roleColorVar(color) } as CSSProperties}
              onClick={() => change({ color })}
            />
          ))}
          <span className={styles.preview} style={{ '--role': roleColorVar(draft.color) } as CSSProperties}>
            {draft.name.trim() || 'Papel'}
          </span>
        </div>
      </div>

      <div className={styles.suggestions}>
        <Select label="Motor" value={draft.engine} options={engineOptions} onChange={(engine) => change({ engine })} />
        <Select label="Modelo" value={draft.model} options={MODEL_OPTIONS} onChange={(model) => change({ model })} />
        <Select label="Esforço" value={draft.effort} options={EFFORT_OPTIONS} onChange={(effort) => change({ effort })} />
        <Select label="Permissões" value={draft.permissionMode} options={PERMISSION_OPTIONS} onChange={(permissionMode) => change({ permissionMode })} />
      </div>

      <label className={styles.field}>
        <span className={styles.label}>Orientação</span>
        {draft.id !== null && factoryRole(draft.id) ? (
          <span className={styles.note}>A parte de fábrica deste papel se atualiza sozinha a cada versão; o que você acrescentar ou mudar aqui vale como complemento.</span>
        ) : null}
        <textarea
          className={styles.guidance}
          value={draft.guidance}
          maxLength={MAX_ROLE_GUIDANCE_CHARS}
          rows={9}
          placeholder="O que este papel faz, o que não faz e como entrega."
          onChange={(event) => change({ guidance: event.target.value })}
        />
      </label>
      <p className={styles.note}>Vale para os lugares que ainda vão abrir ou retomar. O papel de um lugar não troca depois que ele começou.</p>
      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
    </Modal>
  );
}
