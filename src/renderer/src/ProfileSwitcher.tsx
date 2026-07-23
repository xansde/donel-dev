import { AccountBadge, Button, Modal, TextInput } from '@donel-dev/design-system';
import { Check } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import type { ProfileDoctorReportDto, ProfileHeadroomMap, ProfileSummaryDto } from '../../shared';
import { parseAccountNumber } from '../../shared';
import styles from './ProfileSwitcher.module.css';

// T014 — badge da conta ativa (titlebar) + dropdown de perfis (ui-spec §6,
// FR-005/FR-012, CA-3). Auto-suficiente de propósito: diferente de
// PreviousSessions (cujo fetch mora em App.tsx porque o resultado alimenta
// `addTab`), a troca de perfil não afeta NENHUM estado de aba já aberta
// (FR-005 — "trocar de perfil afeta apenas sessões novas"; o main process já
// aplica o perfil ativo em todo `pty:create` claude futuro, ver
// src/main/index.ts `activeProfileConfigDir`) — então este componente só
// precisa de `window.donel.profiles.*`, sem props vindas de App.tsx.
//
// `AccountBadge` (design-system) hardcoda o texto "Tecnologia Claude
// {accountNumber}" — não serve pra perfis com nome arbitrário (Principal,
// ou perfis de teste como "spike-test"/"e2e-profile-test", que o smoke desta
// task cria pra provar isolamento sem exigir login humano). `parseAccountNumber`
// (shared/profiles.ts) decide: nome bate com a convenção -> AccountBadge de
// verdade; senão -> rótulo genérico com o nome cru (mesma cor de headroom).

const EMPTY_PROFILES: ProfileSummaryDto[] = [{ name: 'Principal', slug: 'principal', isPrimary: true, active: true }];

export interface ProfileSwitcherProps {
  /**
   * Reporta pra cima um rótulo pronto pra exibição ("Tecnologia Claude 3 ·
   * 62%" ou o nome cru quando não segue a convenção) — a Statusbar (ui-spec
   * §2 zona 5: "conta ativa") não tem acesso direto a `window.donel.profiles`
   * (App.tsx não busca perfil nenhum) e este componente já é quem faz esse
   * fetch; evita duplicar a chamada IPC só pra alimentar dois lugares.
   */
  onActiveProfileLabelChange?: (label: string) => void;
}

