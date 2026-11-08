// Sessão renovada em voo (B36) — the discreet strip above the active session: the renewal is close,
// due, or in progress. "Agora não" postpones it (and, mid-renewal, leaves the session as it is).

import { Banner, Button } from '@donel-dev/design-system';
import { TriangleAlert, RefreshCw } from 'lucide-react';
import { formatTokensK } from '../../../shared/sessionRenewal';
import type { RenewalBanner } from './useSessionRenewal';

function textOf(banner: RenewalBanner): string {
  switch (banner.kind) {
    case 'near':
      return `Contexto em ${formatTokensK(banner.tokens)} de ${formatTokensK(banner.threshold)}. Ao passar do limite, a sessão é renovada no fim de um turno, com passagem de bastão.`;
    case 'due':
      return `Contexto cheio (${formatTokensK(banner.tokens)}). A sessão vai ser renovada assim que este turno terminar.`;
    case 'asked':
      return 'Renovando a sessão: ela está escrevendo a passagem de bastão. A conversa continua aqui.';
    case 'live-work':
      return `A renovação espera o trabalho em andamento terminar: ${banner.liveWork}.`;
    case 'swapping':
      return 'Abrindo a sessão nova com a passagem de bastão…';
  }
}

export interface RenewalStripProps {
  banner: RenewalBanner;
  onSnooze: () => void;
}

export function RenewalStrip({ banner, onSnooze }: RenewalStripProps): React.JSX.Element {
  return (
    <Banner
      variant="compact"
      tone={banner.kind === 'near' ? 'muted' : 'accent'}
      icon={<RefreshCw size={14} strokeWidth={1.75} />}
      title={<span data-testid="renewal-strip-text">{textOf(banner)}</span>}
      actions={
        banner.kind === 'swapping' ? undefined : (
          <Button variant="link" onClick={onSnooze}>
            Agora não
          </Button>
        )
      }
    />
  );
}

export interface RenewalDeliveryStripProps {
  text: string;
  onDismiss: () => void;
}

/** The new session did not confirm it got the handoff: says so, with the file, until the owner dismisses it. */
export function RenewalDeliveryStrip({ text, onDismiss }: RenewalDeliveryStripProps): React.JSX.Element {
  return (
    <Banner
      variant="compact"
      tone="waiting"
      icon={<TriangleAlert size={14} strokeWidth={1.75} />}
      title={<span data-testid="renewal-delivery-text">{text}</span>}
      actions={
        <Button variant="link" onClick={onDismiss}>
          Entendi
        </Button>
      }
    />
  );
}
