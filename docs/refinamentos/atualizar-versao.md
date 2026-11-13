---
tema: atualizar-versao
data: 2026-11-03
taskdex: []  # sem card: ferramenta pessoal, por decisão do dono
status: fechado
participantes: ["Alexandre Lentz"]
fechado-por: Claude por delegação de Alexandre Lentz, 2026-11-03
---

> **Atualizado em 12/11.** O que está abaixo é o desenho de 03/11 e não vale mais em dois pontos. (1) A
> detecção por `installersDir` e `ultimo-commit.txt` foi substituída por `electron-updater` lendo as releases
> do GitHub (`src/main/app-update.ts`): há versão nova quando a release Latest tem `latest.yml` com versão
> maior que a instalada, checada a cada 30 min (a primeira 15 s depois de abrir). (2) O `electron-updater`
> deixou de estar "fora desta entrega". O clique em Atualizar espera as sessões ou o prazo
> `appUpdate.forceAfterMinutes` (5 min por padrão). O build é sob demanda e o passo a passo para publicar o
> alfa está em [docs/alfa/gerar-alfa-no-pc.md](../alfa/gerar-alfa-no-pc.md).

# Refinamento — Atualizar para a versão nova de dentro do app (B33)

## Demanda

Dono, 03/11: "Já vai ter a funcionalidade de atualizar com o app rodando (mesmo que ele feche e
reabra)?" Hoje o alfa novo nasce toda manhã numa pasta e ele precisa achar e rodar o instalador.

## Regras fechadas (por delegação)

1. **Só o alfa empacotado.** A pasta dos instaladores é `appUpdate.installersDir` do `config.json`;
   sem a chave, `<home>/<nome do executável> - diario` (a pasta que a build diária escreve). Sem a
   pasta, o recurso some. Nada da Seazone no código: o repo público não tem a pasta e não vê nada.
2. **"Há versão nova?"** O app grava no build o commit de origem (`git rev-parse HEAD`, ou
   `DONEL_BUILD_COMMIT`) e a hora do build. Versão nova = `ultimo-commit.txt` traz outro commit, existe
   instalador `…-Setup-*.exe` e o mais novo (pela data no nome) é mais novo que o próprio app. Sem
   saber o próprio commit, nunca oferece. `FALHOU.txt` mais novo que `ultimo-commit.txt` vira "Build
   do alfa falhou · ver log" (abre o `build.log`). A pasta é relida a cada 10 min e quando a janela
   ganha foco.
3. **"Pode atualizar agora?"** O clique só pede. Sessão viva trabalhando (turno confirmado por hook, ou
   esperando agentes em segundo plano) ou com pergunta/permissão/plano aberto segura a troca: a barra
   mostra "Atualiza quando as sessões pararem (N trabalhando · M esperando você) · Cancelar". Sessão
   recém-aberta sem hook ouvido conta como parada. Nunca mata turno no meio.
4. **Retomar depois da atualização.** Antes de fechar, o app grava as abas abertas (projeto, pasta,
   nome, cor, papel, lugar do Mindscape de sessão que ainda não começou, conversa, flags de lançamento,
   vista chat/terminal, aba em foco) em `userData/app-update/<canal>/resume.json`. Na abertura
   seguinte, só se o arquivo existir, for do mesmo canal e tiver menos de 6 h, reabre as abas na mesma
   ordem com `-r <conversa>` (o cartão do Mindscape fica no lugar, porque a conversa é a mesma) e apaga
   o arquivo, restaurando ou não. Terminal livre reabre vazio. Aba de login de conta não volta. A
   restauração geral no boot (cancelada em 25/07) continua cancelada.
5. **A troca.** O app grava um ajudante PowerShell em `userData/app-update/<canal>/` e o abre
   destacado e oculto. Ele espera o processo do app sair (até 2 min; se não sair, não instala nada),
   espera os processos da pasta de instalação acabarem (até 30 s), roda o instalador com `/S` (até
   10 min) e reabre o app. Instalador com código diferente de 0, ou que passou do tempo, grava
   `result.json` e reabre o app de antes, que mostra "Atualização não concluída: …" na barra. A
   janela "O que mudou" já aparece na primeira abertura da versão nova.
6. **UI em pt-BR, discreta**, ao lado das Novidades na barra de status.

## Fora desta entrega

- Beta e stable (não têm pasta de instaladores; seguem à mão).
- Atualização automática por `electron-updater` (B17).
