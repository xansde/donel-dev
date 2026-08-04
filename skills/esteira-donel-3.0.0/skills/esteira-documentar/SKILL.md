---
name: esteira-documentar
description: Use quando o Donel Dev disparar a fase Documentar de um item — o app deixou um `run-input.json` e espera de volta o PONTEIRO do que foi escrito. Documento sem endereço declarado não conta como documentado.
---

# Fase Documentar — esteira-donel 3.0.0

Você registra o que precisa sobreviver ao item: a decisão que vale daqui para
frente, o mapa do processo, a lição que a próxima pessoa não descobriria lendo
o código.

## Iron Law

**Documentar termina com um ponteiro. Sem `artifact.recorded`, não houve
documentação — houve texto perdido.**

`[D-8]` existe para que "cadê o artefato?" tenha **uma** resposta, esteja ele
versionado no repo âncora ou solto no disco. Documento cujo endereço só existe
no histórico de um chat desaparece na próxima sessão; é a mesma classe de
perda que fez a esteira registrar fatos em vez de campos.

## Passos

1. **Leia a ida.**

   ```bash
   python tools/read_input.py --input <run-input.json>
   ```

   `context.discovery` e `context.history` são o material: o problema, o que
   foi decidido, o que falhou no caminho. O que ficou só em nota é justamente o
   que costuma valer o documento.

2. **Decida se transcende o item.** Só vira ADR o que alguém precisaria saber
   em três meses e não descobriria lendo o código. Documento escrito por
   obrigação de processo não é lido por ninguém e ainda envelhece — se não há o
   que registrar, `phase.completed` com `abandoned` e uma nota dizendo por quê
   é um desfecho honesto.

3. **Escolha o lugar** `[D-8]`:
   - documentação de família (`spec`, `process-map`, `adr`) vai para o **repo
     âncora** — no Spotsys, tudo em `spotsys`, mesmo afetando `api-spotsys`;
   - `prototype` e `spike` **nunca** vão para repo: são efêmeros;
   - quando não faz sentido versionar, o artefato fica no disco — e o store
     guarda o ponteiro do mesmo jeito.

4. **Decida o que é fato:**

   - `artifact.recorded` — **obrigatório**. `owner` é a entidade que o
     documento serve (item, plano ou discovery); `artifact_kind` diz o que é
     (`adr`, `process-map`, `spec`, `runbook`); `location: "repo"` exige
     `repo`, `location: "disk"` proíbe.
   - `verification.recorded` com `review` — quando o documento precisa de
     aceite de alguém, `state: pending` até ele acontecer. É assim que o ciclo
     "artefato revisado" `[D-4]` fecha depois.
   - `note.recorded` — o que ficou de fora do documento de propósito.
   - `phase.completed` — **obrigatório**, com o outcome certo.

5. **Emita.**

   ```bash
   python tools/emit_result.py --input <run-input.json> --facts-file facts.json \
       --status success --model <modelo> --effort <esforço>
   ```

## O que esta fase NÃO faz

- **Não abre PR, não faz merge, não move card.**
- Não publica em lugar nenhum fora do que o ponteiro declara: enviar ao Slack,
  ao board ou a quem quer que seja é gesto humano.
- Não conclui o item — quem fecha o ciclo é a fase Concluir.
- Não decide macro etapa: o app deriva do grafo `[D-13]`.

## Racionalizações a combater

| O que passa pela cabeça | Por que não |
|---|---|
| "Está no PR/no chat, já está documentado" | PR e chat não são endereço estável. Sem ponteiro declarado, ninguém acha em três meses. |
| "Escrevo o documento depois e declaro agora" | Ponteiro para arquivo que não existe é ponteiro quebrado — pior que ausência, porque parece resolvido. |
| "Documento tudo, por garantia" | Documento que ninguém lê envelhece e passa a mentir. Registre o que transcende o item; o resto é ruído com data de validade. |
| "Não sobrou nada para documentar, deixo a fase em branco" | Fato nenhum = o app não sabe se você rodou. `abandoned` com a razão escrita é o desfecho honesto. |
