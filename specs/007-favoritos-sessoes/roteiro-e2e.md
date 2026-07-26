# Roteiro E2E manual — 007 favoritos com sessões recentes (para o Alexandre)

**O que a feature faz:** um grupo novo "Favoritos" no TOPO da sidebar (antes de
"Projetos"), só com os projetos que você favoritou. Cada um é uma linha
colapsável mostrando as **5 sessões mais recentes** + **todas as fixadas** dele.
Clicar numa sessão foca a aba se já estiver aberta, ou retoma se não estiver.
Fixar uma sessão persiste — sobrevive a fechar e reabrir o app. **Não** reabre
nada sozinho no boot; é acesso rápido, não restauração de sessões vivas.

**O que a automação já provou** (não precisa reconferir): o modelo puro do
registro (poda na escrita, 5 recentes + fixadas, `tests/sessionRegistry.test.ts`
— 26 testes), a semeadura única de disco (`tests/session-seed.test.ts` — 14
testes), a chave nova no ConfigStore com round-trip em disco
(`tests/config-store.test.ts`), o dedupe/cabeçalho/clique/pin/poda/restart via
smoke isolado (`tests/smoke/favorite-sessions.spec.ts` — 3 testes), e a
medição do CA-7 (`tests/smoke/ca7-measurement.spec.ts` — ver
`medicao-ca7.md`: o alvo de < 100 ms **não foi atingido**, faixa real
~103–149 ms — é uma decisão pendente sua, não um bug a "consertar" aqui).

**O que só o uso real responde** — é este roteiro.

## Passos

1. **Favoritar um projeto que você usa de verdade.** Clique na estrela dele na
   sidebar.
   - ✅ esperado: aparece um grupo "Favoritos" no topo, com esse projeto,
     colapsável (seta ao lado do nome).
   - Se o projeto nunca teve sessão sua NESTE app antes de hoje, o grupo pode
     aparecer vazio na primeira expansão — é a semeadura (CA-8), uma leitura
     única do disco. Nas próximas vezes ele já vem pronto do registro.

2. **Trabalhe nele por alguns dias.** Abra sessões, feche, reabra — o normal do
   seu dia a dia.
   - ✅ esperado: o grupo vai se atualizando sozinho com as sessões mais
     recentes, sem você precisar fazer nada. Ao final de cada dia, a lista
     reflete o que você trabalhou.

3. **Fixe uma sessão de uso contínuo** (aquela que você reabre todo dia). Clique
   no pin da linha dela.
   - ✅ esperado: ela some da posição "só entre as 5 recentes" e passa a
     aparecer **sempre**, mesmo que você abra 10 sessões novas depois.
   - Feche o app e abra de novo — ela continua lá, fixada.

4. **O dia seguinte começando pelo grupo (o motivo original do pedido).** Abra
   o app pela manhã, sem ter feito nada ainda.
   - ✅ esperado: o grupo "Favoritos" já aparece pronto (nomes certos,
     ordenado por atividade), **instantâneo** — sem uma sidebar em branco
     esperando nada carregar. É o "mantenha registro durante o trabalho... já
     tem salvo" que você pediu no discovery.
   - Se sentir que demorou (mesmo que pouco), isso é sinal real — ver o
     "O que reportar" abaixo, e o número já documentado em `medicao-ca7.md`.

5. **Clique numa sessão do grupo com a aba JÁ aberta.**
   - ✅ esperado: foca a aba existente — nunca abre uma segunda aba da mesma
     sessão.

6. **Clique numa sessão do grupo com a aba FECHADA.**
   - ✅ esperado: retoma a sessão (mesmo caminho do botão "Retomar" de hoje).

7. **Uma sessão com permissão pendente, dentro de um grupo FECHADO.**
   - ✅ esperado: mesmo com o grupo colapsado, o cabeçalho do projeto acende
     (indicador de estado) e mostra a contagem — você não perde o sinal de
     que algo espera sua resposta só porque o grupo está fechado.

8. **Desfavoritar um projeto que tinha sessão fixada.**
   - ✅ esperado: o grupo dele some da seção "Favoritos"; as sessões voltam a
     aparecer na lista geral / no painel "Sessões anteriores". A fixada não é
     esquecida — se você favoritar de novo, ela reaparece.

9. **Um `/rename` feito FORA do Donel** (direto no CLI, sem passar pela UI) numa
   sessão que está no grupo.
   - ✅ esperado (consequência aceita, C1): o nome no grupo pode ficar
     desatualizado até você abrir aquela sessão de novo. Não há botão de
     atualizar nem revalidação automática — foi decisão sua no clarify.

10. **Uma sessão fixada cujo `.jsonl` foi apagado** (ex.: você limpou
    `~/.claude/projects/...` manualmente).
    - ✅ esperado (consequência aceita, C3): ela desaparece do grupo sem
      aviso, na próxima vez que o app perceber (ao expandir o projeto de novo,
      ou ao tentar reabri-la). Se isso incomodar na prática, é ajuste de UI
      pendente — não é bug desta entrega.

## O que reportar se algo estranhar

- **Sidebar demora visivelmente para pintar o grupo no boot:** é exatamente o
  achado de `medicao-ca7.md` — a medição automatizada já mostrou ~103–149 ms
  (acima do alvo de < 100 ms da spec), então uma demora perceptível bate com o
  que foi medido. Não é uma surpresa nova; é a decisão pendente registrada lá
  (aceitar o número atual, ou abrir uma task de otimização do boot).
- **Sessão fixada sumiu sem explicação:** confira se o `.jsonl` dela ainda
  existe em `~/.claude/projects/...` — se não existir, é o C3 (consequência
  aceita), não bug.
- **Grupo com nome de sessão errado/velho:** confira se você deu `/rename`
  fora do Donel recentemente — é o C1 (cache que pode envelhecer).
