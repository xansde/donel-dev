# Handoff — fase 1 (vertical pequeno)

Escrito em 2026-08-03, ao fim do passo zero. **A sessão que pegar a fase 1 lê
este arquivo primeiro**; ele diz o que já existe, o que falta, o que já foi
decidido e o que ainda precisa da decisão do Alexandre.

Ordem de leitura: [`spec.md`](./spec.md) (inteira — 16 decisões + as 6
pendências, agora marteladas) → [`passo-zero.md`](./passo-zero.md) (o desenho do
contrato, do store e do teste) → este arquivo.

---

## Onde parar de ler e começar

**Ponto de partida:** `staging` com o PR **#44** mergeado. Se ele ainda estiver
aberto, basear a branch em `origin/feat/010-passo-zero-contrato-store` e dizer
isso no PR da fase 1.

**Gate:** o passo zero foi revisado; o vertical pequeno exige OK explícito do
Alexandre para começar. Pedir o handoff **não** é o mesmo que mandar
implementar — confirmar antes da primeira linha.

---

## O que já existe (não reescrever)

| Arquivo | O que é |
|---|---|
| `src/shared/esteira/contract/v1/esteira-result.schema.json` | **o contrato.** Arquivo canônico, lido pelos dois lados |
| `src/shared/esteira/contract/v1/examples/*.json` | golden corpus, 6 documentos |
| `src/shared/esteira/contract/resultContract.ts` | tipos + `parseEsteiraResult` + `CONSUMED_PATHS` |
| `src/shared/esteira/store/storeFormat.ts` | cabeçalho, compatibilidade, envelope de evento, **tipos** do snapshot |
| `tests/esteiraContractCoverage.test.ts` | o teste de contrato (lado app), 3 amarras |
| `tests/esteiraResultContract.test.ts` · `tests/esteiraStoreFormat.test.ts` | comportamento |

Tudo puro, sem I/O, sem import no app. `npm run typecheck` limpo, `npm test`
1285 verdes.

**Regra ao mexer no contrato:** alterar o schema **obriga** atualizar
`CONSUMED_PATHS` e o corpus no mesmo commit — senão `npm test` quebra na hora.
É o mecanismo funcionando, não um obstáculo a contornar.

## O que NÃO existe (é o trabalho da fase 1)

1. **Writer do store** — criar `<userData>/esteira/events.jsonl` com o cabeçalho,
   append de evento, e a recusa de escrever quando `storeCompatibility() !==
   'read-write'`.
2. **Reducer** eventos → `StoreSnapshot`, com dedupe por `dedupe_key`, e
   persistência do `snapshot.json` (derivado, descartável).
3. **Derivação de macro etapa** — a tabela está em `passo-zero.md` §2. Inclui o
   sinal `completed-without-plan` e o **retrocesso** (item reaberto volta a
   `execution`).
4. **Ingestão** — descobrir o `result.json`, parsear com `parseEsteiraResult`,
   traduzir fato → evento, deduplicar por `run_id`, e gravar
   `IngestErrorSnapshot` quando o documento estiver fora do contrato.
5. **Disparo de fase** — alvo explícito, trava local (`lock.acquired` /
   `lock.released`), sessão amarrada a item+fase.
6. **Mapa como projeção** do snapshot.
7. **Fork `esteira-donel-3.0.0`** — só as fases que a fatia exercita (discovery
   e plano), com o emissor de `result.json` e o teste de contrato espelho.

## Decisões já fechadas — respeitar, não reabrir

As 16 decisões da spec, mais as 6 pendências marteladas em 03/08 (seção final da
spec). As que mais mordem nesta fase:

- **O app nunca afirma o que não leu.** Falha de ingestão é erro visível no card;
  jamais "não realizada" por ausência de dado. Foi esse pecado que matou o
  modelo anterior — e é o que a issue **#35** faz hoje (será revertida, P-5).
- **`issue` tem exatamente um repo-alvo; sem repo, não dispara.** Nada de
  fallback para o projeto em foco (evidência 2 da spec).
