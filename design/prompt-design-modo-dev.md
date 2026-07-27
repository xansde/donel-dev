# Prompt pronto — sessão de design do Modo Dev

> **Como usar:** copie **tudo abaixo da linha divisória** e cole de uma vez em
> `claude.ai/design` (ou Stitch). É o Brief 0 (design system) já concatenado com o
> brief do Modo Dev — não precisa abrir dois arquivos nem montar nada.
>
> **Proveniência:** Brief 0 vem de `design-handoff.md` (linhas 11–90) e a parte do
> Modo Dev de `brief-modo-dev-v2.md`, que traduz as decisões do mapa Wayfinder
> "Modo Dev do Donel Dev" (MD-01 a MD-08, 26–27/07/2026) e a spec
> `specs/003-modo-dev/spec.md`. Se qualquer um dos dois mudar, **regere este arquivo**
> em vez de editar as duas cópias.
>
> **O que esperar de volta:** as telas em HTML, o mapa de cada elemento para o
> componente do design system que o realiza, e a lista de extensões propostas (se
> houver). O HTML aprovado é commitado no repo.

---

Você vai desenhar uma tela de um app desktop. Absorva primeiro o design system,
depois o brief da tela.

# Parte 1 — Design system (linguagem visual obrigatória)

Antes de gerar qualquer tela, absorva este design system — ele define a
linguagem visual completa do produto e deve ser aplicado em toda tela gerada.

## Identidade

Donel Dev é um "cockpit de operador", não um app de consumo. A sensação-alvo
é "sala de controle calma": interface densa, escura, tipografia mono para
dados técnicos (paths, nomes de sessão, terminal), cor usada quase
exclusivamente para comunicar **estado** (semáforo de sessão, smart zone de
tokens, quota de conta). Nada pisca sem motivo — o que pisca, importa de
verdade.

## Paleta de cores (dark, tema único nesta fase)

| Token | Hex | Uso |
|---|---|---|
| `bg-app` | `#0E1116` | fundo da janela |
| `bg-panel` | `#151A21` | sidebar, painéis, cards |
| `bg-raised` | `#1C232C` | hover, aba ativa, inputs |
| `border` | `#28303B` | hairlines de 1px |
| `text-primary` | `#D7DDE5` | texto principal |
| `text-muted` | `#828D9C` | metadados, labels |
| `accent` | `#4C9CF0` | seleção, links, foco |
| `state-working` | `#4C9CF0` | semáforo: sessão trabalhando (pulso sutil) |
| `state-waiting` | `#E8B44C` | semáforo: aguardando resposta |
| `state-permission` | `#F0684C` | semáforo: permissão pendente (pulso forte) |
| `state-done` | `#5E6873` | semáforo: sessão encerrada |
| `zone-ok` | `#3DCE8F` | smart zone: dentro do limite |
| `zone-warn` | `#E8B44C` | smart zone: atenção |
| `zone-over` | `#F0684C` | smart zone: hora de handoff |

O terminal embutido usa tema próprio, casado com `bg-app` (paleta ANSI de
alto contraste, cursor na cor `accent`).

## Tipografia

- UI geral: Inter (ou system-ui) — 13px base, 11px para metadados, títulos
  em 15px/peso 600.
- Dados/técnico (paths de arquivo, nomes de sessão, terminal): **JetBrains
  Mono**, 12.5px.

## Densidade e grid

- Altura de linha em listas: 30–32px.
- Radius de cantos: 6px.
- Ícones: outline, 16px, estilo Lucide.
- Espaçamento base: 8px (múltiplos de 8 para paddings/margins).
- Padding interno de painéis: 12px.

## Componentes recorrentes (usar em qualquer tela que precisar deles)

**Dot de estado (semáforo de sessão)** — círculo de 8px preenchido na cor do
estado:
- Trabalhando: `state-working` (#4C9CF0), pulso de opacidade lento (ciclo de 2s).
- Aguardando resposta: `state-waiting` (#E8B44C), fixo, sem pulso.
- Permissão pendente: `state-permission` (#F0684C), pulso rápido (ciclo de 1s) +
  halo/glow ao redor do dot.
- Encerrada: `state-done` (#5E6873), fixo, sem brilho.

Sempre que houver espaço, acompanhe o dot de um label textual do estado
(acessibilidade — não depender só da cor).

**Medidor smart zone** — barra horizontal fina de 4px de altura, com
preenchimento proporcional a tokens-usados/400k. Cor do preenchimento pela
faixa: 0–70% = `zone-ok` (#3DCE8F); 70–100% = `zone-warn` (#E8B44C); acima
de 100% = `zone-over` (#F0684C). Rótulo numérico ao lado no formato
"312k/400k". Tooltip ao hover com números exatos, ex.: "312k / 400k ·
handoff sugerido".

**Badge de conta** — formato pílula, texto "Tecnologia Claude {n}" + % de
headroom colorido: verde (>40%), âmbar (15–40%), vermelho (<15%), cinza com
"—" quando não há leitura disponível.

**Chip de fase** (usado no modo Dev) — retângulo pequeno com o nome da fase
da Esteira (Discovery, Plano, Implementar, Validar, Concluir), cada fase com
uma cor fixa e distinta entre si (defina uma paleta harmônica com o restante
do sistema — os hex das 5 fases não estão fixados).

---

# Parte 2 — A tela: Modo Dev

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
- Uma fase é exceção e **não abre sessão própria**: **Concluir** é um gate
  determinístico (roda um script e move um card) e acontece na sessão em foco.

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
**sessão** (4 estados: trabalhando/aguardando/permissão/encerrada). Os estados
acima são de **fase**, um eixo diferente — e as duas coisas podem aparecer na mesma
tela (uma fase "em execução" contém uma sessão que pode estar "aguardando
resposta"). Resolva essa convivência explicitamente: reaproveitando o vocabulário
existente, ou propondo uma extensão nomeada (ver "Vocabulário").

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
  Concluir). Não desenhe nenhum preset alternativo de nomes de fase.
- **Núcleo agnóstico**: board e vault são integrações plugáveis, não fundação. Um
  operador sem vault configurado usa o modo inteiro sem ver cobrança.

## Vocabulário: use os componentes existentes

Componha com os componentes do design system (Parte 1) — o produto tem estas peças
e **não recria componente**: dot de estado (semáforo), medidor smart zone, badge de
conta, chip de fase, botão (4 variantes) e botão split, input de texto, dropdown
com descrição por opção, switch, controle segmentado, aba de terminal, label
editável, card post-it, modal, toast e barra de status.

**Se um alcance deste brief não for componível com essas peças, proponha uma
extensão nomeada** — nome do componente ou variante, o que ele resolve e por que
nenhuma peça atual serve — e deixe-a explícita na entrega, para aprovação.
Extensão silenciosa não passa.

## Entrega esperada

1. As telas do Modo Dev em **HTML**;
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
- **Sessão em foco:** conta "Tecnologia Claude 3", smart zone em 312k/400k.

**Gerar em:** desktop 1440×900, tema dark.
