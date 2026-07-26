# Prompt de handoff — sessão de implementação da 006 (contexto consumido)

Gerado em 2026-07-25, logo depois de a **004-nomear-sessoes fechar e ser
validada** por ele ("funcionou perfeitamente"). Escrito por quem implementou a
004 — o que está abaixo reflete o repo **como ele está agora**, não como o
`plan.md`/`tasks.md` da 006 (de 24/07) supõem.

Colar o bloco numa sessão nova aberta em `C:\Users\xansd\seazone\donel-dev`.

---

```
Sessão exclusiva de IMPLEMENTAÇÃO da feature 006-contexto-consumido do Donel Dev.
Repo: C:\Users\xansd\seazone\donel-dev · branch: feature/mvp-p0 (já estou nela).

O planejamento está FECHADO e aprovado. NÃO reabra decisões, NÃO reclarifique,
NÃO reescreva spec/plan. Implemente o que está no tasks.md.

## Leia nesta ordem antes de escrever qualquer linha

1. specs/006-contexto-consumido/prompt-implementacao.md — este handoff (a seção
   "O QUE MUDOU" abaixo é a parte que os outros documentos NÃO sabem).
2. specs/006-contexto-consumido/{spec,plan,tasks}.md — CA-1..CA-9, decisões
   S1/C1/C3/C4/C5 (respondidas pelo Alexandre: são REQUISITO, não sugestão),
   Fatias 0/1/2 e T601–T614.
3. src/main/transcript-watcher.ts + tests/transcriptWatcher.test.ts — a peça
   compartilhada que a 004 JÁ construiu. Você vai estender este arquivo.
4. CLAUDE.md do repo — remoto, canais main/staging, regras de push.
5. specs/backlog.md §B11 e §B13 — o estado real da suíte de smokes. Leia ANTES
   de interpretar qualquer vermelho.

## O QUE MUDOU no repo depois que a 006 foi planejada (crítico)

A 004 entrou primeiro, como a fila previa, então a Fase B daqui ENCOLHEU. Não
construa o que já existe:

- **T605 — JÁ FEITO.** A leitura de cauda foi extraída: `readFileTail(filePath,
  size, maxBytes)` é exportada de `src/main/session-indexer.ts` e o
  `readSessionTailInfo` já a usa. Não crie `transcript-tail.ts`.
- **T607 — PULAR.** O watcher existe: `src/main/transcript-watcher.ts`, com
  `fs.watch` no DIRETÓRIO (o `.jsonl` só nasce na 1ª mensagem) + filtro por
  nome, debounce 300 ms, leitura imediata na abertura, retry limitado quando o
  diretório também não existe, e `TranscriptWatcherRegistry` (um watcher por aba
  `claude` viva, chave `ptyId`, baixa no `PtyManager.onExit`). 15 testes verdes,
  `fs.watch` real em tmpdir.
- **T608 — MEIO FEITO.** O canal e o payload já existem com os DOIS campos:
  `TRANSCRIPT_CHANNELS.changed = 'transcript:changed'` e
  `TranscriptChangedPayload { sessionId, customTitle, contextTokens }` em
  `src/shared/sessions.ts`; `onTranscriptChanged(cb)` já está no preload; a regra
  de emissão já é "emitir quando QUALQUER campo mudar (comparação por valor)".
  **`contextTokens` hoje é sempre `null`** — preenchê-lo de verdade é o seu
  trabalho. O canal NÃO se chama `sessions:nameChanged` (o tasks.md da 004
  rascunhava assim; ficou com o nome do plano da 006, de propósito).
- **T610 — a assinatura JÁ EXISTE.** O `App.tsx` tem UMA assinatura de
  `onTranscriptChanged` (useEffect com deps vazias + `appConfigRef`), usada pelo
  `customTitle`. **REAPROVEITE-A**; não abra uma segunda (é risco explícito da
  tabela de riscos do tasks.md).

Três correções de fato que os documentos da 006 não têm:

1. **A cauda já é de 64 KB, não 8 KB.** A 004 subiu `TAIL_READ_BYTES` de 8192
   para `64 * 1024` por medição em 317 transcripts reais (a janela de 8 KB
   alcançava o `custom-title` de só 44% deles; 64 KB pega 99%) — está em
   `specs/004-nomear-sessoes/medicao-t403.md`. Logo a regra do T606
   ("se 8 KB não trouxerem `usage`, re-ler com 64 KB") está DESATUALIZADA:
   decida com medição se ainda faz sentido uma re-leitura maior (ex.: 256 KB) e
   registre o número, como a 004 fez. Jamais ler o arquivo inteiro no watcher.
2. **O watcher NÃO usa o fallback de varredura completa** do indexer, de
   propósito: numa sessão viva o registro que acabou de ser escrito está no fim
   do arquivo, e varrer 15 MB a cada rajada custaria caro para não achar nada
   novo. Mantenha isso para a `usage` também.
3. **Regra do "não apaga o que já sabe" (decidida na 004, espelhe para tokens).**
   No watcher, uma leitura que NÃO acha `custom-title` não sobrescreve o título
   já conhecido — ausência numa leitura é leitura falha (arquivo travado no meio
   de uma escrita do CLI, cauda ilegível), não um `/rename` que removeu o nome.
   Sem isso o nome da aba piscava para o fallback. **Decida explicitamente, com
   teste, se `contextTokens` segue a mesma regra** — minha leitura é que sim
   (uma cauda sem `usage` é lacuna de leitura, não "contexto voltou a zero"),
   mas é decisão sua e tem de estar coberta por teste, não implícita.

## Ordem de trabalho

Fase A (T601–T604, módulo puro `src/shared/contextWindow.ts`) → Fase B
(T606, T608, T609 — pulando T605 e T607) → Fase C (T610–T614).

A Fase A é onde o TDD paga: a tabela de janelas e a aritmética são o que não
pode estar errado, e são 100% puras. Comece por ela.

## Como trabalhar

- TDD nos módulos puros (o tasks.md marca quais): teste primeiro, vê falhar,
  implementa o mínimo, refatora. Teste comportamento, não implementação.
- Commit por task ou por batch, em português, Conventional Commits. Commitar em
  branch de feature é DEFAULT — não pergunte.
- Cada task tem DoD explícito. Não declare pronto sem rodar e VER a saída.
- `npm run typecheck` + `npm test` verdes antes de cada commit de batch.
- Smokes exigem `npm run build` ANTES (eles rodam `out/main/index.js`; sem build
  você testa o bundle antigo — isso já produziu vermelhos fantasmas).
- Number que aparece em report tem de ser medido, não estimado. Cuidado com o
  amostrador: numa medição de latência da 004, `expect().toHaveAttribute` do
  Playwright (polling progressivo até ~500 ms) reportou 852 ms para algo que,
  medido com polling de 25 ms, levava ~350 ms.

## Estado da suíte de smokes (não confunda com regressão sua)

Última execução completa (25/07): **22 verdes, 4 vermelhos**, todos com causa
nomeada em `specs/backlog.md` §B11:
- `previous-sessions.spec.ts` ×2 → dívida da T013 (restauração de sessões).
- `model-injection.spec.ts` e `terminal.spec.ts:281` → **cota semanal do perfil
  esgotada** (o CLI imprime "You've hit your weekly limit" no pane capturado).
  Os dois exigem turno real do modelo. O do semáforo sozinho queima **4,4 min
  dos 9,2** da suíte esperando resposta que não vem; ele NÃO roda isolado com
  `-g` (depende do projeto selecionado por testes anteriores do mesmo arquivo).

Qualquer vermelho FORA dessa lista é regressão sua — investigue, não normalize.

## Cota: o que dá e o que não dá para validar agora

Ver o `%` mexendo numa conversa real exige uma sessão que responde, e a cota
semanal do perfil estava esgotada em 24–25/07. Desenvolvimento e testes
automatizados rodam normalmente (fixture sintética de transcript — padrão da
rodada 5, e foi assim que os smokes da 004 ficaram em ~6 s no total). Se a cota
ainda estiver estourada, entregue tudo, deixe o roteiro E2E pronto (T614) e
diga explicitamente o que ficou sem validação humana.

## Fronteiras (inegociáveis)

- Push na `feature/mvp-p0`: AUTORIZADO (remoto github.com/xansde/donel-dev,
  privado). Empurre a cada batch fechado.
- PR `feature/mvp-p0` → `staging`: pede confirmação dele. Existe o PR #1 aberto;
  se ainda não foi mergeado, seus commits já entram nele — não abra outro.
- `main`: BLOQUEIO TOTAL. É o canal stable do app que ele usa para trabalhar.
  Nada de push/PR/merge sem instrução LITERAL. "Comita", "sobe", "atualiza
  staging" NÃO autorizam tocar em `main`.
- Conta do `gh`: a ativa é `xansde-seazone` (write, não admin). 404 em comando
  de administração é isso — o repo é do `xansde`.
- Nunca `--no-verify`.
- O app não toca credenciais: `/login` é sempre ato humano no terminal.
- LGPD: nada de nome de proprietário/cliente/hóspede em código, log ou commit.
- Não implemente nada que não esteja num tasks.md aprovado. Se aparecer algo
  fora do escopo, ANOTE em `specs/backlog.md` e siga — não faça direto.
- Instalar o app é ato dele (o instalador substitui o app que ele usa; há duas
  instalações na máquina — ver §B10/B14 do backlog). Você empacota, ele instala.

## Checkpoint

Ao fechar a Fase A, siga direto para a B e a C. Ao fechar a feature (ou ao
travar), PARE e dê um relatório curto: o que passou, o que ficou vermelho com a
saída REAL, quais números você mediu, e o que precisa de decisão dele. Ao final,
atualize `specs/006-contexto-consumido/tasks.md` e o vault
(`Projects/donel-dev/context.md` §Status + `todo.md`).

Comece confirmando em uma linha qual é a primeira task que vai atacar e o teste
que vai escrever primeiro.
```
