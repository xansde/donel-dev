# 04 — O que cada tipo de decisão precisava mostrar e responder, e não conseguiu

> Levantamento, sem mudança de código. Base: worktree `oraculo-mesa` em `origin/staging` **56c7ca22**
> (merge do PR #382, 09/11/2026). Todo `arquivo:linha` é desse commit.
> Frase do dono que guia este documento: *"As cartas não mostram tudo que precisam mostrar, não são modulares
> para responder tudo que aparece"* (09/11). E o objetivo: *"Deve ser onde ficam as decisões que PRECISAM
> REALMENTE DE MIM. Seria por onde eu destravo tudo."*
> Limites respeitados: não proponho ligar Oráculo e ledger; andamento e histórico não entram como objetivo
> (aparecem só como o lugar onde hoje se esconde o que a carta deveria mostrar).

## 0. Fontes e como li

- **Todas as tarefas** pelo `mcp__donel__tarefa_listar {"todos": true, "situacao": "todas"}` em 09/11/2026
  (472 tarefas). Destas, **170 entregas têm o bloco `paraODono`**; 45 são cartas de Slack; 15 entregas de
  risco alto **não têm** o bloco (todas de 05–06/11, antes ou durante a forma A).
- **Cartas abertas uma a uma** com `mcp__donel__tarefa_ver`: t-6c504ed8, t-32b82559, t-678f3cb3, t-d37471a5,
  t-fd44bd79, t-986d4613, t-556daef7, t-c8a843dd, t-04d510ab, t-0dbcc00d, t-efeb0ca3, t-c74e5352, t-7753dcd0,
  t-ce521745, t-85a671ee.
- **O que o dono escreveu nas cartas** (eventos `comentada`, `aceita`, `rejeitada` com texto) pelo
  `~/bin/rotinas/ledger_resumo.py --dias 30` (o caminho sem segredo para ler o registro; fonte "espelho",
  473 tarefas). O `ledger.json` cru fica atrás da trava de segredos e não foi lido.
- **Molde**: `src/shared/ledger/contract.ts`, `src/shared/ledger/tools.ts`, `src/main/hill-climb-store.ts`,
  `src/main/vigia/vigia-service.ts`, `src/renderer/src/Mindscape/LedgerCards.tsx`,
  `src/renderer/src/HillClimb/HillClimbBar.tsx`. Histórico: `git log --all`, inclusive `origin/proto/cartas`.
- Os números de 02-tela-hoje.md (179 blocos, 25 textos do dono) vieram de outra leitura, feita mais cedo;
  aqui uso os meus (170 blocos pelo `tarefa_listar`; 25 textos do dono pelo `ledger_resumo.py`, que bateu).

## 1. O molde de hoje, em uma tela

Uma carta é **um** bloco `paraODono` (`contract.ts:86-97`):

| Peça | Regra | Fonte |
|---|---|---|
| `titulo` | opcional, 60 | `contract.ts:88`, `:1150` |
| `pergunta` | **uma**, 160 caracteres | `contract.ts:207` |
| `resumo` | 280 | `contract.ts:207` |
| `opcoes` | **2 a 4**, cada uma com rótulo (40), efeito (200), risco (160), `fecha` = `aceita`/`rejeitada`, **exatamente 1 recomendada** | `contract.ts:61-71`, `:207-211`, `:1142-1167` |
| `porque`, `risco` | 200 cada | `contract.ts:207` |
| `visual` | **um só**, de três tipos: `prova` (1 arquivo), `antes-depois` (2 arquivos), `checagens` (1 a 10) | `contract.ts:80-84`, `:212`, `:1155-1173` |
| texto do dono | nenhum código: crase, link, id, branch, PR, hash, caminho são recusados | `contract.ts:1105-1137` |

Jeitos de responder: escolher um caminho (fecha a tarefa); "Decidir assim" (texto livre vira a opção
`Outra`, fecha aceita; na carta de Slack fecha **rejeitada**, `contract.ts:1082-1091`); "Só perguntar" (texto
que vai à sessão e a carta fica, `LedgerCards.tsx:66-68`, `:124-136`). Nada mais.

Três moldes são **escritos pelo app**, sempre iguais:
- **Slack** (`slackForOwner`, `contract.ts:926-945`): "Posso mandar esta mensagem no Slack em seu nome?",
  **Enviar / Não enviar**; o texto exato vai como **prova de texto** (`contract.ts:975`).
- **Hill climbing** (`proposalCard`, `hill-climb-store.ts:335-346`): "Rodar esta missão de hill climbing?",
  **Rodar / Não rodar**; alvo e critérios só como prova de texto (`proposalText`, `:318-333`).
- **Vigia** (`vigiaCard`, `vigia-service.ts:102-125`): "Trava: VPS fora do ar. Já resolveu?", **Já resolvi /
  Deixar assim** (ou "Já vi / Quero entender" para a trava que passou).

Uso real do visual nas 170 cartas (contagem minha no `tarefa_listar`): 55 `checagens`, 49 `prova`, **1**
`antes-depois` (t-986d4613), 65 sem visual. Provas em arquivo no registro inteiro: 61 png, 49 html, 4 jpg,
**0 vídeo**. Opções: 111 cartas com 2, 56 com 3, 3 com 4.

## 2. O que o dono disse das cartas, nas palavras dele

Literal, com a carta e a hora (UTC) do evento:

| Quando | Carta | O que ele escreveu | O que revela |
|---|---|---|---|
| 05/11 | t-6c504ed8 (escolha da forma) | "A ideia é ser a forma A. Mas não existe suporte para eu ver os protótipos nas próprias cartas nem como escrever lá." (registrado pelo Líder único na decisão) | protótipo dentro da carta; escrever na carta |
| 06/11 16:46 | t-dab38f1d (Slack ao Lucas) | "Não dá pra ver mensagem alguma nesse cartão." | texto a aprovar invisível |
| 06/11 16:47 | t-556daef7 (Slack ao Filipe) | "Não vejo nenhuma mensagem no cartao" → rejeitou "Não enviar" | idem; e a rejeição não carregou o motivo |
| 06/11 16:49 | t-037fc748 (Slack ao Rosset) | "Não consigo ler mensagem alguma nesse cartão...." → "Não enviar" | idem |
| 06/11 15:46 | t-160aa3d3 (Filipe) | "Similar ao recomendado, mas não fala para revogar senha" | aprovar com ressalva / editar o texto |
| 06/11 16:48 | t-678f3cb3 (cadeiras, final) | "Não tá como eu havia esperado" → "Ajustar" | variantes e mistura de variantes |
| 06/11 16:46 | t-4604624e (cartas no celular) | "Quero ver no Pc. Não tá bom de conferir no celular ainda" | visual grande que não cabe no celular |
| 06/11 17:33 | t-efeb0ca3 (escrever) | "O problema é que o botão de escrever a opção mantém a carta no oráculo, mesmo após apertar em 'Enviar'." | resposta livre tem de decidir |
| 07/11 | t-b647b820 (pedido) | "Isso me incomoda muito. Eu escrevo minha própria opção e não some o cartão" | idem (corrigido em c20bcf23, 07/11) |
| 07/11 16:30 | t-356b8b45 (acessos da factory) | 7 respostas em texto corrido: "Conta google: Utilizará um grupo de e-mail… / O robô slack será o próprio Dalton… / Utilizará as contas da VPS… / Guardião da suíte oculta? WTF / …" | várias perguntas numa carta, cada uma com sua resposta |
| 07/11 17:52 | t-63186140 (Ledger v5) | registrou "Parar e repensar"; depois o Líder anotou que o dono apertou "só para limpar a tela" | falta "tirar da mesa sem decidir" |
| 08/11 16:31 | t-108852bf (Claude Code) | "SIA? Por que SIA?" | pergunta de esclarecimento, com a resposta voltando à mesma carta |
| 06–08/11 | 11 textos em 10 cartas **[corrigido pelo crítico: são 10 textos de devolução em 9 cartas. "Faz sem o OK do Fernando" (t-c6964cbb) é decisão, segundo o Líder: "Decidida pelo dono por escrito na própria carta". "Faz vocÊ uai" foi gravado 2× no mesmo minuto]** | "Faz vc esse ajuste" (t-3de1ce47), "Você mesmo vai organizar" (t-ece4a28c), "faça você mesmo" (t-25f4b31e, 2×), "Faça com a conta do businessoperations" (t-8dfdd191), "Faz sem o OK do Fernando. Só dale" (t-c6964cbb), "Faz vocÊ uai" (t-e470c49f, 2×), "Dalton que se vire" (t-b9232976), "uma ova, se vira… Usa o --admin" (t-6066c6aa), "Faça você. PAra de delegar pra mim" (t-54d85cbd) | a resposta mais comum em texto é **devolver a decisão** |
| 06/11 | t-babf5235, t-1905134e | "Já respondido. Card continua aqui" / "Já respondido. Apareceu repetido" | "já resolvido" como resposta de primeira classe |

## 3. Tipo por tipo

Para cada tipo: o caso real (título + o que a carta mostrou), o que faltou mostrar, o jeito de responder
que faltou, e os módulos necessários. Os nomes de módulo são os da gramática da seção 4.

### 3.1 Escolher entre protótipos ou variantes de tela

**Casos reais.**
- **t-32b82559** "Protótipos: Mindscape de cadeiras e tela de cadeiras" (06/11): 6 variantes em 2 conjuntos,
  4 provas em arquivo (3 png + 1 html). A frente mostrou **só a prova 1** (um índice em png); as opções eram
  "Planta + Seções" / "Cockpit + Orçamento" / "Trilhas + Cascata" / "Refazer" — combinações pré-montadas de
  **duas** escolhas independentes (quadro A1/A2/A3 × tela B1/B2/B3) espremidas em 4 botões, porque o máximo é 4
  (`contract.ts:211`). Dono escolheu "Planta + Seções".
  **[corrigido pelo crítico]** A prova 1 é **o índice que compara as 6 variantes lado a lado**: um png com as
  miniaturas A1–A3 e B1–B3, a marca "RECOMENDADA" e o bloco "Recomendação: A1, com a faixa de números do A3"
  (imagem devolvida por `tarefa_ver t-32b82559`). Nesse caso, ver lado a lado já era possível, como imagem
  parada. O que faltou foi abrir cada variante dentro da carta: as 6 páginas ficaram numa pasta do PC, e o único
  html anexado foi o índice ("Índice: C:\…\prototipos-cadeiras\index.html (leva às 6 variantes)", na prova de
  texto). Faltou também ligar cada variante a uma opção e escolher por eixo.
- **t-678f3cb3** "Cadeiras: protótipo final" (06/11): o pedido do dono já era uma **mistura** ("Prefiro a
  facilidade de leitura da A3, com o layout da A1 / B1: Coluna lateral de custo deve ser colapsavel") que ele
  teve de escrever fora da carta. A final tinha 4 png + 1 html; a frente mostrou só a prova 1; a pergunta
  "É assim que você quer?" com "Sim" / "Ajustar". Ele respondeu "Não tá como eu havia esperado".
- **t-6c504ed8** "4 formas da carta" (05/11, sem `paraODono`): 4 png; a escolha ("forma A") foi feita **no chat
  com o Líder único**, não na carta.
- **t-d37471a5** "Seus pedidos alinhado ao ledger" (09/11): 3 telas + "as cinco decisões" **dentro** de um
  protótipo html; a frente perguntou as duas coisas numa frase só ("Qual destas três telas… e posso seguir as
  recomendações das cinco decisões?").

**O que faltou mostrar.** **[corrigido pelo crítico: em t-32b82559 o lado a lado existiu como png-índice; o que faltou foi poder abrir cada variante na carta]** As variantes **lado a lado** na frente (hoje um visual só; o par `antes-depois` tem
rótulos fixos "Antes"/"Depois", `LedgerCards.tsx:259`, `:263`); cada variante **ligada ao seu botão** (a opção
não aponta para prova, `contract.ts:61-71`); o protótipo **navegável** de cada uma (hoje, um html por carta,
apontado como `visual.prova`); a diferença entre as variantes em uma linha cada.

**Jeito de responder que faltou.** Escolher variante **por eixo** (quadro × tela); **misturar** ("leitura da
A3 com layout da A1"); anotar uma ressalva **em cima da variante** ("coluna de custo recolhível"); "nenhuma
serve, refaça com…" sem gastar uma das 4 vagas de opção.

**Módulos.** Pergunta · Recomendação · Visual **Comparação** (N variantes, cada uma com protótipo embutido ou
imagem, rótulo livre e uma linha de diferença) · Resposta **Escolha de variante** (uma por eixo, com
"misturar" e ressalva por variante) · Saídas universais · Recolhidos (pedido literal, índice, detalhes).

### 3.2 Aprovar print ou vídeo (antes/depois)

**Casos reais.**
- **t-986d4613** "Validação da correção de segurança do TeamZone" (06/11): o **único** `antes-depois` do
  registro. Pergunta "Libero o merge?"; o resumo diz "17 telas principais… idênticas", mas a frente mostra
  **um** par de prints de uma tela (a ficha da Aurora Sampaio). As outras 16 comparações e o "pixel a pixel"
  ficaram numa prova de texto de 2264 caracteres, no verso.
- **t-dda3571f** "Mindscape mostra gargalos" (08/11): 1 png como `prova`, sem par.
- **t-4604624e** "Cartas grandes e legíveis no celular" (06/11): o visual que deveria provar a mudança não deu
  para conferir no celular — "Quero ver no Pc".
- **Vídeo**: 0 provas de vídeo no registro (seção 1), embora o contrato aceite mp4/webm/mov.

**O que faltou mostrar.** Vários pares (uma galeria de antes/depois, não um); o veredito por par ("igual",
"mudou aqui"); destaque do que mudou (contorno/realce); vídeo com o trecho que importa marcado; o lugar onde
ver melhor (PC × celular).

**Jeito de responder que faltou.** Aprovar **por item** da galeria (aceitar 16, apontar a 17ª); marcar um
ponto da imagem com um comentário; "conferir no PC depois" sem decidir.

**Módulos.** Pergunta · Visual **Antes/depois** em galeria (rótulos livres, veredito por par) ou **Vídeo**
(com marcas de tempo) · Checagens com a frase de todos os itens · Resposta **Botões** + **Itens** (aprovar por
par) + ressalva · Saída "Tirar da mesa por agora".

### 3.3 Comparar 2 a 4 opções técnicas ou de produto

**Casos reais.**
- **t-b3deea38** "Proxy nas VPS: vale usar, e como" (06/11): 4 opções ("Sem proxy + pedir chave de API" /
  "Ligar no proxy do Bill" / "Esperar o proxy do Márcio" / "Falta coisa"), visual = 1 html. O dono escolheu
  **a não recomendada** ("Ligar no proxy do Bill").
- **t-efbc8d92** "Faixa marrom" (06/11): 3 opções, visual `checagens(5)`; escolheu **a não recomendada**
  ("OpenRig + contas pelo OpenRig").
- **t-2b51f9df** "Dois rigs de homologação" (07/11): 3 opções, 2 png + 3 textos; a proposta comparada mora num
  FINAL.md/FINAL.html fora da carta (motivo de cancelamento da t-f4d478ee).

**O que faltou mostrar.** A comparação **em tabela** (critério × opção: custo, prazo, risco, quem depende de
quem); hoje cada opção tem só efeito (200) e risco (160), sem eixo comum; o "por que não as outras".

**Jeito de responder que faltou.** Escolher uma **e** dizer a condição ("Bill, mas se o Márcio subir até
sexta, troca"); pedir "falta informação" sem que isso gaste uma vaga de opção (em t-b3deea38 "Falta coisa"
ocupou a 4ª vaga).

**Módulos.** Pergunta · Recomendação · Visual **Tabela de comparação** (opções em colunas, critérios em
linhas) · Resposta **Botões** (com efeito e risco) + ressalva · Saída "Perguntar".

### 3.4 Aprovar texto exato (Slack, e-mail, nota de versão), com poder de editar

**Casos reais.** 45 cartas de Slack (33 aceitas, 8 canceladas, 4 rejeitadas) + **27 cartas de rascunho**
("Mandar o rascunho" / "Eu mesmo respondo" / "Não precisa responder").
- **t-dab38f1d**, **t-556daef7**, **t-037fc748** (06/11): a frente não mostrava a mensagem; ver seção 2. A
  sessão de t-dab38f1d contornou anexando um html só para exibir o texto ("A carta de envio não mostrava o
  texto. Reentregue com a mensagem exata na página da carta").
- **t-c8a843dd** "Mensagem para #plataforma-gestao-de-acessos" (07/11): o texto que saiu foi **"OK"** (2
  caracteres). A carta não mostrava a mensagem da thread que estava sendo respondida; o motivo foi cortado no
  resumo em 280 ("…o pedido é cancelad…", `clip`, `contract.ts:920-923`).
- **t-160aa3d3** "Filipe: três homologações" (06/11): o dono queria **o recomendado menos uma frase**
  ("Similar ao recomendado, mas não fala para revogar senha"); teve de escrever e esperar uma reentrega.
- **t-7753dcd0** "Julia: saldo errado no Spotômetro" (06/11): o rascunho estava num html (visual `prova`) e em
  prova de texto; a opção "Mandar o rascunho" diz "ela só vai ao Slack depois que você aceitar a carta do
  envio" — **duas cartas para uma mensagem**.
- **t-3d2528e5** "Arquivo no Slack para #retiro-ai" (08/11): carta de arquivo; o molde avisa "A carta confere o
  caminho e o nome, não o conteúdo: veja o arquivo antes" (`contract.ts:941-943`). O print não aparece. O dono
  rejeitou.
- E-mail e nota de versão: **não achei** nenhuma carta de aprovação de texto de e-mail nem de nota de versão.

**O que faltou mostrar.** O **texto inteiro na frente**, formatado como vai sair; o **destino** legível (canal,
pessoa) e **a mensagem que está sendo respondida** (thread); o anexo (imagem do arquivo); a diferença para a
versão anterior quando é reentrega.

**Jeito de responder que faltou.** **Editar o texto ali** e mandar a versão editada (hoje a rejeição manda
criar outra carta, `tools.ts:377`); aprovar com corte ("tira a frase da senha"); a opção "Não enviar" com um
motivo (as rejeições de 06/11 registraram só "Não enviar", e a sessão ficou sem saber o ajuste). E uma
aprovação só: rascunho + carta de envio viram uma carta.

**Módulos.** Pergunta · Contexto **citado** (mensagem original, quem, onde) · Visual **Texto a aprovar**
(com destino, thread, anexo e diferença) · Resposta **Editar texto** (pré-preenchido; enviar como está ou
editado) · Saídas universais.

### 3.5 Escolha entre opções com efeito (a decisão "clássica")

**Casos reais.** A maioria das 170. Exemplos: **t-4bd4bc80** "Apagar a tabela antiga de demandas" (Apagar /
Manter); **t-6b9a9605** "Automação do bom dia no WhatsApp parou" (dono escolheu a não recomendada, "Desligar a
automação"); **t-db38a77c** "Quem decide os problemas graves da vistoria" (Eu decido / Outra pessoa / Segurar).

**O que faltou mostrar.** Quase nada no formato; o que falta é **o prazo e o custo de não responder** em
destaque (hoje mora dentro de `risco`, 200 caracteres) e **a mensagem de quem pediu**, quando a decisão
nasceu de alguém (as 27 cartas de rascunho trazem a frase da pessoa só no pedido literal, recolhido).

**Jeito de responder que faltou.** Uma opção que **não fecha** a tarefa: todas fecham como `aceita` ou
`rejeitada` (`contract.ts:69-70`). E as respostas que o dono mais escreveu e não existem como botão:
**"Decida você"** (11 vezes, seção 2), **"Já resolvido / repetida"** (2 vezes), **"Agora não"** (t-63186140).

**Módulos.** Pergunta · Prazo · Recomendação · Resposta **Botões** · Saídas universais.

### 3.6 Resposta livre (o dono escreve)

**Casos reais.**
- **t-fd44bd79** "1:1s da semana" (09/11, ainda entregue): a sessão precisava de **uma frase** ("o que mudou?")
  e teve de embrulhar isso em 2 opções com uma recomendada: "Dizer o que mudou" (que **fecha rejeitada**) /
  "Manter a grade". O dono já tinha respondido antes só com o motivo de rejeição "o planejamento mudou".
- **t-356b8b45** "Acessos próprios da factory" (07/11): carta de "Aceitar / Ajustar" com `checagens(7)`; o
  dono respondeu **7 pontos** num texto corrido, porque havia 7 perguntas abertas e nenhum campo para cada.
- **t-108852bf** "Atualizar o Claude Code" (08/11): "SIA? Por que SIA?" → a sessão reentregou com a resposta
  um minuto depois, e ele aceitou. A pergunta e a resposta não ficam juntas na frente.

**O que faltou mostrar.** A pergunta aberta como pergunta (sem opções inventadas); o que a sessão já procurou
e não achou (em t-fd44bd79 isso estava no verso, prova de texto "NÃO DEU PARA SABER").

**Jeito de responder que faltou.** **Campo livre** sem opções e sem recomendada (hoje é obrigatório 2 a 4
opções e 1 recomendada, `contract.ts:1142-1167`); **formulário curto** (uma linha por pergunta); ditado já
existe (9c9aa0bb, 06/11).

**Módulos.** Pergunta · Contexto ("o que já procurei") · Resposta **Campo livre** ou **Formulário** ·
Saída "Decida você".

### 3.7 Dar acesso (2FA, login, credencial, pagamento)

**Casos reais.**
- **t-ce521745** "Cron + workflow que puxa contas novas sozinho" (07/11): "Libero as duas chaves para a VPS
  cadastrar contas sozinha?" com `checagens(5)` (2 em falha: "Chave do gateway", "Link de login"). Aceitar
  **não entrega a chave**: "Uma sessão no PC grava as chaves…". O passo do dono ficou implícito.
- **t-82418895** (05/11, sem `paraODono`): a nota é uma instrução — "PASSO SEU: no Donel, painel Contas,
  adicione o lugar … e escolha a conta. ACEITAR = já adicionei."
- **t-04d510ab** item 3 (06/11): "o Google pediu o código do autenticador (dois fatores)… RECOMENDO: guardar a
  semente do autenticador no item do cofre"; enterrado como 1 de 6 itens de um lote, num texto do verso.
- **t-90d816b3** "Gabriel Rosset: chave nova do robô" (09/11, entregue): "Posso gerar a chave nova… no seu
  login de admin?" — Sessão do PC gera / Eu mesmo gero.
- **t-85a671ee** "SRE pede OK no token GitHub" (09/11): a carta não sabia o escopo do token; a sessão mesma
  cancelou ("Não era decisão do dono ainda").
- **t-d35cbf67** "token amplo na VPS" (09/11, entregue): 3 opções sobre credencial.
- Vigia: as cartas de trava de "VPS pedindo login" e "Cofre travado" dizem o que fazer só em texto
  (`vigia-service.ts:93-98`).
- Pagamento: **não achei** carta de pagamento.

**O que faltou mostrar.** **O passo exato do dono**, como lista numerada (onde clicar, em qual máquina), com
o atalho para abrir o lugar certo (navegador, terminal, painel Contas); o **escopo** do que se libera (o quê,
para quem, por quanto tempo); o que fica parado enquanto ele não faz.

**Jeito de responder que faltou.** **"Fiz"** que a sessão confere (e devolve à carta se não deu certo);
"Agora não, me lembra às X"; "Não libero" com motivo. Nunca campo de senha na carta (regra do projeto:
credencial só no fluxo oficial, CLAUDE.md "Credenciais").

**Módulos.** Pergunta · Visual **Passo do dono** (checklist com atalhos) · Escopo (o que se libera) ·
Resposta **Fiz / Não consigo agora / Não libero** · Prazo.

### 3.8 Priorizar ou ordenar

**Casos reais.**
- **t-d37471a5** (09/11): pediu escolher **a tela** onde se ordena; a ordenação em si mora fora da carta, no
  painel do Jobu (▲▼, segundo 02-tela-hoje.md §2.6; `src/renderer/src/pet/JobuProgress.tsx`).
- **t-40b23043** "Triagem: 4 cards esperam decisão do dono" (07/11): 4 cards decididos por **uma** escolha de
  caminho ("Seguir o mapa de hubs").
- **t-5c0df1df** (aberta, pedido do dono 09/11): "o líder de cada board busca novas demandas lá, de acordo com a
  prioridade dada".
- **Não achei** carta que pedisse ao dono para ordenar uma lista dentro da própria carta.

**O que faltou mostrar.** A lista com a ordem proposta e o porquê de cada posição; o que entra e o que sai
do corte.

**Jeito de responder que faltou.** **Arrastar para ordenar**; marcar "corta"; aceitar a ordem proposta num
toque.

**Módulos.** Pergunta · Visual **Lista** · Resposta **Ordenar** (com "aceitar a ordem proposta").

### 3.9 Definir número, limite ou data

**Casos reais.**
- **t-c74e5352** "Jornada: limite de tentativas na API" (07/11): os tetos propostos (120/min, 600 e 300) só no
  efeito da opção; a alternativa "**Tetos mais folgados**: Você diz o número e eu ajusto" **fecha rejeitada** e
  não tem onde digitar o número.
- **t-4f1214d9** "Duclas: duas flags vencidas" (09/11, entregue): "dou mais 30 dias à da leitura de visita?" —
  o número vem fixo no botão.
- **t-fd44bd79** "1:1s" (09/11): 9 horários, nenhum editável na carta.
- **t-74480f8d** (cancelada): o dono disse "Não quero que vc limite a quantidade de sessões" sobre um teto.

**O que faltou mostrar.** O valor proposto, a unidade, o medido que o justifica (em t-c74e5352 o "pico
medido" estava só na prova de texto), a faixa segura.

**Jeito de responder que faltou.** **Campo de número / data** pré-preenchido; aceitar o proposto num toque.

**Módulos.** Pergunta · Visual **Medidor** (medido × proposto) · Resposta **Número/data** · Recomendação.

### 3.10 Aprovar plano ou spec (várias decisões dentro)

**Casos reais.**
- **t-0dbcc00d** "Jornada: pronta para o selo provisório" (06/11): **10 decisões** numa tabela em png (visual
  `prova`); respostas possíveis: "Aceitar o recomendado" / "Decidir item a item" (que **fecha rejeitada** e
  manda escrever na carta) / "Só depois de fechar tudo".
- **t-04d510ab** "Homologação torando: 6 decisões em lote" (06/11): as 6 decisões, cada uma com
  recomendação, só numa prova de texto de 2458 caracteres; a frente tinha `checagens(5)` sobre **outra** coisa
  (estado da fila). "Vou responder item a item" também fecha rejeitada.
- **t-63186140** "Ledger v5: decisões do dono" (07/11): "seis decisões" num protótipo html; o dono apertou
  "Parar e repensar" para limpar a tela.
- **t-9c8d319a** "Plano do Mindscape de homologação V1" (07/11): "quatro recomendações" + 2 png; respostas
  "Seguir…" / "Quero desenhar os rigs no quadro" / "Ajustar o plano".
- **t-d37471a5** (09/11): "cinco decisões" escondidas no botão do protótipo.

**O que faltou mostrar.** Cada decisão como **item** com sua recomendação e seu efeito, na frente; o plano em
leitura curta (o que muda, em quantos passos, o que fica de fora).

**Jeito de responder que faltou.** **Por item**: aceitar a recomendação, trocar, comentar; "aceitar todas as
recomendadas"; responder 3 agora e deixar 2 para depois **sem rejeitar** o resto.

**Módulos.** Pergunta · Recomendação geral · Visual **Itens** (cada um: título, recomendação, efeito) ·
Resposta **Itens em lote** (aceitar / trocar / ressalva, por item, + "todos os recomendados") · Recolhidos
(plano completo, link do PR).

### 3.11 Liberar algo perigoso (merge em main, produção, repo público, apagar)

**Casos reais.**
- **t-986d4613** "Libero o merge?" (06/11), ver 3.2.
- **t-6066c6aa** "Aprovação humana do conserto da Organização" (07/11): "O conserto já está na produção…
  Deixo assim ou tiro a trava de vez?" — o dono: "uma ova, se vira e nunca mais me ofenda fazendo um pedido
  desse. Usa o --admin" e "Que trava? Tira essa trava."
- **t-bcce10a2** "8 funções publicadas fora do repositório" (07/11): "Recomendo apagar" seis funções no ar.
- **t-4bd4bc80** "Apagar a tabela antiga de demandas" (07/11).
- **t-0c283dc0** "Rayanne: login da Governança" (06/11): "só para para o seu OK no passo que mexe em produção".
- Repo público: **não achei** carta de publicação no repo público.

**O que faltou mostrar.** **O que é irreversível** e o que tem volta (hoje misturado no texto de risco); o
alvo exato em linguagem de gente (qual app, qual ambiente); o que foi provado e o que não foi (em
t-986d4613 o "não testado" estava no verso).

**Jeito de responder que faltou.** Confirmação **reforçada** só quando é irreversível (segurar ou repetir o
nome); e, do outro lado, "isso não precisava subir a mim" como resposta que vira regra — o caso t-6066c6aa
mostra o dono ofendido por receber essa carta.

**Módulos.** Pergunta · Visual **Irreversível × tem volta** (duas colunas curtas) · Provas na frente
(checagens com frase de todos os itens) · Resposta **Botões** com **Confirmação reforçada** · Saída "Decida
você".

### 3.12 Hill climbing (aceitar rodada)

**Casos reais.** **Não achei nenhuma missão**: `mcp__donel__hillclimb_ver` em 09/11 devolveu `"missoes": []`
e `"pronto": false` ("Falta a chave de LLM"). No registro não há carta com a pergunta "Rodar esta missão de
hill climbing?". O hill climbing que existiu foi o da homologação, fora da ferramenta: **t-2b51f9df** (07/11),
"duas subidas aceitas aguardam a confirmação oculta", e o dono aposentou o juiz de vários modelos em 09/11
(motivo de cancelamento da t-e1c62318).

**O molde existe e está partido em dois.**
- A **proposta** é carta: "Rodar / Não rodar"; alvo, leitor e critérios só na prova de texto
  (`hill-climb-store.ts:318-346`).
- O **fim de rodada** não é carta: os gestos **Parar e aceitar**, **Mais uma rodada** e **Redirecionar · dar
  uma referência** moram na barra do modo "hill" (`HillClimbBar.tsx:486-502`).

**O que faltaria mostrar.** A melhor versão (visual, protótipo ou texto); a curva da menor nota por round;
as notas por juiz e critério; o corte; quanto já gastou e quanto falta do teto.

**Jeito de responder que faltaria.** Os três gestos da barra, **na carta**; "Redirecionar" com texto e uma
referência (imagem ou link).

**Módulos.** Pergunta · Visual **Rodada** (melhor versão + curva + notas) · Medidor (gasto × teto) · Resposta
**Rodada** (parar e aceitar / mais uma / redirecionar com referência).

### 3.13 Tipos que apareceram além da lista

**a) Conferir entrega pronta** ("Aceito a entrega?", "Posso fechar?"). Muito comum: Aceitar/Devolver,
Fechar/Devolver, quase sempre com `checagens`. Exemplos: t-121da54c, t-b3e7e992, t-04099af0, t-13a8b7f9,
t-a2b30095, t-79987d6f (entregue). O `checagens` só mostra a frase do item que **falhou**
(`LedgerCards.tsx:248`), e 55 cartas o usaram, muitas como lista de fatos. *Faltou:* a frase de todos os itens;
"Devolver" com o motivo estruturado (qual item). *Pergunta para o desenho, não respondida aqui:* quantas dessas
precisavam do dono; o dono escreveu "Já respondido" e "faça você" em várias (seção 2).

**b) Triagem de pedido de terceiro** ("X pediu no Slack: … Fica com você?" — Eu faço / Não é comigo / Já
resolvido): t-b1c5a2fd, t-c42f9aa2, t-bbbd4970, t-54d85cbd. *Faltou:* a mensagem da pessoa na frente (fica no
pedido literal, recolhido); "passe para Fulano" como resposta. O dono respondeu a t-54d85cbd com "Faça você.
PAra de delegar pra mim".

**c) Pedido de esclarecimento da sessão** (a sessão não sabe o que o dono quis dizer): t-fd44bd79. Ver 3.6.

**d) Aviso urgente do vigia.** **0 cartas do vigia** no registro (procurei títulos "Trava:"; nenhum). O molde
(`vigia-service.ts:102-125`) pergunta "Já resolveu?" sem marca de urgência na caixa (02-tela-hoje.md §2.10) e
sem o passo do dono além de uma frase. *Faltaria:* selo **urgente** com "desde quando" e "o que está parado";
o **Passo do dono** (3.7); "Fiz" que o vigia confere na rodada seguinte.

**e) Carta escrita pela própria sessão sem contrato (pré-forma A).** As 15 entregas de risco alto sem
`paraODono` codificavam as opções no texto da nota: "ACEITAR = já adicionei. REJEITAR = não quero a VPS no
Donel" (t-82418895), "DECISÃO: ACEITAR = só você e o Bill entram na VPS…" (t-2e2e6413), e t-4ef9feb7,
t-df6e7745. Mostra que a sessão precisava de **opções com efeito** e de **Passo do dono** antes de o molde
existir.

## 4. A gramática mínima de módulos

Uma carta é uma **pilha de módulos**. A cabeça e a resposta são obrigatórias; o resto entra conforme a
decisão. Cada tipo da seção 3 é uma **receita** (seção 5).

### 4.1 Cabeça (sempre)

| Módulo | Conteúdo | Por que (caso) |
|---|---|---|
| **Pergunta** | uma frase; o que o dono decide | já existe |
| **Quem pede** | pessoa ou sessão, pelo nome | triagens e Slack (3.13b, 3.4) |
| **Prazo / custo de esperar** | até quando, e o que fica parado | t-fd44bd79 ("a conversa das 10h"), vigia |
| **Selo** | risco e, quando for, **urgente** | vigia (3.13d), perigoso (3.11) |

### 4.2 Contexto (0 a 2)

| Módulo | Conteúdo | Caso |
|---|---|---|
| **Resumo** | o que aconteceu, curto | já existe |
| **Recomendação** | o caminho e o porquê | já existe |
| **Citação** | a mensagem original de quem pediu (Slack, e-mail), com onde e quando | t-7753dcd0, t-c8a843dd, triagens |
| **O que já procurei** | fontes conferidas e o que não achei | t-fd44bd79 |

### 4.3 Visual (0 a 1; cada um tipado)

| Módulo | Para | Caso |
|---|---|---|
| **Imagem** | um print | já existe (`prova`) |
| **Vídeo** | fluxo em movimento, com marcas de tempo | 0 usos, mas suportado |
| **Antes/depois** | galeria de pares, rótulos livres, veredito por par | t-986d4613 |
| **Comparação** | 2 a N variantes lado a lado, cada uma **ligada a uma opção**, imagem ou protótipo | t-32b82559, t-678f3cb3, t-6c504ed8 |
| **Protótipo** | html navegável embutido, tela cheia, celular/desktop | já existe (`prova` html) |
| **Texto a aprovar** | a mensagem inteira, destino, thread, anexo, diferença | cartas de Slack, rascunhos |
| **Tabela** | opções × critérios | t-b3deea38 |
| **Itens** | lista de decisões ou fatos, cada um com recomendação ou ✓/! **e** a frase | t-04d510ab, t-0dbcc00d, checagens |
| **Medidor** | medido × proposto (número, limite, gasto) | t-c74e5352; carta 2 do protótipo forma A (barra "usado 100%" e "≈ 44 h parada", print de t-6c504ed8) |
| **Passo do dono** | checklist do que o dono faz fora da carta, com atalho para o lugar | t-ce521745, t-82418895, vigia |
| **Rodada** | melhor versão, curva, notas por juiz | hill climbing |
| **Irreversível × tem volta** | duas colunas curtas | t-bcce10a2, t-4bd4bc80 |

### 4.4 Resposta (exatamente 1 principal)

| Módulo | Gesto | Caso |
|---|---|---|
| **Botões** | 2 a 4 caminhos com efeito e risco, 1 recomendado (o de hoje) | maioria |
| **Escolha de variante** | escolher por eixo, misturar, ressalva por variante | t-32b82559, t-678f3cb3 |
| **Editar texto** | texto pré-preenchido; enviar como está ou editado | t-160aa3d3, cartas de Slack |
| **Itens em lote** | por item: aceitar / trocar / ressalva; "todos os recomendados" | t-04d510ab, t-0dbcc00d |
| **Campo livre** | pergunta aberta, sem opções | t-fd44bd79, t-108852bf |
| **Formulário** | uma linha por pergunta | t-356b8b45 |
| **Número/data** | valor pré-preenchido, unidade | t-c74e5352, t-4f1214d9 |
| **Ordenar** | arrastar; aceitar a ordem proposta | t-5c0df1df (pedido) |
| **Fiz** | "Fiz" / "Não consigo agora"; a sessão confere | t-ce521745, vigia |
| **Rodada** | parar e aceitar / mais uma / redirecionar com referência | `HillClimbBar.tsx:486-502` |
| *Confirmação reforçada* | modificador de qualquer resposta, só quando irreversível | t-986d4613, t-bcce10a2 |

### 4.5 Saídas universais (em toda carta, fora das 4 vagas)

| Saída | Efeito | Por que (palavras do dono) |
|---|---|---|
| **Com ressalva** | qualquer resposta leva um texto junto | "Similar ao recomendado, mas…" (t-160aa3d3) |
| **Perguntar** | texto à sessão; a carta fica; a resposta volta **na mesma carta** | "SIA? Por que SIA?" (t-108852bf) |
| **Decida você** | devolve sem decidir; a sessão decide pela recomendada | 11 textos "faça você" (seção 2) |
| **Agora não** | tira da mesa até uma hora, sem decidir | "Parar e repensar" para limpar a tela (t-63186140) |
| **Já resolvido** | fecha como repetida | "Já respondido. Apareceu repetido" (t-1905134e) |

### 4.6 Recolhidos (verso)

Pedido literal · Detalhes técnicos (links, PR, ids, saídas de comando) · Provas restantes · Quem fez e quando.
Igual à forma A (`origin/proto/cartas`, commit 321c6736, 05/11, `docs/specs/cartas-forma-a.md`).

## 5. O mesmo molde resolvendo tipos bem diferentes

Cada linha é uma carta real montada com os módulos da seção 4. Serve de roteiro para os protótipos.

| Carta real | Cabeça | Contexto | Visual | Resposta |
|---|---|---|---|---|
| t-32b82559 cadeiras | Pergunta "Qual forma para o quadro e para a tela de cadeira?" | Recomendação "A1 + B1" | **Comparação** em 2 eixos (A1/A2/A3, B1/B2/B3), cada um com protótipo | **Escolha de variante** por eixo, com misturar e ressalva |
| t-dab38f1d Slack ao Lucas | Pergunta + Quem (Lucas, DM) + Prazo ("o prazo dele é hoje") | **Citação** (o pedido do Lucas) | **Texto a aprovar** | **Editar texto** (Enviar / Enviar editado) |
| t-04d510ab 6 decisões | Pergunta + Prazo | Recomendação geral | **Itens** (6, cada um com recomendação) | **Itens em lote** + "todos os recomendados" |
| t-c74e5352 tetos | Pergunta | Recomendação | **Medidor** (pico medido × teto) | **Número** pré-preenchido |
| t-fd44bd79 1:1s | Pergunta aberta + Prazo ("10h de segunda") | **O que já procurei** | Imagem (a grade) | **Campo livre** |
| t-ce521745 chaves | Pergunta + Selo | Resumo | **Passo do dono** + escopo | **Fiz** / Não consigo agora / Não libero |
| t-986d4613 merge | Pergunta + Selo alto | Recomendação | **Antes/depois** em galeria + **Irreversível × tem volta** | Botões + **Confirmação reforçada** |
| hill climbing (sem caso real) | Pergunta "Rodada 2 fechou. Segue?" | Recomendação | **Rodada** + Medidor (gasto) | **Rodada** |
| vigia (sem caso real) | Pergunta + Selo **urgente** + "desde 14:32" | — | **Passo do dono** | **Fiz** |

Em todas: as cinco **Saídas universais** e os **Recolhidos**.

## 6. O que não achei ou não verifiquei

- **Nenhuma carta do vigia** e **nenhuma missão de hill climbing** no registro; os tipos 3.12 e 3.13d estão
  descritos a partir do molde no código, não de casos.
- **Nenhuma carta de e-mail, nota de versão, pagamento ou publicação no repo público.**
- **Nenhum vídeo** entre as provas.
- **Não li** o texto que o dono escreveu ao escolher "Ajustar" em t-678f3cb3 além de "Não tá como eu havia
  esperado", nem o que ele escreveu em "Ajustar antes" (t-49934e83): o registro guarda só o rótulo.
- **Não abri os protótipos html** das provas (estão no PC, em `C:\Users\compu\AppData\Roaming\donel-dev\ledger-provas\`);
  descrevi o que as cartas mostravam pelo bloco `paraODono`, pelas notas e pelos prints que o `tarefa_ver`
  devolveu (t-6c504ed8, t-fd44bd79, t-986d4613, t-efeb0ca3, t-0dbcc00d, t-32b82559, t-678f3cb3).
- **Não contei** quantas das 170 cartas o dono teria preferido não receber; a seção 2 só lista as 11 em que ele
  escreveu isso.
- A diferença entre os 170 blocos daqui e os 179 de 02-tela-hoje.md não foi conciliada (leituras de fontes e
  horas diferentes: `tarefa_listar` × `ledger.json`). **[corrigido pelo crítico]** A explicação provável é que o
  `tarefa_listar` traz só o `paraODono` da **última** entrega de cada tarefa, enquanto o 02 contou entregas. Às
  16:12 UTC a listagem tinha 171 tarefas com bloco; 55/49/1/66 e 112/56/3 conferem com os números daqui, e são 15 as
  de risco alto sem bloco. Não abri o `ledger.json` para provar a conta das 179.
- **[corrigido pelo crítico: faltava]** t-fd44bd79, o melhor caso de "Campo livre", está **fora da mesa agora**:
  foi reentregue com risco baixo em 09/11 02:21 UTC e só entra na caixa 24 h depois, após o prazo da conversa
  das 10h. Ver 03-dados-ruido.md §5.1. O tipo "resposta livre" precisa chegar ao dono mesmo quando a sessão marca
  risco baixo.
