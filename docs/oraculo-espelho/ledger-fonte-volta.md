# Ledger no Supabase: virada e volta (t-89279f84)

Desde 18/11, a fonte do ledger do Oráculo da VPS é o Supabase pessoal (oraculo-harrow). As tabelas são
`public.ledger_tarefas`, com uma linha por tarefa e a tarefa inteira em `doc`, e `public.ledger_meta`, com o
cabeçalho do ledger. O daemon lê as duas no boot e grava nelas a cada op, antes de responder. O `ledger.json` deixa de
ser lido e de ser escrito.

A `public.tarefas` segue como a visão de leitura, com o texto mascarado. Quem a escreve, junto com as cartas e as
provas do celular, é o espelho que agora roda dentro do daemon. O `donel-espelho.service` sai.

O daemon só usa o Supabase quando existe o `~/.donel/oraculo/ledger-supabase.json`:
`{"url": "https://hotkktdvbjpibkigpopq.supabase.co", "serviceKeyFile": "/home/<user>/.config/donel-espelho/service-key"}`.

## Virada (uma vez)

1. Backup: copie `~/.donel/oraculo/ledger.json` para `~/.donel/oraculo/antigos/ledger-<AAAAMMDD-HHMM>.json` e guarde o
   `oraculo.mjs` em uso como `bin/oraculo.mjs.antes-<AAAAMMDD-HHMM>`.
2. Tabelas: rode `docs/oraculo-espelho/ledger-fonte.sql` no Supabase. Ele é idempotente.
3. Build: a partir da staging, rode `npm run build:oraculo` e instale o `out/oraculo/oraculo.mjs` em
   `~/.donel/oraculo/bin/`.
4. Pare o daemon com `systemctl --user stop donel-oraculo`.
5. Escreva o `ledger-supabase.json` e rode `node ~/.donel/oraculo/bin/oraculo.mjs --semear-supabase`. Ele copia o
   ledger.json, relê o que gravou e confere: precisa sair com `diferentes: 0` e com as duas contagens iguais.
6. Renomeie `ledger.json` para `ledger.json.aposentado-<AAAAMMDD-HHMM>` e deixe-o em só leitura (`chmod 400`).
7. Rode `systemctl --user disable --now donel-espelho`.
8. Rode `systemctl --user start donel-oraculo`. O log precisa dizer `fonte: Supabase` e a mesma contagem.

## Volta

1. `systemctl --user stop donel-oraculo`
2. Exporte o que o Supabase tem, para não perder as ops feitas depois da virada:
   `node ~/.donel/oraculo/bin/oraculo.mjs --exportar-supabase ~/.donel/oraculo/ledger.json`. Ele só cria arquivo
   novo, então não deve existir um `ledger.json` no lugar. Se o Supabase estiver fora, use o backup do passo 1 da
   virada.
3. Apague ou renomeie o `ledger-supabase.json`. Sem ele, o daemon volta a ler o ledger.json.
4. Se a volta for por defeito do código novo, reponha o `bin/oraculo.mjs.antes-<...>`.
5. Rode `systemctl --user enable --now donel-espelho` (a ponte antiga lê o ledger.json) e depois
   `systemctl --user start donel-oraculo`.

## Cuidados

- O `--semear-supabase --forcar` grava o ledger.json por cima e APAGA do Supabase toda tarefa que não está no arquivo.
  Só use na virada, com o daemon parado e o ledger.json do momento. Depois da virada, nunca use: a fonte é o Supabase,
  e um arquivo velho apagaria as tarefas criadas depois.
- Ninguém grava direto em `ledger_tarefas`/`ledger_meta`: o daemon guarda o ledger em memória e se desencontraria.
  Para gravar, use o Oráculo (MCP, `/v1/servico/apply` ou livro). Para ler sem MCP, use
  `~/bin/rotinas/ledger_fonte.py` (`carregar()`), que já atende estado_derivado, painel-rig, ledger_resumo e
  espelho_contagem.
- Uma op que precisa de mais de um lote (mais de 200 tarefas mudando de uma vez, o que só o semear faz) pode deixar
  lotes gravados se o Supabase cair no meio. A op é recusada, e a escrita seguinte manda a diferença de novo.
- A porta 47990, o 2º Oráculo, era um daemon de teste solto: foi encerrado em 18/11 e não há unidade que o suba.
- A réplica do PC (`<userData>/ledger.json` do app do PC em modo remoto) fica só como cache do app. A VPS não a lê
  mais e recusa a cópia dela, nos caminhos `/v1/ledger` e `/v1/devolver`.
