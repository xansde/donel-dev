# Propostas de processo — Esteira (N8, 2026-08-05)

Três propostas de regra de processo para a Esteira (o método, não o código).
**Nenhuma delas está aplicada** — nem em `SKILL.md`, nem em código, nem em
`CLAUDE.md`. São texto pronto para o dono aceitar ou rejeitar, cada uma com o
problema que a motiva, a regra proposta e, quando existe, o precedente real
neste repositório que a evidencia. Aceitar uma proposta é decisão dele; a
aplicação (editar `SKILL.md`, `CLAUDE.md` ou o código) é um passo seguinte,
fora deste documento.

---

## E3 — Dependência externa não verificada vira spike bloqueante; o dublê de HTTP nasce de resposta capturada, nunca do documento do fornecedor

### Problema

Um plano ou uma implementação às vezes depende do comportamento de um sistema
externo — uma API de terceiro, um provider, um serviço que a Esteira não
controla. Duas formas de errar isso já aconteceram neste projeto:

1. **Assumir o comportamento em vez de verificá-lo.** A premissa "o provider X
   fala o protocolo Y" é fácil de tratar como fato de código quando na
   verdade é decisão de produto não testada.
2. **Confiar na documentação do fornecedor para construir um dublê de teste.**
   Documentação de API descreve a intenção do fornecedor, não
   necessariamente o comportamento real do endpoint.

O precedente real dos dois: o spike **T1302** (`specs/011-contas-e-provedores/
registry-classe-a/spike-t1302-openrouter.md`), rodado porque o plano da 011
(risco **R1**, achado **A3**) marcou explicitamente que "a estreia depende de
OpenRouter falar a Messages API da Anthropic — premissa **não verificada** em
nenhum ticket". O spike verificou **contra o serviço real**, com `curl` direto
e o `--debug` do CLI — e encontrou que a documentação pública do OpenRouter
**induzia ao erro**: ela sugere `ANTHROPIC_BASE_URL=https://openrouter.ai/api/v1`
para outros clientes, mas o binário `claude` já concatena `/v1/messages`
sozinho — usar o valor documentado duplicava o path (`.../v1/v1/messages`) e
quebrava a chamada. O valor correto (`https://openrouter.ai/api`, sem `/v1`)
só apareceu confirmando com `curl` de verdade contra o endpoint, nunca lendo a
documentação do fornecedor.

### Regra proposta

> Quando um plano ou uma implementação depende do comportamento de um sistema
> externo que a Esteira não controla, e esse comportamento não está
> verificado por ninguém deste time contra o sistema real:
>
> 1. **A dependência vira um work item `spike`, bloqueante** para o que
>    depende dela — não uma suposição enterrada no plano nem uma nota de
>    rodapé. O spike tem critério de aprovação e regra de parada explícitos
>    (o padrão do T1302: se o spike falhar, a fase para e o humano decide —
>    nunca o código segue sobre a suposição não confirmada).
> 2. **Todo dublê de HTTP para esse sistema nasce de uma resposta CAPTURADA**
>    — uma chamada real (`curl`, ou equivalente) salva em disco — **nunca**
>    reconstruído a partir do documento de contrato do fornecedor (Swagger,
>    OpenAPI, página de docs). O documento descreve a intenção; a resposta
>    capturada descreve o que o serviço realmente devolve. Só a segunda é
>    fonte confiável para um teste que promete pegar regressão de verdade.

### O que mudaria, se aceito

As `SKILL.md` de `esteira-plano` e `esteira-implementar` do fork ganhariam um
passo nomeando esta regra (quando aplicável), e o repositório ganharia uma
convenção de onde salvar respostas capturadas (ex.: `tests/fixtures/http/
<serviço>/<endpoint>.json`, com a data e o comando `curl` usado registrados ao
lado). Nenhuma dessas mudanças está feita neste batch.

---

## E4 — Acesso que a máquina não tem: a pergunta vai ao dono, nunca vira suposição

### Problema

Verificar uma dependência externa (E3) às vezes exige algo que a sessão atual
não tem: uma credencial ainda não cadastrada, uma ferramenta não instalada, um
acesso de rede que a máquina não concede. Duas saídas ruins existem para esse
momento:

1. **Instalar/pedir acesso sem perguntar** — some das regras de autonomia já
   existentes (nunca instalar dependência sem confirmação, nunca lidar com
   credencial fora do fluxo combinado).
2. **Pular a verificação e seguir com uma suposição** — o problema que E3
   inteiro existe para evitar, só que por um caminho diferente: em vez de
   confiar no documento do fornecedor, confia-se no "deve funcionar assim".

