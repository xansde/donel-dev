---
name: esteira-implementar-3
description: "Use quando o Donel Dev disparar a fase Implementar de um item — o app deixou um `run-input.json` com o item em `subject.work_item_id` e espera de volta o que foi construído E o que pode ser conferido. Escreve código e teste na branch do item; nunca abre PR."
---

# Fase Implementar — esteira-donel 3.0.0

Você recebe **um item** já decidido e o constrói. O item é a unidade: uma
issue, uma spec, um ADR, um spike. O tipo dele decide como ele termina — e é
por isso que "implementar" não quer dizer a mesma coisa nos três ciclos.

| Ciclo do item `[D-4]` | Tipos | O que implementar significa aqui |
|---|---|---|
| Entrega de código | `issue`, `spec` | código e **teste** na branch do item |
| Artefato revisado | `process-map`, `adr` | o documento escrito, pronto para revisão |
| Pergunta respondida | `prototype`, `spike`, `eval` | a investigação feita e a **resposta**, inclusive negativa |

## Iron Law

**Toda fase Implementar termina declarando algo que outra pessoa consegue
conferir — e "não deu certo" conta.**

O contrato cobra `verification.recorded` de todo run bem-sucedido desta fase.
Não é burocracia: sem ela, "implementei" é afirmação sem lastro, e um item que
ninguém consegue verificar é indistinguível de um item que ninguém tocou. Foi
essa indistinção — ausência lida como negação — que produziu a tela mentirosa
de 03/08.

## Antes dos passos — onde moram as ferramentas

As `tools/` do fork ficam **dois níveis acima** desta `SKILL.md`, e a sessão da
fase abre no **repo alvo** — nunca dentro do fork. Caminho relativo (`python
tools/…`) não resolve nada daqui: resolva a raiz uma vez, pela própria
instalação.

```powershell
Split-Path (Split-Path @((Get-Item "$env:USERPROFILE\.claude\skills\esteira-implementar-3").Target)[0])
```

Use o caminho devolvido **por extenso** em todo comando `tools/` daqui para
baixo — é por isso que os exemplos escrevem `<raiz>/tools/…` em vez de uma
variável: variável de shell não sobrevive de um comando para o outro.

Comando sem saída = esta skill não foi instalada por junction (`README.md`,
seção "Instalar"). Pergunte onde está o fork; não adivinhe — a Iron Law desta
fase vale para o seu próprio caminho também.

## Passos

0. **Preflight mecânico.**

   ```bash
   ls docs/relatorio-*.md 2>/dev/null
   ```

   Arquivo encontrado = leia antes de agir; costuma nomear o erro que você
   está prestes a repetir. Nada encontrado, siga.

1. **Leia a ida.**

   ```bash
   python <raiz>/tools/read_input.py --input <run-input.json>
   ```

   `context.work_item` diz **o quê**: tipo, título, repo alvo e estado.
   `workspace` diz **onde**: o repo alvo veio explícito do disparo `[D-6]` —
   nunca abra a sessão noutro checkout porque "é obviamente esse". O
   `context.history` traz as fases anteriores, inclusive as que falharam, com o
   código do erro: repetir uma tentativa já reprovada é o desperdício mais caro
   da esteira. Se o item já passou pela fase Design, o mockup e o diagrama de
   arquitetura estão apontados por `artifact.recorded` no histórico — olhe
   antes de codar, não depois.

2. **Construa, com teste antes quando for código de produção.** A disciplina de
   TDD do repo alvo vale aqui: teste que falha → implementação mínima →
   refatora. Escrever a verificação é implementar; **rodar** a verificação como
   gate é a fase seguinte.

3. **Se o item não couber**, não force. Item que precisa de três sessões era
   dois itens: declare o que foi feito, use `phase.completed` com
   `inconclusive` e uma nota dizendo onde parou. Meia entrega declarada é
   informação; meia entrega escondida é retrabalho.

