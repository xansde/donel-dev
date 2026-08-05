Type: task
Status: open

# Melhorar a UX do cadastro de provedores (ProviderForm)

Origem: teste manual do dono em 2026-08-04, durante a T1325 (ingestão da chave
real do OpenRouter), logo após a implementação da etapa 3
(`wi-registry-providers-classe-a`, commit `13c7e80`). Veredito dele: o fluxo
funciona, mas "ficou muito pouco intuitivo". O funcional está aprovado — esta
issue é só de UX; nada aqui bloqueia a fase Validar da etapa 3.

## Bug concreto (o mais chato, prioridade da issue)

**Roubo de foco ao digitar**: com o painel de criação aberto, digitar uma letra
em qualquer campo move o cursor/foco para o campo "Nome" do provedor. Torna a
digitação dos campos de env/segredo uma luta.

Hipóteses a investigar (nenhuma confirmada ainda):

- `ProviderForm` é montado direto na titlebar do `App`
  (`src/renderer/src/App.tsx:1651`); o `App` re-renderiza com frequência
  (semáforo, tabs) — verificar se algo remonta o form/painel e o browser
  devolve o foco ao primeiro input.
- Handlers globais de teclado em fase de captura no `App`
  (`App.tsx:1431-1456`, Ctrl+1..9/Ctrl+Tab) e listeners do xterm
  (`TerminalPane`) que re-focam o terminal — verificar se algum caminho chama
  `focus()` em resposta a keydown sem checar se o usuário está digitando num
  input (`document.activeElement`).
- Associação de `<label>`/`htmlFor` errada fazendo clique/tecla ativar o
  primeiro campo.

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

- Digitar em qualquer campo do painel nunca move o foco.
- Placeholder sem o `/v1` armadilha.
- Um usuário de primeira viagem completa cadastro + segredo sem instrução
  externa (teste com roteiro e2e da etapa 3, seção 2).
