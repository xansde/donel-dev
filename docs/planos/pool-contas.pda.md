---
demanda: pool-contas
titulo: Organização do pool de contas e sincronização entre PCs
cliente: "Alexandre (uso próprio — dono do Donel Dev)"
responsavel: Alexandre
canal-slack: "—"  # Donel Dev roda sem Slack nem TaskDex (ferramenta pessoal)
taskdex: []
origem: "porta B — demanda direta do dono em 27/10/2026 (organizar dezenas de contas do mod local e usá-las nos dois PCs)"
criado: 2026-10-27
status: em-execucao
---

# PDA — Organização do pool de contas e sincronização entre PCs

## Destino

No canal alfa, o Alexandre organiza o pool do mod local em grupos com prioridade, vê e escolhe as contas pelo uso
disponível, e os dois PCs dele compartilham as mesmas contas pela rede local — sem refazer login e sem "Reconectar"
indevido.

## Notas

- **Decisões do dono já tomadas (27/10):** sincronizar (não mover nem copiar); direto pela rede, sem nuvem no meio; nada
  depende de estrutura da Seazone; o plano trata pareamento único entre os PCs, PC que volta de desligado recebendo os
  pares novos antes de renovar sozinho, e se PCs em redes diferentes entram na V1; o dono também quer um roteiro de
  atualização do app nos dois PCs que não perca nenhuma sessão.
- **Base de código:** `staging` — o PR #115 (captura do par rotacionado da conta ativa fora do switch) está lá e é
  gancho da sincronização.
- **Fatos do código (27/10):**
  - Conta local = `{id, label, plan, fingerprint?}` (`src/shared/accounts.ts:106`). O sanitize reconstrói só esses campos
    e descarta o resto (`src/main/accounts/accounts-config.ts:48`); com `userData` compartilhado entre alfa/beta/stable, um
    canal antigo apagaria campo novo (grupo, prioridade) — mesmo problema que o `mindscape.json` resolveu com
    `schemaVersion`.
  - Ordem da lista = ordem de exibição; não há reordenar, grupo nem prioridade. O auto-switch sorteia 2 entre as contas
    com folga ≥ `minAdvantage` e fica com a de menor carga (`src/main/accounts/auto-switch.ts:20`); a ordem não entra.
  - Carga = `five_hour` e `seven_day` do endpoint de uso da Anthropic (`src/main/accounts/usage-client.ts`); não há
    ordenação por uso disponível (era o B8 do `specs/backlog.md:160`, nunca feito).
  - ADR 0001: refresh token de uso único — dois processos renovando a mesma conta a matam
    (`docs/adr/0001-motor-de-contas-e-mods.md:35`); mod local é switch-time-only (invariante 5, `:91`); o par não sai de
    `src/main/accounts/` (invariante 2). A sincronização mexe nas duas invariantes — vai precisar de ADR nova.
  - Faxina do cofre no boot apaga entrada sem conta na config (`src/main/accounts/vault-reconciliation.ts:23`).
  - Rede hoje: só servidores HTTP em loopback (hook-bridge, semáforo de sessões); nada escuta fora de `127.0.0.1`.
- **Depois do plano:** `/arquitetura` → `/fatiamento` → `/implementacao`, terminando no alfa (`main` e repo público
  seguem no bloqueio total).

## Decisões até agora

<!-- Índice: uma linha por item concluído — gist + link pro artefato. Nunca restate o conteúdo. -->

- **01 — A mesma conta em dois PCs: o que o refresh e o CLI permitem** → o CLI trata o refresh token como de uso único e se recupera de troca do arquivo por fora (relê o disco antes de renovar); mesma cadeia nos dois PCs = quem renova primeiro mata a do outro; "uma cadeia por PC" é inferido, não provado — depende de experimento ([pesquisa](../pesquisas/mesma-conta-dois-pcs.md))

## Ainda não especificado

- Como a sincronização aparece na tela (estado do outro PC, último contato, conflito) — depende de 04 e do protótipo.
- Se o isolamento de `userData` por canal (B10 do `specs/backlog.md`) passa a ser necessário com a sincronização.

## Fora de escopo

- Cadastro automático de contas (login, coleta de magic link) — descartado pelo dono em 27/10.
- "Deixar de seguir" conta (e-mails dos grupos) — virou ação pontual fora do app, decisão do dono em 27/10.
- Qualquer dependência de estrutura da Seazone ou de nuvem para sincronizar.

---

## Itens

### 01 — A mesma conta em dois PCs: o que o refresh e o CLI permitem

- **Tipo**: pesquisa
- **Prioridade**: alta
- **Status**: concluido
- **Bloqueado por**: —
- **Pergunta**: com a mesma conta nos dois PCs, o que acontece de fato? (a) Renovar o refresh token invalida na hora o
  anterior, ou há tolerância? (b) O access token vale ao mesmo tempo nas duas máquinas? (c) O CLI renova sozinho o
  token da conta ativa (fora do app) — com que frequência e gatilho? (d) A Anthropic aceita dois logins independentes da
  mesma conta (cada PC com sua própria cadeia de tokens)? Fontes: `specs/011-contas-e-provedores/research-etapa-3-cli.md`,
  ADR 0001, binário do CLI. Proibido: provar com a credencial real de uma conta em uso.
