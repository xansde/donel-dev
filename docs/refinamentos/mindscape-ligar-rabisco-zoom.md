---
tema: mindscape-ligar-rabisco-zoom
plano:
item:
data: 2026-10-24
taskdex: []  # sem card: ferramenta pessoal, por decisão do dono
status: fechado
participantes: ["Alexandre Lentz"]
fechado-por: Claude por delegação de Alexandre Lentz, 2026-10-24 ("to indo quase tudo no recomendado. Vai fundo") — perguntas 1–12 decididas pelo dono; 13 em diante pela recomendação
---

# Refinamento — Mindscape: ligar pelo teclado, rabisco e zoom

## Demanda

Com a V1 do Mindscape funcionando em `staging` (PR #114), o dono quer três coisas de UI/UX
que estavam na hipótese V2 (`docs/versoes/mindscape.md`): ligar post-its pelo teclado,
rabiscar à mão livre no quadro para agrupar e explicar o que as sessões fazem, e zoom in/out.
A sabatina transformou "ligar pelo teclado" numa barra de ferramentas de desenho com atalhos
de uma tecla, no estilo do Excalidraw, e puxou o print colado da V2 para esta entrega.

## Regras de negócio fechadas

### Decididas pelo dono

- Rabisco é só desenho salvo no quadro: não cria grupo nem vínculo com os post-its que
  circunda. Mover um post-it não move o rabisco. Serve para o dono se organizar.
- "Ligar pelo teclado" é uma barra de ferramentas de desenho com atalho de uma tecla, no
  estilo do Excalidraw. Ferramentas desta entrega: `V` seleção, `H` mão (mover a visão),
  `A` seta, `L` linha, `R` retângulo, `O` elipse, `P` lápis (rabisco), `E` borracha, e
  **print colado** (imagem no quadro). Ficam fora: losango e texto livre (o post-it do dono
  cumpre o papel de texto).
- Print entra por `Ctrl+V` (imagem da área de transferência) ou arrastando um arquivo de
  imagem para o quadro; nasce onde está o mouse. Sem tecla nem seletor de arquivo.
- Seta (`A`) e linha (`L`) desenhadas de um post-it a outro **viram ligação** (a de hoje:
  acompanha os post-its; `A` com seta, `L` sem). Desenhadas com alguma ponta fora de post-it,
  são desenho solto. O botão "Ligar" sai da barra.
- Desenho já feito: com `V`, clicar seleciona e arrastar move; `Delete` apaga. Retângulo,
  elipse e print ganham alças de canto para redimensionar (print mantém a proporção); seta e
  linha soltas ganham alça nas pontas. Traço do lápis só move e apaga.
- Estilo do desenho: cor entre as 3 do post-it do dono (Sem cor = tinta neutra que acompanha
  o tema, Azul, Dourado) e 3 espessuras de traço, escolhidas na barra; valem para os próximos
  desenhos e mudam o selecionado. Retângulo e elipse sempre vazados.
- Camadas: ordem livre, como no Excalidraw — segue a criação e o dono muda com "trazer para
  frente" / "mandar para trás". A ordem livre vale **só entre desenhos**: post-its ficam sempre
  por cima de todos os desenhos.
- Borracha (`E`) apaga **o pedaço tocado**, como borracha de verdade (não o desenho inteiro).
  Por tipo: traço do lápis e seta/linha solta perdem o trecho tocado (podem virar dois);
  retângulo, elipse, print e ligação presa saem inteiros; post-its nunca são apagados pela
  borracha.
- `Ctrl+Z` desfaz toda ação do dono no quadro (desenhar, apagar, mover, redimensionar, cor,
  espessura, camada, colar print, criar/editar/mover/arquivar post-it, criar/remover ligação);
  `Ctrl+Shift+Z` refaz. Histórico por quadro, só em memória, vazio a cada abertura do app. O
  que a sessão faz (post-it de sessão surgindo, texto do post-it escrito pela sessão) não
  entra. Editando texto de post-it, `Ctrl+Z` é o desfazer do campo.
- Zoom como no Excalidraw: `Ctrl+roda` e pinça do touchpad dão zoom centrado no mouse; roda
  sozinha move a visão na vertical, `Shift+roda` na horizontal; indicador "− 100% +" no canto
  (clicar no número volta a 100%); faixa de 25% a 400%; salvo por quadro, como o pan. O zoom
  da página do Electron não pode disparar no quadro.

### Decididas por delegação (recomendação do Claude — o dono pode vetar no alfa)

- **Seleção múltipla**: com `V`, arrastar no fundo vazio desenha um laço retangular e
  seleciona tudo o que fica inteiro dentro; `Shift+clique` soma ou tira da seleção; `Ctrl+A`
  seleciona tudo do quadro. A seleção move junto, apaga com `Delete` (post-its saem por
  arquivar, como hoje) e recebe cor/espessura (só os desenhos). Arrastar o fundo com `V`
  deixa de mover a visão: mover passa a ser roda, `H` ou **espaço + arrastar**.
- **Ferramenta depois do desenho**: `A`, `L`, `R` e `O` voltam para `V` depois de um desenho;
  `P` (lápis) e `E` (borracha) ficam ativos até trocar. `Esc` volta para `V` (e cancela o
  desenho em curso). A barra mostra a ferramenta ativa e a letra de cada uma.
- **Alcance dos atalhos**: as teclas de uma letra só valem no modo Mindscape e nunca com foco
  num campo de texto (editar post-it). Não usam `Ctrl`/`Alt`, salvo `Ctrl+Z`, `Ctrl+Shift+Z`,
  `Ctrl+A`, `Ctrl+V` e trazer/mandar (`Ctrl+Shift+]` / `Ctrl+Shift+[`).
- **Seta e linha soltas** são retas de dois pontos (sem curva nem cotovelo). A ponta "está num
  post-it" quando o ponteiro solta sobre a área do cartão.
- **Ligação selecionada** mantém as ações de hoje na barra: seta liga/desliga e remover.
  Ligação para sessão sem aba aberta segue a regra da V1: guardada, só não desenhada.
- **Print**: aceita PNG, JPEG, WebP e GIF (estático); acima de 10 MB é recusado com aviso no
  quadro. Nasce com no máximo 480 unidades de largura do quadro, proporção mantida. O binário
  mora em arquivo próprio no `userData`, fora do `mindscape.json`, que guarda só a referência;
  arquivo sem referência é limpo na abertura seguinte do app (não na hora, por causa do
  `Ctrl+Z`).
- **Fora desta entrega**: copiar/colar e duplicar desenhos, minimapa, alinhar/distribuir,
  agrupar de verdade, losango, texto livre.

## Unknowns decididos

- Assumiria: laço fechado em volta de post-its vira grupo que se move junto → Decidido:
  nenhum vínculo; o agrupamento é visual.
- Assumiria: `L` com um post-it selecionado entra no modo "Ligar" atual → Decidido: não; a
  demanda é de ferramentas de desenho com atalhos estilo Excalidraw.
- Assumiria: print colado fica na V2, como previa `docs/versoes/mindscape.md` → Decidido:
  print entra nesta entrega.
- Assumiria: seta/linha sempre desenho solto, com "Ligar" mantido à parte → Decidido: ponta a
  ponta em post-its vira ligação; "Ligar" sai.
- Assumiria: desenho sempre por baixo dos post-its → Decidido: ordem livre, com trazer para
  frente / mandar para trás.
- Assumiria: borracha apaga o desenho inteiro tocado, sem desfazer → Decidido: apaga o pedaço
  tocado, e o quadro tem `Ctrl+Z`.
- Assumiria: só um item selecionado por vez → Decidido (delegação): laço + `Shift+clique`.
- Assumiria: binário do print em base64 dentro do `mindscape.json` → Decidido (delegação):
  arquivo próprio, referência no JSON, limpeza na abertura.

## ADRs gerados

Nenhum. As decisões desta sabatina são reversíveis sem migração cara. A pergunta sobre o
ADR 0004 fica para a `/arquitetura` (ver "Ficou aberto").

## Termos do glossário

- **Desenho**, **Rabisco**, **Ligação** — entraram em `docs/glossario.md` (a sabatina precisou
  separar seta presa de seta solta).

## Ficou aberto

- Um agente geral do projeto ler ou desenhar rabiscos — talvez no futuro, fora desta entrega.
- ADR 0004: a demanda pede rabisco + formas + prints (3 dos 4 gatilhos de reabertura; texto
  livre ficou fora). Leitura provisória: o quadro próprio segue, porque o critério decisivo
  (post-it de sessão vivo) não mudou. Confirmar ou reabrir na `/arquitetura`.
