# Notas do designer — leva de 2026-10-07

O que a sessão que desenhou os quadros registrou. É insumo da conferência em
`design/chat-verificacao.md`: nada aqui está aprovado ainda.

## Decisões de forma (Parte 5 do brief)

- **A. Dono × Claude.** Transcrição, sem balões.
  - A mensagem do dono é o único cartão preenchido: superfície do painel,
    filete, marcador `>` em accent, hora no canto.
  - O Claude aparece como texto aberto sobre o fundo, sob a legenda
    "CLAUDE · hora".
  - A barra "trabalhou — N ações" é só contorno, para não competir com a
    mensagem do dono.
- **B. Linha de ação e grupo.**
  - A linha tem 28 px: ícone de 16 px por tipo, verbo em muted, objeto em
    mono, `+12 −3` em mono (verde e vermelho-laranja), resultado colorido só
    quando é estado, duração à direita.
  - O grupo recolhido mostra "9 ações — leu 4, editou 2, rodou 3"; a falha
    sobe como linha logo abaixo do cabeçalho, visível sem expandir.
  - Aberto, o grupo ganha um trilho à esquerda; diff e saída entram
    recuados.
- **C. Painel de pendência.**
  - Fica acoplado acima da caixa, na largura da coluna, com borda tingida
    de `state-permission` a 40%.
  - Altura máxima de 62% da área útil da aba (~470 px a 900). Acima disso
    só o miolo rola; cabeçalho e botões ficam fixos.
  - Cartões de opção à esquerda, prévia da opção escolhida à direita.
    "Outra" é a última opção, com campo de texto embutido.
- **D. Modo Foco.** Interruptor no cabeçalho da aba, ao lado de
  Chat | Terminal, mais o clique na barra de cada rodada.
- **E. Estados de envio.** Linha de meta no canto da mensagem do dono:
  - "enviando…": muted, com ponto piscando;
  - "entrou": check verde;
  - "não foi · tentar de novo": borda vermelho-laranja e botão;
  - "na fila": borda tracejada e etiqueta âmbar.

  No `Main` o ciclo roda de verdade: enviando… → na fila → entrou.
- **F. Painel lateral.**
  - A 1440 tem 460 px, com alça de arraste.
  - A 1280×760 tem 420 px, e a coluna de sessões recolhe para um trilho de
    48 px enquanto o painel está aberto. A conversa principal mantém
    ~810 px.
  - Janelas abaixo de ~1180 px não foram desenhadas.

## Extensões propostas ao design system

Nenhuma existe no bundle atual, que exporta 15 componentes. As extensões já
aprovadas no Modo Dev (`AnnotationTag` etc.) também não estão nele e foram
replicadas em markup.

1. **ConversationRow** (`OwnerMessage`, `ClaudeMessage`, `SystemNotice`) — linhas da conversa.
2. **ActionLine / ActionGroup / WorkFold** — ação, grupo com falha içada, barra do Modo Foco com o selo "tem pergunta aqui".
3. **AnnotationTag** — já aprovada, falta no bundle.
4. **CodeBlock + CodePalette** — paleta de código derivada dos tokens, cada papel ligado a um token:

   | Papel | Token |
   |---|---|
   | `kw` | `--phase-plano` |
   | `fn` | `--accent` |
   | `ty` | `--phase-implementar` |
   | `nu` | `--phase-validar` |
   | `st` | `--zone-ok` |
   | `cm` | `--text-muted` |

   Todos com contraste ≥ 5,2:1 sobre `bg-panel`.
5. **DiffBlock / CommandOutput** — diff com gutter e saída com "ver tudo".
6. **PendingPanel** (com `OptionCard`, `PreviewPane`, `PlanCard`).
7. **Composer** — área que cresce até ~10 linhas, anexos, selo de shell.
8. **CommandMenu** — autocomplete de `/` e `@`.
9. **Banner** — faixa de aviso.
10. **SidePanel** (com `SessionRail`) — painel lateral.
11. **SubagentRow / SubagentStrip**.
12. **SendState** — estado de envio na mensagem.
13. **Kbd** — chip de tecla.
14. **TerminalTab · pendência** — campo próprio para "esperando você". Hoje o desenho usa o campo do modelo.

## Desvios e limites conhecidos

- **T02 mostra o grupo de 9 ações aberto**, para caber diff e saída na
  mesma tela. O estado padrão com Modo Foco desligado (grupo recolhido com a
  falha visível) aparece no `Main`.
- **A faixa diz "3 subagentes rodando"**, como o brief pediu, mas um deles
  já terminou. A contagem real seria "2 rodando · 1 concluído".
- **O `AccountBadge` do bundle imprime um rótulo fixo de conta.** Falta uma
  prop `label`.
- **Copiar e "novas mensagens" só têm feedback visual.**
- **A notificação do sistema operacional não foi desenhada.** Ficaram o
  pulso da aba, "esperando você" e o rótulo na barra lateral.
- **A coluna da esquerda é "Projeto + Sessões"**; o painel "Sessão em foco"
  do v3 não aparece, e o espaço fica para o painel de subagente.
