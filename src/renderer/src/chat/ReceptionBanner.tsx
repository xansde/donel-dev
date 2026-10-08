// T056 (014-chat) - the strips at the top of the conversation (G4):
//   coral : "O terminal precisa de você"
//   amber : "Não estou recebendo a conversa"
//   blue, compact : "Conversa nova - a anterior está em Sessões anteriores" (with "abrir")

import { Banner, Button } from '@donel-dev/design-system';
import { Info, Terminal, TriangleAlert } from 'lucide-react';
import type { ChatReception, TerminalNeededReason } from '../../../shared/chat/rows';

const TERMINAL_NEEDED_TEXT: Record<TerminalNeededReason, string> = {
  'permission-dialog': 'O Claude abriu uma tela de permissão que só funciona lá. Responda no terminal e a conversa continua aqui.',
  'interactive-screen': 'O Claude abriu uma tela que só funciona lá. Responda no terminal e a conversa continua aqui.',
  'hook-timeout': 'O chat não conseguiu acompanhar o que o Claude pediu. Responda no terminal e a conversa continua aqui.',
  unrecognized: 'Há uma tela no terminal que o chat não reconhece. Responda lá e a conversa continua aqui.',
};

export interface ReceptionBannerProps {
  reception: ChatReception;
  terminalNeeded: { readonly reason: TerminalNeededReason } | null;
  onOpenTerminal: () => void;
}

/** Renders nothing when the chat is receiving the conversation normally. */
export function ReceptionBanner({ reception, terminalNeeded, onOpenTerminal }: ReceptionBannerProps): React.JSX.Element | null {
  const openTerminal = (
    <Button variant="secondary" onClick={onOpenTerminal}>
      Abrir terminal
    </Button>
  );
  if (terminalNeeded) {
    return (
      <Banner
        tone="permission"
        role="alert"
        icon={<Terminal size={18} strokeWidth={1.75} />}
        title="O terminal precisa de você"
        actions={openTerminal}
      >
        {TERMINAL_NEEDED_TEXT[terminalNeeded.reason]}
      </Banner>
    );
  }
  if (reception !== 'ok') {
    return (
      <Banner
        tone="waiting"
        role="alert"
        icon={<TriangleAlert size={18} strokeWidth={1.75} />}
        title="Não estou recebendo a conversa"
        actions={openTerminal}
      >
        {reception === 'missing'
          ? 'Não achei o registro desta conversa no disco. O terminal continua funcionando normalmente.'
          : 'O registro da conversa parou de chegar. Veja no terminal o que está acontecendo.'}
      </Banner>
    );
  }
  return null;
}

export interface ConversationSwitchBannerProps {
  /** What caused the switch (`resume`, `clear`...), when the main process says so. */
  source?: unknown;
  onOpen: () => void;
}

/** FR-033 / G4: blue, compact. `/resume` gets its own wording. */
export function ConversationSwitchBanner({ source, onOpen }: ConversationSwitchBannerProps): React.JSX.Element {
  const resumed = source === 'resume';
  return (
    <Banner
      tone="accent"
      variant="compact"
      icon={<Info size={14} strokeWidth={1.75} />}
      title={
        resumed
          ? 'Você retomou outra conversa — a anterior está em Sessões anteriores'
          : 'Conversa nova — a anterior está em Sessões anteriores'
      }
      actions={
        <Button variant="link" onClick={onOpen}>
          abrir
        </Button>
      }
    />
  );
}
