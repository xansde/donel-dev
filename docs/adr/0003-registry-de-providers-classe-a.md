---
name: Registry de providers classe A
type: adr
status: accepted
created: 2026-08-05
updated: 2026-08-05
tags: [adr, providers, credenciais, 011-contas-e-provedores]
aliases: [ADR-0003, registry de providers, provider-registry, classe A]
---

# ADR 0003 — Registry de providers classe A

<!-- managed:start -->

## Contexto

Os ADRs 0001 e 0002 fecharam o problema de **contas** — múltiplas contas
Anthropic do mesmo pool, uma fonte única de credencial, um mecanismo de
troca. Ficou de fora um problema vizinho e distinto: usar o binário `claude`
apontado para um endpoint que **não é** a API oficial da Anthropic — um
provider Claude-compatible de terceiro (ex.: OpenRouter), com a própria
chave, o próprio modelo, o próprio endpoint. O ADR 0002 já nomeou essa porta
como pendente (invariante 8: `CLAUDE_CONFIG_DIR`/`buildPtyEnv` sobrevivem à
demolição dos perfis exatamente para isso).

Dois riscos moldaram o desenho:

1. **Contrato inventado.** Desenhar a interface a partir de UM provider real
   (o piloto óbvio, OpenRouter) repetiria o erro que a etapa 1 já cometeu e
   registrou como lição — uma interface extraída de uma implementação só
   tende a esconder campo que só aquele provider tem. A mitigação exigida
   desta vez foi testar contra **dois formatos de provider distintos**, não
   um.
2. **Colisão de três donos do mesmo env var.** `CLAUDE_CONFIG_DIR` já tinha
   dois candidatos a escrever nele — o motor de contas (ADR 0001) e o
   mecanismo de perfis (então ainda vivo). Um provider classe A é o
   **terceiro** candidato. Sem uma regra de precedência única e testada, o
   spawn de uma sessão vira função de qual módulo rodou por último.

Antes de desenhar o contrato, um spike de piloto (T1302, OpenRouter) validou
se o binário `claude` sequer sobe contra um endpoint Claude-compatible de
terceiro — pergunta que só um turno real, com chave real, responde.

## Decisão

Introduzir um **registry de providers** (`src/main/providers/`) com duas
classes — A (Claude-compatible, com spawn) e B (CLI de terceiro, aceito e
persistido, recusado no lançamento) — e um contrato de env genérico validado
contra dois formatos de provider reais, nunca contra um só.

### D1 — O contrato da classe A é o mecanismo env do Claude Code, não a API de um provider

`ProviderEntry` carrega `env: Record<string, string>` (não sensível) +
`secretEnvKeys: readonly string[]` (nomes, nunca valores) — não há campo
nomeado `baseUrl`/`apiKey`/`model`. O motivo é o formato real de configuração
de provider Claude-compatible: são variáveis de ambiente
(`ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_MODEL`,
`ANTHROPIC_SMALL_FAST_MODEL`, ...), e cada provider usa um subconjunto
diferente. Nomear campos seria reintroduzir a suposição de "um provider
representa todos". `provider-registry.test.ts` cobre **duas fixtures de
formato distinto** desde o início — mitigação direta da lição registrada na
etapa 1 (interface extraída de uma implementação só).

Consequência direta confirmada pelo spike T1302: nenhum ajuste de contrato
foi necessário para o achado do OpenRouter (abaixo) — o valor corrigido de
`ANTHROPIC_BASE_URL` é só um dado de configuração comum, sem exigir campo
especial ou shim.

### D3 — Precedência única de `CLAUDE_CONFIG_DIR`, função pura e testada

`resolveSessionConfigDir` (`src/main/providers/session-config-dir.ts`) é
função pura, sem I/O, que recebe os três candidatos possíveis
(`providerConfigDir`, `accountsEngineActive`, `activeProfileConfigDir`) e
devolve um único vencedor pela ordem **provider > motor > perfil**;
`undefined` significa "sem override", o `~/.claude` real de hoje. A tabela-
verdade completa (todas as combinações dos três candidatos) é a bateria de
teste de T1310. Isso resolve o achado A2 do `analyze` — a colisão de três
donos do mesmo env var vira uma única função auditável, em vez de depender
de qual módulo rodou por último.

### D4 — Config dir do provider é isolado, criado vazio, sem cópia automática

Cada provider classe A tem `<userData>/providers/<id>/`, criado **vazio** na
primeira sessão. Não há cópia automática de MCPs, `settings.json` ou
qualquer configuração do `~/.claude` real — um endpoint de terceiro não deve
herdar por acidente configuração pensada para a Anthropic (ex.: MCP com
credencial de outro serviço). A UI diz isso explicitamente no hint do
`ProviderPicker`: a sessão nasce isolada numa pasta de config própria.

### D6 — O registry nasce inerte

