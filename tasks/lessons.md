# Lessons learned — donel-dev

Registro append-only de trade-offs e decisões que custaram análise. Uma seção
por fase/entrega; nunca reescrever entrada antiga.

## 2026-08-04 — pln-motor-contas-mods (motor-contas-mods)

### Refresh token de uso único proíbe clonar o heartbeat

A tentação era portar o `daemon.py` do claude-switcher inteiro para o main
process — heartbeat de 15 min renovando tokens, igual ao original. O research
mostrou que o refresh acontece no **servidor** deles e que existe ainda um
monitor externo coordenado por `refresh_owner`/`token_version`. Como o refresh
token da Anthropic é de **uso único**, um segundo renovador local queimaria o
par debaixo do primeiro. A alternativa rejeitada (clone do heartbeat) foi
trocada por **switch-time-only**: renova só na hora do switch, só como
fallback, e só para contas próprias. Custo aceito: conta parada meses pede
re-login uma vez.

**Lesson:** antes de clonar um mecanismo de renovação de credencial, descubra
QUEM mais renova aquele mesmo par — com refresh token de uso único, dois
renovadores não coexistem, e o segundo é sempre o que quebra.

### Interface extraída de dois mods, não projetada antes deles

Havia espaço para desenhar um framework de mods (loader, manifesto, sandbox)
antes de existir qualquer backend. Rejeitado: a interface nasce com exatamente
os quatro membros que os dois mods concretos exigem, e o motor escolhe entre
dois construtores com um `switch`. Corolário que só apareceu no plano: com **um
mod só** não há de onde extrair — a interface sairia sendo a API da Seazone com
outro nome, exatamente o acoplamento que a frente existe para evitar. Foi o que
obrigou o mod local a entrar na mesma etapa do mod Seazone.

**Lesson:** "extrair a interface de N implementações" implica entregar as N
juntas — cortar a etapa em uma implementação só transforma a abstração no
formato do primeiro backend.

### A escrita de credencial mora fora dos mods

O caminho óbvio era cada mod escrever `.credentials.json` e limpar
`oauthAccount`. Rejeitado: a sequência é uma invariante de correção (inverter a
ordem perde o par rotacionado da conta que sai) e duplicá-la por mod garante
que o terceiro mod a implemente errado. `switchTo()` passou a **devolver** o
par; a escrita ficou num módulo só, com o teste da ordem num lugar só.

**Lesson:** quando uma sequência de passos é invariante de correção, ela é
responsabilidade do orquestrador — plugin que a reimplementa é bug esperando
o próximo plugin.

### Motor inerte por default destrava a etapa

A etapa 1 convive com perfis vivos e com a 010 em voo. Em vez de sequenciar por
espera, o motor nasce desligado (`accounts.mod = null`): sem mod configurado, o
comportamento é byte a byte o de hoje. Isso torna a etapa mergeável e
reversível por config, sem depender da demolição de perfis.

**Lesson:** feature que substitui um mecanismo vivo entra desligada por config
— assim ela pode ser integrada e testada em dogfooding antes de o mecanismo
antigo morrer.

## 2026-08-04 — pln-registry-providers-classe-a (registry-classe-a)

### Registry de um piloto só: campos genéricos em vez de campos nomeados

A classe A estreia com **um** provider (OpenRouter), e a lição da etapa 1 diz
que interface extraída de uma implementação só vira o formato dessa
implementação. A alternativa natural — modelar a entrada com `baseUrl`,
`apiKey` e `model` — foi rejeitada: congelaria o registry no formato do
primeiro provider e exigiria código novo para o segundo. A entrada passou a
carregar `env: Record<string,string>` genérico + `secretEnvKeys: string[]`, e o
teste do registry roda a mesma bateria contra **duas** entradas fictícias de
formatos diferentes. Nenhuma string do provider real existe em lógica.

**Lesson:** quando a feature estreia com um único caso concreto, a proteção
contra "virar o formato dele" não é abstrair mais — é modelar o mecanismo em
dados genéricos e provar com duas fixtures de formatos diferentes.

### "Funciona sem obra" é afirmação sobre o mecanismo, não sobre o encanamento

A spec prometia que transcripts, hooks, resume e Modo Dev funcionariam "sem
obra" na classe A, porque o binário é o mesmo. Verdade sobre o mecanismo — e
falso sobre o app: `resolveTranscriptPath` e `indexProjectSessions` recebem o
`claudeHome` por parâmetro, então alguém tem de passar o home do provider. A
tentação era unir todas as raízes de transcript; foi rejeitada (muda assinatura
do indexer, cria dedup e ordenação entre origens, obra que ninguém pediu). A
resolução ficou no mesmo padrão que já vale para perfil ativo: a lista segue o
provider selecionado, e a UI diz de qual origem ela veio.

**Lesson:** "o binário é o mesmo, então funciona" merece uma checagem no código
de quem chama — o mecanismo herdado costuma ser parametrizado, e o parâmetro é
a obra escondida.

### Precedência de env com três donos vira função pura, não `if` no hub

`CLAUDE_CONFIG_DIR` passa a ter três candidatos ao mesmo tempo (perfil ativo,
motor de contas que exige *ausência* de override, provider). Espalhar a decisão
no `pty:create` deixaria a etapa 2 (que mata perfis) quebrar o comportamento sem
teste acusar. Virou `resolveSessionConfigDir` — pura, ordem provider > motor >
perfil, tabela-verdade testada incluindo o mundo pós-demolição, consumida num
ponto só.

**Lesson:** quando um recurso muda de dono ao longo de etapas, escreva a
precedência como função pura com tabela-verdade — a etapa que remove um dono
some com um ramo em vez de virar arqueologia.