- **Resolução**: o CLI trata o refresh token como de uso único e se recupera de troca do arquivo por fora (relê o disco antes de renovar); mesma cadeia nos dois PCs = quem renova primeiro mata a do outro; "uma cadeia por PC" é inferido, não provado — depende de experimento ([pesquisa](../pesquisas/mesma-conta-dois-pcs.md))

### 02 — Regras da organização do pool

- **Tipo**: refinamento
- **Prioridade**: alta
- **Status**: em-andamento
- **Bloqueado por**: —
- **Pergunta**: o que são grupo e prioridade (conta em um grupo ou em vários; grupo com ordem; "priorizar um grupo"
  muda o auto-switch como — só escolhe dentro do grupo, ou prefere o grupo e cai para os outros?); qual "uso
  disponível" ordena a lista (5h, semana, o pior dos dois, tempo até o reset); como a lista se comporta com dezenas de
  contas. Contexto: Notas (auto-switch e sanitize).
- **Resolução**: —

### 03 — Protótipo da tela do pool organizado

- **Tipo**: prototipo
- **Prioridade**: media
- **Status**: pendente
- **Bloqueado por**: 02
- **Pergunta**: como fica a tela de contas com grupos, prioridade, reordenação e ordenação por uso disponível, com
  dezenas de contas — mínimo 3 variantes para o dono escolher.
- **Resolução**: —

### 04 — Regras da sincronização entre os dois PCs

- **Tipo**: refinamento
- **Prioridade**: alta
- **Status**: pendente
- **Bloqueado por**: 01, 05, 09
- **Pergunta**: o que sincroniza (lista, rótulos, grupos, pares, conta ativa?); quem vale num conflito; a mesma conta
  pode estar ativa nos dois PCs ao mesmo tempo; como é o pareamento único (código); o que o PC que volta de desligado faz
  antes de renovar; remover conta num PC remove no outro; PCs em redes diferentes entram na V1. Gera a ADR que emenda as
  invariantes 2 e 5 da ADR 0001 e a exceção de credencial do `CLAUDE.md`.
- **Resolução**: —

### 05 — Transporte e pareamento na rede local

- **Tipo**: pesquisa
- **Prioridade**: media
- **Status**: pendente
- **Bloqueado por**: —
- **Pergunta**: como dois apps Electron no Windows se acham e conversam com segurança na rede local sem serviço de
  terceiros: descoberta (mDNS ou endereço digitado), autenticação do pareamento por código, cifra do canal, aviso do
  Firewall do Windows, dependência npm nova ou não. E o que muda se os PCs estiverem em redes diferentes.
- **Resolução**: —

### 06 — Atualizar o Donel Dev nos dois PCs sem perder sessão

- **Tipo**: refinamento
- **Prioridade**: alta
- **Status**: pendente
- **Bloqueado por**: 04
- **Pergunta**: o que "não perder sessão" cobre (abas com `claude` rodando, histórico para retomar, conta ativa, pares do
  cofre); em que ordem atualizar os dois PCs; o que acontece enquanto um está na versão nova e o outro na antiga
  (protocolo de sincronização versionado, config com `schemaVersion` maior ficando read-only no canal antigo); e qual o
  roteiro que o dono segue a cada atualização.
- **Resolução**: —

### 07 — Versões da entrega (V1..Vn)

- **Tipo**: refinamento
- **Prioridade**: alta
- **Status**: pendente
- **Bloqueado por**: 02, 04, 06
- **Pergunta**: rodar `/versionamento` — as duas frentes não cabem numa entrega. V1 = caminho feliz ponta a ponta com os
  requisitos críticos (provável: organização + sincronização na mesma rede); V2+ = hipóteses.
- **Resolução**: —

### 08 — Validar MVP e versionamento com o cliente

- **Tipo**: tarefa
- **Prioridade**: alta
- **Status**: pendente
- **Bloqueado por**: 07
- **Pergunta**: apresentar ao dono o MVP proposto e as versões (V1..Vn); registrar o OK — quem validou, quando, onde
  (sem Slack: esta conversa/sessão).
- **Resolução**: —

### 09 — Experimentos com conta descartável (E1–E3)

- **Tipo**: tarefa
- **Prioridade**: alta
- **Status**: pendente
- **Bloqueado por**: —
- **Pergunta**: o dono decide se roda e com qual conta (uma cujo login aceite perder) os experimentos da
  [pesquisa 01](../pesquisas/mesma-conta-dois-pcs.md#experimentos-propostos-o-dono-decide-se-roda): E1 (dois logins da
  mesma conta convivem?), E2 (tolerância do refresh token antigo e revogação da família), E3 (mesmo access token em dois
  PCs). Sem E1, o item 04 não tem base para escolher entre "mesma cadeia sincronizada" e "uma cadeia por PC".
- **Resolução**: —
