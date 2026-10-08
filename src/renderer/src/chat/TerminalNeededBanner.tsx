// T070 (014-chat) - the coral strip "O terminal precisa de você" (G4): one text per
// `terminalNeeded.reason` and the "Abrir terminal" button. It goes away by itself when the hub
// clears `LiveState.terminalNeeded` (input box back with no dialog).

import { Banner, Button } from '@donel-dev/design-system';
import { Terminal } from 'lucide-react';
import type { TerminalNeededReason } from '../../../shared/chat/rows';

export const TERMINAL_NEEDED_TEXT: Record<TerminalNeededReason, string> = {
  'permission-dialog': 'O Claude abriu uma tela de permissão que só funciona lá. Responda no terminal e a conversa continua aqui.',
  'interactive-screen': 'O Claude abriu uma tela que só funciona lá. Responda no terminal e a conversa continua aqui.',
  'hook-timeout': 'O chat não conseguiu acompanhar o que o Claude pediu. Responda no terminal e a conversa continua aqui.',
  unrecognized: 'Há uma tela no terminal que o chat não reconhece. Responda lá e a conversa continua aqui.',
};

export interface TerminalNeededBannerProps {
  reason: TerminalNeededReason;
  onOpenTerminal: () => void;
}

export function TerminalNeededBanner({ reason, onOpenTerminal }: TerminalNeededBannerProps): React.JSX.Element {
  return (
    <Banner
      tone="permission"
      role="alert"
      icon={<Terminal size={18} strokeWidth={1.75} />}
      title="O terminal precisa de você"
      actions={
        <Button variant="secondary" onClick={onOpenTerminal}>
          Abrir terminal
        </Button>
      }
    >
      <span data-testid="terminal-needed-text">{TERMINAL_NEEDED_TEXT[reason]}</span>
    </Banner>
  );
}
