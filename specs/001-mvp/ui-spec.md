# UI Spec — Donel Dev

**Propósito:** especificação visual completa para gerar as telas na ferramenta
de design. Cobre P0 + P1 + P2 (o design nasce completo; a implementação segue
o corte de [tasks.md](tasks.md)). Fonte de requisitos: [spec.md](spec.md).
**Criado:** 2026-07-22 · **Referência visual aprovada pelo Alexandre:** tela de
Tasks do CodeLayer/HumanLayer (screenshot de 22/07 — dark, denso, mono).

---

## 1. Design system base

### Identidade

Cockpit de operador, não app de consumo: denso, escuro, tipografia mono nos
dados, cor usada quase só para **estado** (semáforo, smart zone, quota). A
sensação-alvo: "sala de controle calma" — nada pisca sem motivo; o que pisca
importa.

### Paleta (dark-first; modo claro é derivação futura)

| Token | Hex | Uso |
|---|---|---|
| `bg-app` | `#0E1116` | fundo da janela |
| `bg-panel` | `#151A21` | sidebar, painéis, cards |
| `bg-raised` | `#1C232C` | hover, aba ativa, inputs |
| `border` | `#28303B` | hairlines 1px |
| `text-primary` | `#D7DDE5` | texto principal |
| `text-muted` | `#828D9C` | metadados, labels |
| `accent` | `#4C9CF0` | seleção, links, foco |
| `state-working` | `#4C9CF0` | semáforo: trabalhando (pulso sutil) |
| `state-waiting` | `#E8B44C` | semáforo: aguardando resposta |
| `state-permission` | `#F0684C` | semáforo: permissão pendente (pulso forte) |
| `state-error` | `#B678F0` | semáforo: falha/quota esgotada (fixo) |
| `state-done` | `#5E6873` | semáforo: encerrada |
| `zone-ok` | `#3DCE8F` | smart zone: dentro |
| `zone-warn` | `#E8B44C` | smart zone: atenção |
| `zone-over` | `#F0684C` | smart zone: hora de handoff |

Terminal: tema próprio casado com `bg-app` (ANSI de contraste alto, cursor
`accent`).

### Tipografia e densidade

- UI: Inter (ou system-ui), 13px base, 11px metadados, títulos 15px/600.
- Dados, paths, nomes de sessão, terminal: **JetBrains Mono** 12.5px.
- Linhas de lista 30–32px; radius 6px; ícones outline 16px (Lucide).
- Espaçamento base 8px; painéis com padding 12px.

### Componentes recorrentes

- **Dot de estado** (semáforo): círculo 8px na cor do estado; `working` com
  pulso de opacidade 2s; `permission` com pulso 1s + halo. Sempre acompanhado
  de label textual quando houver espaço (acessibilidade).
- **Medidor smart zone**: barra horizontal fina (4px) com preenchimento
  proporcional a tokens/400k; cor pela faixa (`zone-*`); tooltip com números
  exatos ("312k / 400k · handoff sugerido").
- **Badge de conta**: pílula `Tecnologia Claude {n}` + % de headroom colorido
  (verde > 40%, âmbar 15–40%, vermelho < 15%, cinza "—" sem leitura).
- **Chip de fase** (modo Dev): retângulo pequeno com o nome da fase da Esteira
  (Discovery, Plano, Implementar, Validar, Concluir), uma cor fixa por fase.

---

## 2. Shell principal — modo Uso geral (P0)

A vista onde o dia inteiro acontece.

