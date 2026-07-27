# Brief 10-v2 — Modo Dev (substitui o Brief 10 de `design-handoff.md`)

> **Como usar:** cole o **Brief 0 — Design system** (de `design-handoff.md`)
> e, em seguida, este arquivo inteiro, na ferramenta de geração de design
> (Claude Design, Stitch etc.). Nunca cole este brief sozinho.
>
> **Por que existe:** o Brief 10 original organizava o Modo Dev por *task* do
> board. O mapa Wayfinder "Modo Dev do Donel Dev" (MD-01 a MD-08, resolvido em
> 26–27/07/2026) mudou a unidade de trabalho e várias regras de produto. Este
> brief é a versão vigente; o Brief 10 antigo está superado e não deve ser colado.

---

**Contexto:** modo alternativo do app, ligado por um switch "Uso geral | Dev" no
titlebar — mesma janela, o layout interno se reorganiza; nada da tela de hoje é
aposentado. O Modo Dev organiza o trabalho por **discovery**: uma frente grande a
investigar antes de agir, que corresponde a uma instância de um processo chamado
**Esteira**. A hierarquia é de três níveis e o desenho precisa deixá-la legível:

```
discovery  (a frente inteira — 1 card de entrada do board, papel orquestrador)
  └── marco [M1], [M2], …  (1 card = 1 branch = 1 PR ≈ uma feature)
        └── fases da Esteira: Discovery · Plano · Implementar · Validar · Concluir
```

Cada **fase** roda numa sessão de terminal própria, que nasce com a memória limpa
— o app conduz o operador de fase em fase em vez de ele lembrar o que digitar.
Pode haver vários discoveries abertos, mas **um só em foco**.

## Zonas obrigatórias

O app deve alcançar estas quatro zonas. **Onde cada uma senta, tamanho, densidade,
hierarquia visual e a forma de representar a árvore são decisões suas** — o que
está fixado abaixo é só o que cada zona precisa entregar.

### 1. Porta de entrada — abrir/trocar discovery

Lista de cards vindos do board (um board único, já configurado). Só cards das
colunas **Backlog, Discovery e Plano** aparecem — nunca cards concluídos.

- Cards que já têm discovery aberto vêm **marcados**, e clicar neles **traz aquele
  discovery para o foco** (não cria nada novo).
- Clicar num card de **Plano** abre o **discovery pai** daquele plano.
- Pode ser painel, modal ou lista lateral — sua escolha.

### 2. Mapa lateral — a árvore do discovery em foco

Desenha **a frente inteira**, com o marco em foco destacado: topo = o discovery,
abaixo um ramo por marco `[M1]`, `[M2]`…, e dentro de cada marco os **nós = fases
da Esteira**. Trilha, grafo, lista aninhada, colunas — a representação é sua.

Cada nó de fase carrega:

- **Estado da fase** (ver "Estados", abaixo) — a distinção tem que ser óbvia à
  primeira vista;
- **Anotações do board** sobrepostas ao nó: a **coluna real** do card, se há
  **fase em andamento** (trava), etiquetas de **atenção** ("escalado",
  "precisa atenção"), e **PR + aprovação** (o que ainda falta para poder concluir);
- **Ao expandir**: as skills internas que aquela fase rodou, os **artefatos**
  declarados por ela, e os **recibos de conhecimento** — links para onde o
  conhecimento foi registrado (nota do vault, seção de lições do repo, documento
  do board). Quando não houver registro nenhum, um indicador discreto de
  "sem registro" — e, se o operador não tiver vault configurado, **nada aparece:
  silêncio, nunca cobrança**.
- **Clicar numa fase já concluída** volta à sessão dela (só para consulta).

Artefatos que aparecem como consultáveis, para você dimensionar a lista: manifesto
da fase (`.json`), contexto de disparo (`.md`), a pasta de especificação
(`spec.md`, `plan.md`, `tasks.md`, `research.md`, `data-model.md`, contratos),
roteiro de teste (`e2e.md`), lições do repositório, documentos de processo,
entregáveis visuais `.html` e o transcript da sessão da fase.

### 3. Etapa em foco — o terminal daquela fase

É o terminal da sessão da fase corrente. Trocar de fase (ou de marco) **troca de
sessão**, nunca limpa nem reaproveita a mesma.

Comportamentos que o desenho precisa acomodar:

- **O comando aparece digitado e NÃO enviado.** Ao acionar a próxima fase, o app
  abre a sessão e deixa o comando (`/esteira-<fase> <id-do-card>`) escrito no
  prompt do terminal, aguardando o **Enter do operador**. O botão que faz isso
  precisa comunicar "prepara", não "executa" — disparar uma fase por engano custa
  uma sessão inteira de cota. Este é o gesto central do modo: mostre-o bem.
- **Sessão de fase concluída é arquivada**, não fica como aba aberta: quando a
  fase termina com sucesso, a aba fecha e o acesso passa a ser pelo mapa lateral.
  O desenho não deve pressupor uma barra de abas crescendo com dezenas de sessões.
- Duas fases não seguem "uma sessão por card": **Implementar** roda numa **única
  sessão por plano**, que orquestra subagentes de execução; e **Validar** é
  modular — testa **subconjuntos** dos cards de um plano por vez.

### 4. O switch de modo

