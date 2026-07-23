# Design System — Donel Dev

Documento autocontido para a ferramenta de design. Envie este arquivo
primeiro (ou junto de cada brief de tela). Ele define TODAS as decisões
visuais do produto; os briefs de tela (`design-handoff.md`) só descrevem
layout e conteúdo — cores, tipos, componentes e voz vêm daqui.

**O produto em uma frase:** Donel Dev é o cockpit desktop (Windows) de um
operador que roda ~6 sessões do Claude Code em paralelo — um terminal de
primeira classe no centro, e em volta os painéis que dizem de relance qual
sessão precisa dele, quanto contexto cada uma consumiu e em qual das 15
contas ela roda.

---

## 1. Princípios

1. **Sala de controle calma.** Cor comunica ESTADO, quase nunca decoração.
   Nada pisca sem motivo; o que pisca importa de verdade.
2. **Denso, não apertado.** Muita informação por tela, respirando por
   hierarquia e espaçamento consistente — não por esconder coisas.
3. **O terminal é o palco.** O chrome (sidebar, painéis, barras) é moldura:
   escuro, discreto, sem competir com o conteúdo da sessão.
4. **Dark-first.** O tema escuro é o primário e único no lançamento; todo
   contraste é calibrado para ele.
5. **O Donel vive na memória, não sobre o trabalho.** O personagem (§10)
   aparece nos momentos de captura/recordação/rito — nunca em cima do
   terminal, de permissões ou de erros.

## 2. Cor

### Superfícies e texto

| Token | Hex | Uso |
|---|---|---|
| `bg-app` | `#0E1116` | fundo da janela |
| `bg-panel` | `#151A21` | sidebar, painéis, cards |
| `bg-raised` | `#1C232C` | hover, aba ativa, inputs, modal |
| `border` | `#28303B` | hairlines de 1px |
| `text-primary` | `#D7DDE5` | texto principal |
| `text-muted` | `#828D9C` | metadados, labels, captions |
| `accent` | `#4C9CF0` | seleção, links, foco, botão primário |

### Estados do semáforo de sessões (o vocabulário central do app)

| Token | Hex | Estado | Comportamento |
|---|---|---|---|
| `state-working` | `#4C9CF0` | trabalhando | pulso lento (2 s) |
| `state-waiting` | `#E8B44C` | aguardando resposta | fixo + contador de tempo |
| `state-permission` | `#F0684C` | permissão pendente | pulso rápido (1 s) + halo |
| `state-done` | `#5E6873` | encerrada | fixo |
| `state-error` | `#B678F0` | falha / quota esgotada | fixo |

### Smart zone (medidor de contexto, ~400k tokens)

| Token | Hex | Faixa |
|---|---|---|
| `zone-ok` | `#3DCE8F` | 0–70% — dentro da zona |
| `zone-warn` | `#E8B44C` | 70–100% — atenção |
| `zone-over` | `#F0684C` | >100% — hora de handoff |

### Regras de cor

- Vermelho-coral (`#F0684C`) é EXCLUSIVO de "precisa de você agora"
  (permissão, zona estourada). Roxo (`#B678F0`) é exclusivo de falha/quota.
- Dourado de vela (`#E8B44C`) acumula três papéis compatíveis: aguardando,
  zona de atenção e acento esotérico das ilustrações do Donel.
- Headroom de conta: verde > 40%, dourado 15–40%, vermelho < 15%, cinza "—"
  sem leitura.
- Terminal: tema ANSI próprio de contraste alto sobre `bg-app`, cursor
  `accent`.

## 3. Tipografia

- **UI:** Inter (fallback system-ui). Corpo 13px/1.5; metadados e captions
  11px; títulos de seção 15px/600. Pesos: 400 e 600 apenas.
- **Dados:** JetBrains Mono 12.5px — paths, nomes de sessão, slugs, números
  de token, conteúdo do terminal, previews de output.
- Sentence case em tudo; sem CAPS-LOCK exceto labels de seção da sidebar
  (11px, tracking largo, `text-muted`).

## 4. Grid, espaçamento e densidade

- Base de espaçamento **8px** (4px permitido em micro-gaps).
- Linhas de lista 30–32px; padding de painel 12px; radius **6px** (cards e
  modal 8px).
- Layout do shell: sidebar 240px · centro fluido · painel direito 260px
  (colapsável) · statusbar 28px.
- Hairlines de 1px `border` separam zonas; sem sombras salvo modal
  (`0 8px 24px rgba(0,0,0,.4)`).

## 5. Iconografia

- **Lucide outline**, 16px, stroke 1.5, cor do texto adjacente. 20px apenas
  em empty states.
- Ícones não substituem texto em ações primárias; botões só-ícone têm
  tooltip.
- O corvo/pena do Donel (§10) NÃO entra no set utilitário — é identidade,
  usada só nos contextos do personagem e no ícone do app.

## 6. Componentes

- **Dot de estado:** círculo 8px na cor do estado + label textual quando há
  espaço (nunca só cor — acessibilidade). Pulsos: opacidade 100→40%,
  `working` 2 s, `permission` 1 s + halo de 2px. Anel fino `zone-warn`
  quando a sessão passa de 70% da smart zone (P1).
