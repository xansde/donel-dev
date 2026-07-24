# Prompt de handoff — sessão de implementação da fila 004 → 006 → 005

Gerado em 2026-07-24 (fim do dia). Cole o bloco abaixo numa sessão **limpa**,
aberta em `C:\Users\xansd\seazone\donel-dev`.

---

```
Sessão exclusiva de IMPLEMENTAÇÃO do Donel Dev (Electron + React + TS).
Repo: C:\Users\xansd\seazone\donel-dev · branch: feature/mvp-p0 (já estou nela).

O planejamento está FECHADO e aprovado. NÃO reabra decisões, NÃO reclarifique,
NÃO reescreva spec/plan. Implemente o que está nos tasks.md.

## Ordem da fila (canônica — não reordene por conta própria)

1. 004-nomear-sessoes      13 tasks (T401–T413)  ← COMECE AQUI
2. 006-contexto-consumido  14 tasks (T601–T614)
3. 005-terminal-copy-paste 10 tasks (T501–T510)

Regra dura: 004 e 006 NUNCA em paralelo — as duas leem o mesmo `.jsonl` e o
watcher tem de ser UM só (`transcript-watcher.ts`). A 004 constrói; a 006
herda e sua Fase B encolhe para T608+T609 (pular T607). A 005 é independente.

## Leia nesta ordem antes de escrever qualquer linha

1. `specs/004-nomear-sessoes/prompt-implementacao.md` — handoff específico da
   004, escrito quando ela foi planejada (é o detalhe mais fino que existe).
2. `specs/004-nomear-sessoes/{spec,plan,tasks}.md` — CA-1..CA-6, decisões
   C1..C5 (respondidas pelo Alexandre: são REQUISITO, não sugestão), Fatias 0–5.
3. `CLAUDE.md` do repo — remoto, canais main/staging, regras de push.
4. `specs/backlog.md` §B11 — o estado real da suíte de smokes (leia antes de
   interpretar qualquer vermelho).

Só depois de fechar a 004 leia os artefatos da 006, e depois os da 005.

## Como trabalhar

- TDD nos módulos puros (o tasks.md marca quais): teste primeiro, vê falhar,
  implementa o mínimo, refatora. Teste comportamento, não implementação.
- Commit por task ou por batch, em português, Conventional Commits. Commitar em
  branch de feature é DEFAULT — não pergunte.
- Cada task tem DoD explícito. Não declare pronto sem rodar e VER a saída.
- `npm run typecheck` + `npm test` verdes antes de cada commit de batch.
- Smokes exigem `npm run build` ANTES (eles rodam `out/main/index.js`; sem
  build você testa o bundle antigo — isso já produziu 4 vermelhos fantasmas).

## Estado da suíte de smokes (não confunda com regressão sua)

Vermelhos conhecidos, todos com causa nomeada em `specs/backlog.md` §B11:
- `previous-sessions.spec.ts` ×2 → dívida da T013 (restauração de sessões).
- `profiles.spec.ts` T014 (corpo) → depende de subir sessão claude real; falha
  com painel vazio sob contenção. Decisão de desenho pendente, não é bug.
- `tabs-lifecycle.spec.ts:174` → flake de contenção (passa isolado).

Qualquer vermelho FORA dessa lista é regressão sua — investigue, não normalize.

## Fronteiras (inegociáveis)

- **Push na `feature/mvp-p0`: AUTORIZADO** (remoto `github.com/xansde/donel-dev`,
  privado). Empurre a cada batch fechado — o Alexandre quer o histórico no
  GitHub. Já existe upstream configurado.
- **PR `feature/mvp-p0` → `staging`: pede confirmação** dele antes de abrir.
  Existe o PR #1 aberto; se ainda não foi mergeado, adicione seus commits nele
  em vez de abrir outro.
- **`main`: BLOQUEIO TOTAL.** É o canal stable do app que ele usa para
  trabalhar. Nada de push/PR/merge sem instrução LITERAL. "Comita", "sobe",
  "atualiza staging" NÃO autorizam tocar em `main`.
- **Conta do `gh`:** a ativa é `xansde-seazone` (tem write, não admin). Se um
  comando de administração der 404, é isso — o repo é do `xansde`.
- Nunca `--no-verify`.
- O app não toca credenciais: `/login` é sempre ato humano no terminal.
- LGPD: nada de nome de proprietário/cliente/hóspede em código, log ou commit.
- Não implemente nada que não esteja num tasks.md aprovado. Se aparecer algo
  fora do escopo, ANOTE em `specs/backlog.md` e siga — não faça direto.

## Checkpoint

Ao fechar a 004 (ou ao travar), PARE e me dê um relatório curto: o que passou,
o que ficou vermelho com a saída real, e o que precisa de decisão minha. Não
siga para a 006 sem esse checkpoint.

Comece confirmando em uma linha qual é a primeira task que você vai atacar e o
teste que vai escrever primeiro.
```

---

## Notas para o Alexandre (não fazem parte do prompt)

- **Antes de colar:** confirme que está na `feature/mvp-p0` e que a árvore está
  limpa (`git status`). O repo agora tem remoto
  (`github.com/xansde/donel-dev`) — o prompt já barra push sem sua ordem.
- **Por que 004 primeiro:** ela constrói o `transcript-watcher` que a 006
  consome. Invertendo, a 006 constrói e a 004 vira consumidora — funciona, mas
  o `plan.md` da 006 foi escrito assumindo esta ordem.
- **A Fase A da 006** (T601–T604, núcleo puro: tabela de janelas + smart zone
  de 300k + aritmética) não depende de nada e pode ser mergeada a qualquer
  momento, inclusive antes da 004, se quiser um ganho rápido.
- **O que NÃO está nesta fila:** a Causa 2 do B11 (decisão de desenho do T014),
  o NFR de RAM, e o PR/review humano da `feature/mvp-p0`.
