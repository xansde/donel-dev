# Spec — Cartas do Oráculo na forma A

> Origem: pedido do dono de 05/11, já decidido pelo protótipo
> (`docs/prototipos/carta-oraculo/`; escolha e frases dele em `decisao.md`; forma em `final.html`;
> proposta do contrato em `contrato.html`). Quem implementa: um Dev, a partir de `origin/staging`.
> Política de testes do projeto: **testes enxutos** (CLAUDE.md). Verificação: `npm run typecheck`
> + `npm test` (+ `npm run test:smoke` uma vez, só nas fatias que mexem no main ou no preload).

## O que o dono pediu, nas palavras dele

- “Acho que pouca coisa está chegando lá pra mim, heinn. Mas elas não estão otimizadas para eu
  entender. Gostaria de ver protótipos por lá, entender problemas, decidir oque você não
  conseguir decidir sozinho. Link de github não me explica nada. E o pedido sempre fica ignorado
  no topo da página.”
- “Esse negócio de código das tarefas não me explica nada. Sou um humano, coopera comigo, por favor.”
- “A ideia é ser a forma A. Mas não existe suporte para eu ver os protótipos nas próprias cartas
  nem como escrever lá. É esse tipo de coisa que falta.”

## O resultado esperado

Toda carta que espera o dono, no **celular** (PWA, `src/main/celular/pwa/`) e no **desktop**
(`src/renderer/src/Mindscape/LedgerStrip.tsx`), segue a forma A de `final.html`:

- **Frente (decide)**: naipe e “I · III”; título humano; a pergunta; o visual (print, vídeo,
  **protótipo HTML embutido** ou quadro de checagens); a faixa “Recomendo X: porquê”; as opções,
  cada uma com o efeito embaixo e a recomendada marcada; **✎ Escrever para <quem fez>**; o selo
  de risco com uma frase; o botão “↻ Virar”.
- **Verso (explica)**: o que aconteceu (resumo); por que a recomendação; cada caminho com o
  efeito e o risco; o risco; quem fez (nome do lugar), quando e prazo; recolhidos: “O que você
  pediu, nas suas palavras” e “Detalhes técnicos” (critério, provas de texto e link, ids).
- **Nada de código fora de “Detalhes técnicos”**: nem id de tarefa, nem id de lugar, nem branch,
  hash, número de PR ou caminho de arquivo. Lugar aparece pelo nome no quadro (“Dev · painel do
  Jobu”); sem nome, pelo papel (“Dev”).
- Entrega **sem** o bloco “para o dono” (risco baixo, ou entrega antiga) continua aparecendo,
  num verso só: pedido, critério, nota e provas, como hoje. Nada some.

Desktop: a fila do “esperando você” deixa de ser a lista sob a faixa e passa a abrir as cartas
(mão de cartas à esquerda, carta grande ao centro, como no `final.html`).

---

## Parte C — o contrato de `tarefa_entregar` (vai primeiro: as outras dependem dele)

### C1. Campos novos

Em `src/shared/ledger/tools.ts` (entrada) e `src/shared/ledger/contract.ts` (documento):

```ts
// tarefa_criar ganha:
titulo?: string            // nome humano da tarefa, até 60 caracteres

// tarefa_entregar ganha:
paraODono?: {
  titulo?: string          // sobrescreve o da tarefa, se veio
  pergunta: string         // o que o dono decide, 1 frase, até 160
  resumo: string           // o que aconteceu, até 280
  opcoes: Array<{          // 2 a 4
    rotulo: string         // até 40
    efeito: string         // o que acontece se escolher, até 200
    risco?: string         // o risco deste caminho, até 160
    fecha: 'aceita' | 'rejeitada'
    recomendada?: boolean  // exatamente 1 true
  }>
  porque: string           // por que a recomendada, até 200
  risco: string            // a frase do risco da tarefa, até 200
  visual?:                 // índice (1-based) nas provas desta entrega
    | { prova: number }
    | { antes: number; depois: number }
    | { checagens: Array<{ nome: string; ok: boolean; frase: string }> }  // 1 a 10
}
```

No documento (`LedgerEvent` de `entregue`), o bloco vai como `forOwner` com os mesmos campos em
inglês (`title`, `question`, `summary`, `options[{label, effect, risk, closes, recommended}]`,
`why`, `risk`, `visual`). `LedgerTask` ganha `title?: string`.

