import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { TextArea } from './TextArea';

const meta: Meta<typeof TextArea> = {
  title: 'Base/TextArea',
  component: TextArea,
  parameters: {
    docs: { description: { component: 'Multilinha que cresce até `maxRows` (padrão 10) e depois rola.' } },
  },
};

export default meta;
type Story = StoryObj<typeof TextArea>;

function Demo(props: { initial?: string; mono?: boolean; label?: string; maxRows?: number }) {
  const [value, setValue] = useState(props.initial ?? '');
  return <TextArea value={value} onChange={setValue} placeholder="Escreva aqui" {...props} />;
}

export const Vazia: Story = { render: () => <Demo label="Mensagem" /> };
export const Longa: Story = { render: () => <Demo label="Mensagem" initial={Array.from({ length: 14 }, (_, i) => `linha ${i + 1}`).join('\n')} /> };
export const Mono: Story = { render: () => <Demo label="Comando" mono initial="!git status" /> };
