---
fonte: Treinamento — Lideranças Tech, 03/11/2026, 18h (Bruno Benetti, CTO), 1h47
materiais: transcrição do Meet, slides "Faixas do Claude Code" (HTML/PDF no #hoenn-tech), gravação no YouTube (não listada)
cópia local: vault Claude Seazone, Projects/donel-dev/reunioes/2026-11-03-treinamento-liderancas-tech/
status: insumo — base das próximas semanas, por pedido do dono (03/11)
---

# Treinamento das lideranças Tech (03/11) e o que ele pede do Donel Dev

## O que foi dito, em uma tela

- **Objetivo das 3 semanas** (3, 5, 10, 12, 17 e 19/11): cada líder com a sua *software factory* pessoal, e
  cada produto/área da Tech com o seu **sistema multiagente** que opera o trabalho (software, dados, RM,
  fechamento...). Fecha na semana presencial das lideranças.
- **Segunda, 09/11: roadmaps congelados**, "modo crise", todo mundo construindo os sistemas multiagentes das
  áreas. Semana 3: cada um mostra o que construiu.
- **Dois níveis, separados de propósito**: o *setup pessoal* (vai contigo se você mudar de empresa, "o teu VS
  Code") e a *factory do produto* (vive sem você, roda com contas próprias via proxy, ninguém humano toca nas
  contas). O setup pessoal **opera** a factory do produto; não é a factory.
- **Faixas = gargalos resolvidos**: branca (consulta) → amarela (conectado, executa) → verde (várias sessões,
  discovery + loop/eval) → azul (rotinas e gatilhos) → roxa (orquestradora durável, depois na nuvem) →
  marrom (várias sessões duráveis + camadas) → preta (em aberto).
- **Sessão durável**: sobrevive a reinício, tem nome/endereço, sabe onde parou, é acordada por outra sessão ou
  rotina; roda 24/7, de preferência numa VPS. Diferente de `/resume` (que só puxa contexto).
- **Problemas da marrom**: sessão para e ninguém vê; entrega que ninguém revisa; tarefas espalhadas; sem visão.
  Guarda vigiando guarda não resolve: **precisa de determinismo** (código de verdade, não LLM).
- **As 10 camadas** (slide "Todas as camadas"): interface humana (painel) · orquestração (ex.: OpenRig, "o
  Kubernetes das sessões": o posto fica, quem ocupa pode ser trocado) · gestão de tarefas (*ledger*: dono, prazo,
  estado) · agentes (Claude Code, Codex, Pi) · memória persistente · observabilidade · livro de receitas ·
  rotinas e gatilhos · verificação (quem entrega não aceita) · alçadas e permissões.
- **Ledger com prova**: a API recusa "pronto" sem prova (print, vídeo); um agente contrário confere a prova.
  Ainda assim, **daily com os agentes**: painel com "terminou, tá aqui a prova", filtrado por risco.
- **O setup dele (Billverso)**: OpenRig + ledger no Supabase + Cloudflare; painel web com agentes, tarefas que
  dependem dele, rotinas, entregas aprovadas/reprovadas; **opera tudo pelo celular**. Mensageria entre sessões
  (Herdr/Orca), várias máquinas (Herdr por SSH, Tailscale). Entregas chegam **desenhadas no Excalidraw**; ele
  aprova, reprova e desenha por cima, e o agente lê o feedback de lá.
- **Ideias soltas**: sem PR (burocracia de humano); bugfix em produção com SLA de 30 min; Opus 5.5 em
  esforço baixo para tarefas de execução; Olimpo/Hermes não serve para operação de risco (harness e modelo
  inferiores); "provas em vídeo para rolar" (Roberto) e "aprovar/reprovar estilo Tinder" (Bruno).
- **Quinta, 05/11**: treinamento só de OpenRig e do setup dele.

## O painel do Bill, visto no vídeo (≈ 00:55–00:58 da gravação)

Frames em `reunioes/2026-11-03-treinamento-liderancas-tech/frames/` no vault.

- **Lema na home do billverso.com: "Os agentes mudam. As cadeiras ficam."** Cada agente ocupa uma cadeira,
  cada tarefa tem dono e critério de aceite, e um único registro diz o que é verdade. É o nosso "lugar" (seat).
- **Abas**: Mapa · Pulso · Tarefas · Saldos · Ideias · Entregas · Pessoal · Excalidraw ↗. No topo: "daemon ok ·
  ledger ok · relido há 1 s".
- **Faixa de números**: realizadas hoje · pendentes (quantas paradas há mais de 8 h) · **geradas sem você**
  (% das suas, quantas vieram de rotina) · **validadas sem você** (% dos aceites) · **esperando você** (e a mais
  velha) · menor saldo de conta · energia (tokens; quem mais gasta) · cadeiras por estado (problema · atenção ·
  bem · sem sinal).
- **Mapa**: grupos (rigs) **comando** (orquestradora, triagem, supervisor, clérigo, infra, eficiência, curador),
  **fábrica** (orquestrador-tech → arquiteto → dev-1…dev-6 → qa → revisor → sre → "entregas hoje"),
  governança, assistentes, nautilus. Legenda de ligações: delega · escala · colabora · rotinas; camadas ligáveis
  "quem observa" e "tráfego 24 h".
- **Coluna esquerda**: prioridades do dono (adicionar, subir/descer) e a lista de grupos com contagem.
- **Coluna direita**: fila (abertas, em execução, **entregues sem aceite**, retrabalho hoje, entregas hoje),
  saldos por provedor (Claude: "22 de 24 contas", Codex, AI Hub, Supabase) e um feed "Aconteceu".
- **Alçada no próprio painel**: "Só leitura aqui · ações só em Entregas e nas Prioridades, com login".
- **Excalidraw**: um desenho por entrega, nomeado pelo ID da tarefa (ex.: "T-000804 Nautilus · topologia-alvo
  no OpenRig"). É ali que ele aprova, reprova e rabisca.

Quase tudo isso tem par no Donel Dev: Mapa ↔ Mindscape; esperando você ↔ "Precisa de você"; saldos ↔ pool de
contas (011) e folga de cota (002); cadeiras por estado ↔ estado em três eixos; Excalidraw por entrega ↔ desenho
do Mindscape. O que não tem par: **ledger** (fila, entregues sem aceite, retrabalho), **"sem você"** como
métrica e o **daemon** que mantém tudo vivo.

## Depois da reunião

- SeaNotes registrou como **decisão**: adoção do OpenRig como camada de orquestração, e proxy de contas de IA
  (MVP com o Márcio).
- O Bill subiu uma VPS para o dono (`vps-alexandrelentz`, 8 GB, Linux, acesso só por Tailscale, sem porta
  aberta; já vem com git, tmux, docker, node, uv, gh, Claude Code e Codex, sem login).

## Onde o Donel Dev está, camada por camada

| Camada | Hoje no Donel Dev | Falta |
|---|---|---|
| Interface humana | **Forte**: Mindscape (cartão rico, estado em 3 eixos, papéis), Jobu como Líder, chat, faixa "Precisa de você", falar desenhando (item 16) | Acesso de fora do PC (celular/web); "daily" de entregas com prova |
| Orquestração | App é dono dos PTYs; sessão renovada em voo (B36); papéis fixos por lugar | **Sessão durável de verdade**: app fechado = tudo para (decisão de 03/11, "por enquanto"); não roda em outra máquina |
| Gestão de tarefas (ledger) | Board do Modo Dev, trava local da 010 | Registro único com dono/estado e **gate de prova** determinístico |
| Agentes (harness) | **Alinhado**: LLM agnóstico, Provedores (011), MCP `donel` para qualquer motor | Codex/Pi como cidadãos de primeira |
| Memória persistente | Passagem de bastão em `userData/handoffs/` (B36) | Memória por posto, não por conversa |
| Observabilidade | Semáforo, estado em 3 eixos, contexto consumido | Replay, alerta de "parou sem ninguém ver", histórico por posto |
| Livro de receitas | Skills, esteira 012, Modo Dev | Receita por papel injetada no lançamento (item 12, em parte) |
| Rotinas e gatilhos | Só o build alfa diário (Agendador do Windows) | Rotina/evento que **acorda um posto** dentro do app |
| Verificação | `esteira-check`, revisor da esteira | "Quem entrega não aceita" como regra do ledger, com prova anexada |
| Alçadas e permissões | Ligações que autorizam (item 13, decidido) | Alçada por posto: o que faz sozinho e o que sobe para o dono |
| Mensageria / várias máquinas | Item 13 (pendente); `herdr` só como spike (B28) | Mensagem entre postos sem atropelar; postos em outra máquina |

## O que isso muda (a transmutação)

1. **O Donel Dev deixa de ser "um terminal com Claude dentro" e vira a interface humana de um sistema
   multiagente pessoal.** O valor dele está no que nenhum outro tem: o Mindscape como canal gráfico (que o próprio
   Bruno chegou por outro caminho, com Excalidraw), o Jobu e a faixa "Precisa de você".
2. **O runtime das sessões precisa sair do processo do app.** Postos duráveis num servidor de sessões (local e
   numa VPS Linux), com o app como uma das janelas. A decisão de 03/11 ("app fechado → para, por enquanto") vira
   o primeiro gargalo a cair. A API local que nasceu "como contrato que um servidor remoto possa servir" é a
   costura.
3. **OpenRig volta à mesa como camada, não só referência.** Ele foi descartado como runtime por não rodar no
   Windows nativo. Na VPS Linux esse motivo some, e a empresa decidiu adotá-lo. Proposta: o Donel Dev vira a
   interface humana sobre o OpenRig rodando na VPS, por adaptador (mesma régua do LLM agnóstico: nada fixo),
   confirmada **depois do treinamento de quinta (05/11)**.
4. **Ledger com prova entra no centro do Mindscape.** Cartão de entrega com print/vídeo, aprovar ou reprovar num
   gesto (o "Tinder" do Bruno), filtro por risco. É a "daily com os agentes" desenhada.
5. **Rotinas e gatilhos acordam postos.** Sem isso o sistema só trabalha quando o dono está no PC.
6. **Pessoal × factory de produto.** O Donel Dev é o setup pessoal; as factories da área vivem fora dele. Ele fala
   com elas por adaptador opcional (regra Seazone opcional), nunca fixo.

## O que já está em andamento e sobe de prioridade

Do [PDA mindscape-openrig](../planos/mindscape-openrig.pda.md): 13 (conexões que autorizam e mensagem sem
atropelar), 15 (esteira montada no Mindscape), 16 (falar desenhando), 17 (nó de terminal), 18 (Jobu como Líder),
09 (salvar e reabrir o quadro, ponte para durabilidade) e o B32 (hibernar/acordar).

## Datas

- 05/11 (qui) 18h — treinamento de OpenRig e do setup do Bruno.
- 09/11 (seg) — roadmaps congelados; construção dos sistemas multiagentes das áreas.
- 10, 12/11 — treinamentos seguintes; 17, 19/11 — cada um mostra o que construiu.
