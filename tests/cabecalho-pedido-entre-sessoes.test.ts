import { describe, expect, it } from 'vitest';
import { parseBoardToolCall } from '../src/shared/mindscape/agent-tools';
import { taskHeaderSourceOf, withTaskHeader } from '../src/shared/mindscape/task-header';

// t-057bf559 — the usage collector keeps only 300 characters of each request. A message between sessions that names
// its task must open with "[t-xxxx] título: objetivo", and what comes below must arrive untouched.

const TASK = taskHeaderSourceOf(
  JSON.stringify({
    id: 't-057bf559',
    titulo: 'Pedido entre sessões abre com tarefa e objetivo',
    criterio: 'Toda mensagem que uma sessão recebe de outra começa, nos primeiros 300 caracteres, com o id da tarefa, o título e o objetivo em uma frase. Ideal: o app monta a linha sozinho.',
    pedido: 'x'.repeat(3000),
  }),
);

describe('cabeçalho do pedido entre sessões', () => {
  it('sessao_enviar e sessao_abrir aceitam o id da tarefa', () => {
    const sent = parseBoardToolCall('sessao_enviar', { para: 'place:a', texto: 'oi', tarefa: 't-057bf559' });
    expect(sent.ok && sent.call.tool === 'sessao_enviar' && sent.call.tarefa).toBe('t-057bf559');
    const opened = parseBoardToolCall('sessao_abrir', { papel: 'dev', pedido: 'faça', tarefa: 't-057bf559' });
    expect(opened.ok && opened.call.tool === 'sessao_abrir' && opened.call.tarefa).toBe('t-057bf559');
    expect(parseBoardToolCall('sessao_enviar', { para: 'place:a', texto: 'oi', tarefa: 'qualquer coisa' }).ok).toBe(false);
  });

  it('abre com a linha da tarefa, dentro dos 300 com o prefixo de quem manda, e o texto abaixo chega igual', () => {
    const body = 'Contexto longo primeiro.\n'.repeat(40) + 'id no fim: t-057bf559';
    const out = withTaskHeader(body, TASK);
    const delivered = `◆ De Líder (place:bb9bfae3-65bd-428e-9574-700bbcbcdd38), quadro Donel Dev, tarefa completa: ${out}`;
    const firstLine = out.split('\n')[0]!;
    expect(firstLine.startsWith('[t-057bf559] Pedido entre sessões abre com tarefa e objetivo: Toda mensagem')).toBe(true);
    expect(delivered.slice(0, 300)).toContain(firstLine);
    expect(out.endsWith(`\n\n${body}`)).toBe(true);
  });

  it('não duplica a linha quando o texto já começa com "[t-", nem inventa sem tarefa', () => {
    expect(withTaskHeader('  \n[t-1234] já tem: x\n\nresto', TASK)).toBe('  \n[t-1234] já tem: x\n\nresto');
    expect(withTaskHeader('sem tarefa', null)).toBe('sem tarefa');
    expect(taskHeaderSourceOf('{"erro":"Não existe tarefa"}')).toBeNull();
  });
});
