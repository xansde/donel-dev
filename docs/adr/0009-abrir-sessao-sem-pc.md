---
name: Abrir sessão sem o PC
type: adr
status: accepted
created: 2026-11-18
updated: 2026-11-18
tags: [adr, vps, oraculo, sessoes-remotas, t-1a3f7150]
aliases: [ADR-0009, abrir sessão sem o PC, abrir sem o app]
---

# ADR 0009 — Abrir sessão sem o PC

## Contexto

O dono quer sair do PC e operar pelo celular ("Dê início nas 4 etapas que faltam para sair do Pc e ir para o celular
100%"). Hoje uma sessão nova numa VPS só nasce pelo app do PC: o `spawnRemoteClaudeSession` monta os arquivos e o
argv e manda o script de preparo por ssh. Com o PC desligado, o `sessao_abrir` do Líder não tem quem o execute.
Desenho completo na tarefa t-1a3f7150 (`_scratch/abrir-sem-pc/desenho.md`, 18/11, decisões do Líder do quadro).

## Decisão

1. **Abrir sessão sem o app do PC é um caminho só.** Com o PC desligado, o portão do Oráculo na VPS abre a sessão no
   tmux da própria VPS, com o lugar `session:<sid>`, sem tocar o `mindscape.json`. Não há fila de lugares pendentes
   nem rota nova: o tmux vivo e o id determinístico bastam.
2. **O PC adota o lugar ao voltar.** Ele acha a sessão viva pela busca de sessões remotas que já faz e cria o cartão
   pelo `placeOne`/`freePlaceId` com o id `session:<sid>`. Importar duas vezes dá um cartão só.
3. **A montagem do lançamento é uma só, nos dois lados.** Os arquivos (`role.md`, `settings.json`, `mcp.json`,
   `meta.json`, `claude.sh`, `run.sh`) e o argv do `claude` saem de uma função pura, `planRemoteLaunch`
   (`src/main/remote-launch-plan.ts`), sem I/O e sem electron. O PC e o daemon da VPS a usam; quem chama gera os
   tokens e as portas.
4. **Papéis e permissão com o PC fora:** todos os papéis menos `lider`. Toda sessão de VPS nasce em
   `--permission-mode bypassPermissions` com `CLAUDE_CODE_EVEN_MORE_DANGEROUSLY_SKIP_PERMISSIONS=1`, como já nasce
   quando o PC a abre.
5. **Sem segredo no kit.** O que só o PC sabe (papéis, pastas dos quadros, limite de abertas) vai à VPS num kit sem
   token, chave nem credencial, gravado com permissão 600.

## Consequências

- Uma mudança no argv ou nos arquivos de uma sessão remota vale para o PC e para a VPS de uma vez; o teste
  `tests/plano-lancamento-remoto.test.ts` guarda esse argv.
- Com o PC fora não há `askOwner`: no limite de abertas o portão recusa e diz quantas estão abertas.
- Com o PC fora, o pedido do Líder único abre a sessão direto no quadro pedido, também num quadro com Líder vivo
  (t-83b81fd2, 20/11): o Líder do quadro nem sempre consegue abrir sem o PC, e o repasse deixava o pedido sem sessão.
  O Líder do quadro segue abrindo só no próprio quadro.
- Um `/clear` na sessão aberta sem o PC muda a conversa da pasta; o cartão criado na volta nasce com o `sid` da pasta.
  É o mesmo risco que existe com o PC ligado.
- Quem trabalhar na etapa 3 ou 4 (agentd, t-9accc989) parte daqui: não cria um segundo caminho de "abrir sem o app".
