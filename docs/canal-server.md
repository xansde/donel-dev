# Donel Dev Server (branch `server`)

Pedido do dono (18/11): "Quero que mude o nome do app. Não seja mais o alfa. Seja outro nome, algo como donel dev
server" e "quando eu digo de mudar o nome do app, é que eu quero em outra branch".

A branch `server` do `xansde/donel-dev` é **duradoura** e nasce da `staging`. Nela o app se chama **Donel Dev
Server** e instala **ao lado** do Donel Dev Alfa, sem que um sobrescreva ou atualize o outro. A `staging` e o canal
alfa não mudam.

## O que separa os dois

| | Alfa (`staging`) | Server (`server`) |
|---|---|---|
| Nome visível, atalho, exe | Donel Dev Alfa | Donel Dev Server |
| appId (instalação, registro de desinstalar, notificações) | `com.seazone.doneldev.alfa` | `com.seazone.doneldev.server` |
| Pasta de dados (`app.setName`) | `%APPDATA%\donel-dev` | `%APPDATA%\donel-dev-server` |
| Cache do atualizador | `%LOCALAPPDATA%\donel-dev-updater` | `%LOCALAPPDATA%\donel-dev-server-updater` |
| Pasta de instalação | `%LOCALAPPDATA%\Programs\Donel Dev Alfa` | `%LOCALAPPDATA%\Programs\Donel Dev Server` |
| Instalador | `DonelDevAlfa-Setup-<versão>.exe` | `DonelDevServer-Setup-<versão>.exe` |
| Release no GitHub | tag `alfa-*`, marcada **Latest** | tag `server-*`, marcada **pre-release**, nunca Latest |
| Onde procura versão nova | a release Latest (`/releases/latest`) | a pre-release mais nova, e só aceita instalador `DonelDevServer-Setup-*` |

Os valores moram em `src/shared/appIdentity.ts` e em `electron-builder.yml`; `tests/server-identidade.test.ts`
guarda a sincronia entre os dois.

**Regra do repositório:** pre-release no `xansde/donel-dev` é só do Server. O Alfa lê só a Latest (o GitHub nunca
devolve pre-release ali); o Server lê a pre-release mais nova e recusa, como "sem versão nova", qualquer release cujo
instalador não seja do Server.

## Manter a branch em dia

Mescle a `staging` na `server` (nunca rebase): numa worktree da `server`, `git merge origin/staging`. Os conflitos,
quando houver, ficam nas poucas linhas que dizem a identidade (`electron-builder.yml`, `src/renderer/index.html`,
`app.setName`/`setAppUserModelId` e o atualizador em `src/main/index.ts`): mantenha o lado do Server. Rode o
`npm run verify` antes de empurrar.

## Gerar e publicar o Server na VPS

O mesmo caminho do alfa (skill `alfa-na-vps`), com estas diferenças: worktree de `origin/server`, o
`electron-builder` sem os `--config.appId/productName/shortcutName/artifactName` do alfa (o `electron-builder.yml`
da branch já é o do Server) e a release como pre-release, sem `--latest`:

```bash
npx electron-builder --win nsis --config.npmRebuild=false --config.extraMetadata.version=$V \
  --config.publish.provider=github --config.publish.owner=xansde --config.publish.repo=donel-dev \
  --config.publish.private=true --publish never
gh release create server-$V release/DonelDevServer-Setup-$V.exe release/DonelDevServer-Setup-$V.exe.blockmap \
  release/latest.yml --repo xansde/donel-dev --target "$C" --title "Server $V" --notes "server $C" \
  --prerelease --latest=false
```

Prova de que o alfa não mudou: `gh api repos/xansde/donel-dev/releases/latest --jq .tag_name` segue dando a última
`alfa-*`.

## Levar configuração do Alfa para o Server

As pastas de dados são separadas de propósito e nada é compartilhado: o Server abre limpo, sem projetos, contas nem
VPS. **Não copie o `config.json` inteiro** do Alfa. Ele traz a lista de contas e os lugares remotos (`accounts`),
e com eles o Server passa a mexer nas mesmas contas e nas mesmas sessões da VPS que o Alfa (ver abaixo).

O que dá para levar sem risco, com os dois apps fechados e antes da primeira abertura do Server, é a lista de pastas
de projeto (PowerShell):

```powershell
$de = "$env:APPDATA\donel-dev\config.json"; $para = "$env:APPDATA\donel-dev-server\config.json"
$alfa = Get-Content $de -Raw | ConvertFrom-Json
New-Item -ItemType Directory -Force (Split-Path $para) | Out-Null
# UTF-8 sem BOM: o app não lê JSON com BOM.
[IO.File]::WriteAllText($para, (@{ projectRoots = @($alfa.projectRoots) } | ConvertTo-Json -Depth 5))
```

O app completa o resto com os padrões ao abrir. Não copie o cofre de contas, o `mindscape.json` nem o
`celular.json`.

### Usar a mesma VPS nos dois apps

Os dois apps foram feitos para um só PC mandar numa VPS. Com a **mesma VPS cadastrada no Alfa e no Server, abertos
ao mesmo tempo**, acontece o seguinte (conferido no código em 18/11):

- **Sessões da VPS:** ao abrir, cada app reabre toda sessão `donel-*` viva no tmux da VPS, inclusive as do outro.
  Fechar no Server uma aba que veio do Alfa encerra a sessão de verdade na VPS.
- **Contas:** os dois motores de contas gravam a mesma credencial do CLI no `~/.claude`, e o refresh token é de uso
  único. Uma troca ou renovação de um derruba a conta no outro ("Reconectar").
- **Oráculo na VPS:** o daemon guarda uma senha de PC só. Ligar o Oráculo remoto pelo Server tira o Alfa do ar até
  ele religar. Por isso o Server **não** leva o Oráculo para a VPS sozinho na primeira abertura, como o Alfa faz;
  só pelas Preferências.
- **Celular:** a porta 47815 é uma só; ligue o celular em um app só.
- **Painel de Saúde:** um app vê os processos do outro como estranhos e oferece encerrá-los.

Enquanto isso não for separado, use a VPS em um app por vez: feche o Alfa antes de usar o Server com a mesma VPS, ou
cadastre no Server só uma VPS que o Alfa não usa.