`defaultProvidersConfig()` = `{ version: 1, entries: [] }`. Sem nenhuma
entrada configurada, o ramo novo de código nem é avaliado: `ProviderPicker`
devolve `null` com lista vazia, `resolveSessionConfigDir` devolve
`undefined` nos dois caminhos restantes (motor/perfil, exatamente como
antes) e o spawn de uma sessão é **byte a byte** o de hoje. É o mesmo padrão
que destravou a etapa 1 (motor inerte por default) — a etapa entra por PR
sozinha, sem apostar comportamento existente, e o smoke
`providers-inert.spec.ts` cobre os três ângulos (Launcher, config dir,
sanitize).

### C13 — Provider e motor de contas são mutuamente exclusivos por sessão

Com `providerId` presente, o motor de contas **nem é consultado**
(`accountsSnapshot` fica `undefined`, `motorActive` é `false`) e
`spawnAccount` é forçado a `undefined` por `!spawnProvider`. Uma sessão nunca
mistura credencial de conta do pool com credencial de provider externo — a
precedência de D3 e a exclusividade de C13 são a mesma decisão vista de dois
ângulos (config dir de um lado, credencial injetada de outro).

### Cofre reusado, segredo write-only

Não existe segundo cofre: o segredo de provider vive no **mesmo**
`safeStorage` da etapa 1 (`src/main/accounts/vault.ts`), sob o namespace de
chave `provider:<providerId>:<ENV_KEY>` — valor. `setSecret` é one-way
(renderer → main, devolve só `{ kind }`); não existe canal
`providers:resolveLaunch` — a resolução do env acontece dentro do `main`
durante o `pty:create`, então o valor de segredo nunca cruza o preload. A UI
só enxerga `secretsStatus: 'configured' | 'missing' | 'vault-unavailable'`
(booleano de fato, nunca o valor).

Isso encaixa na exceção nomeada e confinada do `CLAUDE.md` (011, etapa 1,
"o motor de contas é a única parte do app que lê/grava credencial"): esta
etapa **não amplia** a exceção — o novo código de segredo mora inteiro em
`src/main/providers/`, ao lado do motor, dentro do mesmo perímetro
declarado, reusando o cofre em vez de duplicá-lo. O core do app e a UI de
gerenciamento (`ProviderForm.tsx`) seguem sem tocar segredo: o campo é
write-only, nenhum canal de leitura devolve o que foi digitado.

### Classe B nasce vazia, com definição

`class: 'B'` (CLI de terceiro fora do mecanismo env do Claude Code) é aceito
e **persistido** desde já — o operador pode cadastrar a intenção — mas
`resolveLaunch` de uma entrada classe B é sempre `unsupported-class`, e o
handler de `pty:create` lança erro **antes** de qualquer
`ptyManager.create`. `ProviderPicker` marca a entrada como "não suportada
nesta versão" e ignora o clique — recusa explícita, nunca silêncio. O smoke
`providers-class-b-refused.spec.ts` cobre o caminho.

### Spike T1302 como gate de produto, não de código

Antes de desenhar o registry, o spike confirmou que o piloto (OpenRouter)
sobe: um turno completo via `claude -p`, validado por `--debug` e `curl`
direto. O achado de produto que ficou registrado — e que teria custado uma
sessão de suporte se descoberto só em uso real — é que
`ANTHROPIC_BASE_URL` do OpenRouter vai **sem** `/v1` final
(`https://openrouter.ai/api`, não `.../api/v1`): o binário `claude` já
concatena `/v1/messages` por conta própria, e o valor sugerido pela
documentação do OpenRouter para outros clientes duplicaria o path. O achado
não mudou nenhuma linha de contrato (D1 já comportava o valor certo como
dado comum) — foi incorporado como nota operacional no roteiro e2e da etapa.
Confirmado também que `--model`/`--effort` do CLI não têm efeito com
provider selecionado (a resolução de alias do CLI é local, independente de
`ANTHROPIC_MODEL`) — por isso `buildLauncherArgs` omite as duas flags do argv
quando há `providerId`, deixando o modelo vir só do `env` da entrada.

## Consequências

**Positivas**

- Um provider Claude-compatible de terceiro entra por formulário, sem shim,
  sem redesenho de contrato — o spike provou isso ao vivo para o piloto.
- A colisão de três donos de `CLAUDE_CONFIG_DIR` (provider, motor, perfil)
  virou uma função pura testada por tabela-verdade, não uma corrida entre
  módulos.
- O cofre da etapa 1 ganhou um segundo consumidor sem duplicar mecanismo —
  namespace novo, mesmo `safeStorage`, mesma garantia de nunca degradar para
  texto plano.
- Registry inerte por default: a etapa mergeou sem alterar nenhum
  comportamento de sessão sem provider configurado.

**Negativas e limitações conhecidas**

