---
name: e2e-visual
description: Use para rodar um e2e do Donel Dev que FOTOGRAFA cada passo e gera um relatório HTML local — quando for preciso ver o que a tela diz em cada estado (não só se o código passa), validar uma tela nova antes de declarar pronto, ou produzir um passo a passo com prints. Gatilhos: "roda o e2e visual", "tira prints da tela", "monta o tutorial da tela X", "prova que a tela não está mentindo".
---

# e2e visual — o que a tela diz, fotografado

Roda um roteiro contra o app buildado, circula o alvo de cada passo, e gera um
**HTML local** com os prints e as legendas. Um arquivo só, abre com duplo
clique.

```powershell
npm run e2e:visual
```

Saída: `.e2e-visual/<roteiro>/relatorio.html` (+ os PNGs e o `manifest.json` ao
lado). A pasta é ignorada pelo git — é saída regenerável.

## Iron Law

**Teste verde não é tela honesta.**

Em 03/08/2026, quatro defeitos de estado e vocabulário atravessaram **1.447
testes verdes** e morreram no primeiro print: a tela dizia "em andamento" para
uma fase que ninguém tinha assumido, e mantinha um card travado sem saída. A
suíte não tinha como pegar — ela verifica o dado, não a frase que a interface
escolhe para ele.

Por isso: **toda tela nova passa por um roteiro daqui antes de ser declarada
pronta.** Custa segundos e olha o que o `npm test` estruturalmente não olha.

## Rodar

| Comando | O que faz |
|---|---|
| `npm run e2e:visual` | build + roteiros + relatório do roteiro `esteira` |
| `npx playwright test -c .claude/skills/e2e-visual/lib/playwright.config.ts` | só os roteiros (exige `npm run build` antes) |
| `node .claude/skills/e2e-visual/lib/relatorio.mjs <roteiro>` | só o relatório, a partir dos prints já capturados |
| `node …/relatorio.mjs <roteiro> --titulo "…"` | relatório com título próprio (útil quando vira tutorial) |

O roteiro roda **isolado**: `--user-data-dir` temporário e
`DONEL_ESTEIRA_{STORE,INBOX,OUTBOX}_DIR` em `tmpdir`. Nada toca o histórico
real da máquina — nem o `%APPDATA%`, nem o `~/.claude`.

## Escrever um roteiro

Um arquivo em `roteiros/<nome>.spec.ts`. O roteiro descreve o passo **em
português**; a captura registra; o relatório desenha. Não existe template de
HTML por roteiro.

```ts
import { test } from '@playwright/test';
import { abrirDonel, fecharDonel, fecharPortaDeEntrada, type RoteiroContexto } from '../lib/captura';

let ctx: RoteiroContexto;
test.beforeAll(async () => { ctx = await abrirDonel({ roteiro: 'minha-tela' }); });
test.afterAll(async () => { await fecharDonel(ctx); });

test('o que eu quero provar', async () => {
  const { win, passo } = ctx;
  try {
    const botao = win.getByRole('button', { name: 'Salvar' });
    await passo('Salve o formulário', botao, 'Uma frase dizendo por que este passo importa.');
    await botao.click();
    await passo('O estado depois de salvar', null, 'Sem alvo = fotografa a tela inteira, sem anel.');
  } catch (error) {
    ctx.registraFalha(error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error));
    throw error;
  }
});
```

Depois, acrescente o roteiro ao `e2e:visual` do `package.json` (ou gere o
relatório dele à mão com `relatorio.mjs <nome>`).

**Regras de roteiro:**

- **`passo()` antes da ação, não depois.** O print mostra onde clicar; se você
  fotografar depois do clique, o anel aponta para o que já passou.
- **Sempre embrulhe em `try/catch` com `registraFalha`.** Roteiro que morre no
  meio ainda vale: o relatório mostra até onde foi e por quê, em vez de sumir.
- **Chame `fecharPortaDeEntrada(win)` depois de ligar o Modo Dev.** O modal
  antigo abre sozinho, cobre a tela e mostra **os cards reais do board** — que
  não podem vazar num relatório que talvez seja compartilhado.
- **Nunca busque por texto que o próprio fluxo altera.** Use `data-testid`,
  papel + nome estável, ou posição.

## Os erros que se repetem (achados de 03/08/2026)

**1. A mesma palavra errada, em dois lugares.** "Em andamento" apareceu duas
vezes para um estado que não tinha começado: no bloco da trava e na lista de
fases. Consertar a frase onde ela aparece, sem consertar a função que a produz,
garante a terceira aparição. A correção desce até quem calcula o texto — e leva
teste junto.

**2. Estado que só sai por gesto de terceiro.** A trava do card dependia de a
skill declarar `lock.released`. Skill que morre no meio deixaria o card preso
para sempre — a *trava órfã* que a divergência D-V3 proibia, voltando por
omissão em vez de por arquivo. Todo estado que prende precisa de uma saída que
não dependa de quem pode sumir.

**3. Buscar por um texto que o próprio fluxo muda.** O roteiro procurava o card
pelo título enquanto a ingestão o renomeava. Vale para roteiro e para código:
âncora estável, nunca conteúdo variável.

**4. Print que vaza dado real.** A primeira captura pegou a lista de cards do
board do Alexandre dentro de um modal que abriu sozinho. Relatório é artefato
que circula: nenhum roteiro pode fotografar dado de trabalho real.

## O que esta skill NÃO é

- Não substitui `npm test` (vitest) nem `npm run test:smoke`. Ela olha outra
  coisa: a **frase** que a tela escolhe para cada estado.
- Não compara imagens entre execuções (sem baseline, sem diff de pixel). O
  julgamento é humano — e é justamente por isso que ela produz um relatório
  legível em vez de um verde/vermelho.
- Não publica nada. O HTML fica local.