A decisão do dono passa a gravar a opção: `aceita`/`rejeitada` ganham `option?: string` (o
rótulo). Escolher uma opção com `fecha: 'rejeitada'` grava como motivo `"<rótulo>"` mais o texto
do dono, se houver (o motivo continua obrigatório, mas a opção já é um motivo).

O evento novo `comentada` (Parte B) também nasce aqui, para o documento mudar **uma vez só**.

**`LEDGER_SCHEMA_VERSION` sobe para 3** (regra do contrato: o `userData` é compartilhado entre
canais; o canal mais velho fica só lendo). `parseLedgerDoc` aceita v2 e v3; descarta campo
inválido do bloco sem descartar a entrega.

### C2. Quando o bloco é obrigatório (guarda em código, no `applyLedgerOp`)

A entrega de uma tarefa de **risco alto** é recusada sem `paraODono`, ou com ele incompleto:
sem `pergunta`, sem 2 a 4 `opcoes` com `efeito`, sem exatamente 1 `recomendada`, sem `porque`
ou sem `risco`. Também é recusada quando a entrega tem print ou vídeo e o bloco não aponta um
`visual`. No risco baixo, o bloco é opcional (o Revisor decide; o dono só vê a amostra do dia).

`visual.prova` (ou `antes`/`depois`) tem de apontar uma prova de arquivo da mesma entrega.

### C3. Recusa de código no texto para o dono

Todo texto de `titulo` e de `paraODono` passa por `findCode(text)` (puro, em `contract.ts`). A
entrega é recusada, com a mensagem dizendo **o que** trocar, se aparecer:

| Padrão | Exemplo recusado |
|---|---|
| id de tarefa `\bt-[0-9a-f]{6,}\b` | `t-1b6c1a95` |
| id de lugar `\b(place\|session):[0-9a-f-]{6,}` | `place:4fd365dd…` |
| hash `\b[0-9a-f]{7,40}\b` com ao menos um dígito e uma letra | `2a98f2f` |
| PR ou issue `#\d+` ou `/pull/\d+` | `PR #105` |
| branch `\b(feature\|feat\|fix\|proto\|docs\|chore)/[\w.-]+` | `feat/homologacao-…` |
| caminho de arquivo `[\w-]+/[\w./-]+\.\w{1,5}\b` ou `[A-Z]:\\` | `src/main/x.ts` |
| crase `` ` `` | `` `npm test` `` |
| URL `https?://` | (link vai como prova) |

Mensagem: `Escreva para um humano: "<trecho>" é código. Chame pelo nome (ex.: "a fase 2 da
VPS", "o Dev do painel"). O código vai nas provas, que ficam em "Detalhes técnicos".`

Provas, critério e pedido **não** passam pelo filtro (são técnicos ou literais).

### C4. A descrição das ferramentas

Atualizar a `description` de `tarefa_criar` e `tarefa_entregar` em `LEDGER_TOOLS` para ensinar o
bloco em 3 linhas e citar a régua (abaixo). É o que o agente lê.

### C5. A régua de quando sobe ao dono (vai na descrição de `tarefa_criar`)

Sobe (cria tarefa de risco alto com o dono decidindo) quando é: difícil de desfazer (`main`,
repo público, apagar, credencial, conta, dinheiro); toca outra pessoa ou algo de fora; gasta o
que é do dono (limite de conta, VPS, a hora dele); muda a forma do que ele vê **e há 2 jeitos
bons** (sobe com protótipo, nunca com descrição); contradiz o que ele disse ou sai do pedido.
Não sobe: só uma opção defensável (decide e registra o porquê); escolha técnica reversível
dentro do pedido; resposta já escrita em CLAUDE.md, ADR, memória ou decisão anterior; bug
corrigido com teste; risco baixo que o Revisor aceita. Teste: sem pergunta numa frase, 2 opções
reais e uma recomendação, a decisão não está pronta para subir.

### Pronto quando (C)

- `tarefa_entregar` de risco alto sem o bloco, ou com `t-1b6c1a95` na pergunta, volta recusada
  com a mensagem acima; com o bloco certo, grava e o `tarefa_ver` mostra o bloco.
- Um `ledger.json` v2 de hoje abre sem perder nada; gravado em v3, um app v2 abre em só leitura.
- Testes (só estes, em `tests/ledger.test.ts`): parse v2→v3 sem perda; `findCode` pega cada
  padrão da tabela e não pega texto comum com número (“44 h”, “5 de 5”, “07/11”); risco alto sem
  bloco é recusado; decisão por opção grava `option`.