```
┌─────────────────────────────────────────────────────────────────────────┐
│ ◆ Donel Dev   [Uso geral ▾]        [Tecnologia Claude 3 · 62% ▾] [＋ Nova]│ titlebar
├───────────────┬─────────────────────────────────────────┬───────────────┤
│ PROJETOS      │ ● bizops·fable ▲ spotsys·sonnet ◌ dalton│ LANÇAR SESSÃO │
│ ▾ seazone/    │ ┌─────────────────────────────────────┐ │ Modelo  fable │
│   ★ bizops-…  │ │                                     │ │ Esforço high  │
│     spotsys   │ │        terminal (xterm)             │ │ Permis. accept│
│     dalton    │ │                                     │ │ Nome  [.....] │
│ ▸ pessoal/    │ │                                     │ │               │
│ SESSÕES       │ │                                     │ │ [▶ Iniciar]   │
│ ● spec helm   │ │                                     │ │               │
│ ▲ radar spots │ └─────────────────────────────────────┘ │ (colapsável)  │
│ ◌ fix build   │  > _                                    │               │
├───────────────┴─────────────────────────────────────────┴───────────────┤
│ Tecnologia Claude 3 · fable/high · 6 sessões · ▂▂▂ smart zone           │ statusbar
└─────────────────────────────────────────────────────────────────────────┘
```

**Zonas:**

1. **Titlebar** — logo+nome; switch de modo `Uso geral | Dev`; badge da conta
   ativa (abre dropdown de perfis, §6); botão split "＋ Nova sessão" — clique
   no corpo abre direto com a última configuração de sessão Claude usada;
   seta lateral abre menu com 2 opções: "Sessão Claude" (abre o painel do
   Launcher, §4) e "Terminal (shell livre)" (aba de terminal comum, sem
   configuração — rótulo explícito, ver nota 2026-07-23 abaixo).
   > **Nota 2026-07-23 (feedback E2E rodada 1)** — o rótulo "Terminal" sozinho
   > não deixava óbvio que era um shell livre (sem sessão claude nenhuma);
   > passou a "Terminal (shell livre)".
2. **Sidebar esquerda (240px)** — duas seções: PROJETOS (árvore rasa por root,
   favoritos `★` no topo; favorito removido do disco aparece esmaecido com
   ação "remover") e SESSÕES (todas as sessões abertas, cada linha =
   dot de estado + nome + projeto abreviado + modelo; ordenadas por
   "precisa de mim primeiro" — o estado do semáforo sempre vence: permission
   > error/quota > waiting > working > done). Sessões fixadas têm ícone de
   pin e ficam acima das demais, mas só desempatam DENTRO do mesmo estado.
3. **Centro** — barra de abas (dot de estado + nome + modelo; abas de
   terminal comum não têm dot de semáforo, mostram ícone de shell no lugar;
   overflow com scroll horizontal) e o terminal da aba ativa.
4. **Painel direito (260px, colapsável)** — Launcher (§4) quando nada
   selecionado; detalhes da sessão selecionada (P1: tokens §7, subagentes §8)
   quando houver.
   > **Nota 2026-07-23 (feedback E2E rodada 3)** — "colapsável" formalizado:
   > fechado por DEFAULT (o espaço vai pro terminal), sem ficar fixo
   > roubando espaço o tempo todo. Ver decisão completa em §4.
5. **Statusbar** — conta ativa, modelo/esforço da aba em foco, contagem de
   sessões, mini medidor smart zone da aba em foco (P1).

**Estados da vista:** primeira execução (sem projetos → empty state com botão
"Escolher pastas de projetos"); `claude` não encontrado (banner de erro CA-5
com caminho esperado); sem sessões abertas (centro mostra atalhos: nova
sessão, retomar recente, rotinas); fechar aba com sessão ativa (modal de
confirmação: título "Fechar sessão?", texto curto avisando que o processo
será encerrado, botões "Fechar sessão" (perigo) e "Cancelar"); processo
`claude` termina sozinho (estado "sessão encerrada" no CORPO do terminal —
mensagem central + botões "Reabrir" e "Fechar aba" — distinto do dot cinza da
lista de sessões).

**Configurações do app (P1):** tela mínima acessível pelo menu do app, com
edição dos roots de scan de projetos (adicionar/remover pastas) após o
onboarding. No P0 a única edição de roots é o fluxo de primeira execução.

---

## 3. Lista de sessões + semáforo (P0 — o coração)

Estados e comportamento (FR-010):

