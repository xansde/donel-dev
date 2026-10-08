# Fixtures de tela do chat (014, T034)

Capturas do buffer renderizado do `claude` 2.1.293 para os testes dos detectores
de tela (`src/shared/cliInputBox.ts`, `trustDialog.ts`, `chat/screen.ts`).

## Formato

```json
{ "name": "...", "description": "...", "source": "real|synthetic", "origin": "...",
  "layout": "fullscreen|inline", "cols": 120, "rows": 40,
  "lines": [ { "text": "...", "dim": [[2,34]] } ] }
```

- `lines[i].text`: a linha como `IBufferLine.translateToString(true)` devolve (sem espaços à direita).
- `lines[i].dim`: máscara *dim* = lista de intervalos `[início, fim)` **em índices da string `text`**
  (UTF-16, não colunas). Equivale a runs consecutivas de células com `IBufferCell.isDim()`; o T039 monta
  `text` e `dim` juntos ao percorrer as células da linha. `[]` = nenhuma célula dim.
- `layout`: `fullscreen` = buffer alternativo (`tui: fullscreen`); `inline` = buffer normal.

## Origem do texto e da máscara

- Os logs de `specs/014-chat/spike/b2/logs/*.txt` guardam **só o texto** das telas, sem atributos. Por isso a
  máscara *dim* de **todas** as fixtures foi anotada à mão, a partir do que a research (R6, R8) documenta como
  *dim*: placeholder (`Try "..."`, `Press up to edit queued messages`), sugestão fantasma e as linhas de rodapé
  abaixo da régua inferior da caixa.
- `source: real` = texto copiado de uma captura real. `source: synthetic` = construído a partir de uma captura
  real alterando linhas, ou inferido do texto do CLI 2.1.293 descrito na research (sugestão fantasma, caixa de
  15 linhas, `[Image #N]`, menu `@` com sugestões, "external imports", tela Help, banner sem caixa, ocioso
  com texto digitado durante o trabalho).

## Catálogo

