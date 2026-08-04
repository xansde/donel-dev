# esteira-donel 3.0.0 — o lado skill do contrato

Fork da esteira que fala com o Donel Dev pelo **contrato v1** da spec 010.
Mora dentro deste repositório de propósito (decisão de 2026-08-03): o repo é o
dono do contrato, e manter a skill aqui elimina a cópia do schema — sem cópia,
não há divergência a conferir por hash, e o teste espelho roda no mesmo
`npm test` que o teste do lado app.

## O que muda em relação à 2.1.0

| 2.1.0 | 3.0.0 |
|---|---|
| Recebe contexto num `ctx.md` de texto livre | Recebe `run-input.json` com schema, validado |
| Devolve `<fase>-result.json` com campos de saída | Devolve `result.json` declarando **fatos** |
| O app **deduz** o que aconteceu de campos opcionais | O app registra só o que a skill **declara** |
| Campo que só um lado conhece passa despercebido | Campo desconhecido é **erro na hora**, dos dois lados |
| Trava por etiqueta no board | Trava é fato no log local, com dono, hora e sessão |

A 3.0 escreve **só** no formato novo. Gravar nos dois "por compatibilidade" foi
o que produziu o desencontro que originou a spec (D-3).

## Estrutura

```
tools/
  esteira_contract.py   as funções construtoras + EMITTED_PATHS/CONSUMED_PATHS
  read_input.py         lê o run-input.json e resume para a skill
  emit_result.py        CLI de emissão — a ÚNICA porta de saída
skills/
  esteira-discovery/    a fase Discovery
  esteira-plano/        a fase Plano
  esteira-implementar/  a fase Implementar
  esteira-validar/      a fase Validar
  esteira-documentar/   a fase Documentar
  esteira-concluir/     a fase Concluir
```

O ciclo completo, desde o batch B7 (2026-08-04). É o que permite um card rodar
de ponta a ponta no modelo novo — a condição que P-3 impôs para a 2.x sair de
`~/.claude/skills/`. Até ela sair, os dois convivem.

## O que cada fase promete declarar

A tabela `x-required-facts` mora no **schema**, não em regra escrita duas
vezes: o emissor a lê do arquivo canônico e o app carrega a mesma tabela como
cópia literal, conferida por teste.

| Fase | Além de `phase.completed` | Por quê |
|---|---|---|
| `discovery` | `discovery.recorded` | a raiz do card |
| `implementar` | `verification.recorded` | o que outra pessoa consegue conferir (check, review ou a resposta do spike) |
| `validar` | `verification.recorded` | rodar a verificação **é** validar (D-4) |
| `documentar` | `artifact.recorded` | D-8 — documento sem endereço não responde "cadê o artefato?" |
| `concluir` | `verification.recorded` | D-4 — o ciclo termina com evidência |

E um dente a mais: `concluir` com `outcome: done` exige uma
`verification.recorded` com `state: passed`. Desfecho ruim continua válido —
`abandoned` e `inconclusive` não pedem nada. A tabela só vale para run
`success`: o que se cobra é promessa **cumprida**, e run que falhou já declara
`failure` com código e motivo.

## Instalar

O Claude Code carrega skills de `~/.claude/skills/`. Aponte para cá com um
junction (Windows, não pede admin):

```powershell
foreach ($fase in 'discovery','plano','implementar','validar','documentar','concluir') {
  New-Item -ItemType Junction `
    -Path "$env:USERPROFILE\.claude\skills\esteira-$fase-3" `
    -Target "$PWD\skills\esteira-donel-3.0.0\skills\esteira-$fase"
}
```

Nomes com sufixo `-3` para conviverem com o plugin `esteira:` da 2.1.0 sem
conflito — os dois modelos coexistem até a virada.

## O teste que amarra os dois lados

`tests/esteiraSkillMirrorContract.test.ts` (na raiz do repo) roda o emissor
Python **de verdade** e confronta:

- todo campo do schema é escrito pela skill, e vice-versa;
- o que o app **lê** (`CONSUMED_PATHS`) é exatamente o que a skill **escreve**
  (`EMITTED_PATHS`);
- o que o app **grava** na ida (`PRODUCED_PATHS`) é exatamente o que a skill
  **lê** (`CONSUMED_PATHS` daqui);
- a skill **recusa emitir** o que o app recusaria ler.

`tests/esteiraEspinha.test.ts` fecha o ciclo: o app dispara, este emissor
responde, o app ingere, e o card mostra — inclusive quando o documento vem
fora do contrato.

**Mexeu no schema? Os dois lados mudam no mesmo commit,** senão `npm test`
quebra na hora. É o mecanismo funcionando.
