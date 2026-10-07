# Roteiro E2E — 002 Quota headroom (validação do Alexandre)

> **SUPERSEDED (2026-08-04, C32 — 011-contas-e-provedores, etapa 2).** O
> mecanismo de perfis (`~/.claude-profiles`, `CLAUDE_CONFIG_DIR` por perfil,
> dropdown `ProfileSwitcher`) descrito abaixo foi DEMOLIDO na etapa 2 da 011
> (T1222/T1225): o único caminho de conta hoje é o motor
> (`src/main/accounts/`), documentado em `specs/011-contas-e-provedores/`.
> Marcação apenas — nada abaixo foi apagado ou reescrito (mesma regra do
> `backlog.md`, itens riscados com nota, nunca deletados).


**Build:** `release/Donel Dev-Setup-0.1.0.exe` (gerado em 2026-07-24, HEAD
`c1425e8` na `feature/mvp-p0`). Instalação é ato humano — o NSIS não é
one-click (pede pasta). Fechar o Donel Dev antigo antes de instalar.

**O que esta entrega mudou:** Fatia 0 (destravar o número) já estava validada;
o que entra agora é o **modelo das duas janelas** (invisível) + a **UI do
dropdown**. Cada passo abaixo aponta o critério de aceite que ele prova.

**Cobertura automatizada já verde** (não precisa refazer à mão): typecheck,
322 testes unit e 3 smokes (`tests/smoke/profile-quota.spec.ts`) cobrindo
5h+semana rotuladas, chevron sem ativar a conta e botão "Atualizar". O roteiro
abaixo foca no que só o olho humano julga: legibilidade, hierarquia visual e os
casos que dependem de conta real.

---

## 1. Badge do titlebar rotula a janela (CA-4)

1. Abrir o app.
2. Olhar o badge da conta no titlebar.

**Esperado:** o número vem rotulado — `Tecnologia Claude N · 5h 95%` (ou
`Principal · 5h 95%`), **não** um `%` solto e ambíguo. Sem leitura disponível,
mostra `· —` (nunca `5h —`).

## 2. Dropdown: 5h como primária, semana como resumo (CA-1, CA-2)

1. Clicar no badge para abrir "Perfis de conta".
2. Observar cada linha de perfil **sem clicar em nada**.

**Esperado por perfil:**
- **5h primária:** barra horizontal colorida por tier (verde >40% / dourado
  15–40% / vermelho <15%), com `5h`, o **% LIVRE** e o reset.
- **Semana logo abaixo, em TEXTO, sem barra própria:** `semana X% livre ·
  reset DD/MM`.
- Enquanto a primeira leitura não volta: **"carregando…"**, nunca `—`.

**O que reprovaria:** `—` aparecendo antes de qualquer resposta; a semana com
barra competindo com a 5h; ficar ambíguo se o % é usado ou livre.

> Reset é `HH:mm` quando for no mesmo dia e `DD/MM` em dia diferente. Se o
> `quota-axi` não informar reset, o trecho é **omitido** — não é bug ver uma
> janela sem reset.

## 3. Fable só na expansão, sem sequestrar a seleção (CA-2b) — **o ponto mais importante**

1. Com o dropdown aberto, clicar **no chevron** de uma linha.
2. Depois clicar **no corpo** de outra linha (no nome/badge, longe do chevron).

**Esperado:**
- Chevron → revela `fable X% livre` **e NÃO troca a conta ativa** (o check não
  se move).
- Corpo da linha → **ativa a conta** (o check move) e **não expande** nada.

**O que reprovaria:** clicar no chevron trocar sua conta ativa, ou o clique de
selecionar ficar difícil/duplo por causa da expansão. O gesto primário é
selecionar; ele tem de continuar fácil.

## 4. Botão "Atualizar" (US-C / CA-3)

1. No topo do dropdown, clicar "Atualizar".

**Esperado:** relê **ignorando o cache de 60s** — desabilita e mostra
"Atualizando…" durante a leitura, e os números voltam (podem vir iguais, o que
prova só que releu). Com vários perfis pode levar alguns segundos; o loading
cobre isso.

## 5. Lista enxuta + erro como ícone (CA-7)

1. Olhar a lista de perfis saudáveis.

**Esperado:** **nenhuma** linha mostra "Perfil OK" — perfil saudável é linha
limpa, sem texto de status. Foi isso que liberou a altura das duas janelas.

**Para ver o estado de erro** (opcional — só se quiser conferir o tooltip),
remova UMA junction de um perfil de teste. `rmdir` num reparse point do Windows
remove **só o link, nunca o alvo** (confirmado empiricamente no smoke do T014),
mas faça isso num perfil que você não se importe:

```powershell
rmdir "$env:USERPROFILE\.claude-profiles\<slug-de-teste>\skills"
```

Reabra o dropdown. **Esperado:** ícone de alerta na linha, o texto do problema
aparece no **hover** (tooltip), e o botão **"Recriar links" fica VISÍVEL na
linha** — nunca escondido dentro do tooltip. Clicar nele recria a junction e o
ícone desaparece.

## 6. Statusbar por aba (CA-4)

1. Abrir uma sessão claude e olhar o rodapé.
2. Abrir uma aba de terminal livre e olhar de novo.

**Esperado:** sessão claude → `Sessão: <nome da conta> · 5h X%` (a cota é a do
perfil de **nascimento** da aba, não a do perfil ativo global). Terminal livre
→ `Terminal (sem conta)`.

## 7. Perfil sem login reflete rápido depois do `/login` (CA-5) — **regra de cache**

1. Num perfil **sem login**, confirmar que o dropdown mostra `—` / "login
   pendente" (isso é legítimo, não bug).
2. Ativar esse perfil, abrir uma sessão e fazer `/login` no terminal.
3. Reabrir o dropdown (ou clicar "Atualizar").

**Esperado:** o número aparece **sem precisar esperar o TTL de 60s expirar** —
leitura `unavailable` nunca é cacheada, só `ok` respeita o TTL. Essa foi a
decisão de 24/07.

**O que reprovaria:** continuar `—` por até um minuto depois de um login feito.

---

## Fora de escopo (não reprovar por isso)

- Painel/tela dedicada de cotas com histórico e ordenação → B8/US-12.
- Outras janelas `model:*` além do Fable → US-12.
- Auto-seleção de perfil por headroom → outra entrega.
- Semana em 0% livre é **número real**, não bug de exibição (a janela semanal
  da conta ativa já apareceu zerada numa medição legítima).

## Dívida conhecida (medida, NÃO é regressão desta entrega)

- 2 smokes de `previous-sessions.spec.ts` (T013 resume/fork) — feature de
  restauração de sessões, código disjunto.
- 3 smokes (`profiles.spec.ts:83`, `model-injection.spec.ts:48`,
  `terminal.spec.ts:281`) falham por **drift do CLI `claude` v2.1.219**
  instalado na máquina — **provado** rodando a suíte no commit pré-entrega
  `7d1bbf9`, onde já falhavam. Candidato a item de backlog.
- `tabs-lifecycle.spec.ts:174` é flake de contenção (passa isolado).
