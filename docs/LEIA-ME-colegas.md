# Donel Dev — instalação

<!-- Este arquivo é o TEMPLATE do LEIA-ME.md que vai para a pasta compartilhada.
     `scripts/publicar.ps1` copia-o trocando {{VERSAO}}, {{DATA}}, {{TAMANHO}} e
     {{SHA256}} pelos valores do build. Edite AQUI, nunca no arquivo publicado —
     o próximo `npm run publicar` sobrescreve o de lá. -->

**Versão {{VERSAO}}** · publicada em {{DATA}} · `Donel-Dev-Setup.exe` ({{TAMANHO}})

Uma IDE para trabalhar com **várias sessões do Claude Code em paralelo**: cada aba
é uma sessão real do CLI, com os projetos, as sessões anteriores (retomar ou
forkar), o seletor de modelo/esforço/permissões e o semáforo que mostra quais
sessões estão esperando você.

O app **não substitui o Claude Code** — ele roda o `claude` de verdade por
dentro. Seus hooks, skills, MCPs e comandos continuam funcionando exatamente
como no terminal.

---

## Antes de instalar: você precisa do Claude Code

O app embeda o CLI, não o inclui. Então é preciso ter o **Claude Code instalado e
logado** na máquina — o mesmo `claude` que você usa no terminal.

Confira num PowerShell:

```powershell
claude --version
```

Se responder com um número, está pronto. Se der "não reconhecido", instale o
Claude Code primeiro (https://claude.com/claude-code) e faça `claude` →
`/login` uma vez no terminal.

> O Donel Dev **nunca toca nas suas credenciais**: o `/login` é sempre um ato
> seu, no terminal. Ele também não manda nada para lugar nenhum — suas sessões
> continuam vivendo no seu próprio `~/.claude`, na sua máquina.

Requisitos: **Windows 11 x64**. Se o `claude` não for encontrado, o app abre
normalmente e mostra um aviso "⚠ Claude Code não encontrado" no lugar do
terminal — não trava.

---

## Instalar

1. Baixe o **`Donel-Dev-Setup.exe`** desta pasta.
2. Execute. **O Windows vai reclamar** — veja o quadro abaixo.
3. Siga o instalador (pode escolher a pasta). **Não precisa de admin**: a
   instalação é só para o seu usuário, em `%LOCALAPPDATA%\Programs\Donel Dev`.
4. Atalho na área de trabalho e no menu Iniciar: **Donel Dev**.

### O aviso azul do Windows é esperado

Vai aparecer **"O Windows protegeu o seu PC"**. Clique em **Mais informações** →
**Executar assim mesmo**.

Motivo, sem rodeios: o instalador **não tem certificado de assinatura digital**
(é uma ferramenta interna, feita em casa, e certificado de code signing custa
caro). Sem assinatura, o SmartScreen avisa sobre qualquer executável novo —
não é um sinal de que há algo errado com o arquivo. Se quiser conferir que o
arquivo é o mesmo que foi publicado, compare o hash:

```powershell
Get-FileHash "$env:USERPROFILE\Downloads\Donel-Dev-Setup.exe" -Algorithm SHA256
```

Deve bater com: `{{SHA256}}`

Se o antivírus corporativo colocar em quarentena, fale com o Alexandre antes de
tentar contornar.

---

## Primeiro uso — comece configurando suas pastas

Na primeira abertura a sidebar provavelmente vai estar **vazia**, dizendo que não
achou projeto em `~/seazone` ou `~/pessoal`. Isso é esperado: esses são os
caminhos padrão da máquina de quem construiu o app, e quase certamente não são os
seus. **Troque pelos seus** — leva 30 segundos:

1. Clique na **engrenagem** (canto da janela) → **Preferências**.
2. Em **"Pastas-raiz de projetos"**, remova as que não existem (ícone de lixeira)
   e **digite o caminho** da sua pasta de código — ex. `C:\Users\voce\dev` — e
   clique **Adicionar**. O campo é de texto: cole o caminho do Explorer.
3. A sidebar recarrega na hora. O app procura projetos **até 2 níveis** dentro de
   cada pasta-raiz, reconhecendo o que tem `.git/` ou `CLAUDE.md`.

Depois disso:

- Abra uma aba escolhendo **modelo**, **esforço** e **modo de permissões** antes
  de subir a sessão.
- Renomeie as abas (duplo-clique ou **F2**) — ou use `/rename` dentro da sessão,
  que o app acompanha sozinho.
- O **semáforo** de cada sessão mostra quem está trabalhando, quem terminou e
  quem está esperando você; quem pede permissão sobe para o topo.

### Suas contas são suas

O app **não vem com conta nenhuma configurada** — não há como: o instalador
carrega só o programa, e a lista de contas é montada lendo a **sua** máquina
(`~/.claude` e `~/.claude-profiles`) a cada abertura. Você começa com um único
perfil, **Principal**, que é o seu `~/.claude` de sempre — a mesma conta que já
usa no terminal. Se quiser mais de uma conta na mesma máquina, o app cria perfis
isolados por `CLAUDE_CONFIG_DIR`; o `/login` de cada um continua sendo ato seu,
no terminal.

---

## Como atualizar

**Sempre o mesmo link desta pasta.** Baixe o `Donel-Dev-Setup.exe` de novo e
execute — ele substitui a instalação anterior no lugar. Não precisa
desinstalar nada, e suas configurações (projetos, perfis, nomes de sessão)
continuam onde estavam.

O app **não se atualiza sozinho** ainda. Quando sair versão nova, o Alexandre
avisa.

---

## Limitações conhecidas nesta versão

- **`Ctrl+C` no terminal interrompe a execução** em vez de copiar (é o
  comportamento do terminal, não um bug do app). Para copiar, use
  **`Ctrl+Shift+C`**. Correção já planejada.
- **Sem atualização automática** — veja a seção acima.
- Ícone ainda é o padrão do Electron.

## Achou algo estranho?

Fale com o **Alexandre** com: o que você fez, o que esperava e o que aconteceu.
Print ajuda. Não abra issue em lugar nenhum — o projeto ainda é interno e o
canal é ele.
