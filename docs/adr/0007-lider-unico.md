# ADR 0007 — Um Líder só, para todos os quadros

**Data:** 2026-11-04 · **Status:** aceito (pedido do dono: "os líderes de cada mindscape deve ser apenas uma sessão
única que se comunica com todos os mindscapes. Essa eu acesso pelo jobu. O resto é resto.")

## Contexto

Cada quadro do Mindscape tinha o seu Líder (Donel Dev; Dalton na Homologação; Theo West no BizOps), e o Jobu falava
com o Líder do projeto selecionado. O MCP `donel` só enxergava o quadro da própria sessão e `sessao_enviar` só andava
pelas setas desse quadro, então um quadro não falava com outro: um recado da Homologação para o BizOps passou pelo dono
em arquivo (`handoffs/2026-11-04-feedback-alexandre-sessoes-e-quadros.md`, seção 2).

## Decisão

- **Um Líder só.** É uma sessão do app com o papel `lider` e **sem projeto** (`isLeaderOfAllTab`: aba `claude`, papel
  `lider`, sem `projectName`). O Jobu abre e conversa com ela; a primeira mensagem a cria se não houver uma viva. Roda
  neste computador, na pasta que contém os projetos dos quadros (`leaderHome`: `…\seazone`), para ler qualquer um.
  Não tem lugar em quadro nenhum.
- **O quadro vira parâmetro.** `quadro_ler`, `sessao_listar`, `sessao_abrir`, `sessao_enviar`, `sessao_ver_tela` e
  `quadro_aplicar` ganham `quadro` (nome ou pasta do projeto). O Líder único sem `quadro` recebe a lista de quadros;
  `sessao_quem_sou` também a devolve. As outras sessões seguem presas ao próprio quadro: `quadro` de outro projeto é
  recusado.
- **A regra da seta continua, com ligações derivadas, nunca gravadas.** O Líder único não tem cartão, então o que o liga
  a um lugar sai do que o dono desenha (`leaderReaches`):
  - ele fica acima do topo de cada quadro: um lugar para o qual nenhum outro **lugar** aponta seta responde a ele
    (post-it apontando para lugar é nota, não chefe);
  - as setas que saem de um lugar com papel `lider` (os Líderes antigos de quadro) contam como dele: quem eles
    dirigiam, ele dirige.
  - Uma sessão que ele abre nasce sem seta apontando para ela, então nasce ligada a ele. Se o dono desenhar uma seta
    de outro lugar para ela, ela passa para baixo desse lugar e o Líder fala com ela por ele. O dono decide desenhando;
    nada invisível fica guardado.
- **Avisos "terminou".** Toda sessão ligada a ele (em qualquer quadro) e toda sessão que ele abriu o avisa no fim do
  turno, com o nome do quadro no aviso.
- **Teto de sessões abertas por ele:** 4 por quadro (o mesmo `OPEN_CAP`), depois o dono permite.
- **Sem campo novo no `mindscape.json`** (`schemaVersion` fica): nada novo é gravado.

## Migração dos Líderes de quadro

- Os lugares com papel `lider` **ficam onde estão**, com a conversa, as setas e o papel. Nenhum lugar nem conversa é
  apagado. Viram **lugares comuns**: o Jobu deixa de falar com eles, e uma aba deles aberta segue funcionando como
  qualquer sessão do quadro (com as setas que tinha).
- As setas deles passam a valer para o Líder único (regra acima), então o time de cada quadro continua alcançável sem o
  dono redesenhar nada. Na Homologação: o Líder antigo aponta para o Dalton, logo o Líder único fala com o Dalton. No
  BizOps: ninguém aponta para o Theo West, logo ele está no topo e o Líder único fala com ele.
- Quando quiser, o dono arquiva os Líderes antigos no quadro (gesto dele). As setas que saíam deles somem junto; os
  lugares que eles apontavam sobem para o topo e continuam ligados ao Líder único.

## Consequências

- Uma aba antiga com papel `lider` **num projeto** não é o Líder único (tem projeto). O alcance entre quadros do PR #207
  (`reach.ts`, botão "Alcance" no quadro) nasceu para o Líder de um quadro; com o Líder único, o `canReach` dele precisa
  aceitar "vindo do Líder único" (`leaderReaches` direto ou abaixo dele em cadeia). Combinado com o Dev daquele PR.
- O Líder único some se a aba fechar; a próxima mensagem pelo Jobu abre outro, sem a conversa anterior. Retomar a
  conversa do Líder após reiniciar o app fica para a V2 (hoje só volta junto com as abas depois de uma atualização, B33).

## Fica para depois (V2)

- Um cartão do Líder em cada quadro, para o dono **ver e desenhar** as setas dele (hoje são derivadas e só aparecem em
  `podeMandar` / `voceAlcanca` das ferramentas).
- Retomar a conversa do Líder único depois de reiniciar o app.
- Líder único rodando num lugar remoto (VPS); hoje roda sempre neste computador.
- "Onde roda" por quadro (Dalton e Theo West na VPS por padrão) para as sessões que o Líder abre; hoje vale o `onde` da
  chamada, e sem ele, este computador.
