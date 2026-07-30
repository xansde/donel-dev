import type { Meta, StoryObj } from '@storybook/react';
import { useState } from 'react';
import { TAB_COLOR_TOKENS, TerminalTab, type TabColorToken } from './TerminalTab';

const meta: Meta<typeof TerminalTab> = {
  title: 'Sessão/TerminalTab',
  component: TerminalTab,
  parameters: {
    docs: {
      description: {
        component:
          'Abas do centro do shell principal — uma por sessão aberta. Variante v3 (009-modo-dev-v3, extensão 7): ícone de estado no lugar do farol (CA-28, pode piscar), faixa de cor definível pelo operador (CA-27) e alça de arraste para reordenar (CA-26). Dados de exemplo: "spec do donel" (trabalhando, fable), "radar spotsys" (aguardando, sonnet), "fix build_real.py" (encerrada, sonnet).',
      },
    },
  },
};

export default meta;
type Story = StoryObj<typeof TerminalTab>;

// --- Os 5 estados do ícone (CA-28) — glifos e cores medidos no handoff v3
// (`Modo Dev v3.dc.html:1075-1082`/`tabLegend` 1243-1249). `error` não está
// no handoff (só 4 dos 5 `SessionState` + o pseudo-estado "shell"); glifo
// escolhido por analogia ao `✕` de PhaseStateGlyph — ver comentário em
// TerminalTab.tsx. ---

/** Ícone `▶`, `--state-working`, pisca 2s (handoff `dd-blink`). */
export const WorkingTab: Story = {
  args: { name: 'spec do donel', model: 'fable', state: 'working', active: true, onClose: () => {} },
};

/** Ícone `◐`, `--state-waiting`, estático. */
export const WaitingTab: Story = {
  args: { name: 'radar spotsys', model: 'sonnet', state: 'waiting', onClose: () => {} },
};

/** Ícone `!`, `--state-permission`, pisca rápido 1s (handoff `dd-blink-fast`). */
export const PermissionTab: Story = {
  args: { name: 'onvio/etl', model: 'sonnet', state: 'permission', onClose: () => {} },
};

/** Ícone `■`, `--state-done`, estático. */
export const DoneTab: Story = {
  args: { name: 'fix build_real.py', model: 'sonnet', state: 'done', onClose: () => {} },
};

/** Ícone `✕`, `--state-error` — falha ou quota esgotada (glifo não coberto pelo handoff, ver comentário em TerminalTab.tsx). */
export const ErrorTab: Story = {
  args: { name: 'esteira-implementar · 143-f1', model: 'fable', state: 'error', onClose: () => {} },
};

/** Terminal comum, sem sessão Claude — ícone `❯`, `--text-muted`. */
export const CommonTerminalTab: Story = {
  args: { name: 'shell', onClose: () => {} },
};

// --- As 4 faixas de cor (CA-27) — paleta fixa medida no handoff v3 (`tabsRaw`, `Modo Dev v3.dc.html:1075-1079`). ---

/** Sem cor (default) — stripe neutro `var(--border)`, mesmo tom do handoff pra aba sem cor escolhida (`zsh`). */
export const NoColorTab: Story = {
  args: { name: 'zsh', color: 'none', onClose: () => {} },
};

/** Faixa `accent` (azul). */
export const AccentColorTab: Story = {
  args: { name: 'esteira-validacao · 143-f2', model: 'fable', state: 'working', color: 'accent', active: true, onClose: () => {} },
};

/** Faixa `donel-accent` (dourado). */
export const DonelAccentColorTab: Story = {
  args: { name: 'simulador/web', model: 'sonnet', state: 'waiting', color: 'donel-accent', onClose: () => {} },
};

/** Faixa `permission` (vermelho). */
export const PermissionColorTab: Story = {
  args: { name: 'onvio/etl', model: 'sonnet', state: 'permission', color: 'permission', onClose: () => {} },
};

/** CA-27 — clique direito na aba abre o menu de 4 faixas; escolher uma faixa fecha o menu e chama `onColorChange`. Story interativa (estado local só para demonstrar o gesto). */
export const InteractiveColorMenu: Story = {
  render: () => {
    function Demo() {
      const [color, setColor] = useState<TabColorToken>('none');
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <p style={{ font: 'var(--font-ui)', fontSize: 11, color: 'var(--text-muted)' }}>
            Clique com o botão direito na aba para escolher a cor.
          </p>
          <div style={{ display: 'flex', background: 'var(--bg-panel)', borderBottom: '1px solid var(--border)' }}>
            <TerminalTab name="spec do donel" model="fable" state="working" active color={color} onColorChange={setColor} onClose={() => {}} />
          </div>
        </div>
      );
    }
    return <Demo />;
  },
};

/** CA-26 — alça de arraste visível (`draggable`); a barra completa abaixo ilustra as 4 faixas de cor lado a lado, como no topo do centro do shell. */
export const TabBar: Story = {
  render: () => (
    <div style={{ display: 'flex', background: 'var(--bg-panel)', borderBottom: '1px solid var(--border)' }}>
      {TAB_COLOR_TOKENS.map((token, index) => (
        <TerminalTab
          key={token}
          name={['spec do donel', 'radar spotsys', 'onvio/etl', 'shell'][index]}
          model={index < 3 ? (index === 0 ? 'fable' : 'sonnet') : undefined}
          state={index === 0 ? 'working' : index === 1 ? 'waiting' : index === 2 ? 'permission' : undefined}
          color={token}
          active={index === 0}
          draggable
          onClose={() => {}}
        />
      ))}
    </div>
  ),
};
