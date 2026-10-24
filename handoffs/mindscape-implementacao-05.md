# /implementacao — Mindscape, fatia 05

**Fatia**: 05 — Ligações com seta, em traço à mão
**Data**: 2026-10-24 · **Branch**: `feature/mindscape` (checkout principal) · **taskdex**: [] (ferramenta pessoal, sem card)
**Caminho**: `tdd` (reducers do modelo + `roughShapes`) + `teste-depois` (tela, por smoke)

## Decisões tomadas no caminho

Todas **decididas por delegação do dono, 2026-10-23** ("Você pode seguir a estrutura atual da esteira, só que vai tomando as decisões"):

- **Sem worktree, no checkout principal, `feature/mindscape`, inline.** Mesma instrução das fatias 01 a 04.
- **Dependência `roughjs@4.6.6` instalada com `--save-exact`.** Foi decidida no design doc e no ADR 0004. Nenhuma outra dependência entrou.
- **Ligação nova nasce com a seta ligada.** O plano de testes pede "aparece a ligação com seta".
- **`addLink` também recusa id já em uso e par já ligado, nos dois sentidos.** É a opção mais simples para não haver duas linhas sobrepostas entre os mesmos cartões.
- **O `id` da ligação vem de fora do reducer** (`crypto.randomUUID()` no renderer). Mesmo padrão do post-it do dono.
- **Função pura nova, `visibleLinks`**, que o design não listava. Ela devolve só as ligações com as duas pontas na tela. O cartão de sessão sem aba aberta fica fora dessa conta, então a ligação continua guardada e volta a ser desenhada quando a sessão reabre.
- **A linha liga os centros e é cortada na borda de cada cartão** (`linkEndpoints`). Assim a ponta da seta fica na borda do destino. Cartões sobrepostos não desenham linha. O tamanho de cada cartão é medido no DOM (`useCardSizes`, só re-renderiza quando um tamanho muda).
- **Modo "Ligar"**: um clique escolhe a origem, outro escolhe o destino, e o modo fecha depois de criar a ligação. Esc ou um novo clique em "Ligar" cancelam. Nesse modo, o clique no cartão não seleciona nem abre o terminal.
- **Ações da ligação selecionada ficam na barra do quadro**: "Seta" (`aria-pressed`) e "Remover ligação". Para selecionar, basta clicar na linha, que tem uma faixa de clique invisível de 14 px. Clique no fundo limpa a seleção.
- **Contorno à mão**: fica numa camada SVG por cima dos cartões, transparente ao ponteiro. O cartão de sessão perdeu a borda lateral CSS (agora transparente) para não ficar com contorno duplo. A faixa de cor do topo continua.
- **O traço não treme**: o `seed` vem de um hash FNV-1a do id, e o `d` fica em cache por id e geometria, arredondada a 0,1 px.

## O que foi feito

- `src/shared/mindscape/model.ts`: `addLink`, `toggleLinkArrow`, `removeLink` e `visibleLinks`. O `archiveCard` já removia as ligações do cartão desde a 03.
- `src/renderer/src/Mindscape/roughShapes.ts` (novo): `linkEndpoints`, `linkPath` (linha + ponta da seta), `cardOutlinePath` e `clearRoughCache`.
- `src/renderer/src/Mindscape/MindscapeLinks.tsx` (novo): `useCardSizes`, `MindscapeLinkLayer` (SVG por baixo dos cartões) e `MindscapeOutlineLayer` (SVG por cima).
- `MindscapeScreen.tsx`: modo "Ligar", ligação selecionada, botões "Seta" e "Remover ligação", e as duas camadas. `App.tsx`: três handlers ligados aos reducers. `Mindscape.module.css`: estilos de ligação, contorno, cursor do modo e botão pressionado.
- `package.json` / `package-lock.json`: `roughjs` `4.6.6`.
- Testes: `tests/mindscape-links.test.ts` (15 testes). Estavam vermelhos antes do código porque o módulo e as funções não existiam. Smoke: `tests/smoke/mindscape-links.spec.ts`.