"Uso geral | Dev" no titlebar. Ligar reorganiza o layout; desligar volta à tela de
hoje, intacta.

## Estados de fase (5) — semântica fixada, representação sua

O produto exige que estes cinco sejam **distinguíveis à primeira vista**; a regra
de ouro é: *identificar falha tem que ser a coisa mais clara da tela*.

| Estado | Significado |
|---|---|
| não iniciada | a fase ainda não rodou |
| em execução | a sessão da fase está viva agora |
| concluída | a fase terminou com sucesso |
| **falhou** | a fase terminou mal — precisa de atenção |
| **travada** | a sessão morreu sem concluir e deixou uma trava para trás; retomar exige liberar a trava primeiro |

Atenção a uma sobreposição de vocabulário: o design system já tem um semáforo de
**sessão** (`StateDot`, 5 estados: trabalhando/aguardando/permissão/encerrada). Os
estados acima são de **fase**, um eixo diferente — e as duas coisas podem aparecer
na mesma tela (uma fase "em execução" contém uma sessão que pode estar
"aguardando resposta"). Resolva essa convivência explicitamente: reaproveitando o
vocabulário existente, ou propondo uma extensão nomeada (ver "Vocabulário").

## Duas situações específicas para compor

**Divergência entre o board e o disco.** O que rodou (disco) e onde o card está
(board) podem discordar — por exemplo, a fase Implementar concluída no disco com o
card ainda na coluna "Plano". Nesse caso o nó mostra os dois fatos e um **marcador
de divergência**, e oferece uma ação: **abrir uma sessão de conciliação** com um
prompt já preparado descrevendo os pontos divergentes (mesma regra do Enter
humano). O app nunca "corrige" o board sozinho. Nota: divergências esperadas pelo
processo não devem alarmar — a fase Validar, por desenho, nunca move o card de
coluna.

**Trava ativa.** Quando há uma fase em andamento registrada, o botão da próxima
fase **continua clicável** e o app apenas **avisa** ("fase em andamento desde
\<data\> — pode ser recusada"). Nunca desabilite: uma trava esquecida de ontem
bloquearia exatamente quem quer retomar hoje.

## Regras de produto a refletir na composição

- **O app conduz, nunca decide.** Nenhum botão de aprovação automática, nenhum
  gate que o app resolva sozinho: aprovações e gates seguem sendo das skills e do
  humano.
- **O app não escreve conhecimento** — quem registra são as skills. O mapa exibe
  os recibos, não os produz.
- **Vocabulário é o da Esteira** (Discovery, Plano, Implementar, Validar,
  Concluir). O preset alternativo de nomes ao estilo HumanLayer que constava do
  Brief 10 antigo **foi descartado** — não desenhe essa opção.
- **Núcleo agnóstico**: board e vault são integrações plugáveis, não fundação. Um
  operador sem vault configurado usa o modo inteiro sem ver cobrança.

## Vocabulário: use os componentes existentes

Componha com os componentes do design system (Brief 0): `StateDot`,
`SmartZoneMeter`, `AccountBadge`, `PhaseChip`, `Button`/`SplitButton`, `TextInput`,
`Select`, `Toggle`, `SegmentedControl`, `TerminalTab`, `EditableLabel`,
`PostItCard`, `Modal`, `Toast`, `StatusBar`.

**Não recrie componente existente.** Se um alcance deste brief não for componível
com essas peças, **proponha uma extensão nomeada** — nome do componente ou
variante, o que ele resolve e por que nenhuma peça atual serve — e deixe-a
explícita na entrega, para aprovação. Extensão silenciosa não passa.

## Entrega esperada

1. As telas do Modo Dev em **HTML** (que será commitado no repositório, não
   entregue como link solto);
2. Um **mapa de componentes**: cada elemento da tela anotado com qual componente
   do design system o realiza;
3. A **lista de extensões propostas**, se houver — cada uma nomeada e justificada.

## Dados de exemplo

- **Discovery em foco:** `SZI-142 · Cotas: parcelamento CUB` (card de entrada,
  orquestrador), com 3 marcos.
- **Marcos:** `[M1] Cálculo das parcelas` — Validar em execução; `[M2] Tela de
  simulação` — Implementar concluída, aguardando Validar; `[M3] Relatório de
  repasse` — Plano falhou.
- **Anotações do board:** `[M1]` com PR vinculado e aprovação pendente; `[M2]` com
  divergência (disco: Implementar concluída · board: coluna "Plano"); `[M3]` com
  etiqueta "precisa atenção".
- **Uma fase travada, para exercitar o estado:** `[M1] · Implementar` — trava
  registrada desde ontem, 18:42.
- **Recibos de conhecimento** em `[M2] · Plano`: nota no vault, 2 lições no
  repositório, 1 documento no board.
- **Outros discoveries abertos (fora de foco):** `SZI-155 · Webhook de medalhas`,
  `SZI-160 · Radar de PRs`.
- **Porta de entrada:** 6 cards, sendo 3 já vinculados (marcados) e 3 livres —
  `SZI-171 · Conciliação Onvio` (Backlog), `SZI-168 · Espelho de cotas`
  (Discovery), `SZI-165 · Ajuste de repasse` (Plano).

**Gerar em:** desktop 1440×900, tema dark.
