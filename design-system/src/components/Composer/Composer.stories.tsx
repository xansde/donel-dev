import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { Banner } from '../Banner';
import { TextArea } from '../TextArea';
import { Composer } from './Composer';

const meta: Meta<typeof Composer> = {
  title: 'Chat/Composer',
  component: Composer,
  parameters: {
    docs: {
      description: {
        component:
          'Caixa de escrever do chat (T06). Ocioso: "Enviar" primário. Com `working`: SplitButton (clique = fila; menu = "Interromper e mandar agora").',
      },
    },
  },
};

export default meta;
type Story = StoryObj<typeof Composer>;

function Demo(props: Partial<React.ComponentProps<typeof Composer>> & { initial?: string; mono?: boolean }) {
  const { initial = '', mono, ...composer } = props;
  const [value, setValue] = useState(initial);
  return (
    <Composer onSend={() => setValue('')} onInterruptAndSend={() => setValue('')} sendDisabled={!value.trim()} footerHint {...composer}>
      <TextArea
        appearance="bare"
        aria-label="Mensagem para o Claude"
        placeholder="Escreva para o Claude"
        value={value}
        onChange={setValue}
        mono={mono}
      />
    </Composer>
  );
}

export const Ocioso: Story = { render: () => <Demo initial="Confere o contrato da API." /> };

export const Trabalhando: Story = { render: () => <Demo initial="Depois disso, rode os testes." working /> };

export const VariasLinhas: Story = {
  render: () => <Demo initial={Array.from({ length: 14 }, (_, i) => `linha ${i + 1}`).join('\n')} />,
};

export const ComandoEmMono: Story = { render: () => <Demo initial="/model" mono /> };

export const TextoNaoEnviado: Story = {
  render: () => (
    <Demo
      initial="oi"
      banner={
        <Banner tone="waiting" variant="compact" title="Há texto não enviado no terminal" />
      }
    />
  ),
};

export const AjusteNoPlano: Story = { render: () => <Demo initial="Troque o passo 3." adjust /> };
