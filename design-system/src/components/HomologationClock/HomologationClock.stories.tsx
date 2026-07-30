import type { Meta, StoryObj } from '@storybook/react';
import { HomologationClock } from './HomologationClock';

const meta: Meta<typeof HomologationClock> = {
  title: 'Modo Dev/HomologationClock',
  component: HomologationClock,
  parameters: {
    docs: {
      description: {
        component:
          'A janela de 24h da homologação (009-modo-dev-v3, extensão 6): horário-limite absoluto em mono, barra de 4px consumindo a janela, relativo como apoio, frase de consequência. Quatro degraus de urgência — os dois últimos piscam. Nunca lê `Date.now()`: `deadline`/`now` vêm de fora (ver `computeClockTier`, testado em `tests/homologationClock.test.ts`).',
      },
    },
  },
};

export default meta;
type Story = StoryObj<typeof HomologationClock>;

// Mesmas 4 horas do estudo `clockStudy` do mockup (`Modo Dev v3.dc.html:1120-1125`).
const NOW = new Date('2026-07-29T09:00:00Z').getTime();
const HOUR = 60 * 60 * 1000;

/** > 12h — janela recém-aberta. */
export const Tranquilo: Story = {
  args: { deadline: NOW + 18.5 * HOUR, now: NOW, absoluteLabel: 'amanhã (30/07) · 09:00' },
};

/** 4–12h — menos de meia janela. */
export const Atencao: Story = {
  args: { deadline: NOW + 7.2 * HOUR, now: NOW, absoluteLabel: 'hoje · 21:00' },
};

/** 0–4h — reta final, pisca 1s. */
export const Urgente: Story = {
  args: { deadline: NOW + 1.6 * HOUR, now: NOW, absoluteLabel: 'hoje · 15:30' },
};

/** <= 0h — prazo estourado, pisca mais fundo (mesma cadência de 1s, mergulho de opacidade maior). */
export const Estourado: Story = {
  args: { deadline: NOW, now: NOW, absoluteLabel: 'hoje · 09:00' },
};

/** Os 4 degraus lado a lado — igual ao estudo 2c do mockup. */
export const TodosOsDegraus: Story = {
  render: () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, width: 340 }}>
      <HomologationClock deadline={NOW + 18.5 * HOUR} now={NOW} absoluteLabel="amanhã (30/07) · 09:00" />
      <HomologationClock deadline={NOW + 7.2 * HOUR} now={NOW} absoluteLabel="hoje · 21:00" />
      <HomologationClock deadline={NOW + 1.6 * HOUR} now={NOW} absoluteLabel="hoje · 15:30" />
      <HomologationClock deadline={NOW} now={NOW} absoluteLabel="hoje · 09:00" />
    </div>
  ),
};

/**
 * Variante compacta — "promoção, não duplicação" à barra de status
 * (decisão A): usada só quando o degrau é `urgente` e o card saiu de foco.
 */
export const Compacto: Story = {
  args: { deadline: NOW + 1.6 * HOUR, now: NOW, absoluteLabel: 'hoje · 15:30', variant: 'compact' },
};

/** A compacta dentro de uma barra de status simulada, ao lado do resto do rodapé. */
export const CompactoNaBarraDeStatus: Story = {
  render: () => (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        height: 28,
        padding: '0 12px',
        background: 'var(--bg-panel)',
        borderTop: '1px solid var(--border)',
        fontFamily: 'var(--font-ui)',
        fontSize: 'var(--text-caption-size)',
        color: 'var(--text-muted)',
      }}
    >
      <span>Tecnologia Claude 3 · 58%</span>
      <span style={{ color: 'var(--border)' }}>·</span>
      <span>4 sessões</span>
      <span style={{ color: 'var(--border)' }}>·</span>
      <HomologationClock deadline={NOW + 1.6 * HOUR} now={NOW} absoluteLabel="hoje · 15:30" variant="compact" />
    </div>
  ),
};
