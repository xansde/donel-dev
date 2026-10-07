Type: task
Status: open

# Melhorar a UX do cadastro de provedores (ProviderForm)

Origem: teste manual do dono em 2026-08-04, durante a T1325 (ingestão da chave
real do OpenRouter), logo após a implementação da etapa 3
(`wi-registry-providers-classe-a`, commit `13c7e80`). Veredito dele: o fluxo
funciona, mas "ficou muito pouco intuitivo". O funcional está aprovado — esta
issue é só de UX; nada aqui bloqueia a fase Validar da etapa 3.

## Bug concreto — ✅ RESOLVIDO em 2026-08-04 (mesma sessão)

**Roubo de foco ao digitar**: com o painel de criação aberto, digitar uma letra
em qualquer campo movia o cursor/foco para o campo "Nome" do provedor.

**Causa raiz confirmada**: o efeito de foco do `Modal` (design-system) tinha
`onClose` nas deps; o `ProviderForm` passa `onClose` como arrow inline
(identidade nova a cada render), então qualquer re-render com o modal aberto
(uma tecla, um clique, ou o `App` re-renderizando por evento de semáforo)
re-rodava o efeito, que foca o primeiro focável do diálogo — o "Nome".

**Fix**: `onClose` movido para ref (`onCloseRef`) e efeito dependendo só de
`open` (`design-system/src/components/Modal/Modal.tsx`) — foco inicial
acontece uma vez por abertura; conserta todos os chamadores do Modal, não só
o ProviderForm. Coberto por smoke novo
(`tests/smoke/modal-focus-steal.spec.ts`), vermelho antes / verde depois;
regressão: vitest 1729/1729, typecheck, smokes de providers + project-config
verdes.

## Melhorias de UX (menores, mesma passada)

1. **Placeholder enganoso**: o campo de env mostra
   `ANTHROPIC_BASE_URL=https://openrouter.ai/api/v1` como exemplo
   (`ProviderForm.tsx:173`) — com o `/v1` que o spike T1302 provou que QUEBRA
   no OpenRouter (o CLI concatena `/v1/messages` sozinho; ver
   `specs/011-contas-e-provedores/registry-classe-a/spike-t1302-openrouter.md`).
   Trocar o exemplo para `https://openrouter.ai/api` ou usar exemplo neutro.
2. **Fluxo em dois tempos pouco sinalizado**: na criação entra só o NOME da
   variável secreta e o valor é colado depois, noutra seção ("Segredos de
   <label>"). O hint existe, mas o usuário real não entendeu de primeira —
   avaliar um passo único guiado (criar → painel já rola/foca o campo de
   segredo pendente) ou wizard curto.
3. Revisar rótulos/ordem dos campos com olhar de primeira vez (o formato
   `NOME=valor` um por linha também não é autoevidente).

## Restrições (inalteradas, não são negociáveis nesta issue)

- Segredo segue write-only: nunca relido, nunca ecoado à UI, nunca em log.
- Nenhum campo nomeado de provider (baseUrl/apiKey/model) — env genérico +
  `secretEnvKeys` (D1/C15 do plano da etapa 3).
- Registry vazio continua invisível no Launcher (C14/D6).

## DoD

- ~~Digitar em qualquer campo do painel nunca move o foco.~~ ✅ feito
  (smoke `modal-focus-steal.spec.ts`).
- Placeholder sem o `/v1` armadilha.
- Um usuário de primeira viagem completa cadastro + segredo sem instrução
  externa (teste com roteiro e2e da etapa 3, seção 2).
