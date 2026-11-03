---
demanda: mindscape-lugar-principal
plano: docs/planos/mindscape-lugar-principal.pda.md
item: 01
data: 2026-10-31
autor: Claude por delegação de Alexandre Lentz
fontes: Slack da Seazone (leitura via Composio, conta do dono), links externos públicos
---

# Pesquisa — o que o Bill trouxe dos EUA (21/09 a 30/10/2026)

Bruno "Bill" Benetti, CTO, viajando pelos EUA com o Fernando (post de 26/10; volta na semana de
02/11). Quase tudo em `#grupo-secreto-do-bill`. Leitura apenas; nada foi postado.
Links do Slack relativos a `https://seazone-fund.slack.com/archives/`.

## Achados e o que muda no Donel Dev

| # | Achado | Relevância | Melhoria no Donel |
|---|---|---|---|
| 1 | **Orquestrador que abre uma sessão por skill** + `firstmate` (Kun Chen): agente líder, uma worktree por tarefa, watcher que só acorda quando algo precisa de atenção, estado em disco. `C0BH8K82X6W/p1790878436818229`, https://github.com/kunchenguid/firstmate | alta | **B32**: "próxima fase em aba nova" — ao fim de uma skill da Esteira, abrir aba nova na mesma worktree com a próxima skill e hibernar a anterior; fila em disco que sobrevive a reiniciar o app. |
| 2 | **OpenRig / Gas Town**: "fale com um agente, construa com uma equipe"; líder despacha para especialistas persistentes (Claude Code, Codex, Pi). Exige tmux. `C0BH8K82X6W/p1793311744044009`, https://openrig.dev/ | alta | **B32 (depois)**: aba líder que despacha para abas especialistas, sem tmux — é o diferencial do Donel no Windows. Reforça o B34 agnóstico de LLM. |
| 3 | **Steve Yegge, "The Shape of Things to Come"**: o gargalo vira coordenação e revisão; trabalho como grafo com claim atômico, *leases* e dependências; revisão em camadas, humano nas exceções. `C0BH8K82X6W/p1793379561789869`, https://yegge.ai/essays/the-shape-of-things-to-come/ | alta | Trava local da 010/012 ganha **lease que vence sozinha** (nunca órfã) e a fila do B32 vira grafo com dependências explícitas. |
| 4 | **pstack (Lauren Tan)**: agente prova com evidência (teste vermelho→verde, vídeo antes/depois); uma "verificação por produto" (CLI que sobe o app, semeia dados, navega). `C0BH8K82X6W/p1790891490792859`, https://flaviocopes.com/pstack | média-alta | **Novo**: `verificar-donel` sobre os smokes que já existem, gravando screenshot/vídeo como evidência no PR; o painel de PRs mostra a evidência. Liga com o B9. |
| 5 | **Esteira beta 1.19/1.20**: uma sessão por skill; implementação sem o dono, dúvida resolvida pela opção mais conservadora e registrada em `docs/decisoes/<branch>.md`; skill `/verificacao`. `C0BH8K82X6W/p1790969194452129` | média | Painel do PR/sessão mostra o arquivo de decisões do agente para o dono revisar. |
| 6 | **Treinamento IA Nível 3 + medidor de uso**: a virada é "algo rodando sem você" (98,4% dos PRs de tecnologia com Claude, só 11,3% com algo rodando sozinho). `CDKD79F6F/p1793217133971329` | média | Mostrar no Donel o que roda sozinho (rotinas, agendamentos, filas). Conferir se a soma por e-mail do coletor aguenta a troca de contas do pool. |
| 7 | **HumanLayer** (citado como recomendação do CTO num resumo automático): roda agentes de vários fornecedores com daemon por máquina; desktop só macOS. https://github.com/humanlayer/humanlayer | média | Concorrente direto que falta em `docs/produto/pesquisa-mercado-2026-10-30.md`. |
| 8 | **Browser Use Cloud**: navegador na nuvem com captcha resolvido. `C0BH8K82X6W/p1793321251503509` | baixa | No máximo adaptador opcional ao lado do `--chrome`. |
| 9 | **REA** (MCP de engenharia reversa local). https://github.com/morluto/rea | baixa | Ferramenta de pesquisa, como a leitura do binário do CLI. |

Sem relevância: SIA Lab, tutoras que o dono já tem, replica-skill, MCP de Reservas.

## O que entra nesta leva

- Nada muda a fatia de hoje (F1–F3). A direção bate com ela: o Mindscape vira o painel de
  coordenação (achado 3), e o diário de gestos é o começo do "algo que melhora sem você"
  (achado 6).
- Viram registro no backlog: B32 ganha "próxima fase em aba nova", fila em disco e lease
  (achados 1–3); item novo para a verificação com evidência (achado 4); HumanLayer na pesquisa
  de mercado (achado 7).

## Pendência pessoal do dono encontrada

- DM do Bill em 26/10: falta o dono instalar o coletor de uso de IA (`C0BH8K82X6W/p1792959897001719`).

## Não verificado

- Artigos da Lauren Tan no X (HTTP 402; usados resumos de terceiros), vídeos (só títulos),
  imagens e anexos das threads, licença do OpenRig, se o "Human Layer" do resumo é o mesmo
  produto do GitHub, mensagens anteriores a 20/09.