Nada mudou em `src/main/accounts/`, no Modo Dev nem no `config.json`. Nenhum teste existente foi alterado.

## Gates (saída observada)

- `npm test` → `Tests  4928 passed (4928)` (211 arquivos), exit 0
- `npm run typecheck` → `> tsc --noEmit -p tsconfig.json`, exit 0
- `npm run build` → `✓ built in 4.83s`, exit 0
- Smoke: `npx playwright test -c tests/smoke/playwright.config.ts mindscape tabs-v3 empty-state` → `8 passed (48.7s)`, incluindo os smokes das fatias 01 a 04
- `npm ls roughjs` → `roughjs@4.6.6`
- O repo não tem script de lint. É lacuna conhecida, e não montei um.

## Plano de testes, item a item

- vitest `addLink` recusa ligação de um cartão para ele mesmo ✔ e entre cartões que não estão no quadro ✔ (e quadro ausente, id repetido, par repetido nos dois sentidos ✔)
- vitest `toggleLinkArrow` inverte `arrow`, ida e volta ✔. Ligação ausente devolve o mesmo documento ✔
- vitest `removeLink` remove só a ligação alvo ✔
- vitest `archiveCard` remove as ligações do cartão e mantém as outras ✔
- vitest `roughShapes` devolve o mesmo `d` para o mesmo id e geometria, também com o cache limpo ✔. Outro id dá outro traço ✔, e seta desligada não tem ponta ✔
- smoke: modo "Ligar" → clicar no post-it do dono e no da sessão → aparece a ligação com seta ✔ (`data-arrow`, ponta no DOM, gravada no arquivo)
- smoke: desligar a seta → a ponta some ✔ (no DOM e no arquivo)
- smoke: mover um cartão → a ligação acompanha ✔ (o `d` muda). Parada, o `d` não muda ✔
- smoke: fechar a aba da sessão → a ligação some da tela ✔ e continua no arquivo ✔. **"Volta ao reabrir a sessão" não foi provado por smoke**, porque reabrir a mesma sessão exige retomá-la pelas "Sessões anteriores", e o indexador lê o `~/.claude` real. Esse caso está coberto pelo vitest de `visibleLinks` (a mesma ligação volta quando o cartão da sessão volta a ficar visível).
- smoke: remover → some ✔ e não volta ao relançar o app ✔
- `npm ls roughjs` mostra 4.6.6 ✔
- Conferi o print do smoke (`mindscape-links.png`): o contorno à mão aparece nos dois cartões e a ligação selecionada fica em azul, com a seta desligada.

## Dados necessários (seed)

Não há banco. O spec monta um root temporário com `atlas/CLAUDE.md`, um `config.json` com `projectRoots` e o `DONEL_MINDSCAPE_FILE` temporário. Usa o roteiro `slow-turn.json` da fatia 04.

## Pendências e lacunas

- Instabilidade vista uma vez: na primeira rodada do smoke, o segundo post-it do dono não apareceu depois de relançar o app. Não se repetiu em 4 rodadas seguidas. O smoke agora espera o arquivo ter os dois post-its antes de relançar, e mesmo assim não reproduziu. Suspeita, não confirmada: uma gravação com debounce que se perde quando o app fecha (comportamento da fatia 01). Vale olhar na `/revisao`.
- Não rodei a suíte smoke inteira, nem `npm run test:smoke:dev`, nem com o CLI real (`@real`).
- Sem lint no repo.
- Notas fora do escopo, candidatas a fatia:
  - o contorno à mão passa por cima do canto dobrado do post-it do dono;
  - ligar não funciona pelo teclado.
- Próxima etapa: `/revisao` da `feature/mindscape` (as fatias 01 a 05 estão implementadas).
