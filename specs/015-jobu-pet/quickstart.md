# Quickstart — validação do pet do Jobu Donel (015)

Registro das baterias. **O dono não segue este arquivo**: a validação manual
dele vai numa página HTML local, um passo por vez, com print do esperado e
botões "funcionou / não funcionou" (regra do repo desde 08/10). Este arquivo é
a fonte da página e o lugar onde o resultado fica registrado.

## Preparação

1. Alfa instalado com a 015 (a partir de `staging`).
2. Preferências → **Jobu na área de trabalho** ligado.
3. Pelo menos duas sessões do Claude abertas em abas (nomes curtos, ex.:
   `atlas` e `beacon`).

## B1 — O rosto diz quem espera (US1, SC-001)

| # | Passo | Esperado |
|---|---|---|
| 1.1 | Fechar todas as sessões | Jobu dormindo (Zzz) |
| 1.2 | Abrir uma sessão e mandar uma tarefa longa | Jobu lendo o grimório |
| 1.3 | Minimizar o Donel e esperar o turno terminar | Em até 2 s: balão `atlas · terminou`, depois rosto impaciente e selo `1` |
| 1.4 | Esperar 10 min sem abrir a aba | Muito impaciente |
| 1.5 | Abrir a aba `atlas` | Selo some; ele ri por um instante e volta (sereno ou lendo) |
| 1.6 | Com a aba `atlas` ativa e o Donel em foco, mandar uma mensagem curta e esperar o fim | Nenhum balão, nenhuma impaciência |

## B2 — Aviso na hora (US2, SC-001, SC-004, SC-006)

| # | Passo | Esperado |
|---|---|---|
| 2.1 | Em `beacon`, pedir uma pergunta com opções; minimizar o Donel | Surpreso + `beacon · tem uma pergunta` |
| 2.2 | Em modo de permissão padrão, pedir um comando que exige permissão | Surpreso + `beacon · quer permissão` |
| 2.3 | Em modo plano, pedir um plano | Surpreso + `beacon · plano para aprovar` |
| 2.4 | Em `beacon`, digitar `/exit` com o Donel em foco (o processo da sessão termina e a aba fica) | **Nenhum** balão: você está olhando a aba (Q9). O balão `Triste + beacon · encerrou` só nasce quando o Donel está minimizado ou em outra aba — é o que o smoke T035 confere |
| 2.5 | Durante 2.1–2.4 | Nenhum aviso do Windows; nenhum balão com texto da conversa |
| 2.6 | Esconder o Jobu (botão direito → Esconder) e repetir 2.1 | O aviso do Windows aparece como antes |

## B3 — Um clique até a sessão (US3, SC-002)

| # | Passo | Esperado |
|---|---|---|
| 3.1 | Uma sessão esperando, Donel minimizado; clicar no Jobu | O Donel volta com a aba dela ativa |
| 3.2 | Três esperando; clicar no Jobu | Lista com as três, a mais antiga no topo; clicar na segunda abre a aba dela |
| 3.3 | Nenhuma esperando; clicar no Jobu | O Donel volta sem trocar de aba |
| 3.4 | Clicar num balão de sessão | Abre a aba do aviso |
| 3.5 | Com a lista aberta, apertar Esc; abrir de novo e clicar fora | A lista fecha nas duas vezes |

## B4 — Troca de conta (US4, SC-003)

| # | Passo | Esperado |
|---|---|---|
| 4.1 | Trocar de conta pelo painel de Contas | Espelho + `Conta → <rótulo novo>` |
| 4.2 | Provocar uma troca automática (limiar baixo, Alfa fechado ao editar a config) | O mesmo aviso |

## B5 — Convivência (US5, SC-005)

| # | Passo | Esperado |
|---|---|---|
| 5.1 | Ligar o Jobu pela primeira vez | Canto inferior direito, sentado na borda da barra de tarefas |
| 5.2 | Arrastar para o meio da tela | A base esmaece em vez de mostrar o corte reto |
| 5.3 | Arrastar para o outro monitor; fechar e reabrir o Donel | Volta ao mesmo lugar |
| 5.4 | Clicar no vazio logo ao lado do desenho, com uma janela embaixo | O clique chega à janela de baixo |
| 5.5 | Maximizar o Donel no monitor sem barra de tarefas; depois voltar a janela ao primeiro | O Jobu continua lá nos dois (desde 07/11, t-56abde57, ele só some por Esconder) |
| 5.6 | Botão direito → Silenciar por 1 hora; provocar um fim de turno | Nenhum balão nem aviso do Windows; rosto e selo mudam; o menu oferece Retomar avisos |
| 5.7 | Botão direito → Voltar ao canto | Volta à posição padrão |
| 5.8 | Esconder e religar pelas Preferências | Some e volta na posição lembrada, já com o estado atual |
| 5.9 | Fechar o Donel | O Jobu sai junto |
| 5.10 | Botão direito → Tamanho → Grande; depois Ctrl + roda sobre ele | Cresce para cima sem sair do lugar; a roda ajusta aos poucos; ao reabrir o Donel, o tamanho continua |
| 5.11 | Com o Jobu na tela, tirar um print de tela inteira (Win + Shift + S) e compartilhar a tela numa chamada | O Jobu não aparece em nenhum dos dois; no lugar dele está o que fica atrás |
| 5.12 | Botão direito → Liberar print por 1 minuto; tirar um print; esperar 1 minuto e tirar outro | O primeiro print mostra o Jobu; o segundo não; durante o minuto, o menu oferece "Bloquear print agora" |

## B6 — Vida (US6)

| # | Passo | Esperado |
|---|---|---|
| 6.1 | Observar um minuto em repouso | Balanço leve; dormindo, quase parado |
| 6.2 | Provocar um aviso | Um pulinho ao surgir o balão |
| 6.3 | Deixar 20 min sereno | O waffle aparece por alguns segundos, uma vez |

## Diário (SC-007)

Uma semana de uso diário no alfa. Registrar aqui qualquer vez que o Jobu foi
escondido ou desligado, e o motivo.
