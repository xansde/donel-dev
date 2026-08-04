# Como escrever um roteiro

Um arquivo em `roteiros/<nome>.spec.ts`. Ele descreve o fluxo em português; a
captura registra; o relatório desenha. **Não existe template de HTML por
roteiro** — se você está editando HTML para acrescentar um passo, parou no
lugar errado.

## Esqueleto

```ts
import { test } from '@playwright/test';
import { abrirDonel, fecharDonel, fecharPortaDeEntrada, type RoteiroContexto } from '../lib/captura';

let ctx: RoteiroContexto;

test.beforeAll(async () => {
  ctx = await abrirDonel({ roteiro: 'minha-tela' });
});

test.afterAll(async () => {
  await fecharDonel(ctx);
});

test('o que eu quero provar', async () => {
  test.setTimeout(180_000);
  const { win, passo } = ctx;

  try {
    const botao = win.getByRole('button', { name: 'Salvar' });
    await passo('Salve o formulário', botao, 'Uma frase dizendo por que este passo importa.');
    await botao.click();

    await win.getByText('Salvo').waitFor();
    await passo('O estado depois de salvar', null, 'Sem alvo = fotografa a tela inteira, sem anel.');
  } catch (error) {
    // Roteiro que morre no meio ainda entrega valor.
    ctx.registraFalha(error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error));
    throw error;
  }
});
```

## API

| Chamada | O que faz |
|---|---|
| `abrirDonel({ roteiro, env?, viewport? })` | Abre o app isolado. `env` acrescenta variáveis (fixtures, overrides de path). Devolve o contexto. |
| `ctx.passo(titulo, alvo, nota?)` | Circula o alvo e fotografa. `alvo: null` = tela inteira sem anel. `titulo` e `nota` viram o texto do relatório. |
| `ctx.registraFalha(mensagem)` | Marca onde o roteiro parou. Sempre no `catch`. |
| `fecharPortaDeEntrada(win)` | Fecha o modal antigo que abre sozinho no Modo Dev. |
| `fecharDonel(ctx)` | Fecha o app e apaga os temporários. A saída fica. |
| `ctx.esteiraRoot` | Raiz temporária com `inbox/`, `outbox/`, `store/` — use para semear ou ler arquivos no meio do roteiro. |

## Regras

**`passo()` ANTES da ação, nunca depois.** O print mostra onde clicar. Se você
fotografar depois do clique, o anel aponta para o que já passou.

**Sempre `try/catch` com `registraFalha`.** Sem isso, um roteiro que morre no
meio some do relatório e você perde tudo o que ele já tinha visto.

**`fecharPortaDeEntrada(win)` depois de ligar o Modo Dev.** O modal do modelo
antigo abre sozinho, cobre a tela e mostra **os cards reais do board** — que não
podem vazar num relatório que talvez seja compartilhado.

**Nunca ancore em texto que o próprio fluxo altera.** `data-testid`, papel +
nome estável, ou posição. Já aconteceu: o roteiro procurava o card pelo título
enquanto a ingestão o renomeava.

**Semeie o estado ruim de propósito.** Um tutorial só do caminho feliz esconde
o que o leitor mais precisa reconhecer. Escreva um arquivo inválido, force um
erro, deixe algo travado — e fotografe.

**Use as ferramentas reais no meio do roteiro.** O roteiro da Esteira chama o
`emit_result.py` da skill 3.0 em vez de forjar um JSON: assim o e2e prova o
contrato dos dois lados, não só o do app.

## Saída

`.e2e-visual/<roteiro>/`:

| Arquivo | O quê |
|---|---|
| `NN.png` | um por passo, na ordem |
| `manifest.json` | título, nota e alvo de cada passo — a fonte do relatório |
| `relatorio.html` | o tutorial, prints embutidos, um arquivo só |

A pasta é ignorada pelo git: é saída regenerável.
