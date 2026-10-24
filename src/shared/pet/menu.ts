// T047 (015-jobu-pet, US5, R13) - the right-click menu of the Jobu, as data. What the menu SAYS and in
// which order is decided here, pure and tested; the main only turns it into a native menu
// (src/main/pet/pet-menu.ts) and gets the chosen action back (`PetService.handleMenuAction`).
//
// Silenciar por 1 hora / Retomar avisos (FR-026, FR-027) · Liberar print por 1 minuto / Bloquear print agora
// (FR-035) · Fazer faxina / Faxinando… (016) · Tamanho > Pequeno, Médio, Grande, Muito grande (FR-033) · - · Voltar ao canto · Esconder.

import { PET_SIZE_PRESETS } from './placement';

/** What the owner can ask of the Jobu from the menu. */
export type PetMenuAction =
  | { readonly kind: 'silence' }
  | { readonly kind: 'resume' }
  | { readonly kind: 'releaseCapture' }
  | { readonly kind: 'blockCapture' }
  | { readonly kind: 'sweep' }
  | { readonly kind: 'size'; readonly size: number }
  | { readonly kind: 'home' }
  | { readonly kind: 'hide' };

/** An entry of the "Tamanho" submenu; `checked` marks the size in use. */
export interface PetMenuCheckItem {
  readonly label: string;
  readonly action: PetMenuAction;
  readonly checked: boolean;
}

export type PetMenuEntry =
  | { readonly type: 'item'; readonly label: string; readonly action: PetMenuAction; readonly enabled?: boolean }
  | { readonly type: 'submenu'; readonly label: string; readonly items: readonly PetMenuCheckItem[] }
  | { readonly type: 'separator' };

/** What decides the words of the menu: whether the notices are silenced, the print is released, and the size now. */
export interface PetMenuContext {
  readonly silenced: boolean;
  readonly captureReleased: boolean;
  readonly size: number;
  /** 016: a sweep is running, so the item says so and cannot be chosen again. */
  readonly sweeping: boolean;
}

export function buildPetMenu(context: PetMenuContext): readonly PetMenuEntry[] {
  return [
    context.silenced
      ? { type: 'item', label: 'Retomar avisos', action: { kind: 'resume' } }
      : { type: 'item', label: 'Silenciar por 1 hora', action: { kind: 'silence' } },
    context.captureReleased
      ? { type: 'item', label: 'Bloquear print agora', action: { kind: 'blockCapture' } }
      : { type: 'item', label: 'Liberar print por 1 minuto', action: { kind: 'releaseCapture' } },
    context.sweeping
      ? { type: 'item', label: 'Faxinando…', action: { kind: 'sweep' }, enabled: false }
      : { type: 'item', label: 'Fazer faxina', action: { kind: 'sweep' } },
    {
      type: 'submenu',
      label: 'Tamanho',
      items: PET_SIZE_PRESETS.map((preset) => ({ label: preset.label, action: { kind: 'size', size: preset.size }, checked: preset.size === context.size })),
    },
    { type: 'separator' },
    { type: 'item', label: 'Voltar ao canto', action: { kind: 'home' } },
    { type: 'item', label: 'Esconder', action: { kind: 'hide' } },
  ];
}
