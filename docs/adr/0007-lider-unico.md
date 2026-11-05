# ADR 0007 — Um Líder só, para todos os quadros

**Data:** 2026-11-04 · **Status:** aceito (pedido do dono: "os líderes de cada mindscape deve ser apenas uma sessão
única que se comunica com todos os mindscapes. Essa eu acesso pelo jobu. O resto é resto.")

## Contexto

Cada quadro do Mindscape tinha o seu Líder (Donel Dev; Dalton na Homologação; Theo West no BizOps), e o Jobu falava
com o Líder do projeto selecionado. O MCP `donel` só enxergava o quadro da própria sessão e `sessao_enviar` só andava
pelas setas desse quadro, então um quadro não falava com outro: um recado da Homologação para o BizOps passou pelo dono
em arquivo (`handoffs/2026-11-04-feedback-alexandre-sessoes-e-quadros.md`, seção 2).

## Decisão

- **Um Líder só.** É a sessão que o **Jobu** abre: a aba ganha a marca `leaderOfAll` só por esse caminho
  (`liderDeliverRef` no `App.tsx`), e a marca volta junto depois de uma atualização (B33). `isLeaderOfAllTab` exige a
  marca e o papel `lider`; nunca reconhece pela falta de projeto. Um Líder aberto pelo Launcher, na VPS ou numa pasta
  fora da barra lateral é uma sessão comum do quadro dele. O Jobu conversa com ela; a primeira mensagem a cria se não
  houver uma viva. Roda neste computador, na pasta que contém os projetos dos quadros (`leaderHome`: `…\seazone`),
  para ler qualquer um. Não tem lugar em quadro nenhum.
- **O quadro vira parâmetro.** `quadro_ler`, `sessao_listar`, `sessao_abrir`, `sessao_enviar`, `sessao_ver_tela`, `sessao_fechar` e
  `quadro_aplicar` ganham `quadro` (nome ou pasta do projeto). O Líder único sem `quadro` recebe a lista de quadros;
  `sessao_quem_sou` também a devolve. As outras sessões seguem presas ao próprio quadro: `quadro` de outro projeto é
  recusado.
- **Uma regra de alcance só** (`src/shared/mindscape/reach.ts`, `canReach` com `LEADER_OF_ALL_FROM`). Regra do dono:
  "o do Donel Dev deve ser capaz de fechar sessões em qualquer mindscape, mas o Dalton, apenas dentro do seu próprio".
  - O Líder único fica **acima do topo de cada quadro**. Topo = lugar para o qual nenhuma **seta de hierarquia**
    aponta; seta de hierarquia é a do dono ou a que o `sessao_abrir` cria (`opened: true`). Ele alcança o topo e quem
    está abaixo dele por essas setas, direto ou em cadeia, em **qualquer** quadro, **sem** a marca "Alcance" (só ele
    dispensa a marca; o Líder de um quadro segue precisando dela para sair do próprio quadro).
  - Seta que uma sessão desenha (`quadro_aplicar`) não conta: não tira ninguém do topo nem põe ninguém acima.
  - Os Líderes antigos de quadro são lugares comuns: as setas do dono que saem deles valem como hierarquia normal
    (quem eles apontavam está abaixo do topo, então o Líder único alcança).
  - Mandar mensagem, fechar sessão (`sessao_fechar`) e dar tarefa no ledger (`tarefa_criar` com `dono`) usam esse
    mesmo alcance. As outras sessões seguem como antes: mensagem pela seta delas, fechar pela hierarquia do quadro.
  - Uma sessão que ele abre nasce sem seta (ele não tem cartão), então nasce no topo, ligada a ele. As que as outras
    sessões abrem seguem nascendo com a seta de abertura (`opened: true`).
- **Avisos "terminou".** Ele ouve as sessões que abriu e as que mandou trabalho por `sessao_enviar` (em qualquer
  quadro), com o nome do quadro no aviso. Não ouve o topo inteiro: o dono trabalha em sessões do topo, e cada fim de
  turno delas acordaria o Líder à toa.
- **Ledger.** As ferramentas `tarefa_*` aceitam `quadro` para o Líder único (criar e listar). Ele assina como o lugar
  `lider` (sem cartão), cria só com `dono` num lugar que alcança e não aceita entrega (não é Revisor). Sem `quadro`, a
  lista é de todos os quadros.
- **Teto de sessões abertas por ele:** 4 por quadro (o mesmo `OPEN_CAP`), depois o dono permite.
- **Sem campo novo no `mindscape.json`** (`schemaVersion` fica): nada novo é gravado.

## Migração dos Líderes de quadro

- Os lugares com papel `lider` **ficam onde estão**, com a conversa, as setas e o papel. Nenhum lugar nem conversa é
  apagado. Viram **lugares comuns**: o Jobu deixa de falar com eles, e uma aba deles aberta segue funcionando como
  qualquer sessão do quadro (com as setas que tinha).
- As setas deles (do dono) são hierarquia normal, então o time de cada quadro continua alcançável sem o dono
  redesenhar nada. Na Homologação: o Líder antigo está no topo e aponta para o Dalton, logo o Dalton está abaixo do
  topo e o Líder único fala com ele. No BizOps: ninguém aponta para o Theo West, logo ele está no topo.
- Quando quiser, o dono arquiva os Líderes antigos no quadro (gesto dele). As setas que saíam deles somem junto; os
  lugares que eles apontavam sobem para o topo e continuam alcançáveis.

## Consequências

- Uma aba com papel `lider` sem a marca do Jobu não é o Líder único, tenha projeto ou não. O alcance entre quadros do
  PR #207 (botão "Alcance") continua valendo para o Líder posto pelo dono num quadro; o Líder único é um ramo do mesmo
  `canReach`, não uma regra paralela (a `leaderReaches` da primeira versão deste ADR foi apagada na revisão de 05/11).
- O Líder único some se a aba fechar; a próxima mensagem pelo Jobu abre outro, sem a conversa anterior. Retomar a
  conversa do Líder após reiniciar o app fica para a V2 (hoje só volta junto com as abas depois de uma atualização, B33).

## Fica para depois (V2)

- Um cartão do Líder em cada quadro, para o dono **ver e desenhar** as setas dele (hoje são derivadas e só aparecem em
  `podeMandar` / `voceAlcanca` das ferramentas).
- Retomar a conversa do Líder único depois de reiniciar o app.
- Líder único rodando num lugar remoto (VPS); hoje roda sempre neste computador.
- "Onde roda" por quadro (Dalton e Theo West na VPS por padrão) para as sessões que o Líder abre; hoje vale o `onde` da
  chamada, e sem ele, este computador.
