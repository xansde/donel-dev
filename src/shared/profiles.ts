// T014 — tipos IPC do domínio de perfis (FR-005, FR-012, plan.md
// "profiles:list|create|activate|doctor"). `ProfileManager`
// (src/main/profile-manager.ts) e `quota-headroom.ts` são quem de fato lêem
// disco/spawnam `quota-axi`; este arquivo só espelha o contrato pro
// preload/renderer (mesmo padrão de src/shared/sessions.ts pro
// SessionIndexer). Canais além dos 4 originalmente listados em plan.md
// (`headroom`, `repair`) são extensão desta task — mesmo espírito de como
// T013 já tinha adicionado `sessions:list` sem estar detalhado no plan
// original.

export const PROFILE_CHANNELS = {
  list: 'profiles:list',
  create: 'profiles:create',
  activate: 'profiles:activate',
  doctor: 'profiles:doctor',
  /** T014 — não estava no plan.md original; ver comentário de topo. */
  repair: 'profiles:repair',
  /** T014 — não estava no plan.md original; ver comentário de topo. */
  headroom: 'profiles:headroom',
} as const;

export interface ProfileSummaryDto {
  readonly name: string;
  readonly slug: string;
  readonly isPrimary: boolean;
  readonly active: boolean;
}

export type JunctionIssueDto =
  | { readonly dirName: string; readonly kind: 'missing' }
  | { readonly dirName: string; readonly kind: 'wrong-target'; readonly actualTarget: string; readonly expectedTarget: string };

export interface ProfileDoctorReportDto {
  readonly slug: string;
  readonly junctionIssues: readonly JunctionIssueDto[];
  readonly settingsMissing: boolean;
  readonly claudeMdMissing: boolean;
  readonly mcpServersDrift: boolean;
  readonly healthy: boolean;
}

/** `Record<slug, percent>` — `null` = perfil sem leitura confiável ("—", ui-spec §6); slug ausente = ainda não consultado. */
export type ProfileHeadroomMap = Record<string, number | null>;

/** API tipada exposta pelo preload em `window.donel.profiles`. */
export interface DonelProfilesApi {
  /** Sempre inclui o Principal (1º item) + os perfis em `~/.claude-profiles/*`. */
  list(): Promise<ProfileSummaryDto[]>;
  /** Cria o perfil (junctions + cópias + bootstrap + merge de mcpServers — spike T001); devolve a lista já atualizada. */
  create(name: string): Promise<ProfileSummaryDto[]>;
  /** Troca o perfil ativo (afeta só sessões `claude` novas, FR-005); devolve a lista já atualizada (campo `active`). */
  activate(slug: string): Promise<ProfileSummaryDto[]>;
  doctor(slug: string): Promise<ProfileDoctorReportDto>;
  /** Recria as junctions quebradas reportadas pelo último `doctor` (ui-spec §6 "Recriar links"); devolve o doctor já re-executado. */
  repair(slug: string): Promise<ProfileDoctorReportDto>;
  /** Leitura sob demanda, paralela, timeout 3s/cache 60s por perfil (FR-012) — nunca lança, nunca trava esperando todos. */
  headroom(): Promise<ProfileHeadroomMap>;
}

const ACCOUNT_NAME_PATTERN = /^Tecnologia Claude (\d+)$/;

/**
 * Puro — extrai o número de "Tecnologia Claude {n}" do nome de exibição do
 * perfil, ou `null` quando o nome não segue essa convenção (perfis de teste
 * como "spike-test"/"e2e-profile-test", ou o Principal). Usado pela UI pra
 * decidir se renderiza o `AccountBadge` do design-system (que hardcoda o
 * texto "Tecnologia Claude {accountNumber}") ou um rótulo genérico com o
 * nome cru — `AccountBadge` NÃO serve pra perfil com nome arbitrário.
 */
export function parseAccountNumber(profileName: string): number | null {
  const match = ACCOUNT_NAME_PATTERN.exec(profileName.trim());
  if (!match) return null;
  return Number(match[1]);
}
