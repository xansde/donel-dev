# OpenRig como referência para o Mindscape (03/11/2026)

Pedido do dono: "pesquise sobre o openRig. Parece ser o tipo de coisa que eu gostaria para o
Mindscape". Fontes: README, wiki e `docs/` do repositório (`docs/as-built/ui/topology.md`,
`docs/as-built/architecture/coordination-primitive.md`, `docs/reference/agent-state-taxonomy.md`).

## O que é

- `github.com/mvschwarz/openrig`, Apache 2.0, ~8,6 mil estrelas, v0.7.x, commits diários.
- Daemon local + CLI + TUI + servidor MCP, em cima do tmux. Junta sessões de Claude Code, Codex e
  Pi num "rig": um time declarado em YAML (pods, seats, edges, políticas de continuidade).
- **Não roda no Windows nativo** (só WSL2). Serve de referência, não de dependência. É a mesma
  conclusão do B28 (herdr).

## O que serve ao Mindscape

| OpenRig | No Mindscape |
|---|---|
| **Seat**: papel e endereço estáveis (`dev@starter`); a conversa dentro dele pode trocar. | O cartão passa a ser um *lugar*, não uma conversa. Sobrevive a compactar, retomar e hibernar (B32). |
| **Pod**: moldura tracejada que agrupa seats com orientação compartilhada. | Moldura de grupo no quadro: é a forma visual dos "temas" do agente do B34. |
| **Cartão do agente**: selo do runtime, % de contexto, tokens, anel de atividade (ativo · precisa de você · bloqueado). | Cartão de sessão mais rico. O selo mostra o motor, seja qual for (nada preso a uma IA). |
| **Prévia do terminal**: espelho estático primeiro, clique para ao vivo, teto de terminais vivos na página. | Ver a sessão sem sair do quadro, sem custo de RAM. Peça central do "Mindscape como lugar principal". |
| **Três vistas dos mesmos dados**: grafo · tabela · grade de terminais. | Quadro = grafo; a barra lateral recessiva vira a tabela; grade de terminais para acompanhar várias. |
| **Hot-potato edge**: aresta animada quando trabalho passa de um agente a outro. | Ligações com tipo (delegou, entregou, revisou) que se animam quando acontece. Hoje são só desenho. |
| **Taxonomia de estado em 3 eixos**: sessão (presente/destacada/encerrada), atividade (trabalhando/parada/**desconhecido**), retomabilidade (viva/retomável/sem contexto). Precisa-de-você é *contagem + motivo* ("permissão", "limite de uso"), não estado. "Desconhecido vence uma resposta confiante e errada." | Arrumar o semáforo: adormecido, hibernado e retomável deixam de competir no mesmo campo. Mesma lição da issue #35. |
| **PARKED** (parada + compromisso aberto) e **DONE-UNSEEN** (terminou e ninguém viu). | DONE-UNSEEN já é o destaque da V1. PARKED é coluna nova do Organizar. |
| **Snapshot/restore do rig inteiro**, com resultado por nó (retomou, nova, aguarda decisão). | "Fechar o dia" e "reabrir o quadro": acorda todas as sessões do quadro e diz o que voltou. |
| **Agentes mexem na topologia por MCP** (`rig_up`, `rig_send`). | O agente do B34 age no quadro pelas ferramentas MCP do próprio app, o mesmo servidor local do navegador interno. Qualquer motor que fale MCP usa. |
| **Fila, inbox e chatroom entre agentes.** | Orquestração. Fica para o "Depois" do B32. |

## O que não copiar

- tmux e daemon com SQLite (96 migrações). O Donel Dev já é dono dos PTYs e do estado.
- Topologia declarada em YAML antes de rodar. O quadro do dono nasce do uso, não de um spec.

## Ordem sugerida de fatias

1. Cartão rico com a taxonomia de 3 eixos e o motivo do "precisa de você".
2. Prévia do terminal no cartão (espelho → ao vivo, com teto).
3. Molduras de grupo: a base visual que o agente do B34 vai preencher.
4. Depois: ligações com tipo e animação, snapshot do quadro, fila entre sessões.
