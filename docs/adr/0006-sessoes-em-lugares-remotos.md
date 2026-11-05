# ADR 0006 — Sessões em lugares remotos

**Data:** 2026-11-04 · **Status:** aceito (pedido do dono: "controlar tudo por aqui, sem lotar a minha RAM")

## Contexto

O dono ganhou uma VPS Linux (8 GB, Tailscale) e quer lançar e acompanhar sessões nela pelo Donel Dev, como
primeiro passo do runtime de sessões fora do processo do app (treinamento das lideranças, 03/11). O motor de
contas já controla a conta de um lugar remoto por ssh (ADR 0005).

## Decisão

- Uma aba `claude` pode nascer num **lugar remoto** (`accounts.remotes`): o Launcher ganha "Onde roda".
- O CLI roda lá dentro de **tmux** (`-L donel`, sessão `donel-<id da conversa>`), que sobrevive ao app. O PTY
  daqui é só o `ssh -t` que mostra essa sessão.
- **Preparo por stdin**: um script único (`bash -l -s`) cria `~/.donel/s/<id>/`, clona o projeto quando a pasta
  falta (mesmo `origin` e branch da cópia local) e grava `--settings`, `--mcp-config`, papel, scripts de
  lançamento e `meta.json`. Se a sessão tmux daquele id ainda vive, não grava nada e devolve o `meta.json`.
- **Volta para o app por túnel reverso** (`ssh -R 127.0.0.1:<porta remota>:127.0.0.1:<porta local>`): os hooks
  HTTP da ponte e o MCP do navegador funcionam como numa sessão local. Tokens e portas remotas ficam no
  `meta.json`, então uma reconexão depois de reiniciar o app reusa o que o CLI vivo já tem.
- **Transcript espelhado**: `ssh … tail -c +1 -F <jsonl>` escreve em `<userData>/remote-transcripts/<id>.jsonl`;
  chat, nome e contexto leem o espelho. `/clear`, `/resume` e fork re-apontam o espelho.
- **Pasta remota**: o mesmo caminho abaixo da raiz de projetos, sob uma pasta com o nome da raiz
  (`…\seazone\Donel Dev` → `~/seazone/Donel Dev`).
- **Ciclo de vida**: fechar a aba (gesto do dono) encerra a sessão tmux; fechar o app, cair a rede ou atualizar
  não. No boot o app procura sessões vivas em cada lugar e reabre as abas.

## Consequências

- O que não foi enviado ao GitHub não existe na VPS. O app não sincroniza arquivos.
- `--worktree` é ignorado no remoto (V1): o espelho segue o transcript da pasta do projeto.
- Provedor de terceiro (classe A) não roda no remoto (V1).
- Depois de reiniciar o app, a sessão reconectada volta com hooks e MCP porque reusa tokens; se a porta remota
  estiver ocupada, a sessão segue sem semáforo até reabrir.
- Próximos passos fora desta decisão: OpenRig como orquestrador na VPS (por adaptador, depois de 05/11),
  sessões duráveis também locais, acesso pelo celular.
