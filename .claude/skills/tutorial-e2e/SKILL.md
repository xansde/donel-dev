---
name: tutorial-e2e
description: Use para transformar um fluxo de uso em um tutorial HTML com prints — dirigindo o app de verdade, fotografando cada passo com o alvo circulado, e gerando um arquivo local que ensina e, ao mesmo tempo, vale como e2e. Invoque quando alguém pedir "monta um tutorial disso", "documenta esse fluxo com prints", "prova que a tela funciona", ou antes de declarar pronta qualquer tela nova.
---

# Fazer um tutorial de uso (que também é o e2e)

O ato: **pegar um fluxo, executá-lo no app de verdade, fotografar cada passo e
entregar um HTML que ensina.** O mesmo artefato serve para duas coisas — ensina
quem nunca usou, e prova que a tela diz a verdade em cada estado.

Não é screenshot decorativo. É o app rodando, o clique acontecendo, e a tela
sendo lida.

## Iron Law

**Você tem que OLHAR cada print. Um por um.**

Gerar os prints e passar direto para o HTML é fazer teatro: o valor inteiro
está no que a imagem mostra e o teste não mostra. Em 03/08/2026, neste repo,
quatro defeitos de estado e vocabulário atravessaram **1.447 testes verdes** e
morreram no primeiro print — a tela dizia "em andamento" para uma fase que
ninguém tinha assumido, e prendia um card sem saída.

Se você não olhou, você não tem tutorial: tem uma pasta de PNG.

## As seis etapas

### 1. Escreva o fluxo em português, antes de codar

Uma linha por passo, do jeito que uma pessoa faria: *ligue o Modo Dev → abra a
Esteira → digite o título → crie → prepare a fase*. Se você não consegue
escrever a lista, não é hora de automatizar: é hora de usar o app à mão e
descobrir o fluxo.

Termine a lista com os **estados que precisam aparecer**. Um tutorial que só
mostra o caminho feliz esconde exatamente o que o leitor precisa reconhecer:
erro, vazio, coisa travada, coisa que falhou.

### 2. Traduza para um roteiro

Um arquivo em `roteiros/<nome>.spec.ts`. Cada passo vira uma chamada que diz o
título e a razão **em português** — é isso que vira a legenda no HTML:

```ts
await passo('Prepare a fase', botao, 'O app separa o contexto e trava o card.');
```

API, armadilhas e o esqueleto pronto: [`referencias/roteiro.md`](referencias/roteiro.md).

### 3. Rode

```powershell
npm run tutorial
```

build → roteiros → um `relatorio.html` por roteiro, em `.e2e-visual/<roteiro>/`.

### 4. Olhe cada print (a etapa que não se pula)

Abra as imagens e leia o que está escrito na tela, com estas perguntas:

- **A frase corresponde ao estado?** "Em andamento" para algo que não começou,
  "concluído" para o que falhou, "não realizada" para o que ninguém leu — é aqui
  que aparecem.
- **Dá para sair de todo estado que prende?** Trava, modal, carregamento: existe
  botão? Ele diz por que está desabilitado?
- **Vazou dado real?** Nome de card, cliente, proprietário, caminho com
  informação sensível. O relatório circula.
- **O anel está no alvo certo?** Se está no lugar errado, o roteiro fotografou
  depois da ação.

### 5. Conserte o APP, não o roteiro

Quando o print mostra algo errado, a tentação é ajustar o roteiro para a foto
sair bonita. **O print é o achado.** Conserte o app, desça a correção até a
função que produz o texto (não a frase onde ela apareceu) e leve teste junto.

Se o roteiro é que estava errado, conserte o roteiro — e anote na iteração,
porque roteiro errado costuma repetir.

### 6. Registre as iterações e entregue

Cada volta ganha uma entrada: **o que tentei → o que quebrou → o que mudei.**
No fim, nomeie os erros que se repetiram e a correção estrutural de cada um.
Isso vale mais que o tutorial: o tutorial documenta o app, o registro documenta
como o app quebra.

Entregue o HTML e o registro juntos.

## O que o relatório garante

- **Um arquivo só.** Prints embutidos: abre com duplo clique, vai por anexo, não
  depende de pasta ao lado nem de servidor.
- **Roteiro interrompido não some.** Morreu no passo 5? O HTML mostra os quatro
  primeiros, o passo onde parou e o motivo — e avisa se sobrou print sem passo.
- **Isolamento.** `--user-data-dir` temporário e diretórios de dado em `tmpdir`:
  um tutorial nunca escreve no estado real da máquina.
- **Tema claro e escuro**, porque quem lê pode não usar o seu.

## Comandos

| Comando | O que faz |
|---|---|
| `npm run tutorial` | build + todos os roteiros + um relatório por roteiro |
| `npx playwright test -c .claude/skills/tutorial-e2e/lib/playwright.config.ts` | só os roteiros (exige `npm run build` antes) |
| `node .claude/skills/tutorial-e2e/lib/relatorio.mjs` | só os relatórios, dos prints já capturados |
| `node …/relatorio.mjs <roteiro> --titulo "…"` | um relatório, com título próprio |

## Referências

- [`referencias/roteiro.md`](referencias/roteiro.md) — como escrever o roteiro: API, armadilhas, esqueleto.
- [`referencias/erros-conhecidos.md`](referencias/erros-conhecidos.md) — os erros que já se repetiram aqui, com a correção de cada um. Leia antes de investigar um novo.
- [`roteiros/esteira.spec.ts`](roteiros/esteira.spec.ts) — exemplo completo: o caminho de uma fase da Esteira, com os quatro estados que a spec 010 existe para não confundir.

## O que esta skill não é

- **Não substitui `npm test` nem o smoke.** Ela olha outra coisa: a frase que a
  interface escolhe para cada estado.
- **Não compara pixels.** Sem baseline, sem diff — o julgamento é humano, e é
  por isso que a saída é um documento legível em vez de verde/vermelho.
- **Não publica nada.** O HTML fica local.