O T1302 evitou as duas: a chave do OpenRouter já estava no Bitwarden (não
precisou pedir acesso novo), e foi lida só para a sessão do terminal, nunca
escrita em arquivo nem ecoada. Mas nada no processo hoje nomeia o que fazer
quando o acesso **não** está pronto — esse é exatamente o buraco que ficaria
exposto na próxima vez que um spike precisar de algo que a máquina não tem.

### Regra proposta

> Quando um spike de verificação (E3) precisar de um acesso que a sessão
> atual não tem — instalar uma ferramenta, cadastrar uma credencial nova,
> liberar uma rede —, a pergunta **"instalo/peço acesso agora para poder
> verificar?"** vai ao dono, como pergunta literal, e a sessão **espera a
> resposta** antes de agir. Nunca:
>
> - instalar/pedir por conta própria, mesmo achando que é óbvio que a
>   resposta seria sim;
> - pular a instalação e responder ao spike com uma suposição do que o
>   sistema "provavelmente" faz — isso é o mesmo erro que E3 nomeia, com uma
>   camada a mais de silêncio.
>
> Se o dono disser não (ou não responder a tempo), o spike fecha
> `inconclusive` — nunca `done` com uma suposição no lugar do fato — com uma
> nota nomeando exatamente o que faltou verificar.

### O que mudaria, se aceito

A `SKILL.md` de `esteira-implementar` (onde spikes tocam código/ambiente pela
primeira vez) ganharia este passo explícito, coerente com a regra de
autonomia já existente para instalação de dependência. Não aplicado aqui.

---

## E7 — Cláusula de dispensa da regra de PR sempre humano

### Problema

O baseline do squad — e o `CLAUDE.md` deste projeto — dizem, sem ressalva:
*"dentro da Esteira, PR é sempre aberto manualmente pelo humano — nunca pelo
Claude"*. Essa regra **já foi violada uma vez, com boa justificativa**: o
relatório de melhoria da sessão de 2026-08-05 (`docs/relatorio-melhoria-
sessao-2026-08-05-etapa-3-ponta-a-ponta.md`, achado **P34**) registra que o
dono autorizou literalmente ("pode abrir PR e mergear"), a exceção foi
sinalizada antes de agir — o que foi o comportamento certo dentro do vácuo
atual —, mas a regra continua escrita como absoluta, sem prever esse caminho.
O próprio relatório já nomeia o risco: *"a regra precisa de uma cláusula de
dispensa explícita (quem pode dispensar, para qual branch, registrada onde) ou
vai ser violada de novo com boa justificativa — que é exatamente como uma
regra dura vira letra morta."*

Uma regra absoluta que todo mundo sabe que dobra "quando faz sentido" não é
mais uma regra — é uma sugestão com aparência de regra, e isso corrói a
credibilidade das OUTRAS regras duras do mesmo documento (a de `main`/prod
inclusive).

### Regra proposta

> A regra "PR é sempre aberto manualmente pelo humano — nunca pelo Claude"
> continua o padrão. Ela admite UMA dispensa, com três condições, todas
> obrigatórias:
>
> 1. **Quem dispensa**: só o dono do repositório (aqui, o Alexandre), com
>    **instrução literal** na sessão — o mesmo padrão que já vale para
>    tocar `main`/produção ("abre PR pra X", não "comita" ou "resolve isso").
>    Instrução ambígua não conta como dispensa.
> 2. **Para qual branch**: a dispensa **nunca** alcança `main`/`master` nem o
>    repositório público (`xansde/donel`) — essas continuam bloqueio total,
>    sem exceção, mesmo com instrução literal (a regra correspondente do
>    `CLAUDE.md` já é mais dura que esta e não muda). A dispensa só pode
>    valer para abrir/mergear PR contra uma branch de integração
>    (`staging`/`dev`) — nunca a branch final protegida.
> 3. **Onde fica registrado**: a dispensa vira um fato escrito, sempre —
>    nunca só a lembrança da conversa. No mínimo: (a) a mensagem do commit ou
>    a descrição do PR nomeia a dispensa e cita a instrução literal recebida
>    ("dispensa de PR manual: `<instrução literal do dono>`"); (b) o
>    relatório de melhoria da sessão (`docs/relatorio-melhoria-sessao-*.md`)
>    registra o achado, do mesmo jeito que P34 já fez — o registro não é
>    burocracia extra, é o motivo de a exceção ser rastreável em vez de
>    silenciosa.
>
> Fora dessas três condições — sem instrução literal, mirando `main`/público,
> ou sem registro —, a regra absoluta vale sem ressalva, e a ação correta é a
> que P34 já nomeou: sinalizar a exceção, não executar, esperar confirmação.

### O que mudaria, se aceito

O `CLAUDE.md` do squad (ou o deste projeto, conforme o dono decidir o
escopo) ganharia esta cláusula como parágrafo da regra existente — este
batch **não toca `CLAUDE.md`** de propósito, porque essa edição é a aplicação
da proposta, não a proposta em si.