- **O encanamento da C17 ficou pela metade.** A promessa era: a sessão
  carrega `providerId` de nascimento e o painel "Sessões anteriores" segue o
  provider, com a limitação visível quando não seguir. O `PtyCreateResult`
  ganhou o campo `provider` e `TerminalPane.tsx` declara a prop
  `onProviderResolved`, mas **nenhum ancestral a consome** — código morto —
  e o handler de listagem de sessões (`indexProjectSessions`) não olha para
  o config dir do provider. Efeito real: uma sessão lançada com provider
  grava o transcript normalmente (isso funciona, T1323 cobre), mas ela some
  do painel "Sessões anteriores" **sem aviso** — exatamente o silêncio que a
  C17 foi escrita para evitar. Não bloqueou a fase Validar (registry vazio é
  o default, e nenhuma invariante dura do contrato foi ferida) e ficou
  nomeado como dívida na issue
  `.scratch/contas-e-provedores/issues/10-encanamento-c17-e-segredo-orfao.md`
  (F-1), com nota de honestidade explícita: a T1321 está `[x]` no
  `tasks.md`, mas este pedaço do DoD dela não foi entregue.
- **Segredo órfão possível no cofre.** O formulário de gerenciamento
  (`ProviderForm.tsx`) itera `provider.envKeys` — a união diagnóstica de
  `env` + `secretEnvKeys` — para desenhar a seção de segredos, então permite
  gravar no cofre uma entrada para uma variável que não está em
  `secretEnvKeys`. Essa entrada nunca é lida por `buildProviderEnv` e não é
  apagada por `remove()` (que só varre `secretEnvKeys`). Sem vazamento (o
  valor segue write-only, nunca relido), mas é resíduo cifrado sem dono no
  cofre — dívida nomeada na mesma issue 10 (F-2).
- **Placeholder do formulário ainda sugere o valor que quebra.** O campo de
  env do `ProviderForm` mostra `ANTHROPIC_BASE_URL=https://openrouter.ai/api/v1`
  como exemplo — com o `/v1` que o próprio spike T1302 provou que falha.
  Registrado e conscientemente adiado na issue
  `.scratch/contas-e-provedores/issues/09-ux-cadastro-provedores.md` (F-3),
  que também nomeia UX geral do cadastro (fluxo em dois tempos pouco
  sinalizado, rótulos de primeira viagem) como melhoria pendente, não bug.
- O risco desta etapa foi classificado **sensível** (`auth_pii`) pela fase
  Validar: o diff cria um caminho novo de credencial — chave de provider
  entra por formulário, é cifrada no cofre e é decifrada e injetada em texto
  plano no env de um processo que fala com um endpoint de **terceiro** — e
  decide roteamento de autenticação (o ramo `providerId` é o que garante que
  a credencial da conta Anthropic não viaje para esse endpoint, C13).
  Material de autenticação + decisão de autorização de sessão não admite
  classificação trivial, mesmo com zero findings bloqueantes.

## Referências

- [`docs/adr/0001-motor-de-contas-e-mods.md`](0001-motor-de-contas-e-mods.md) — o cofre e a exceção nomeada de credencial que esta etapa reusa sem ampliar.
- [`docs/adr/0002-demolicao-dos-perfis-e-migracao-assistida.md`](0002-demolicao-dos-perfis-e-migracao-assistida.md) — invariante 8: `CLAUDE_CONFIG_DIR`/`buildPtyEnv` preservados de propósito como a porta desta etapa.
- [`specs/011-contas-e-provedores/spec.md`](../../specs/011-contas-e-provedores/spec.md) — clarifications C13–C22 da etapa.
- [`specs/011-contas-e-provedores/registry-classe-a/plan.md`](../../specs/011-contas-e-provedores/registry-classe-a/plan.md), [`data-model.md`](../../specs/011-contas-e-provedores/registry-classe-a/data-model.md) e [`contracts/provider-registry.md`](../../specs/011-contas-e-provedores/registry-classe-a/contracts/provider-registry.md) — desenho completo do registry e as seis invariantes de teste obrigatórias.
- [`specs/011-contas-e-provedores/registry-classe-a/spike-t1302-openrouter.md`](../../specs/011-contas-e-provedores/registry-classe-a/spike-t1302-openrouter.md) — o achado do path do OpenRouter e a confirmação de que `--model`/`--effort` não têm efeito com provider.
- [`.scratch/contas-e-provedores/issues/09-ux-cadastro-provedores.md`](../../.scratch/contas-e-provedores/issues/09-ux-cadastro-provedores.md) e [`10-encanamento-c17-e-segredo-orfao.md`](../../.scratch/contas-e-provedores/issues/10-encanamento-c17-e-segredo-orfao.md) — dívida nomeada não bloqueante: UX do cadastro, encanamento da C17 pela metade, segredo órfão no cofre.
- `.esteira/validar/handoffs/wi-registry-providers-classe-a/validar-result.json` — classificação de risco (`sensivel`, `auth_pii`) e a auditoria de invariantes no código, não só no relatório da fase Implementar.
- `CLAUDE.md` (raiz), seção **Credenciais** — a exceção nomeada e confinada que esta etapa reusa sem ampliar.

<!-- managed:end -->