4. **Decida o que é fato.** A tabela é a mesma promessa do schema
   (`x-required-facts`), nomeada por esta fase:

   | Fato | Quando é obrigatório |
   |---|---|
   | `verification.recorded` | quando `outcome: "done"` — o que outra pessoa consegue conferir |
   | `phase.completed` | **sempre**, em todo run `status: success` |

   O que `verification.recorded` pode ser:
   - `check` — a verificação que você escreveu e rodou (`state: passed` se
     ficou verde, `failed` se você está entregando com ela vermelha e sabe
     disso);
   - `review` — o documento pronto para alguém revisar (`state: pending`);
   - `conclusion` — a resposta do spike/eval, inclusive "não dá"
     (`state: passed` = a pergunta foi respondida; o texto vai em `ref`).
   - `pull-request` **não** é desta fase: aqui não se abre PR.

   E o resto:
   - `artifact.recorded` — o ponteiro do que ficou fora do código: a spec, o
     documento, o relatório. `location: "repo"` exige `repo`; `location:
     "disk"` proíbe. Ponteiro que não resolve não é ponteiro `[D-8]`.
   - `note.recorded` — o que um humano precisa ler depois e não cabe em campo.

   `phase.completed` leva o outcome certo: `done` quando entregou, `abandoned`
   quando o item morreu aqui, `inconclusive` quando terminou sem fechar. As
   três são respostas.

   **A forma é o corpus, não a memória.** Veja
   `src/shared/esteira/contract/v1/examples/implementar-que-fecha-o-ciclo.json`
   (um run que fecha implementar E as fases seguintes, via A22) e
   `spike-inconclusivo.json` (um `conclusion` que respondeu "não dá" e ainda
   assim fechou `done`) antes de montar `facts.json`. `implementar-falhou.json`
   mostra a forma de um `status: "failed"`.

5. **Emita.**

   ```bash
   python <raiz>/tools/emit_result.py --input <run-input.json> --facts-file facts.json \
       --status success --model <modelo> --effort <esforço>
   ```

   O emissor recusa o que o app recusaria: fase sem os fatos que ela promete,
   id fora do padrão, artefato com ponteiro que não resolve. Se ele reclamar,
   **conserte o fato — não contorne a ferramenta**.

6. **Confira do outro lado do contrato antes de considerar a fase concluída.**

   ```bash
   npm run esteira:check -- <result.json escrito pelo passo 5>
   ```

   Só considere a fase concluída com exit 0. Reclamou, conserte os fatos e
   emita de novo.

7. **Se a fase falhou**, emita mesmo assim:

   ```bash
   python <raiz>/tools/emit_result.py --input <run-input.json> --facts-file facts.json \
       --status failed --failure-code <código> --failure-message "<o que houve>"
   ```

   Run que falhou **não** é cobrado pela tabela de fatos: o que se cobra é
   promessa cumprida. O que ele precisa é do motivo — "falhou, não sei por quê"
   é o mesmo "não sei" travestido de fato.

## O que esta fase NÃO faz

- **Não abre PR, não faz merge, não move card em board.** Nunca foi da skill.
- Não conclui o item: quem declara o ciclo encerrado é a fase Concluir, e só
  com a verificação que passou.
- Não cria item novo — isso é da fase Plano (ou de uma invocação explícita da
  skill de criação, `[D-16]`).
- Não decide macro etapa: ela é **derivada** pelo app a partir dos seus fatos
  `[D-13]`.

## Racionalizações a combater

| O que passa pela cabeça | Por que não |
|---|---|
| "O código está lá, o app que veja" | O app não olha repo. O que você não declara, não aconteceu — e a tela vai dizer exatamente isso. |
| "Não tem o que verificar nesse item" | Então tem uma resposta: declare `conclusion`. Item sem nada conferível é item que ninguém sabe se foi feito. |
| "Deixa eu já abrir o PR, é o mesmo gesto" | Não é. PR é ato humano, e a fase que o registra é Concluir. |
| "O teste ficou vermelho, declaro `passed` e arrumo depois" | Aí a tela mente por escrito, e com a sua assinatura. `failed` é um estado; mentira não é. |
| "O repo é óbvio, uso o que está aberto" | Foi esse palpite que abriu uma fase no repo errado (evidência 2 da spec). O alvo vem do `workspace`. |