| Estado | Dot | Comportamento visual |
|---|---|---|
| Trabalhando | azul, pulso lento | nada exige atenção |
| Aguardando resposta | âmbar, fixo | linha sobe no ranking; contador "há 4min" |
| Permissão pendente | vermelho-coral, pulso rápido | topo absoluto da lista; entre 2+ pendências simultâneas, a mais antiga fica acima, cada uma com contador de tempo visível; toast/notificação Windows opcional |
| Falha/quota esgotada | roxo (`state-error`), fixo | distinto de encerrada; ação inline "trocar de conta e retomar" |
| Encerrada | cinza | ações inline: reabrir · fechar |

Ordenação: o estado do semáforo sempre vence (permissão pendente >
falha/quota > aguardando resposta > trabalhando > encerrada); pin só
desempata dentro do mesmo estado.

Linha da lista (sidebar e/ou painel dedicado): `dot · nome da sessão ·
projeto · modelo · tempo desde última atividade`. Clique = foca a aba.
Hover = preview do último output (3 linhas, mono). Atalhos de teclado:
`Ctrl+1`..`Ctrl+9` focam a sessão na posição N da lista; `Ctrl+Tab` foca a
próxima sessão que precisa de atenção (permissão > aguardando). Sessões
rodando sob perfil com headroom < 15% (P1) ganham badge da conta em vermelho
na própria linha, não só no dropdown de perfis.

---

## 4. Launcher (P0)

Painel vertical: Modelo (segmented: fable/opus/sonnet/haiku), Esforço
(segmented: low/med/high/xhigh/max), Permissões (select: manual, acceptEdits,
auto, plan, dontAsk, bypassPermissions — com descrição curta de cada), Nome (input),
projeto-alvo (herdado da seleção da sidebar, editável). Botão primário
"▶ Iniciar". Defaults persistidos. Validação: nome vazio = ok (flag omitida).

