// CA-26/CA-27 (009-modo-dev-v3, lote 1) — canais IPC de `window.donel.tabs`,
// separados da lógica pura (`tabAppearance.ts`) pelo mesmo motivo de
// `sessions.ts`/`sessionRegistry.ts` serem dois arquivos: este precisa
// importar `AppConfigDto` de `./config` (o retorno de toda escrita, mesmo
// padrão de `sessions.setName`/`registerVisit`), e `tabAppearance.ts` fica
// livre de qualquer import — evita o único jeito de um ciclo real aparecer
// entre este domínio e `config.ts` (que importa `TabAppearanceMap` de
// `tabAppearance.ts` para o campo `AppConfigDto.tabAppearance`).

import type { AppConfigDto } from './config';
import type { TabColorToken } from './tabAppearance';

export const TAB_CHANNELS = {
  /** CA-27 — grava a cor escolhida pelo operador para a sessão. */
  setColor: 'tabs:setColor',
  /** CA-26 — grava a posição da aba depois de um arraste. */
  setOrder: 'tabs:setOrder',
} as const;

/** API tipada exposta pelo preload em `window.donel.tabs`. Só cobre abas `claude` — abas `shell` não têm `sessionId` que sobreviva a restart (ver comentário de `TabAppearanceMap`). */
export interface DonelTabsApi {
  /** CA-27 — grava a cor da aba desta sessão claude. Devolve o config atualizado, mesmo padrão de `sessions.setName`. */
  setColor(sessionId: string, color: TabColorToken): Promise<AppConfigDto>;
  /** CA-26 — grava a posição da aba desta sessão claude depois de um arraste (índice dela na lista de abas abertas no momento do drop). */
  setOrder(sessionId: string, order: number): Promise<AppConfigDto>;
}
