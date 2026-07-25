# Roteiro E2E — Batch B da 004 (renomear sessão pela UI)

**Para:** Alexandre · **Gerado em:** 2026-07-24 · **Instalador:**
`release/Donel Dev-Setup-0.1.0.exe` (recém-empacotado nesta sessão).
**O que este batch entrega:** US-A (refletir o `/rename`), US-B (renomear pela
UI) e US-D (convergência). O reflexo AO VIVO (US-C / CA-4 — `/rename` no meio
da sessão e a aba trocar sozinha) é o Batch C, **não está aqui**.

O que os testes automatizados já provaram (não precisa repetir): o gesto de
edição na aba, Esc restaurando, clique ainda ativando, `×` ainda fechando, o
`custom-title` aparecendo na lista de sessões anteriores, persistência através
de restart e o "vazio volta ao fallback" — tudo em
`tests/smoke/session-rename.spec.ts`, 4 casos verdes. Este roteiro cobre o que
**só você** valida: uma sessão `claude` de verdade, no seu ambiente, com os
seus dados.

## Antes de começar

1. Instale o pacote novo (`release/Donel Dev-Setup-0.1.0.exe`).
2. ⚠️ **Os dois canais ainda compartilham `userData`** (item B10 do backlog) —
   o `config.json` que este teste escreve é o mesmo do app que você usa para
   trabalhar. Os nomes que você der aqui vão ficar. Isso é esperado; é o mesmo
   `%APPDATA%\donel-dev\config.json` de sempre.

## Passo 1 — Renomear pela aba (CA-3)

1. Abra uma sessão `claude` num projeto qualquer.
2. **Duplo-clique** no nome da aba. Deve aparecer um input inline, no lugar, com
   o texto atual já selecionado — sem a barra de abas pular de layout.
3. Digite um nome (ex.: `investigação do watcher`) e aperte **Enter**.
4. ✅ A aba mostra o nome novo **e** a linha de "Sessões" na sidebar mostra o
   MESMO nome (é um valor resolvido, não duas cópias).
5. Passe o mouse na aba: o `title` deve trazer o nome **inteiro** (a aba trunca
   com `…` a partir de ~22 caracteres; o limite do dado é 60).

## Passo 2 — Renomear pela sidebar, e F2

1. **Duplo-clique** no nome da sessão na linha da sidebar. O mesmo input deve
   aparecer ali.
2. Renomeie por lá e confirme com **Enter** → a aba de topo acompanha.
3. Clique na aba (uma vez, para focar) e aperte **F2** → o input abre. Aperte
   **Esc** → nada muda.
4. ✅ Os dois lugares aceitam o mesmo gesto e sempre mostram o mesmo nome.

## Passo 3 — Vazio volta ao fallback (C5)

1. Abra a edição, **apague tudo** e aperte Enter.
2. ✅ O nome volta ao fallback: nome do projeto (sessão aberta pela sidebar) ou
   a 1ª mensagem truncada (sessão reaberta de "Sessões anteriores").

## Passo 4 — Sobrevive a fechar e reabrir o app (CA-6)

1. Renomeie uma sessão `claude`, feche o app **inteiro** e reabra.
2. Reabra aquela sessão por **Sessões anteriores** do mesmo projeto.
3. ✅ O nome que você deu está lá — na lista, na aba e na sidebar.
4. Aba de **terminal livre** (`＋ Nova sessão` → Terminal): também renomeia, mas
   o nome morre com a aba — isso é decisão sua no clarify (C4), não bug.

## Passo 5 — O caso de uso principal: achar sessão antiga pelo `/rename` (CA-1)

1. Escolha um projeto onde você já usou `/rename` em sessões passadas.
2. Abra **Sessões anteriores**.
3. ✅ As linhas mostram o nome do `/rename` em vez da 1ª mensagem. Se você
   renomeou a mesma sessão várias vezes, deve aparecer o **último** nome.
4. Vale conferir num transcript **longo** (sessão de semanas, arquivo grande):
   era exatamente o caso que a janela de leitura de 8 KB perdia. A janela subiu
   para 64 KB e há varredura completa como rede — ver
   `medicao-t403.md` para os números.

## Passo 6 — Precedência: `/rename` novo vence o nome da UI (CA-5 / C2)

> ⚠️ **Neste batch, o nome NÃO muda na hora.** Nada relê o transcript enquanto a
> sessão está viva — isso é o CA-4, entregue pelo Batch C (`fs.watch` com
> debounce). Aqui, o que se valida é a PRECEDÊNCIA depois de uma releitura, e a
> forma confiável de forçar releitura é **reiniciar o app**.

1. Numa sessão viva, renomeie pela UI (ex.: `nome da UI`).
2. No terminal daquela sessão, rode `/rename nome do CLI`.
3. **Reinicie o app** (fechar e reabrir a aba não basta — o índice de sessões é
   lido no boot).
4. ✅ Aparece `nome do CLI`: o `/rename` veio depois, então ele vence, e o nome
   antigo da UI é descartado (não fica um nome zumbi competindo).

**Validado por ele em 24/07:** ✅ com restart. O "não mudou durante a sessão" é o
comportamento esperado deste batch, não falha.

## O que reportar

Para cada passo: ✅ ou ❌ com o que viu. Interessa especialmente:

- algum lugar em que a aba e a sidebar mostraram nomes DIFERENTES (seria a
  falha mais grave — quebra o CA-5);
- lentidão perceptível ao abrir "Sessões anteriores" de um projeto pesado (é o
  ponto medido no `medicao-t403.md`: 18 ms no donel-dev, mas 684 ms no
  `spotometro`, que tem 72 MB de transcripts quase todos sem título);
- qualquer coisa em que o duplo-clique tenha ativado/fechado a aba por acidente.

## Estado da suíte quando este pacote foi gerado

- `npm run typecheck` ✅ · `npm test` ✅ **379 testes** · `npm run test:smoke:dev` ✅
- `npm run test:smoke`: **21 passaram, 4 falharam** — nenhuma delas nesta feature:
  - `previous-sessions.spec.ts` ×2 → dívida herdada da T013 (§B11 do backlog);
  - `model-injection.spec.ts` e `terminal.spec.ts:281` → **cota semanal do
    perfil esgotada** ("You've hit your weekly limit · resets 1am" impresso pelo
    próprio CLI no pane capturado). Os dois exigem um turno real do modelo, que
    não existe sob limite. Registrado no §B11; re-rodar quando a semana virar.
  - `tests/smoke/session-rename.spec.ts` (novo, desta entrega): **4/4 verdes**.