> **Decisão 2026-07-23 (feedback E2E rodada 3 — "painel lateral 'Lançar
> sessão' fixo rouba espaço e não parece produtivo")** — o painel deixa de
> ser fixo no painel direito (zona 4, §2). Comportamento final:
> - **Fechado por default** — o espaço do painel direito some e o terminal
>   (zona 3) ocupa a largura inteira.
> - **Abre** ao clicar no item "Sessão Claude" do menu da seta do "＋ Nova
>   sessão" (titlebar, zona 1) — esse item deixou de ser um atalho redundante
>   pro quick-launch (que já existia no CORPO do botão) e passou a abrir
>   este painel para configurar antes de lançar.
> - **Fecha** ao lançar uma sessão (botão "▶ Iniciar") ou ao pressionar `Esc`.
> - O clique no CORPO do "＋ Nova sessão" (quick-launch com a última
>   configuração usada) **continua sem depender do painel** — não abre nem
>   fecha nada, comportamento inalterado (T010, CA-1).

**Em sessão viva (FR-011):** os mesmos segmented de Modelo/Esforço aparecem
nos detalhes da sessão; trocar = injeta `/model` (tooltip: "aplica na sessão
em andamento"); quando indisponível, tooltip explica e oferece "reiniciar com
essa config".

---

## 5. Sessões anteriores (P0)

Lista por projeto (abre ao selecionar projeto na sidebar): `nome ou preview ·
data relativa · tamanho · modelo`. Ações por linha: **Retomar** (primário) ·
**Fork** (secundário, tooltip "nova sessão a partir desta"). Busca simples por
nome no topo (full-text é P1). Preview segue as regras do FR-004 (nunca
mostrar payload de controle). Edge case: transcript corrompido/truncado
entra na lista com preview "(ilegível)", sem derrubar o índice. Empty state:
"Nenhuma sessão anterior neste projeto — comece uma nova".

---

## 6. Perfis e quota — 15 contas (P0 dropdown; P1 painel)

**Dropdown (P0):** lista das contas `Tecnologia Claude 1..15`, cada linha =
badge de conta + % headroom + check na ativa. Item fixo no rodapé: "Gerenciar
contas…" e "Abrir claude-monitor ↗" (link para claude-monitor.seazone.dev).
Trocar conta = afeta apenas sessões novas (aviso sutil na primeira troca).

**Painel de gestão (P1):** grade das 15 contas com headroom, janela de reset,
última leitura; dados do claude-monitor.seazone.dev (embed ou API). Ação por
conta: "abrir sessão com esta conta". Estado de conta sem login: badge "login
pendente" — o login em si SEMPRE acontece dentro do terminal (o app nunca
manuseia credenciais). Estado de conta com junction quebrada (profile doctor,
FR-005): card exibe aviso + botão "Recriar links".

---

## 7. Medidor smart zone (P1 — componente transversal)

Barra 4px + rótulo `312k/400k`. Faixas: 0–70% `zone-ok`; 70–100% `zone-warn`;
>100% `zone-over` + ação sugerida "Handoff → nova sessão" (abre launcher
pré-preenchido com o mesmo projeto e nome `<sessão> (cont.)`). Aparece: nos
detalhes da sessão, na statusbar (aba em foco) e como anel fino em volta do
dot na lista de sessões quando > 70%. Toast complementar (F3): dispara ao
entrar em `zone-over`, canto inferior direito, ~6s de duração, texto "Sessão
passou da smart zone" + botão "Handoff → nova sessão".

---

## 8. Subagentes (P1)

Nos detalhes da sessão: lista das tasks/subagentes disparados — `nome/label ·
estado (rodando/concluído/erro) · duração`. Fonte: transcript JSONL da sessão.
Colapsada por default com contador ("3 subagentes · 1 rodando").

---

## 9. Post-its (P1)

- **Captura:** atalho global (proposta: `Ctrl+Alt+N`) abre mini-janela
  flutuante de UMA linha ("anota e some") — Enter salva, Esc cancela; nunca
  rouba o foco por mais de um instante. Nota de implementação:
  `globalShortcut.register()` do Electron retorna `false` silenciosamente se
  o atalho já estiver tomado por outro app — checar o retorno, avisar o
  usuário e oferecer reconfigurar em vez de falhar em silêncio.
- **Quadro:** vista dedicada (ícone na titlebar com contador) — grid de
  post-its (texto, data, projeto de origem opcional). Ações: arquivar,
  transformar em prompt ("enviar para sessão…"), copiar. Ordenação: mais
  recente primeiro. Visual: cartões amarelo-dessaturado (`#3A3526` fundo,
  texto claro) — reconhecíveis como post-its sem quebrar o dark.
- Persistência local (config do app); integração com Inbox do vault Obsidian
  como ação explícita "arquivar no vault" (P2).
- **Tematização Donel (ver §16):** o quadro é o **Tomo do Donel**; capturar =
  entregar uma carta a ele; cabeçalho, confirmações e empty state usam a voz
  do personagem; a mecânica "cartas do dia" devolve 2–3 post-its antigos no
  Setup do dia.

---

## 10. Todo do projeto (P1)

Aba no painel direito quando um projeto está selecionado: renderiza o
`todo.md` do vault do projeto (checkboxes interativos) e/ou cards TaskDex
quando o repo tem `.taskdex.json` (fonte indicada no header do painel).
Read-only na primeira versão exceto marcar checkbox. **Escrita do
checkbox:** sempre via REST local do Obsidian (mesmo mecanismo do MCP
`obsidian`, prática já estabelecida) — nunca escrita direta no arquivo sob
OneDrive. Se o REST estiver indisponível, o painel cai para read-only com
aviso visível.

---

## 11. Modo Dev (P2 — referência CodeLayer)

Ativado no switch da titlebar. A navegação muda de "projetos" para **tasks**:

```
┌───────────────┬──────────────────────────────────────────┬──────────────┐
│ TASKS         │ SZI-142 · Ajuste parcelas CUB            │ ARTEFATOS    │
│ ▸ SZI-142 ▣   │ [Discovery ✓][Plano ✓][Implementar ●]    │ spec.md    2 │
│   SZI-155     │ [Validar ][Concluir ]                    │ plan.md    5 │
│   SZI-160     │ ──────────────────────────────────────── │ tasks.md     │
│               │ STATUS  SESSÃO               FASE   UPD  │ diff.patch 1 │
│ [+ Nova task] │ ● work  implementa parcelas  Impl.  2m   │              │
│               │ ▲ wait  revisão do plano     Plano  15m  │              │
│               │ ◌ done  discovery entrevista Disc.  2h   │              │
└───────────────┴──────────────────────────────────────────┴──────────────┘
```

- **Sidebar:** lista de tasks (cards TaskDex do board vinculado), com chip da
  fase atual.
- **Centro:** header da task (id, título, repo/worktree, stepper das 5 fases
  da Esteira com estado ✓/●/vazio) + lista de sessões da task (uma linha por
  sessão: semáforo, nome, chip de fase, última atividade). Botão contextual
  por fase: "Iniciar fase →" (dispara a skill `/esteira-*` correspondente numa
  sessão nova — **uma sessão fresca por fase**, medidor smart zone visível).
- **Painel direito:** artefatos produzidos pela task (arquivos das specs,
  diffs), com contadores de alteração.
- Preset alternativo de fases (HumanLayer: Questions, Research, Design,
  Structure, Plan, Implement) selecionável na config; muda apenas rótulos e
  quantidade de chips no stepper.
- Gates do processo continuam nos donos de sempre (skills/humano): o app
  mostra e organiza, não aprova nada sozinho.

---

## 12. Rotinas (P1)

- Na titlebar/empty state: botão "☀ Setup do dia" (a primeira rotina, criada
  por default) — abre sessão no projeto configurado já executando a sequência
  de skills definida.
- Config de rotinas: lista ordenável de passos (cada passo = skill/prompt),
  projeto-alvo, modelo/esforço. Rotina = launcher pré-preenchido + prompt
  inicial composto.

---

## 13. Fluxos-chave (para prototipagem)

- **F1 Abrir o dia:** abrir app → badge de conta mostra headroom → "☀ Setup
  do dia" → sessão nasce rodando as skills matinais.
- **F2 Alternar 6 sessões:** trabalhando na aba 1 → dot vermelho pulsa na
  sidebar (permissão pendente na sessão 4) → clique → responde → volta.
- **F3 Handoff smart zone:** medidor entra em `zone-over` → toast "hora de
  handoff" → botão abre launcher pré-preenchido → nova sessão continua o
  trabalho.
- **F4 Trocar de conta por quota:** headroom da ativa < 15% (badge vermelho) →
  dropdown → escolhe conta com folga → novas sessões nascem nela.
- **F5 Post-it no meio do trabalho:** `Ctrl+Alt+N` → digita → Enter → segue
  trabalhando; à tarde abre o quadro e recapitula.
- **F6 Task pela Esteira (modo Dev):** nova task → Discovery (sessão fresca) →
  ✓ → "Iniciar Plano →" (sessão fresca) → … → Concluir; artefatos acumulam no
  painel direito.
- **F7 Novo projeto:** "＋ Novo projeto" na sidebar → formulário dinâmico
  (§15) → confirmar → sessão abre rodando `/new-project` com as respostas →
  projeto aparece na sidebar ao concluir.

## 15. Novo projeto — formulário dinâmico (P1)

Aberto pelo botão "＋ Novo projeto" no rodapé da seção PROJETOS da sidebar.
Modal centrado (não wizard de página inteira), um passo visível por vez com
progressão fluida — as perguntas seguintes reagem às respostas:

1. **Tipo:** Pessoal × Profissional (segmented, obrigatório).
2. **Nome do projeto** (input; slug kebab-case gerado ao lado, editável).
3. **Tema** (input opcional; placeholder "ex.: automação de heartbeats").
4. **Tem todo?** (toggle) — cria `todo.md` no vault do projeto.
5. **Repositório:** Nenhum × Criar novo × Vincular existente (se "vincular":
   campo de path/URL; se Profissional: oferecer vínculo TaskDex).
6. Resumo do que será criado (diretório, vault, pointer, TaskDex) + botão
   primário "Criar projeto".

Ao confirmar, abre uma sessão executando a skill `/new-project` com as
respostas — o progresso do scaffolding aparece no próprio terminal da sessão.
Estados: validação de nome duplicado (projeto já existe no root escolhido);
erro da skill = sessão fica aberta para diagnóstico.

## 16. Identidade do personagem — Donel

**Lore (canônico, do RPG do Alexandre — papo de 22/07):** Jobu Donel é um
tengu (homem-corvo) **taumaturgo** de Pathfinder. Corpo preto como a noite
com **uma única pena branca no peito**. Carrega sempre um **espelho** e um
**tomo**; coleciona bugigangas esotéricas e **vê padrões onde ninguém vê**.
Tema de **cartomante**: lia cartas e falava do futuro das pessoas. Anda com
velas e incensos; respeita todas as divindades e sabe os ritos de todas.
**Nômade** — vive em passeio, nunca para num lugar. Personalidade: **bobo e
entusiasmado**, com **ironia pontual** quando necessário; sem bordão — o
registro dele é a **analogia improvável que acaba fazendo sentido**.

### Mascote (direção visual)

- Corvo estilizado em silhueta preta que se funde com o fundo escuro; a pena
  branca no peito é A marca — único highlight. Acessórios conforme o
  contexto: o tomo (memória/post-its) e o espelho (retrospectiva, futuro).
- Estático ou micro-animação sutil (piscar, inclinar a cabeça). Nunca
  animação chamativa sobre a área de trabalho.
- O ícone do app deriva dele: cabeça do corvo ou a pena branca.
- Dourado de vela (`#E8B44C`, já na paleta) como acento esotérico nas
  ilustrações do Donel; não usar o roxo (reservado ao estado falha/quota).

### Voz (regras de microcopy)

- Entusiasmado; analogias esotérico-cotidianas improváveis que fazem
  sentido; ironia RARA e leve (nunca no primeiro contato de um fluxo).
- Frases de 1 linha (máx. 2); nunca bloqueiam ação; sempre em elemento
  secundário (caption, header do quadro, tooltip) — nunca modal.
- Erros, permissões e qualquer fluxo crítico NUNCA usam a voz do Donel —
  clareza acima de charme.

Falas de exemplo (calibram tom para design e microcopy):

- Captura de post-it: "Guardado no tomo. Ideia solta é incenso apagado —
  essa aqui fica acesa."
- Abrir o quadro: "Você voltou! Vamos ver o que as cartas guardaram."
- Cartas do dia (no Setup): "Rito da manhã: acendi as velas e separei 3
  cartas de ontem que pedem tua atenção."
- Padrão detectado: "Essa rima com aquela de terça. Não acredito em
  coincidência — acredito em padrão."
- Ironia dosada (tomo lotado): "Trigésima carta no tomo. Em algum momento a
  gente lê, certo?"
- Empty state do quadro: "Tomo vazio. Até augúrio precisa de matéria-prima."
- Fim do formulário de novo projeto: "Caminho novo — o nômade aprova."

### Onde vive / onde nunca entra (direção do papo de 22/07)

- **Vive:** post-its (§9 — capturar = entregar uma carta; quadro = Tomo do
  Donel), "cartas do dia" no Setup do dia, empty states, fecho do formulário
  de novo projeto (§15).
- **Nunca:** sobre o terminal, em notificações de permissão, em mensagens de
  erro, nos gates do modo Dev. O app é sala de controle calma; o Donel vive
  nos momentos de memória e rito, não sobre o trabalho.

### Mecânica "ele devolve, não só guarda"

No Setup do dia (§12) e no primeiro open do quadro no dia, o Donel traz 2–3
post-its antigos como uma "leitura de cartas" — os mais velhos não
revisitados ou os relacionados ao projeto ativo. Ações por carta: manter no
tomo · virar prompt · arquivar. É o que o torna útil, não decorativo.

## 17. Dados de exemplo para o design (LGPD-safe)

Projetos: `bizops-ai-native`, `spotsys`, `dalton`, `donel-dev`, `ai-rats`.
Sessões: "spec do donel", "radar spotsys", "fix build_real.py", "setup do
dia", "revisão PR 214". Contas: `Tecnologia Claude 1..15` (headrooms 62%,
38%, 91%, 12%, "—"). Tasks modo Dev: `SZI-142 Ajuste parcelas CUB`,
`SZI-155 Webhook medalhas`, `SZI-160 Radar de PRs`. Nunca usar nome de
proprietário/cliente/hóspede/liderado.
