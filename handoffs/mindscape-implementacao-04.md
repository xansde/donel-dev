# /implementacao — Mindscape, fatia 04

**Fatia**: 04 — Canvas livre: arrastar, mover a visão e post-its do dono
**Data**: 2026-10-24 · **Branch**: `feature/mindscape` (checkout principal) · **taskdex**: [] (ferramenta pessoal, sem card)
**Caminho**: `tdd` (reducers do modelo) + `teste-depois` (tela, por smoke)

## Decisões tomadas no caminho

Todas **decididas por delegação do dono, 2026-10-23** ("Você pode seguir a estrutura atual da esteira, só que vai tomando as decisões"):

- **Sem worktree, no checkout principal, `feature/mindscape`, inline.** É a mesma instrução das fatias 01 a 03.
- **Reducer novo `setBoardPan`**, que o design não listava. O pan precisa ser gravado no `pointerup` e, sem reducer, não teria como entrar no documento. É puro e coberto pelo vitest.
- **O `id` do post-it do dono vem de fora do reducer.** O renderer gera com `crypto.randomUUID()` e passa para `addOwnerCard`. Assim o reducer fica puro e testável. Se o id já estiver em uso, o reducer devolve o mesmo documento.
- **Onde nasce o post-it do dono**: na primeira vaga livre da grade, contada a partir do canto visível do quadro (40 px menos o pan). Desse jeito ele nunca nasce fora da tela depois de mover a visão. O tamanho usado na colisão é o mesmo do post-it escrito pela sessão (230 × 270).
- **Edição inline**: o cartão novo já abre no modo de edição, com o foco no campo. Duplo clique no cartão volta a editar. Sair do campo grava, e Esc ou Ctrl+Enter também. O texto não tem limite de tamanho (o spec não pede).
- **Os botões do cartão do dono (cores e "Arquivar") não tiram o foco do campo** (`preventDefault` no `mousedown`). Bug real que o smoke pegou: o blur trocava o campo pelo texto, o layout mudava entre o `mousedown` e o `mouseup`, e o clique na cor se perdia.
- **Arraste**: a gesto só vira arraste depois de 4 px, para o clique e o duplo clique da fatia 02 seguirem funcionando. Os listeners ficam no `window`, sem pointer capture, porque o capture redirecionaria o `click` para o quadro. De botão, campo de texto e link não sai arraste. Clique no fundo logo depois de um arraste não limpa a seleção.
- **Posição em pixels inteiros** (`Math.round` no deslocamento). Com escala de tela, as coordenadas do ponteiro chegam fracionadas e sujariam o JSON.
- **"Arquivar" reusa o `archiveCard` da fatia 03.**

## O que foi feito

- `src/shared/mindscape/model.ts`: `moveCard`, `setBoardPan`, `addOwnerCard` (com `origin` opcional), `editOwnerCard`, `setOwnerColor` (recusa `permission` e cartão que não é do dono), `OWNER_COLORS` exportado e o tamanho do cartão do dono na colisão.
- `src/renderer/src/Mindscape/MindscapeBoard.tsx` (novo): o plano com `transform: translate(pan)`, arraste de cartão e de fundo por pointer events, posição ao vivo em `requestAnimationFrame`, gravação no `pointerup`. Expõe `data-pan` (para o smoke).
- `MindscapeCard.tsx`: `MindscapeOwnerCard` ("✎ você", canto dobrado, campo inline, seletor Sem cor/Azul/Dourado, "Arquivar") e `data-card-id` nos cartões de sessão e escrito.
- `MindscapeScreen.tsx`: usa o `MindscapeBoard` e ganha o botão "Novo post-it" na barra do quadro. `App.tsx`: os cinco handlers ligados aos reducers. `Mindscape.module.css`: cursor grab/grabbing, cartão do dono e paleta, na forma da variante A.
- Testes: `tests/mindscape-canvas.test.ts` (12 testes), vermelhos antes do código (12 falhas: funções inexistentes). Smoke: `tests/smoke/mindscape-canvas.spec.ts`, que reusa o roteiro `slow-turn.json`.

Nenhuma dependência nova. Nada em `src/main/accounts/`, no Modo Dev nem no `config.json`. Nenhum teste existente alterado.

## Gates (saída observada)

- `npm test` → `Tests  4912 passed (4912)` (210 arquivos), exit 0
- `npm run typecheck` → `> tsc --noEmit -p tsconfig.json`, exit 0, sem erros
- `npm run build` → `✓ built in 4.91s`, exit 0
- Smoke: `npx playwright test -c tests/smoke/playwright.config.ts mindscape tabs-v3 empty-state` → `7 passed (33.9s)`, incluindo os smokes das fatias 01 a 03
- O repo não tem script de lint. É uma lacuna conhecida, e não montei um.

## Plano de testes, item a item

- vitest `moveCard` muda só o x/y do cartão alvo ✔. Cartão ou quadro ausente, mesma posição ou posição não finita devolvem o mesmo documento ✔
- vitest `addOwnerCard` cria com id, `createdAt`, texto vazio e cor `none` ✔. Ids diferentes dão dois cartões, e id repetido devolve o mesmo documento ✔. Nasce sem cobrir a sessão e respeita o `origin` ✔
- vitest `editOwnerCard` troca o texto ✔, e é no-op para o mesmo texto e para cartão que não é do dono ✔
- vitest `setOwnerColor` aceita as 3 cores ✔ e ignora `permission` e cartão que não é do dono ✔
- vitest `parseMindscapeDoc` preserva os cartões do dono e o `pan` numa ida e volta por JSON ✔
- smoke "Novo post-it" → digitar → Dourado: o cartão mostra "✎ você" e o dourado ✔
- smoke: arrastar o post-it do dono e o da sessão leva cada um para outro ponto ✔, e o arraste não abre o terminal ✔
- smoke: arrastar o fundo desloca todos os cartões juntos na tela, e as posições no plano não mudam ✔
- smoke: depois de relançar, posições, pan, texto e cor estão iguais ✔ (a sessão é conferida no arquivo, porque o app nasce sem abas)
- smoke: "Arquivar" faz o cartão sumir, e ele não volta depois de relançar ✔
- Conferi o print do smoke: tem a faixa dourada, o "✎ você" em dourado, o canto dobrado e as 3 bolinhas, na forma da variante A.

## Dados necessários (seed)

Não há banco. O spec monta um root temporário com `atlas/CLAUDE.md`, um `config.json` com `projectRoots` e o `DONEL_MINDSCAPE_FILE` temporário.

## Pendências e lacunas

- Não rodei a suíte smoke inteira nem o `npm run test:smoke:dev`, só os specs acima.
- Não validei com o CLI real (`@real`).
- O repo não tem lint.
- Notas fora do escopo, candidatas a fatia:
  - o tamanho do cartão do dono na colisão (230 × 270) é maior que o real (cerca de 115 px de altura), o que deixa folga na grade;
  - o arraste não sobe o cartão para cima dos outros (não há z-index por cartão);
  - um cartão arrastado fica selecionado, porque o clique depois do arraste cai nele.
- Próxima etapa: a fatia 05 (ligações), que depende só desta. Ou a `/revisao`.
