---
name: Credencial pelo celular
type: adr
status: accepted
created: 2026-11-19
updated: 2026-11-19
tags: [adr, credenciais, celular, oraculo, cofre, t-c441e144]
aliases: [ADR-0010, caixa de credencial, credencial do celular]
---

# ADR 0010 — Credencial pelo celular, direto ao cofre

## Contexto

Em 19/11/2026 o dono pediu: "Precisamos de uma caixa de colocar credenciais aqui sem passar direto pro chat". Até
então a senha chegava pelo chat do celular e ficava no histórico da conversa, e o Líder único a guardava à mão no
Bitwarden. A regra do app é que ele nunca lê, grava ou exibe credenciais; as exceções nomeadas eram só
`src/main/accounts/` ([ADR 0005](0005-contas-em-lugares-remotos.md)) e `src/main/proxies/`
([ADR 0008](0008-proxy-da-vez.md)). A carta **t-6b5092f6** pôs a exceção ao dono, que escolheu "Autorizar com os
limites" (19/11). O contrato fechado é o v1.5 (`contrato-credencial.md`, tarefa t-c441e144).

## Decisão

1. **Terceira exceção de credencial, confinada a `src/oraculo/credencial/`.** É o único código do Oráculo que toca o
   valor. A rota `POST /api/v2/credencial` (`celular-v2.ts`) só confere a assinatura `Donel-HMAC` do aparelho e passa
   o corpo cru ao módulo; ele não passa pelo `parseBody` genérico nem por log. O socket do celular lê no máximo 16 KB
   dessa rota (413). Com o entregador à parte, a rota é dele (onde mora o chat), e o corpo não é repassado ao registro.
2. **Só criar, nunca editar.** O módulo roda `ssh <host> python3 -I -c <script>` na Homologações (`DONEL_CREDENCIAL_SSH`,
   padrão `homologacoes-2222`), com a sessão do `bw` de lá. O script mora no módulo e vai em argv, junto com nome,
   usuário, url e uma nota fixa; **a senha vai só pelo stdin** e chega ao `bw create` também pelo stdin. Um item com o
   nome exato já existente responde `409 ja-existe` com mensagem fixa e o cofre não é tocado. Do `bw` só volta um
   código: o script imprime só `{id, sha256_curto}` ou `{erro, motivo}`, e o daemon só aceita um id com forma de uuid
   e 10 hex.
3. **Cofre fora = 503, sem fila nem retentativa.** Timeout de 30 s, ssh caído ou sessão do `bw` vencida respondem
   `cofre-indisponivel`, e nada fica guardado para depois.
4. **Idempotência sem a senha.** Por 24 h, `id → {item_id, hash_curto, hash}` em `credencial-pedidos.json` (600), no
   diretório do Oráculo; o `hash` é sha256 da senha salgado com o id. Mesmo id e mesma senha devolvem a mesma resposta
   (`nova:false`); outra senha no mesmo id dá `409 conflito`.
5. **Aviso sem o valor.** A linha `🔐 Credencial «<nome>» guardada no cofre, item <item_id>.` entra uma vez na fila do
   chat: o Líder único a recebe pela entrega do chat e a conversa do app a mostra. O log tem uma linha por pedido (id
   curto, nome, item_id, hash_curto, resultado).
6. **Teste de vazamento obrigatório** (`tests/oraculo-credencial.test.ts`): uma senha marcadora única passa por
   sucesso, repetição, conflito, nome já existente, cofre fora, erro do `bw` com o valor, corpo inválido e corpo grande,
   e o grep dela dá zero no diretório do Oráculo, no log, nas respostas e no argv do filho. O script real roda contra
   um `bw` falso que ecoa o valor nos erros. **Não generalizar**: nenhum outro módulo ganha licença de tocar
   credencial por causa desta.

## Consequências

- A senha passa pela memória do daemon por um instante (string do corpo; o buffer enviado é zerado no melhor esforço
  do runtime). Um log novo que imprima o corpo a exporia: é o que o teste de vazamento guarda.
- Um timeout depois de o `bw` ter criado o item deixa o pedido sem resposta guardada; o reenvio ouve `ja-existe` (nunca
  um segundo item). O dono confere no cofre.
- Fica fora: ler, editar ou apagar item do cofre pelo app, e credencial com TOTP ou anexo.
- A prova na implantação é o mesmo grep, com uma senha de teste real, em `~/.donel`, `~/.claude/projects` e no
  journal das duas unidades (`donel-oraculo`, `donel-entregador`), apagando depois o item de teste do cofre.
