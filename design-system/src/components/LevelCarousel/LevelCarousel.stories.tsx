import type { Meta, StoryObj } from '@storybook/react';
import { useState } from 'react';
import { LevelCarousel, type LevelCarouselCardContext, type LevelCarouselLevel } from './LevelCarousel';

const meta: Meta<typeof LevelCarousel> = {
  title: 'Modo Dev/LevelCarousel',
  parameters: {
    docs: {
      description: {
        component:
          'O trilho de dois eixos do mapa (009-modo-dev-v3, extensão 5): carrossel vertical de níveis, cada nível um carrossel horizontal de cards. Encurta quando um nível não existe (lista filtrada, nunca buraco) e absorve o caminho documental de 2 níveis com o MESMO componente. Geometria pura testada em `tests/carouselGeometry.test.ts`; aqui só a montagem visual.',
      },
    },
  },
};

export default meta;
type Story = StoryObj<typeof LevelCarousel>;

/** Conteúdo mínimo de card usado nas histórias — o LevelCarousel não sabe nada disto, só recebe via `renderCard`. */
interface DemoCardContent {
  icon: string;
  id: string;
  title: string;
  status: string;
  statusColor: string;
  plain: string;
}

function renderDemoCard(card: DemoCardContent, ctx: LevelCarouselCardContext) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', fontFamily: 'var(--font-ui)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 11px 0' }}>
        <span style={{ flex: 'none', fontSize: 11, color: ctx.focused ? 'var(--accent)' : 'var(--text-muted)' }}>{card.icon}</span>
        <span style={{ flex: 'none', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--accent)' }}>{card.id}</span>
        <span
          style={{
            flex: 1,
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            fontSize: 13,
            fontWeight: 600,
            color: 'var(--text-primary)',
          }}
        >
          {card.title}
        </span>
        <span
          style={{
            flex: 'none',
            display: 'inline-flex',
            alignItems: 'center',
            height: 18,
            padding: '0 7px',
            borderRadius: 4,
            fontSize: 10,
            whiteSpace: 'nowrap',
            color: card.statusColor,
          }}
        >
          {card.status}
        </span>
      </div>
      <div style={{ padding: '6px 11px 11px 30px', fontSize: 11.5, lineHeight: 1.5, color: 'var(--text-primary)' }}>{card.plain}</div>
    </div>
  );
}

const DISCOVERY_CARD: DemoCardContent = {
  icon: '◈',
  id: 'PRJ-142',
  title: 'Parcelamento no simulador',
  status: '1 plano rodando',
  statusColor: 'var(--accent)',
  plain: 'Deixar o cliente parcelar a cota corrigida pelo CUB — do cálculo até o repasse para a construtora.',
};

const PLANO_CARDS: DemoCardContent[] = [
  {
    icon: '▷',
    id: 'PRJ-143',
    title: 'Cálculo das parcelas',
    status: 'homologação aberta',
    statusColor: 'var(--state-waiting)',
    plain: 'Descobrir quanto o cliente paga por mês quando o valor do CUB muda.',
  },
  {
    icon: '▷',
    id: 'PRJ-144',
    title: 'Tela de simulação',
    status: 'conferir board',
    statusColor: 'var(--state-permission)',
    plain: 'A tela onde o corretor simula as parcelas junto com o cliente, antes de fechar negócio.',
  },
  {
    icon: '▷',
    id: 'PRJ-145',
    title: 'Relatório de repasse',
    status: 'Plano rodando',
    statusColor: 'var(--accent)',
    plain: 'O relatório mensal que diz quanto dinheiro repassar para cada construtora.',
  },
];

const IMPL_CARDS: DemoCardContent[] = [
  {
    icon: '⑂',
    id: 'fase 1',
    title: 'Tabela de coeficientes',
    status: 'PR #482 mergeado',
    statusColor: 'var(--zone-ok)',
    plain: 'Um PR só: tabela de coeficientes — implementação numa sessão única que orquestra subagentes.',
  },
  {
    icon: '⑂',
    id: 'fase 2',
    title: 'Serviço de parcelas',
    status: 'em execução',
    statusColor: 'var(--accent)',
    plain: 'Um PR só: serviço de parcelas — implementação numa sessão única que orquestra subagentes.',
  },
];

const VAL_CARD: DemoCardContent = {
  icon: '◷',
  id: 'fase 2',
  title: 'Serviço de parcelas',
  status: 'aguardando homologação',
  statusColor: 'var(--state-waiting)',
  plain: 'Provar em staging que o PR funciona — dentro da janela de 24h depois do merge.',
};

const DOC_CARD: DemoCardContent = {
  icon: '▤',
  id: 'PRJ-150',
  title: 'Documento do processo',
  status: 'em execução',
  statusColor: 'var(--accent)',
  plain: 'Um documento só: o caminho do dinheiro do boleto até a construtora, com os pontos de decisão.',
};

/**
 * Os 4 níveis do eixo vertical (CA-10), interativo: clicar no rótulo de um
 * nível move o foco no eixo Y; clicar num card fora de foco ou nas setas
 * `‹ ›` move o foco no eixo X daquele nível — os dois eixos navegáveis na
 * mesma história (CA-9).
 */
