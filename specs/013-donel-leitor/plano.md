# Plano — O Donel como leitor de arquivos (e de widgets)

Plano `pln-esteira4-donel-leitor`, do discovery «Definicao esteira dev»
(`dsc-15a7e7f5-fbb`, 07/08). Desagregado em itens na fase Plano de **13/08/2026**
(run `run-9400a822-4cb`), ao vivo com o dono.

**Por que existe:** a esteira produz o que o dono não consegue ler sem sair do
app. A Design entrega HTML+Mermaid, a Validar entrega HTML de e2e com espaço
para anotação, e os relatórios são MD. Hoje ele sai do Donel Dev para ler tudo
o que o Donel Dev produz.

**Ordem:** este plano começa **depois** que a rodada da 012 fechar (Onda 5,
alfa). Nenhum item daqui entra na 012 — a decisão do dono de 11/08 segue de pé.

---

## Terreno no momento de planejar

Verificado em `src/` nesta sessão: **não existe** `shell.openPath` nem
`openExternal` em lugar nenhum; o único `onDrop` é reordenação de aba
(`App.tsx:2030`); não há renderizador de Markdown nem `mermaid` nas
dependências. Tudo aqui é construção nova — nada é ajuste do que existe.

O app já tem raízes de projeto (`~/seazone`, `~/pessoal`, em
`project-scanner.ts:125`) e sabe qual projeto está em foco. O vault Obsidian
**não** mora em nenhuma delas.

---

## Decisões tomadas ao vivo (13/08)

### D1 — A porta de entrada é um diretório, não um link de artefato
A pergunta era se o leitor abriria só o que a esteira declarou
(`artifact.recorded`) ou um diretório navegável. O dono escolheu diretório, com
uma intenção declarada de longo prazo: **trazer a wiki do Obsidian para dentro
do Donel Dev**. Isso reclassifica o plano — não é "link clicável no card", é
navegador de diretório com visualizador multi-formato.

### D2 — A raiz são locais fixados pelo dono
Não é a pasta do projeto em foco, e não é diálogo ad-hoc. Uma lista de pastas
que ele fixa e o app lembra: o projeto em foco é um local, o vault Obsidian é
outro, e qualquer pasta futura entra igual. **Motivo:** ancorar no projeto em
foco faria a wiki exigir reabrir a âncora depois, mexendo no que já estivesse
pronto.

### D3 — Formatos desta rodada: MD, Mermaid, imagem, HTML, PDF
**CSV fica de fora.** Nada da esteira produz CSV hoje; ele entra quando entrar
pelo lado da wiki. PDF usa o visualizador nativo do Chromium.

### D4 — A anotação do e2e é persistida
O leitor não é estritamente leitura. O que o dono escreve no HTML de e2e hoje
morre quando a aba fecha, porque nada grava. Passa a ser gravado em sidecar
dentro de `.esteira/validar/`, versionado junto do resto — o que abre um
contrato novo (formato do sidecar, regeração do HTML por cima, e a fase Concluir
podendo ler o que foi anotado). **Anotação em MD/PDF/imagem fica fora** desta
rodada: isso é a wiki, e é plano próprio.

### D5 — Widget só vale com canal de volta
Pedido acrescentado no meio da entrevista. O ponto explicitado ao dono, e aceito
por ele: **renderizar não é o problema** — se o spike do sandbox resolver, mostrar
um widget é o mesmo trabalho de mostrar o HTML da Design. Os dois problemas reais
são outros, e nenhum existe hoje:

1. **Como o widget chega.** O app do Claude Code (desktop/web) tem canal próprio
   para emitir widget. O Donel Dev embute o **CLI**, por `node-pty`, e o que
   trafega ali é texto de terminal — o CLI no terminal não emite widget. A forma
   escolhida é **convenção de pasta** (o Claude grava, o app percebe e abre), não
   protocolo. Interceptar marcador no fluxo do PTY foi considerado e descartado
   como frágil: o `\r` colado do auto-start já mostrou o que acontece quando se
   assume como o PTY trata um bloco que chega junto.
2. **O caminho de volta.** Widget que só mostra é figura. O valor é o resultado
   virar entrada da sessão — via injeção no PTY (`injectCommand`), o mesmo
   mecanismo do auto-start.

**Consequência aceita:** o item do canal de volta herda o auto-start do Enter,
que na 012 está com a **bateria manual ainda pendente** na Onda 1. Se aquele
Enter não estiver provado, este item nasce com o bug dentro.

---

## Os 10 itens

| # | id | Tipo | Item | Depende de |
|---|---|---|---|---|
| 1 | `wi-leitor-01` | `spec` | Spec do leitor e dos widgets: locais fixados, formatos, leitura confinada à raiz, contrato da anotação e do canal de volta | — |
| 2 | `wi-leitor-02` | `spike` | Sandbox de HTML com JS dentro do Electron — dá para rodar sem o conteúdo herdar o privilégio do app? | 1 |
| 3 | `wi-leitor-03` | `issue` | Locais fixados + árvore de arquivos + leitura confinada | 1 |
| 4 | `wi-leitor-04` | `issue` | Visualizador de Markdown com Mermaid | 3 |
| 5 | `wi-leitor-05` | `issue` | Visualizador de imagem e PDF | 3 |
| 6 | `wi-leitor-06` | `issue` | Visualizador de HTML, na forma que o spike aprovar | 2, 3 |
| 7 | `wi-leitor-07` | `issue` | Anotação do e2e persistida em sidecar em `.esteira/validar/` | 6 |
| 8 | `wi-leitor-08` | `issue` | Arrastar arquivo para o terminal | — |
| 9 | `wi-leitor-09` | `issue` | Widget: o Claude grava na pasta combinada, o app percebe e abre | 6 |
| 10 | `wi-leitor-10` | `issue` | Canal de volta: o resultado do widget vira entrada da sessão | 9 (`ships_with`) |

Alvo de todos: **`donel-dev`**.

### Três escolhas de quebra, e o porquê

- **O spike (2) vem antes do visualizador de HTML (6).** Escrever o visualizador
  e descobrir o sandbox depois é retrabalho garantido. A resposta do spike pode
  ser negativa ("não dá, abre fora") — e resposta negativa fecha um spike.
- **MD+Mermaid (4) é separado de imagem+PDF (5).** Mermaid sozinho enche uma
  sessão; junto com o resto, o item vira handoff no meio.
- **9 e 10 são `ships_with`, não `flows_into`.** Uma entrega só, construída em
  sequência na mesma branch. Widget que aparece sem devolver nada é a figura
  bonita que o dono recusou explicitamente — nenhum dos dois sobe sozinho.

O item **8 (arrastar para o terminal) não depende de nada** e é o único que dá
valor sem o resto existir. Candidato natural a entrar primeiro.