---

## Parte A — ver o protótipo DENTRO da carta

### A1. HTML como prova

- `PROOF_FILE_TYPES` ganha `html: 'text/html'`. Limite **2 MB** para HTML (`MAX_PROOF_HTML_BYTES`);
  print e vídeo seguem em 50 MB. O HTML tem de ser **autocontido** (CSS, JS e imagens dentro
  dele); o app não busca nada de fora para ele.
- O `importProof` copia o HTML para `ledger-provas/` como já faz com print (mesma checagem de
  link simbólico, caminho real e tamanho).
- Uma entrega pode ter **um** HTML como `visual` (`{ prova: n }`); mais HTMLs viram provas comuns.

### A2. Como o arquivo viaja

1. **Agente no PC → Oráculo**: como hoje: `{"tipo":"arquivo","caminho":"C:/…/prototipo.html"}`;
   o main copia para `<userData>/ledger-provas/<data>-<aleatório>.html`.
2. **Agente num lugar remoto (VPS) → Oráculo**: hoje a cópia falha (“Numa sessão remota, mande a
   prova como texto ou link”). Novo: quando a sessão que entrega é de um lugar remoto, o main
   lê o arquivo **pelo ssh do próprio lugar** (o mesmo acesso de `src/main/remote-session.ts`):
   primeiro `stat -c %s` (recusa acima do limite), depois `cat -- <caminho>` com o caminho
   passado como argumento citado, nunca interpolado em shell. Só caminho absoluto, só as
   extensões de `PROOF_FILE_TYPES`, sem seguir link simbólico (`test -L` recusa). O conteúdo vai
   direto para `ledger-provas/`.
3. **Oráculo → celular**: a PWA pede `GET /api/prova-bilhete?item=…&prova=…` (com o token, como
   as outras chamadas) e recebe um bilhete de **uso único, 60 s**, preso àquele item e prova. A
   carta põe `<iframe sandbox="allow-scripts" src="/api/prova-html?b=<bilhete>">`. O servidor
   responde o HTML com:
   `Content-Security-Policy: sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline';
   style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:;
   connect-src 'none'; form-action 'none'; base-uri 'none'; frame-ancestors 'self'`.
   Sem `allow-same-origin`: o protótipo não lê o token do celular nem chama a API. A `PAGE_CSP` da
   PWA ganha `frame-src 'self'`.
4. **Oráculo → desktop**: protocolo `donel-prova:` registrado no main (precedente: `donel-asset:`),
   que só serve nome válido (`isProofFileName`) de dentro de `ledger-provas/`, com a mesma CSP
   acima no cabeçalho. O CSP do `src/renderer/index.html` ganha `frame-src donel-prova:`. O
   iframe tem `sandbox="allow-scripts"` (sem `allow-top-navigation`, sem `allow-popups`).

### A3. Na carta

- O visual HTML aparece na frente, no lugar da ilustração (altura fixa, rola por dentro), com
  “⤢ tela cheia”. Print abre ampliado ao tocar; vídeo toca dentro da carta.
- `visual.checagens` é desenhado pelo app (o quadro de luzes da carta 1 do protótipo): nome e
  sinal verde/amarelo; a frase só aparece no que não está ok.

### Pronto quando (A)

- Um Dev no PC e outro na VPS entregam cada um um HTML de protótipo; os dois aparecem rodando
  dentro da carta, no celular e no desktop, e os botões do protótipo funcionam.
- O protótipo não consegue: abrir rede (fetch de `https://example.com` falha), ler
  `localStorage` da PWA, navegar a página de cima nem abrir janela. Conferir no console.
- Bilhete usado duas vezes ou depois de 60 s dá 404.
- HTML de 2,1 MB é recusado na entrega, com a mensagem do limite.
- Testes (só estes): `celular-server.test.ts` — o HTML sai com a CSP `sandbox allow-scripts`, o
  bilhete é de uso único e vence; guarda do protocolo `donel-prova:` recusa nome fora de
  `ledger-provas/` (é guard de navegação, entra na política).

---

## Parte B — escrever na carta

### B1. O que o dono faz

- Na frente, abaixo das opções: “✎ Escrever para <quem fez>”. Abre uma caixa de texto livre
  (até 2.000 caracteres; ditado pelo teclado do celular funciona).