| Fixture | Layout | Origem | Descrição |
|---|---|---|---|
| `boot-banner-only` | fullscreen | synthetic | Boot: banner pintado, REPL ainda sem caixa de entrada (stdin não armado). |
| `boot-repl-armed-inline` | inline | real | Boot: REPL armado, layout inline, placeholder dim. |
| `boot-trust-dialog-after-down` | inline | real | Boot: confiança após seta para baixo (cursor em Yes). |
| `boot-trust-dialog` | inline | real | Boot: diálogo de confiança 2.1.293 (default No, exit). |
| `box-15-lines` | fullscreen | synthetic | Caixa com 15 linhas (limite alto da caixa). |
| `box-image-placeholder` | fullscreen | synthetic | Marcador [Image #N] na caixa, antes do texto. |
| `box-long-wrapped` | fullscreen | real | Texto longo quebrado em 2 linhas pela largura (wrap). |
| `box-multiline-3` | fullscreen | real | Caixa com 3 linhas coladas (LF). |
| `box-pasted-text-placeholder` | fullscreen | real | Marcador [Pasted text #N +M lines] na caixa. |
| `box-shell-placeholder` | fullscreen | real | Modo shell (!) com placeholder dim. |
| `box-shell-typed` | fullscreen | real | Caixa em modo shell (!): "! echo spike", rodapé "! for shell mode". |
| `dialog-external-imports` | inline | synthetic | Confiança: "external imports" do CLAUDE.md (texto inferido do CLI). |
| `dialog-model` | fullscreen | real | Diálogo "Select model" (sem caixa de entrada). |
| `dialog-permission-inline` | inline | real | Permissão de ferramenta (Create file), layout inline. |
| `dialog-plan` | fullscreen | real | ExitPlanMode: "Exit plan mode?" com opções. |
| `dialog-question` | fullscreen | real | AskUserQuestion: opções numeradas, "Enter to select · ↑/↓ to navigate". |
| `idle-empty-placeholder` | fullscreen | real | Ocioso, caixa com placeholder dim (Try "..."). |
| `idle-empty` | fullscreen | real | Ocioso, caixa vazia, rodapé com "? for shortcuts". |
| `idle-ghost-suggestion` | fullscreen | synthetic | Ocioso com sugestão fantasma (prompt suggestion) dim na caixa. |
| `idle-typed` | fullscreen | real | Ocioso com texto digitado (rodapé sem "? for shortcuts"). |
| `interrupted` | fullscreen | real | Rodada interrompida: "Interrupted · What should Claude do instead?" e CLI ocioso. |
| `menu-at-no-match` | fullscreen | real | Texto "@notes/al" sem sugestões (menu não aparece). |
| `menu-at-open` | fullscreen | synthetic | Menu "@" aberto (sugestões de arquivo acima da régua). Forma inferida. |
| `menu-shortcuts-help` | fullscreen | real | Painel de atalhos (?) aberto sob a caixa. |
| `menu-slash-args-closed` | fullscreen | real | Comando com argumento: menu fechado, texto intacto. |
| `menu-slash-only` | fullscreen | real | Menu "/" aberto, só a barra digitada. |
| `menu-slash-open` | fullscreen | real | Menu "/" aberto com 2 comandos (box "/spike-help"). |
| `msg-ctrl-c-again` | fullscreen | real | "Press Ctrl-C again to exit" no rodapé. |
| `msg-esc-again` | fullscreen | real | "Esc again to clear" com texto na caixa. |
| `msg-transcript-saving-off` | fullscreen | real | "Transcript saving is off" acima do rodapé. |
| `msg-unknown-command` | fullscreen | real | "Unknown command: /zzzunknown" no transcript. |
| `screen-add-directory-to-workspace` | fullscreen | real | Tela sem caixa de entrada: "Add directory to workspace". |
| `screen-background` | fullscreen | real | Tela sem caixa de entrada: "Background". |
| `screen-effort` | fullscreen | real | Tela sem caixa de entrada: "Effort". |
| `screen-export-conversation` | fullscreen | real | Tela sem caixa de entrada: "Export conversation". |
| `screen-help` | fullscreen | synthetic | Tela "Help" (forma inferida: barra ▔ + título). |
| `screen-hooks` | fullscreen | real | Tela sem caixa de entrada: "Hooks". |
| `screen-manage-mcp-servers` | fullscreen | real | Tela sem caixa de entrada: "Manage MCP servers". |
| `screen-memory` | fullscreen | real | Tela sem caixa de entrada: "Memory". |
| `screen-permissions` | fullscreen | real | Tela sem caixa de entrada: "Permissions". |
| `screen-plugins` | fullscreen | real | Tela sem caixa de entrada: "Plugins". |
| `screen-resume-session` | fullscreen | real | Tela sem caixa de entrada: "Resume session". |
| `screen-rewind` | fullscreen | real | Tela sem caixa de entrada: "Rewind". |
| `screen-settings` | fullscreen | real | Tela sem caixa de entrada: "Settings". |
| `screen-skills` | fullscreen | real | Tela sem caixa de entrada: "Skills". |
| `screen-status` | fullscreen | real | Tela com abas Settings/Status/Config/Usage/Stats (/status). |
| `screen-theme` | fullscreen | real | Tela sem caixa de entrada: "Theme". |
| `screen-usage` | fullscreen | real | Mesmas abas (/usage). |
| `working-queued-one` | fullscreen | real | Trabalhando com 1 mensagem na fila (placeholder dim "Press up to edit queued messages"). |
| `working-queued-two` | fullscreen | real | Trabalhando com 2 mensagens na fila. |
| `working-typed` | fullscreen | synthetic | Trabalhando com texto real digitado na caixa. |
| `working` | fullscreen | real | Trabalhando: spinner, "esc to interrupt", caixa vazia. |