- **Medidor smart zone:** barra horizontal 4px, preenchimento proporcional,
  cor da faixa; rótulo mono "312k/400k"; tooltip com detalhe e ação
  "Handoff → nova sessão" quando `zone-over`.
- **Badge de conta:** pílula "Tecnologia Claude {n}" + % de headroom na cor
  da regra de headroom.
- **Chip de fase (modo Dev):** retângulo 11px com nome da fase da Esteira
  (Discovery, Plano, Implementar, Validar, Concluir), uma cor fixa e
  dessaturada por fase.
- **Botões:** primário = fundo `accent`, texto `#0E1116`; secundário =
  borda `border`, texto `text-primary`; ghost = só texto; perigo = texto
  `#F0684C`. Split-button no "＋ Nova sessão" (clique = última config;
  seta = abrir launcher). Altura 30px.
- **Inputs / select / toggle / segmented:** fundo `bg-raised`, borda
  `border`, foco com anel `accent` 1px; segmented para
  modelo/esforço/tipo (opção ativa `bg-raised` + texto `text-primary`).
- **Abas de terminal:** dot de estado + nome (mono) + modelo abreviado;
  ativa = `bg-raised` com borda superior `accent`; aba de terminal comum usa
  ícone de shell no lugar do dot.
- **Cartas (post-its):** cartões `#3A3526` com texto claro, data e projeto
  em caption; usados no Tomo do Donel (§10).
- **Modal:** central, máx. 480px, fundo `bg-raised`, overlay `rgba(0,0,0,.5)`;
  usado só para confirmação destrutiva e formulário de novo projeto.
- **Toast:** canto inferior direito, ~6 s, uma linha + no máx. uma ação.
- **Statusbar:** 28px, texto 11px `text-muted`: conta ativa · modelo/esforço
  da aba em foco · nº de sessões · mini smart zone (P1).

## 7. Motion

- Durações: micro 120 ms, painéis 200 ms, ease-out padrão.
- Só três coisas se movem sem input do usuário: os dois pulsos do semáforo e
  o micro-gesto opcional do mascote. Todo o resto anima apenas em resposta a
  ação.

## 8. Voz e microcopy (neutra)

- pt-BR, sentence case, direta e curta; sem "por favor", sem exclamações em
  fluxo de trabalho.
- Erros dizem o que houve e o que fazer, em tom neutro — NUNCA na voz do
  personagem.
- Estados vazios orientam a próxima ação ("Nenhuma sessão anterior neste
  projeto — comece uma nova").

## 9. Acessibilidade

- Contraste mínimo 4.5:1 para texto sobre qualquer superfície listada.
- Estado nunca comunicado só por cor: dot sempre pareado com label, posição
  na lista ou tooltip.
- Todos os fluxos principais operáveis por teclado (Ctrl+1..9 e Ctrl+Tab
  trocam de sessão; Ctrl+Alt+N captura post-it).

## 10. O Donel — identidade do personagem

Jobu Donel, personagem de RPG do dono do app: **tengu (homem-corvo)
taumaturgo**, cartomante esotérico, nômade, colecionador de bugigangas, que
via padrões onde ninguém via. Bobo e entusiasmado, ironia rara, fala por
analogias improváveis que fazem sentido.

- **Mascote:** corvo em silhueta preta que se funde com o fundo escuro; UMA
  pena branca no peito é a marca — único highlight. Acessórios por contexto:
  tomo (memória) e espelho (retrospectiva). Acento em dourado de vela
  `#E8B44C` (velas, cartas). Nunca roxo (reservado a falha/quota). Estático
  ou micro-gesto (piscar, inclinar a cabeça).
- **Ícone do app:** derivado dele — cabeça do corvo ou a pena branca.
- **Onde ele vive:** Tomo do Donel (quadro de post-its = cartas), "cartas do
  dia" no Setup do dia, empty states, fecho do formulário de novo projeto.
- **Onde nunca entra:** sobre o terminal, permissões, erros, gates do modo
  Dev.
- **Voz dele:** 1 linha (máx. 2), em elemento secundário, nunca modal.
  Exemplos de calibragem: "Guardado no tomo. Ideia solta é incenso apagado —
  essa aqui fica acesa." · "Você voltou! Vamos ver o que as cartas
  guardaram." · "Essa rima com aquela de terça. Não acredito em coincidência
  — acredito em padrão." · "Tomo vazio. Até augúrio precisa de
  matéria-prima."

## 11. Dados de exemplo padrão (usar em todas as telas)

- Projetos: `bizops-ai-native`, `spotsys`, `dalton`, `donel-dev`, `ai-rats`.
- Sessões: "spec do donel", "radar spotsys", "fix build_real.py", "setup do
  dia", "revisão PR 214".
- Contas: `Tecnologia Claude 1..15` — headrooms de exemplo 62% (ativa: nº 3),
  38%, 91%, 12%, "—".
- Tasks do modo Dev: `SZI-142 Ajuste parcelas CUB`, `SZI-155 Webhook
  medalhas`, `SZI-160 Radar de PRs`.
- Nunca usar nome de proprietário, cliente, hóspede ou liderado (LGPD).