- **Enviar sem escolher opção**: a carta continua esperando o dono, com o recibo “Enviado a
  <quem>, às 14:40” e a conversa no verso.
- **Escolher uma opção com texto escrito**: o texto vai junto da decisão (vira o `text` do
  evento `aceita`/`rejeitada`) **e** também é enviado como mensagem.

### B2. No Oráculo

- Op nova `comentar { id, texto, requestId? }`, só do dono, em qualquer estado menos `aceita`
  sem amostra. Grava o evento `comentada { at, by: dono, text, requestId?, deliveredTo? }`.
  Idempotente por `requestId`, como o `decidir` do celular.
- O lugar dono pode **entregar de novo** uma tarefa `entregue` quando há um `comentada` do dono
  depois da última entrega (responder a uma pergunta com uma carta nova). A regra fica em
  `applyLedgerOp`.
- Celular: `POST /api/comentar { pedidoId, itemId, texto }`. Desktop: canal IPC novo em
  `LEDGER_CHANNELS`, só da janela do app (mesmo `fromMain` do `decide`).

### B3. A mensagem

- Logo depois de gravar, o main manda à **sessão dona da tarefa** (o `ownerPlaceId`), pelo
  mesmo caminho do `sessao_enviar` (fila do CLI, na hora; nunca retida, regra “chat envia na
  hora”), o texto:
  `◆ Do dono, na carta «<título>»: <texto>` + uma linha `(responda entregando a tarefa
  <id> de novo, ou com tarefa_ver para reler)`. Aqui o id pode aparecer: a mensagem é para o
  agente, não para o dono.
- Se a sessão dona estiver fechada, não começou ou não existe, a mensagem vai ao **Líder único**
  (`LEADER_OF_ALL`), com o nome do lugar dono e do quadro. Se nem o Líder estiver aberto, o
  evento fica gravado com `deliveredTo: null` e a carta mostra “Ninguém aberto para ler agora;
  fica guardado na carta”.
- `deliveredTo` grava para onde foi (`{ placeId }` ou `'lider'`), para o recibo da carta.

### Pronto quando (B)

- Do celular, escrever numa carta de uma sessão aberta chega no chat dela em segundos, uma vez
  só, mesmo se o celular reenviar.
- Com a sessão fechada, chega ao Líder; sem Líder, a carta diz que ficou guardado.
- O verso mostra a conversa (dono e as reentregas) em ordem.
- Testes (só estes; mensagem que some ou duplica entra na política): `comentar` com o mesmo
  `requestId` grava uma vez; roteamento dono → Líder → ninguém; reentrega só depois de
  `comentada`.

---

## Ordem das fatias (uma branch e um PR por fatia, contra `staging`)

1. **Contrato** (Parte C inteira, sem tela): campos, schema 3, `findCode`, guarda do risco alto,
   descrições e régua nas ferramentas. Sem esta, nenhuma carta tem o que mostrar.
2. **Carta A no celular**: frente e verso lendo o bloco; opções com nome decidindo; quadro de
   checagens; verso único para entrega sem bloco; nada de id fora dos detalhes técnicos.
3. **Carta A no desktop**: a fila do “esperando você” abre a mão de cartas, como no `final.html`.
4. **Protótipo dentro da carta** (Parte A): HTML como prova, bilhete + CSP no celular,
   `donel-prova:` no desktop.
5. **Escrever na carta** (Parte B): op `comentar`, entrega da mensagem, recibo e conversa no verso.
6. **Prova de arquivo vinda da VPS** (A2, passo 2): a cópia pelo ssh do lugar.

As fatias 4, 5 e 6 dependem da 1 e podem correr em paralelo depois da 2 e da 3. Cada PR que muda
algo visível acrescenta um item em `src/renderer/src/patchnotes/notes.ts`.

## Fora do escopo

- O gesto de arrastar a carta (fica como está na PWA).
- Mudar o Revisor e a amostra do dia.
- Resposta do agente dentro da carta como chat em tempo real: o agente responde **reentregando**.

## Riscos

- **Schema 3**: um canal antigo aberto fica só lendo o Oráculo até ser atualizado. Avisar no patch note.
- **HTML de agente rodando no app**: o isolamento é a CSP do cabeçalho mais o `sandbox` sem
  `allow-same-origin`; se um dos dois faltar, o protótipo enxerga o token do celular. O teste da
  Parte A guarda os dois.
- **ssh na VPS** (fatia 6): o caminho vem do agente; nunca interpolar em comando de shell.
