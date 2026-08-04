# Captura visual da etapa 1 — o que os prints pegaram

04/08/2026, sobre a branch `esteira/contas-e-provedores` (commits `38042e9`,
`eccf49a`, `b722f53`). Dois roteiros, 17 prints:
`.claude/skills/tutorial-e2e/roteiros/contas-motor-{inerte,ativo}.spec.ts`.

Cobre as seções **1** e **7** do `e2e.md` de verdade (motor inerte, perfis
intactos) e fotografa os estados do **motor ativo** com o mod falso. O que
continua sendo bateria manual: as seções **2**, **3**, **4**, **5** e **6** —
tudo que depende de credencial real, de rede real ou de uma máquina sem
`safeStorage`.

**Contexto que importa:** a fase Validar passou este mesmo código com 1699
testes verdes, `/code-review` e `/verify`. Os três achados abaixo estavam lá o
tempo todo.

---

## Iteração 1 — o roteiro do motor inerte

**O que tentei:** fotografar o painel recém-aberto.
**O que quebrou:** o print 3 pegou o modal a meio caminho da transição de
entrada — translúcido, com "Nenhuma sessão aberta" do fundo atravessando a
linha do seletor de provedor. O app estava certo; a foto, não.
**O que mudei:** `assentar(win)` depois de todo `waitFor()` de modal. É o erro
conhecido **5c** desta casa (anel medido no meio da animação) na variante
opacidade — o mesmo relógio, outro sintoma.

## Iteração 2 — o achado que quase custou a sessão

**O que tentei:** escrever o roteiro do motor ativo, que precisa trocar de
conta de verdade para fotografar o estado "· ativa".
**O que quebrou:** ao ler a fiação para saber o que isolar, apareceu isto em
`main/index.ts`:

```ts
const claudeHome = appConfig.accounts.claudeHome ?? claudeHomeDir(profilePathDeps);
applyAccountSwitch({ claudeHome, claudeJsonPath: globalClaudeJsonPath(profilePathDeps), … })
```

O override `accounts.claudeHome` movia o **primeiro** alvo da escrita. O
segundo — o `~/.claude.json` de onde o switch apaga o bloco `oauthAccount` —
saía direto de `homedir()`, sempre. Metade do alvo isolada, metade não.

Consequência: **`npm run test:smoke` derrubava o login do CLI da máquina.** Os
três smokes da etapa 1 isolavam só o `claudeHome`; ao rodar, apagavam o
`oauthAccount` do `~/.claude.json` real — e ainda falhavam a asserção, que
esperava o efeito no arquivo de teste. Eles nunca tinham sido rodados (a fase
Implementar os escreveu sem executar; `npm test` é vitest e não os inclui),
então ninguém tinha visto.

Confirmado na prática, e não por leitura: rodados contra o build ainda não
corrigido, 2 dos 4 falharam **e** o `oauthAccount` real sumiu (restaurado de
backup no mesmo minuto). Depois da correção, os 4 passam e o arquivo real fica
intacto.

**O que mudei:** o `.claude.json` passou a acompanhar o override — é sempre o
irmão do `claudeHome`. Em produção `dirname(~/.claude)` é o próprio `~`, então
o caminho real não muda em nada; com override, os dois alvos andam juntos.

> **A regra que sai daqui:** um override de isolamento que cobre parte do alvo
> é pior que nenhum — ele **promete** proteção e entrega meia. Quando um teste
> aponta para fora do sandbox, o estrago é na máquina de quem roda, e o verde
> da suíte não tem como avisar.

## Iteração 3 — o erro que sobrevive ao formulário

**O que tentei:** fotografar o estado ruim de propósito (clicar em "Conectar"
sem preencher) e depois o formulário do outro provedor.
**O que quebrou:** print 8 — "Dados incompletos — confira os campos.", em
vermelho, dentro do formulário do **Pool Seazone**, que ninguém tinha
submetido. A recusa era do formulário do Pool próprio e sobreviveu à troca de
provedor, descrevendo campos que nem estavam mais na tela.
**O que mudei:** toda edição do formulário passa por `editarForm`, que invalida
a recusa anterior. É o erro conhecido **#7** ("veredito que sobrevive ao texto
que o motivou") reaparecendo em tela nova — desta vez, prevenido na função em
vez de na frase.

## Iteração 4 — a garantia que a própria etapa 1 tornou falsa

**O que tentei:** fotografar a regressão dos perfis (seção 7 do `e2e.md`).
**O que quebrou:** print 10, no rodapé do painel de perfis:

> "O login sempre acontece dentro do terminal (`/login`); **o app nunca lê nem
> grava credenciais**."

A frase é verdadeira sobre perfis e **falsa sobre o app** desde esta etapa: o
botão vizinho, a três centímetros no mesmo titlebar, abre um formulário que
pede access token e refresh token e os guarda no cofre. O `CLAUDE.md` do repo
já registra a exceção; a tela não tinha sido avisada.
**O que mudei:** a frase passou a falar do que aquela tela conhece — "perfil
nenhum lê ou grava credencial".

> **A regra que sai daqui:** afirmação sobre *o app inteiro* feita de dentro de
> uma tela que só conhece uma parte dele envelhece na primeira feature que
> mexer no resto. Quem escreve a garantia não é quem vai quebrá-la.

---

## Erros que se repetiram

| # | Erro | Onde já tinha acontecido | Correção estrutural |
|---|---|---|---|
| 5c | Foto tirada durante a transição | captura do B6 (carrossel) | `assentar()` depois de todo `waitFor` de modal |
| 7 | Veredito que sobrevive ao texto que o motivou | seed do Modo Dev (`seedIssues`) | `editarForm` invalida a recusa em toda edição |
| 1 | Frase de estado que diverge do estado real | quatro vezes na spec 010 | a frase passou a descrever só o que a tela conhece |

O padrão acima dos padrões continua valendo, e ganhou um caso mais caro: **os
três achados atravessaram 1699 testes verdes, um code-review e um verify.** O
segundo deles não era só uma frase errada — era um teste que danificava a
máquina de quem o rodasse, e que ninguém tinha rodado.