- **Macro etapa é derivada**, nunca digitada. Override existe, sempre marcado
  como tal e com o valor calculado ao lado.
- **A trava é fato no log** (dono, hora, sessão), não arquivo `.lock` nem
  etiqueta remota. A etiqueta no board é espelho opcional.
- **Sessão:** mudar de fase abre sessão nova **sempre**; dentro da mesma fase,
  quem decide abrir outra é o orçamento de contexto (~400k tokens), encadeando
  por `continuesSessionId` (P-6).
- **A 3.0 escreve só no formato novo.** Gravar nos dois "por compatibilidade" é
  exatamente o que produziu o desencontro que originou a spec (D-3).
- **Store nasce limpo** — sem importação de legado (D-2). O caminho de `seed`
  existe para plantar um discovery em andamento sem edição manual às cegas.

## Lacunas que precisam de decisão dele (perguntar **uma por vez**)

**1. Onde a skill grava o `result.json` — o "local combinado".**
O passo zero definiu o *formato*, não o *lugar*. Recomendação:
`~/.claude/esteira-donel/outbox/<run_id>.json`. Fora do repo (não polui checkout
nem vira commit acidental), fora do `userData` (a skill não sabe o nome nem o
canal do app), no home local — **nunca** no OneDrive. O app varre no boot e
observa por watcher; a idempotência já vem do `run_id`, então mover o arquivo
depois de ingerir é opcional.

**2. A contraparte de entrada.** O `result.json` é o que a skill **devolve**.
Como ela **recebe** qual discovery/fase está tocando? Hoje isso é o `ctx.md`.
Isso não foi desenhado no passo zero — é lacuna real, e a fatia não roda sem
ela. Recomendação: um `inbox/<run_id>.json` no mesmo diretório, com o mesmo rigor
de schema e teste de contrato dos dois lados. Se virar um segundo contrato, ele
nasce junto com o primeiro, não depois.

**3. Geração de ids.** Recomendação: o app gera `discovery_id` e `plan_id`; a
skill gera `work_item_id` dos itens que cria. Atenção ao padrão do contrato:
`^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$` — **não aceita underscore**.

**4. Convivência com o mapa atual.** P-5 diz que `discovery-tree.ts`, o
`esteira-reader` e o mapa saem **ao fim** do vertical. Recomendação: a tela nova
nasce ao lado, atrás de um gesto interno, e o antigo fica intocado até o fim da
fase — assim dá para comparar os dois com o mesmo dado.

## O que fecha a fase

- `npm run typecheck` e `npm test` verdes, com a saída mostrada.
- **O app rodando, com a espinha na tela.** Não declarar pronto com teste verde
  só: as duas tentativas anteriores de consertar o mapa passaram nos testes e
  falharam na tela dele.
- Um `result.json` produzido pela skill 3.0 de verdade é ingerido e aparece.
- Um `result.json` **fora do contrato** produz erro visível no card — este é o
  teste que prova que a inverdade acabou; vale tanto quanto o caminho feliz.
- O teste de contrato rodando **dos dois lados** (app e fork).

## Armadilhas conhecidas

- **Não criar worktree dentro do repo** (`.claude/worktrees`): o glob do
  Playwright pega as cópias e a suíte roda multiplicada.
- **Não rodar `npm run test:smoke`** sem ele pedir — abre janelas Electron na
  máquina dele.
- **Append-only não usa temp+rename.** O padrão atômico de `config-store.ts`
  (temp → fsync → rename) vale para o `snapshot.json`; para o `events.jsonl` é
  append + fsync, e o arquivo **nunca** é reescrito.
- **A cópia de trabalho é compartilhada.** Ele troca de branch e dá `pull` no
  mesmo checkout enquanto a sessão trabalha — aconteceu em 03/08, e um commit
  caiu em `staging` local por isso. Conferir `git branch --show-current` **antes
  de cada commit**.
- **node-pty** casa com a ABI do Electron; `npm test` sobe PTY real em alguns
  testes (é esperado, demora ~10s).
- Transcripts JSONL nunca são lidos inteiros — streaming + `stat`.