export const QuatroNiveisInterativo: Story = {
  render: () => {
    function Demo() {
      const [focusedLevelIndex, setFocusedLevelIndex] = useState(1);
      const [planoIdx, setPlanoIdx] = useState(0);
      const [implIdx, setImplIdx] = useState(1);

      const levels: LevelCarouselLevel<DemoCardContent>[] = [
        {
          key: 'discovery',
          label: 'Discovery',
          focusedCardIndex: 0,
          cards: [{ id: 'PRJ-142', accent: 'var(--accent)', content: DISCOVERY_CARD }],
          onFocusLevel: () => setFocusedLevelIndex(0),
        },
        {
          key: 'planos',
          label: 'Planos',
          tall: true,
          focusedCardIndex: planoIdx,
          cards: PLANO_CARDS.map((c) => ({ id: c.id, accent: c.statusColor, content: c })),
          onFocusLevel: () => setFocusedLevelIndex(1),
          onFocusCard: (i) => {
            setPlanoIdx(i);
            setFocusedLevelIndex(1);
          },
          onPrevCard: () => setPlanoIdx((i) => Math.max(0, i - 1)),
          onNextCard: () => setPlanoIdx((i) => Math.min(PLANO_CARDS.length - 1, i + 1)),
        },
        {
          key: 'impl',
          label: 'Implementação',
          focusedCardIndex: implIdx,
          cards: IMPL_CARDS.map((c) => ({ id: c.id, accent: c.statusColor, content: c })),
          onFocusLevel: () => setFocusedLevelIndex(2),
          onFocusCard: (i) => {
            setImplIdx(i);
            setFocusedLevelIndex(2);
          },
          onPrevCard: () => setImplIdx((i) => Math.max(0, i - 1)),
          onNextCard: () => setImplIdx((i) => Math.min(IMPL_CARDS.length - 1, i + 1)),
        },
        {
          key: 'val',
          label: 'Validação',
          focusedCardIndex: 0,
          cards: [{ id: 'val-2', accent: VAL_CARD.statusColor, content: VAL_CARD }],
          onFocusLevel: () => setFocusedLevelIndex(3),
        },
      ];

      return (
        <div style={{ width: 480, height: 500, background: 'var(--bg-panel)', border: '1px solid var(--border)' }}>
          <LevelCarousel levels={levels} focusedLevelIndex={focusedLevelIndex} renderCard={renderDemoCard} />
        </div>
      );
    }
    return <Demo />;
  },
};

/**
 * "Nível ausente não deixa buraco" (CA-14): só 3 níveis existem — o plano
 * não tem nenhuma fase de Implementação ainda, então esse nível nem entra
 * na lista (não é um nível vazio escondido, é um nível que não existe).
 */
export const TresNiveisSemImplementacao: Story = {
  render: () => {
    const levels: LevelCarouselLevel<DemoCardContent>[] = [
      {
        key: 'discovery',
        label: 'Discovery',
        focusedCardIndex: 0,
        cards: [{ id: 'PRJ-142', accent: 'var(--accent)', content: DISCOVERY_CARD }],
      },
      {
        key: 'planos',
        label: 'Planos',
        tall: true,
        focusedCardIndex: 2,
        cards: PLANO_CARDS.map((c) => ({ id: c.id, accent: c.statusColor, content: c })),
      },
      {
        key: 'val',
        label: 'Validação',
        focusedCardIndex: 0,
        cards: [{ id: 'val-2', accent: VAL_CARD.statusColor, content: VAL_CARD }],
      },
    ];
    return (
      <div style={{ width: 480, height: 500, background: 'var(--bg-panel)', border: '1px solid var(--border)' }}>
        <LevelCarousel levels={levels} focusedLevelIndex={2} renderCard={renderDemoCard} />
      </div>
    );
  },
};

/**
 * O caminho documental (CA-18): só 2 níveis — Discovery → Documentação —
 * com o MESMO trilho, nenhum componente separado para o track documental.
 */
export const CaminhoDocumentalDoisNiveis: Story = {
  render: () => {
    const levels: LevelCarouselLevel<DemoCardContent>[] = [
      {
        key: 'discovery',
        label: 'Discovery',
        focusedCardIndex: 0,
        cards: [{ id: 'PRJ-150-disc', accent: 'var(--accent)', content: DISCOVERY_CARD }],
      },
      {
        key: 'documentacao',
        label: 'Documentação',
        focusedCardIndex: 0,
        cards: [{ id: 'PRJ-150', accent: 'var(--donel-accent)', content: DOC_CARD }],
      },
    ];
    return (
      <div style={{ width: 480, height: 300, background: 'var(--bg-panel)', border: '1px solid var(--border)' }}>
        <LevelCarousel levels={levels} focusedLevelIndex={1} renderCard={renderDemoCard} />
      </div>
    );
  },
};

/**
 * Nível com 1 card = nenhum ornamento (Discovery, sempre único). Nível com
 * N cards = contador "N de M" + setas `‹ ›` (Planos, 3 cards) — os dois
 * lado a lado provam a condição `cards.length > 1` (CA-11/CA-13).
 */
export const OrnamentoCondicional: Story = {
  render: () => {
    const levelUnico: LevelCarouselLevel<DemoCardContent> = {
      key: 'discovery',
      label: 'Discovery — 1 card, sem ornamento',
      focusedCardIndex: 0,
      cards: [{ id: 'PRJ-142', accent: 'var(--accent)', content: DISCOVERY_CARD }],
    };
    const levelMultiplo: LevelCarouselLevel<DemoCardContent> = {
      key: 'planos',
      label: 'Planos — 3 cards, com ornamento',
      tall: true,
      focusedCardIndex: 0,
      cards: PLANO_CARDS.map((c) => ({ id: c.id, accent: c.statusColor, content: c })),
    };
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
        <div style={{ width: 480, height: 160, background: 'var(--bg-panel)', border: '1px solid var(--border)' }}>
          <LevelCarousel levels={[levelUnico]} focusedLevelIndex={0} renderCard={renderDemoCard} />
        </div>
        <div style={{ width: 480, height: 240, background: 'var(--bg-panel)', border: '1px solid var(--border)' }}>
          <LevelCarousel levels={[levelMultiplo]} focusedLevelIndex={0} renderCard={renderDemoCard} />
        </div>
      </div>
    );
  },
};
