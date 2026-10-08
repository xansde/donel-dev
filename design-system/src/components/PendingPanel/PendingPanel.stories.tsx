import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { CircleHelp, ListChecks, ShieldAlert } from 'lucide-react';
import { Button } from '../Button';
import { DiffBlock } from '../DiffBlock';
import { Kbd } from '../Kbd';
import { TextInput } from '../TextInput';
import {
  ChoiceCard,
  ClaudeNote,
  DiffStat,
  MonoChip,
  OtherChoice,
  PendingActions,
  PendingFrame,
  PendingIndent,
  PendingNote,
  PendingSpacer,
  PlanBody,
  PlanTitle,
  PreviewPane,
  QuestionBlock,
} from './PendingPanel';

const meta: Meta<typeof PendingFrame> = {
  title: 'Chat/PendingPanel',
  component: PendingFrame,
  parameters: {
    docs: {
      description: {
        component:
          'Painel de pendência acima da caixa (T03/T04/T05): pergunta, permissão e plano. Moldura com borda coral a 40%, cabeçalho com "mais N esperando", miolo que rola e rodapé fixo.',
      },
    },
  },
};

export default meta;
type Story = StoryObj<typeof PendingFrame>;

function QuestionDemo() {
  const [one, setOne] = useState('last');
  const [many, setMany] = useState<string[]>(['sim']);
  const [other, setOther] = useState('');
  return (
    <PendingFrame
      ariaLabel="Pergunta do Claude"
      icon={<CircleHelp size={16} strokeWidth={1.75} />}
      title="O Claude pergunta"
      headerExtra={<PendingNote>2 perguntas, uma resposta</PendingNote>}
      waiting="mais 2 esperando"
      footer={
        <>
          <PendingNote>Responder envia as respostas juntas. O Claude espera por você.</PendingNote>
          <PendingSpacer />
          <Button variant="primary">Responder</Button>
        </>
      }
    >
      <QuestionBlock
        number={1}
        titleId="q1"
        title="Qual regra de arredondamento usar?"
        hint="escolha uma"
        multiple={false}
        options={[
          { id: 'last', label: 'Ajustar a última parcela', rec: true, desc: 'A diferença de centavos vai para a última parcela.' },
          { id: 'spread', label: 'Distribuir os centavos', rec: false, desc: 'Espalha a diferença pelas primeiras parcelas.' },
        ].map((o) => (
          <ChoiceCard
            key={o.id}
            kind="radio"
            checked={one === o.id}
            label={o.label}
            recommended={o.rec}
            description={o.desc}
            onSelect={() => setOne(o.id)}
          />
        ))}
        other={
          <OtherChoice kind="radio" active={false}>
            <TextInput placeholder="Escreva a sua regra" value="" onChange={() => undefined} aria-label="Outra regra" />
          </OtherChoice>
        }
        preview={<PreviewPane>{one === 'last' ? 'Parcela 1: R$ 333,33\nParcela 3: R$ 333,34' : null}</PreviewPane>}
      />
      <QuestionBlock
        number={2}
        titleId="q2"
        title="Onde aplicar?"
        hint="escolha uma ou mais"
        multiple
        options={['sim', 'rep', 'api'].map((id) => (
          <ChoiceCard
            key={id}
            kind="checkbox"
            compact
            checked={many.includes(id)}
            label={{ sim: 'Simulador', rep: 'Relatório de repasse', api: 'API pública' }[id]!}
            onSelect={() => setMany((m) => (m.includes(id) ? m.filter((x) => x !== id) : [...m, id]))}
          />
        ))}
        other={
          <OtherChoice kind="checkbox" active={other.trim() !== ''}>
            <TextInput placeholder="Outro lugar onde aplicar" value={other} onChange={(e) => setOther(e.target.value)} aria-label="Outro lugar" />
          </OtherChoice>
        }
      />
    </PendingFrame>
  );
}

export const Pergunta: Story = { render: () => <QuestionDemo /> };

export const PermissaoEdicao: Story = {
  render: () => (
    <PendingFrame
      ariaLabel="Pedido de permissão"
      icon={<ShieldAlert size={18} strokeWidth={1.75} />}
      title="O Claude quer editar"
      headerExtra={
        <>
          <MonoChip>src/simulador/parcelas.ts</MonoChip>
          <DiffStat added={3} removed={2} />
        </>
      }
      waiting="mais 1 esperando"
      footer={
        <PendingActions>
          <Button variant="primary">Permitir</Button>
          <Button variant="secondary">Permitir sempre neste projeto</Button>
          <Button variant="danger">Negar</Button>
          <PendingSpacer />
          <PendingNote>sempre: todas as edições neste projeto</PendingNote>
          <PendingNote>
            <Kbd>Esc</Kbd> nega
          </PendingNote>
        </PendingActions>
      }
    >
      <ClaudeNote>Troca o arredondamento por Decimal.</ClaudeNote>
      <PendingIndent>
        <DiffBlock
          showAll
          maxHeight={170}
          path="src/simulador/parcelas.ts"
          lines={[
            { kind: 'del', text: '  const installment = Number((total / count).toFixed(2));' },
            { kind: 'del', text: '  return installments;' },
            { kind: 'add', text: '  if (count < 1) throw new RangeError("count must be >= 1");' },
            { kind: 'add', text: '  const base = Math.floor((total / count) * 100) / 100;' },
            { kind: 'add', text: '  return installments;' },
          ]}
        />
      </PendingIndent>
    </PendingFrame>
  ),
};

export const PermissaoSubagente: Story = {
  render: () => (
    <PendingFrame
      ariaLabel="Pedido de permissão"
      icon={<ShieldAlert size={18} strokeWidth={1.75} />}
      title="O Claude quer rodar"
      headerExtra={<MonoChip>rg -n &quot;Math.round&quot; src</MonoChip>}
      waiting="mais 2 esperando"
      origin={{ name: 'Mapear usos de arredondamento', onOpen: () => undefined }}
      footer={
        <PendingActions>
          <Button variant="primary">Permitir</Button>
          <Button variant="secondary">Permitir sempre neste projeto</Button>
          <Button variant="danger">Negar</Button>
        </PendingActions>
      }
    >
      <ClaudeNote>Procura todas as chamadas de Math.round nos arquivos do projeto.</ClaudeNote>
    </PendingFrame>
  ),
};

export const Plano: Story = {
  render: () => (
    <PendingFrame
      ariaLabel="Plano proposto pelo Claude"
      icon={<ListChecks size={16} strokeWidth={1.75} />}
      title="Plano proposto"
      headerExtra={<PendingNote>aguardando a sua aprovação</PendingNote>}
      waiting="mais 1 esperando"
      footer={
        <>
          <Button variant="primary">Aprovar e seguir</Button>
          <Button variant="secondary">Pedir ajuste</Button>
          <PendingSpacer />
          <PendingNote>Aprovar libera o Claude para executar o plano.</PendingNote>
        </>
      }
    >
      <PlanBody>
        <PlanTitle>Trocar float por decimal.js no simulador</PlanTitle>
        <ol>
          <li>Instalar a biblioteca.</li>
          <li>Criar o módulo de dinheiro.</li>
          <li>Trocar o cálculo.</li>
        </ol>
      </PlanBody>
    </PendingFrame>
  ),
};