export function ProfileSwitcher({ onActiveProfileLabelChange }: ProfileSwitcherProps): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [profiles, setProfiles] = useState<ProfileSummaryDto[]>(EMPTY_PROFILES);
  const [headroom, setHeadroom] = useState<ProfileHeadroomMap>({});
  const [doctorReports, setDoctorReports] = useState<Record<string, ProfileDoctorReportDto>>({});
  const [repairingSlug, setRepairingSlug] = useState<string | null>(null);
  const [newProfileName, setNewProfileName] = useState('');
  const [creating, setCreating] = useState(false);

  const refreshProfiles = useCallback((): void => {
    void window.donel.profiles.list().then(setProfiles);
  }, []);

  // Doctor por perfil não-Principal (Principal é sempre saudável,
  // profile-manager.ts) — reaproveitado tanto na abertura do dropdown quanto
  // logo após criar um perfil novo (senão o perfil recém-criado ficaria sem
  // status de doctor até o dropdown ser fechado e reaberto).
  const refreshDoctorFor = useCallback((profileList: readonly ProfileSummaryDto[]): void => {
    for (const profile of profileList) {
      if (profile.isPrimary) continue;
      void window.donel.profiles.doctor(profile.slug).then((report) => {
        setDoctorReports((prev) => ({ ...prev, [profile.slug]: report }));
      });
    }
  }, []);

  // Lista básica carregada no boot (badge do titlebar precisa saber quem é a
  // conta ativa mesmo com o dropdown fechado) — sem headroom/doctor ainda
  // (FR-012: "leitura sob demanda", nunca no boot).
  useEffect(() => {
    refreshProfiles();
  }, [refreshProfiles]);

  // FR-012 — dispara SÓ quando o dropdown abre: headroom (paralelo/timeout/
  // cache já resolvidos no main, ver quota-headroom.ts) + doctor por perfil.
  useEffect(() => {
    if (!open) return;
    void window.donel.profiles.list().then((list) => {
      setProfiles(list);
      refreshDoctorFor(list);
    });
    void window.donel.profiles.headroom().then(setHeadroom);
  }, [open, refreshDoctorFor]);

  const handleActivate = (slug: string): void => {
    void window.donel.profiles.activate(slug).then(setProfiles);
  };

  const handleRepair = (slug: string): void => {
    setRepairingSlug(slug);
    void window.donel.profiles
      .repair(slug)
      .then((report) => setDoctorReports((prev) => ({ ...prev, [slug]: report })))
      .finally(() => setRepairingSlug(null));
  };

  const handleCreate = (): void => {
    const name = newProfileName.trim();
    if (!name || creating) return;
    setCreating(true);
    void window.donel.profiles
      .create(name)
      .then((list) => {
        setProfiles(list);
        setNewProfileName('');
        refreshDoctorFor(list); // perfil recém-criado já entra com status de doctor visível, sem precisar fechar/reabrir o dropdown.
      })
      .finally(() => setCreating(false));
  };

  const activeProfile = profiles.find((profile) => profile.active) ?? profiles[0];
  const activeAccountNumber = activeProfile ? parseAccountNumber(activeProfile.name) : null;
  const activeHeadroom = activeProfile ? (headroom[activeProfile.slug] ?? null) : null;

  useEffect(() => {
    if (!activeProfile) return;
    const percentText = activeHeadroom === null ? '—' : `${activeHeadroom}%`;
    const label = activeAccountNumber !== null ? `Tecnologia Claude ${activeAccountNumber} · ${percentText}` : activeProfile.name;
    onActiveProfileLabelChange?.(label);
  }, [activeProfile, activeAccountNumber, activeHeadroom, onActiveProfileLabelChange]);

  return (
    <>
      {/* `display: contents` — não participa do layout flex do titlebar como caixa própria; só serve de âncora estável pro smoke (T014), já que o filho alterna entre AccountBadge/botão genérico conforme `parseAccountNumber`. */}
      <span style={{ display: 'contents' }} data-testid="profile-switcher-trigger">
        {activeAccountNumber !== null ? (
          <AccountBadge accountNumber={activeAccountNumber} headroomPercent={activeHeadroom} expandable onClick={() => setOpen(true)} />
        ) : (
          <button type="button" className={styles.genericBadge} onClick={() => setOpen(true)}>
            <span>{activeProfile?.name ?? 'Perfil'}</span>
          </button>
        )}
      </span>

      <Modal open={open} onClose={() => setOpen(false)} title="Perfis de conta">
        <div className={styles.body} data-testid="profile-switcher">
          <ul className={styles.list}>
            {profiles.map((profile) => {
              const accountNumber = parseAccountNumber(profile.name);
              const percent = headroom[profile.slug] ?? null;
              const doctor = doctorReports[profile.slug];
              const unhealthy = doctor ? !doctor.healthy : false;

              return (
                <li key={profile.slug} className={styles.row} data-testid="profile-row" data-slug={profile.slug}>
                  {accountNumber !== null ? (
                    <AccountBadge
                      accountNumber={accountNumber}
                      headroomPercent={percent}
                      active={profile.active}
                      onClick={() => handleActivate(profile.slug)}
                    />
                  ) : (
                    <button type="button" className={styles.plainRow} onClick={() => handleActivate(profile.slug)}>
                      <span className={styles.plainName}>{profile.name}</span>
                      {profile.active ? <Check size={14} strokeWidth={1.5} aria-hidden="true" /> : null}
                    </button>
                  )}

                  {doctor && unhealthy ? (
                    <div className={styles.doctorWarning} data-testid="profile-doctor-warning">
                      <span>Junctions com problema</span>
                      <Button
                        variant="secondary"
                        onClick={() => handleRepair(profile.slug)}
                        disabled={repairingSlug === profile.slug}
                      >
                        {repairingSlug === profile.slug ? 'Recriando…' : 'Recriar links'}
                      </Button>
                    </div>
                  ) : null}
                  {doctor && !unhealthy ? (
                    <span className={styles.doctorOk} data-testid="profile-doctor-ok">
                      Perfil OK
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ul>

          <div className={styles.createForm}>
            <TextInput
              label="Novo perfil"
              value={newProfileName}
              onChange={(event) => setNewProfileName(event.target.value)}
              placeholder="ex.: Tecnologia Claude 4"
              onKeyDown={(event) => {
                if (event.key === 'Enter') handleCreate();
              }}
            />
            <Button variant="secondary" onClick={handleCreate} disabled={creating || !newProfileName.trim()}>
              {creating ? 'Criando…' : 'Criar perfil'}
            </Button>
          </div>

          <p className={styles.hint}>
            Trocar de perfil afeta só sessões novas — abas já abertas continuam com a conta que tinham. O login sempre acontece
            dentro do terminal (<code>/login</code>); o app nunca lê nem grava credenciais.
          </p>
        </div>
      </Modal>
    </>
  );
}
