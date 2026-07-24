# Spec — 002 Quota headroom (destravar + dropdown enriquecido)

**Status:** planejada (aguarda OK do Alexandre para implementar)
**Prioridade:** PRÓXIMA ENTREGA (fura a fila do 003-modo-dev, decisão do
Alexandre em 2026-07-24)
**Origem:** rodada 6 do E2E (`001-mvp/feedback-e2e.md`) + B8 do
`specs/backlog.md` + US-12 (P1). Escopo escolhido pelo Alexandre:
**dropdown enriquecido** (não painel dedicado — este fica pro US-12 depois).

## Problema

1. **BUG (P0 da entrega):** o `%` de cota mostra "—" em TODOS os perfis
   (badge do titlebar, dropdown "Perfis de conta", statusbar). Causa raiz
   MEDIDA (2026-07-24 00:30): `readQuotaAxiHeadroom` usa timeout de 3000 ms,
   mas `npx -y quota-axi --provider claude --json` leva **~3803 ms** nesta
   máquina (overhead de resolução do `npx`, mesmo com o pacote em cache). O
   processo é morto antes do JSON chegar → `null` → UI renderiza "—". Não é
   o exit 255 de ontem (rodou exit 0 com JSON válido).
2. **UX — a cota não se explica** (relato: "Não entendi o que essa cota
   significa"): hoje é um `%` solto, sem dizer QUAL janela (a implementação
   usa `five_hour` com fallback pra `seven_day`, decisão nunca exposta) nem
   que é % RESTANTE (`percentRemaining`), não usado.
3. **Falta visão das duas janelas por conta** (pedido do Alexandre: "todas
   as contas ativas e suas cotas de uso disponível — 5h e semanal"): o
   `quota-axi` JÁ devolve as duas janelas no mesmo JSON, mas o app colapsa
   num número só.

## User stories

- **US-A (bug):** como usuário, ao abrir o dropdown de perfis eu vejo o
  número da cota de cada conta — não "—" — mesmo que a leitura demore alguns
  segundos, com um estado de "carregando" enquanto não chega (nunca "—"
  otimista antes da 1ª resposta).
- **US-B (janelas rotuladas + seleção fácil):** como usuário, vejo por conta
  a janela **5h** (barra) e a **semana** (texto) com % RESTANTE ("livre") e
  reset, e consigo **selecionar uma conta com um clique fácil na linha**; a
  janela do **Fable** eu revelo sob demanda expandindo a linha (uso não-diário
  — escolho com calma), sem que isso atrapalhe a seleção.
- **US-C (refresh manual):** como usuário, tenho um botão "Atualizar" no
  dropdown que relê as cotas ignorando o cache de 60 s, para conferir o
  número agora sem esperar o cache expirar.

## Critérios de aceite

- **CA-1:** com as contas logadas, abrir o dropdown mostra número (não "—")
  para elas dentro de ~10 s; enquanto a 1ª leitura não volta, aparece
  "carregando", não "—". "—" só depois de falha/timeout REAL ou conta sem
  login (stale).
- **CA-2:** cada conta mostra, no estado **colapsado** (default), o layout
  **primária + resumo compacto** (decisão do Alexandre, 2026-07-24): a **5h**
  é a primária, com barra colorida por tier (verde/dourado/vermelho, reusando
  `getHeadroomTier`), % restante e reset; a **semana** aparece como resumo
  compacto em texto embaixo (% restante + reset), SEM barra própria. O rótulo
  deixa explícito que é % LIVRE/restante.
- **CA-2b (Fable sob expansão + seleção fácil, decisão 2026-07-24):** o
  **clique na linha do perfil ATIVA a conta** — este é o gesto primário e tem
  de ser fácil (não pode ser sequestrado por outra ação). A janela do **Fable**
  (`model:fable` do payload) fica escondida por padrão e é revelada por um
  **gesto de expansão dedicado** (ex.: chevron na linha), que NÃO ativa a
  conta. Expandido, a linha mostra também "fable X% livre". Justificativa:
  Fable é uso não-diário — o usuário escolhe com calma, sem poluir a lista
  nem competir com o clique de seleção. Outras janelas `model:*` continuam
  fora (vão pro painel US-12).
- **CA-3:** o botão "Atualizar" força releitura de todas as contas
  ignorando o cache; some/desabilita enquanto relê.
- **CA-4:** o badge compacto do titlebar e a statusbar continuam
  funcionando, mostrando a janela de 5h rotulada (ex.: "5h 95%"), não um %
  ambíguo. Nada quebra com 0 sessões/perfil sem leitura.
- **CA-5:** a regra de segurança do cache global do quota-axi é mantida —
  leitura marcada `state.stale`/`state.error` NUNCA vira número (poderia ser
  de outra conta); vira "—" (ou "login pendente" quando for o caso).
  **Cache (decisão 2026-07-24):** o status `unavailable` NÃO é cacheado — é
  SEMPRE relido. Assim, um perfil sem login que acaba de fazer `/login`
  reflete na próxima leitura, sem esperar o TTL de 60s expirar (o cache de
  60s vale só para leituras `ok`, que são caras de reabrir).
- **CA-6:** o app continua sem ler credenciais — fonte de dado é só o
  `quota-axi` local, nada de token/endpoint OAuth.
- **CA-7 (dropdown compacto, decisão do Alexandre 2026-07-24):** a lista de
  perfis não repete "Perfil OK" em cada linha — perfil saudável renderiza
  SEM texto de status (linha limpa). Só o perfil COM problema mostra um
  indicador compacto (ícone de alerta) cujo **hover/tooltip descreve o
  problema** (ex.: "Junctions com problema"); a ação "Recriar links"
  permanece VISÍVEL na linha (não dentro do tooltip — ação não vive em
  tooltip, que some ao mover o mouse). Objetivo: enxugar a lista para caber
  as duas janelas de cota por perfil sem estufar a altura.

## Fora de escopo (fica pro US-12 / B8)

- Tela/painel dedicado de cotas com histórico e ordenação.
- Auto-seleção de perfil por headroom (isso é o 002-auto-switch → renumerar).
- Complementar o quota-axi com o endpoint OAuth oficial.

## Notas de realidade (não são bug)

- "Todas as contas" = todos os PERFIS configurados e logados localmente
  (cada conta = um perfil com `CLAUDE_CONFIG_DIR` + `/login` feito). Perfil
  sem login → quota-axi devolve stale → "—" legítimo.
- A janela semanal da conta ativa estava 100% usada (0% livre) até 25/07
  04:00 UTC na medição — o número baixo é real, não bug de exibição.
