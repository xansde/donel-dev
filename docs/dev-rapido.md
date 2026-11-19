# Cadeira Dev rápido: o inventário (t-7c942870, 19/11/2026)

Pedido do dono (19/11, áudio): "na era da IA muitas das burocracias que existiam antes não existem mais. Precisa de
staging mesmo? Se a gente tem PostHog que consegue usar Feature Flag, precisa de um ambiente todo de staging? [...] não
precisa 50 minutos de teste. 2 minutos de teste pra todo seu código já é mais do que o suficiente. [...] a gente tem as
regras do coletor. Não dá pra fugir disso. Isso é o nosso limitante. Mas só isso é o nosso limitante."

Como foi feito: um Workflow de leitura com 5 varredores (CLAUDE.md, skills, papéis, hooks e CI, coletor), um cético
por varredor que abriu cada arquivo na linha para derrubar o achado, e um crítico de completude que leu o que faltou
(memórias, `_docs`, outros repos, rotinas do cron, proteção de branch no GitHub). Resultado bruto:
`~/seazone/_scratch/dev-rapido/inventario.json` (VPS pessoal).

## O que os números dizem

- `npm run verify` inteiro, VPS parada: ~1 min (19/11: design-system 6,7 s, tsc 8,8 s, vitest 32,6 s com 159
  arquivos e 1.972 testes, build 9,1 s). Mediana dos 305 logs desde 12/11: vitest 30 s, vitest + build 51 s.
- A espera vinha de antes do teste: em 7 dos 25 verifies mais recentes, de 1,5 a 19 min só esperando o
  `verify.lock` ou a vaga do limitador. Os "50 minutos" eram fila e espera de revisão, não suíte.
- O coletor de uso de IA não vê ambiente, deploy nem PostHog: produção atrás de flag sem homologação não muda o que
  conta. O que conta é a linha escrita chegar ao clone principal (ou à branch padrão) no prazo.

## Mudou (neste PR e nas skills da VPS pessoal)

| Onde | Antes | Agora |
| --- | --- | --- |
| `src/shared/roles.ts` | só Dev (pede revisão ao Revisor) | papel de fábrica `dev-rapido`: flag no lugar de staging, verify de 2 min, cético, merge próprio, produção com a flag desligada e ligada em seguida, coletor e migração mantidos |
| `src/shared/roles.ts`, Líder e Líder único | "o Dev pede revisão ao Revisor" | e "a Dev rápido não passa pelo Revisor; não a mande esperar revisão nem aceite" |
| `package.json`, `scripts/verify-rapido.mjs` | só `npm run verify` (tudo, sob `verify.lock`) | `npm run verify:rapido`: tipos, testes ligados ao diff (suíte inteira se mudou config de teste), build só se mudou o que é empacotado; sem fila; imprime o tempo de cada passo |
| `CLAUDE.md` | política de review dizia "o próprio dono, após validação manual"; "~17 arquivos vitest" | revisor = subagente cético antes do merge, dono valida no alfa depois; seção da cadeira; ~160 arquivos |
| skill `dev-rapido` (nova) | — | o passo a passo com horários T0…T8, onde mora a flag de cada app e o que fica |
| skill `merge-direto` (passo 4) | verify completo pela fila | na cadeira, `verify:rapido` direto; PR nasce pronto |
| skill `verify-pela-fila` | toda verificação pela fila | a fila vale para o verify completo; a cadeira usa o rápido |
| skill `limitador-vps` | todo verify por `flock` + `limitador.py pesado` | exceção nomeada para o `verify:rapido`; o hook segue barrando sem vaga |
| skill `resolver-conflito-notes` | "o Revisor devolve", "espere o PR de baixo", "avise o Revisor" | quem resolve é o Dev antes do merge; PR de baixo seu, mescle-o; o resto vai para o cético |
| skill `abrir-sessao-com-pedido-completo` | "verify pela fila" | e "na Dev rápido, `verify:rapido`" |
| memória `build-pesado-um-por-vez-vps` | todo verify pela fila | exceção do `verify:rapido` |

A cópia de antes de cada skill está em `~/seazone/_scratch/dev-rapido/skills-antes/`.

## Fica (não é burocracia)

- **Coletor**: worktree em `<repo>/.claude/worktrees/`, merge e ff do clone principal no mesmo dia (o `mesclar.sh` já
  faz), nunca apagar a branch remota antes do ff, sessão nunca na raiz nem em `~/.seazone-uso-ia`.
- **Migração e dado**: `~/.claude/CLAUDE.md` ("MCP que grava em prod... vira `.sql` em branch"), régua de backup,
  volta e conferência do teamzone, `deploy.yml` da api-spotsys que aplica migration em todo push (PR com migration
  não usa o atalho), `feature_flags` do spotometro (criar flag é inserir linha: backup e volta).
- **Do dono**: `main` do donel-dev e o repo público `xansde/donel` (nada no GitHub barra, só a regra escrita e o
  `mesclar.sh`), credencial nova, pagamento, apagar dado dele, `--no-verify`, `--admin`.
- **Limite físico e segredo**: o hook do limitador (só barra sem vaga) e a trava de segredos.
- **CI obrigatório dos repos da empresa**: spotsys e api-spotsys têm `ci-do-zero` (~11 min) e `Alfred` obrigatórios,
  e auto-merge desligado; a cadeira acompanha com `gh pr checks --watch` e mescla na hora, mas não corta esse tempo.

## Depende do dono (proposta, não aplicada)

1. **Produção de app da empresa atrás de flag.** O `~/.claude/CLAUDE.md` diz "main e prod só com pedido literal".
   Já há duas exceções por repo, na mesma forma (frase do dono gravada em memória): teamzone (16/11) e release do
   spotometro (16/11, só para pedido dele). Linha proposta para o global, se o dono quiser:
   "Na cadeira Dev rápido, promover para produção com a flag desligada, sem migration, em app com flag funcionando
   (spotsys, api-spotsys) está autorizado pelo pedido de 19/11; main e repo público do Donel Dev seguem só com pedido
   literal." Até lá, nesses repos a cadeira para no PR `staging → main` pronto.
2. **Baseline Seazone** (`seazone-baseline.md`, instalado pelo plugin `dev`): "a suíte passa antes de abrir o PR",
   test-first em tudo e "brainstorm → spec → plano" em etapas. O global já vence o baseline; a cadeira escreve o seu
   jeito (teste do que importa, plano no corpo do PR). Mudar o baseline é do plugin da empresa.
3. **Seazone Studio** (repo do Tauan: "merge de PR é gate humano") fica fora até o dono do repo mudar a regra.

## Observado e fora desta tarefa

- `.esteira/review-policy.json` ainda diz "o próprio dono, após validação manual"; nenhum código o lê.
- Skills que ainda mandam esperar o Revisor de cadeira, sem relação com a cadeira: `absorver-openrig` (linhas 91, 94,
  112), `rotina-cron-por-wrapper` (36), `sessao-remota-nasce-em-bypass` (31), `recado-sem-seta` (50).
- `revisar-pr-donel` roda `npm run verify` sem fila nem limitador.
- O reconciliador (cron de 5 em 5 min) pede um Revisor para entrega de risco baixo parada há 30 min, e o despertador
  aceita "esperando Revisor" como motivo de parada. A entrega da cadeira com o veredito do cético resolve isso no
  próprio Oráculo (a primeira entrega real da cadeira).
- A partir de 20/11 17h o coletor credita também a branch empurrada do clone, sem merge; o texto do global e da skill
  `trabalho-que-conta` ainda dizem "só conta mesclado".
