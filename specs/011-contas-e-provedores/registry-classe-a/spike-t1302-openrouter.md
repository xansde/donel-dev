# Spike T1302 — compatibilidade do piloto (OpenRouter)

**Data**: 2026-08-05. **Regra de parada** (tasks.md): se o binário `claude`
não completar um turno apontado ao provider, a fase para e o humano decide
entre shim ou trocar o piloto — o resto do registry (T1303+) é indiferente
ao resultado (D1) e seguiu de qualquer forma.

## Resultado: **SUBIU** — um turno completo, com uma ressalva de path

A chave foi lida do Bitwarden via `bw get password <item-id>` e usada só na
sessão do terminal (nunca ecoada, nunca escrita em arquivo). Nenhum valor de
segredo aparece abaixo.

### Achado — `ANTHROPIC_BASE_URL` não pode incluir `/api/v1`

O binário `claude` concatena um sufixo fixo `/v1/messages` a
`ANTHROPIC_BASE_URL` (confirmado com `--debug`: a request saiu para
`.../api/v1/v1/messages`, path duplicado). O endpoint Anthropic-compatible
real do OpenRouter vive em `https://openrouter.ai/api/v1/messages` — logo o
valor correto de `ANTHROPIC_BASE_URL` é **`https://openrouter.ai/api`**
(sem o `/v1`), não `https://openrouter.ai/api/v1` como a documentação do
OpenRouter sugere para outros clientes.

Com o path corrigido, um `POST /api/v1/messages` bateu certo (confirmado por
`curl` direto e pelo `--debug` do CLI) e o CLI completou o turno.

### Variáveis necessárias

- `ANTHROPIC_BASE_URL` = `https://openrouter.ai/api` (**sem** `/v1` — ver achado acima)
- `ANTHROPIC_AUTH_TOKEN` = a chave do OpenRouter (cofre — nunca em texto plano fora do vault do app)
- `ANTHROPIC_MODEL` = nome do modelo aceito pelo endpoint (ver abaixo)

### Nome de modelo aceito

`claude-sonnet-5` — testado com sucesso via CLI (`claude -p "diga ok"`,
resposta `Ok.`) e via `curl` direto ao endpoint. O OpenRouter resolve esse
nome (sem prefixo `anthropic/`) para `anthropic/claude-sonnet-5` na resposta.

Testado também `anthropic/claude-3-haiku` (com prefixo) via `curl` — 200 OK,
mapeado para `provider: "Amazon Bedrock"`. Via CLI, `claude-3-haiku` (sem
prefixo) devolveu `API Error: 400 Provider returned error` — o nome exato
importa; não foi investigado mais a fundo (fora do escopo do spike: só
precisa de UM modelo funcionando ponta a ponta, e `claude-sonnet-5` já prova
isso).

### `--model`/`--effort` do CLI não servem com provider

Confirmado o motivo do C18/D7 do plano: `--model <alias-anthropic>` (ex.
`sonnet`, que resolve para `claude-sonnet-5` do catálogo LOCAL do CLI) NÃO
equivale a setar `ANTHROPIC_MODEL` — nesta simulação as duas strings até
coincidem, mas a fonte é outra (o CLI faz sua própria resolução de alias
antes de montar a request, independente do `ANTHROPIC_MODEL`; os dois
mecanismos não se comunicam). O registry (T1303+) omite `--model`/`--effort`
do argv com provider selecionado e deixa o modelo vir só do `env` da
entrada — exatamente o comportamento validado aqui.

## Conclusão para o registry

Nenhum ajuste de código é necessário no registry por causa deste achado — o
formato genérico `env: Record<string,string>` (D1) já comporta o valor
correto de `ANTHROPIC_BASE_URL` (`https://openrouter.ai/api`) como um dado
de configuração comum, sem precisar de nenhum campo especial ou shim. O
achado é só operacional: quem cadastrar o provider OpenRouter pelo
`ProviderForm` precisa digitar `https://openrouter.ai/api` (sem `/v1`) no
campo de env — vai para `specs/011-contas-e-provedores/registry-classe-a/e2e.md`
como nota do roteiro manual.

## Pendência para o humano

**Nenhuma que bloqueie.** A regra de parada do T1302 só exige decisão humana
quando o piloto NÃO sobe (escolher entre shim ou trocar de provider) — não é
o caso aqui: o piloto subiu, com uma única ressalva operacional (o valor
exato de `ANTHROPIC_BASE_URL`, documentada acima e no roteiro e2e). A fase
seguiu para T1303+ sem esperar confirmação adicional, exatamente como D1
previa.
