# Gerar, publicar e instalar o alfa novo no PC do dono

Para uma sessão Claude rodando no PC Windows do dono (usuário `compu`). Escrito em 12/11/2026.

## Por que existe

O botão "Versão nova · Atualizar" do alfa só aparece quando há uma release do GitHub **mais nova** que a versão
instalada. Em 12/11 a release Latest de `xansde/donel-dev` era `alfa-26.1109.2251`, igual à instalada:
`electron-updater` compara com `semver.eq` (`node_modules/electron-updater/out/AppUpdater.js:345`), emite
`update-not-available`, `src/main/app-update.ts:137-141` zera `available` e `failure`, e o
`UpdateIndicator` devolve `null` (`src/renderer/src/appUpdate/UpdateIndicator.tsx:130`). Não há bug de código.

Desde 03/11 o build é **sob demanda**: a tarefa agendada "Donel Dev Alfa diario" está desativada e o único
caminho que publica a release com `latest.yml` é `scripts/build-alfa-diario.ps1`. A solução é rodá-lo.

Os comandos abaixo são PowerShell. Nenhum troca a branch do dono nem descarta arquivo dele.

## 1. Pré-checagens

```powershell
# 1.1 gh logado, com acesso ao repo (o app também usa o token do gh para baixar a release privada)
gh auth status
gh repo view xansde/donel-dev --json nameWithOwner,viewerPermission
# Esperado: viewerPermission WRITE ou ADMIN. Senão: gh auth login (login é do dono: 2FA/navegador).

# 1.2 RAM livre >= 1,5 GB (o script desiste sozinho abaixo disso, sem marcar falha)
'{0:N1} GB livres' -f ((Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory / 1MB)

# 1.3 clone principal: a partir de QUALQUER pasta do repo (clone ou worktree)
$common = (git rev-parse --path-format=absolute --git-common-dir).Trim()
$repo = Split-Path -Parent $common          # o clone principal (termina em "Donel Dev")
$repo; git -C $repo branch --show-current   # só olhar; NÃO trocar a branch
# Se não estiver numa pasta do repo: o caminho costuma ser C:\Users\compu\seazone\Donel Dev

# 1.4 package-lock do clone principal igual ao de origin/staging
git -C $repo fetch --quiet origin staging
git -C $repo diff --quiet origin/staging -- package-lock.json
$LASTEXITCODE   # 0 = igual, siga para 1.5; 1 = difere, veja abaixo
```

Se o lock **difere**, o script aborta com "as dependências de staging mudaram" (ele empresta o
`node_modules` do clone principal por junção, e só vale com o mesmo lock). Só então, sem trocar de branch e
sem apagar nada do dono, atualize as dependências **no clone principal**:

```powershell
# O lock do clone é o do working tree do dono. Se ele tem alteração própria no package-lock/package.json
# (git -C $repo status --short -- package.json package-lock.json), PARE e pergunte ao dono.
# Senão, traga só esses dois arquivos de origin/staging (não mexe em mais nada, nem na branch):
git -C $repo checkout origin/staging -- package.json package-lock.json
Rename-Item "$repo\node_modules" 'node_modules.bak'   # guarda, não apaga
npm --prefix $repo ci
```

Atenção: `npm ci` roda o postinstall que recompila o `node-pty`, e esta máquina não tem Visual Studio (nota no
próprio script). Se falhar: `Remove-Item "$repo\node_modules" -Recurse -Force` só da pasta recém-criada que
falhou, `Rename-Item "$repo\node_modules.bak" node_modules`, desfaça o `checkout` dos dois arquivos com
`git -C $repo checkout HEAD -- package.json package-lock.json` (só se você os trouxe no passo acima) e
peça ao dono. Dependência nova de módulo nativo precisa de decisão dele. Dá para conferir depois: `git -C $repo
status` não deve mostrar nada novo além do que o dono já tinha.

```powershell
# 1.5 pasta de saída e último commit buildado
$out = Join-Path $env:USERPROFILE 'Donel Dev Alfa - diario'
Get-Content "$out\ultimo-commit.txt" -ErrorAction SilentlyContinue
git -C $repo rev-parse origin/staging
```

Se os dois hashes forem **iguais**, o script responde "staging sem mudança desde o último build" e não faz
nada. Para forçar (só se a release Latest ainda for a instalada), guarde o arquivo de lado:

```powershell
Rename-Item "$out\ultimo-commit.txt" "ultimo-commit.$(Get-Date -Format yyyyMMdd-HHmm).txt"
```

Sem commit novo o build sai com versão nova mesmo assim (a versão é a data e hora: `AA.MMDD.HHmm`).

## 2. Rodar o script

Parâmetro único: `-Repo` (padrão: a pasta acima de `scripts\` onde o `.ps1` está). Passe sempre o clone
principal; se rodar o `.ps1` de dentro de uma worktree sem `-Repo`, ele usaria a worktree.

O `.ps1` do clone principal pode ser antigo (a branch do dono não é a staging). Use a cópia de
`origin/staging`, copiada byte a byte (o redirecionamento do `cmd` preserva o BOM e os acentos):

```powershell
$script = Join-Path $env:TEMP 'build-alfa-diario.ps1'
cmd /c "git -C `"$repo`" show origin/staging:scripts/build-alfa-diario.ps1 > `"$script`""
powershell -NoProfile -ExecutionPolicy Bypass -File $script -Repo $repo
```

O que ele faz: confere RAM, busca `origin/staging`, cria/atualiza a worktree
`$repo\.claude\worktrees\alfa-diario` em `origin/staging` (destacada), confere o lock, liga o `node_modules`
por junção, monta a versão `AA.MMDD.HHmm`, roda `npm run dist:alfa` (appId e nome do canal alfa) com
`--publish never`, cria a release `alfa-<versão>` com `DonelDevAlfa-Setup-<versão>.exe`, `.blockmap` e
`latest.yml` (`--latest`), poda para as 6 últimas e copia o instalador para a pasta de saída (guarda 8).
Leva vários minutos: rode em segundo plano e espere terminar.

Onde olhar:

- Log: `%USERPROFILE%\Donel Dev Alfa - diario\build.log`
- Falha: `%USERPROFILE%\Donel Dev Alfa - diario\FALHOU.txt` (data e motivo; some no próximo build bom)
- Fim bom: a última linha do log é `Pronto: <caminho do .exe> (<commit>)`.

## 3. Conferir a release publicada

```powershell
gh release list --repo xansde/donel-dev --limit 5
gh release view --repo xansde/donel-dev --json tagName,isDraft,isPrerelease,publishedAt
# precisa: tagName alfa-<versão nova>, isDraft false, isPrerelease false, e ser a marcada Latest
gh release download <tag> --repo xansde/donel-dev --pattern latest.yml --output - | Select-String '^version:'
```

`version:` do `latest.yml` tem de ser **maior** que `26.1109.2251` (compare por parte numérica: 26.1112.x
> 26.1109.2251). Sem isso o app continua dizendo "não há nada novo".

## 4. Como o dono vê a atualização

- Com o alfa aberto, a checagem roda a cada 30 min e a primeira 15 s depois de abrir
  (`CHECK_EVERY_MS` e `FIRST_CHECK_AFTER_MS` em `src/main/app-update.ts:27-28`). Reabrir o app antecipa.
- Aparece "Baixando versão nova" e depois "Versão nova pronta · Reiniciar" ao lado das Novidades na barra de
  status.
- O clique em Atualizar (`UpdateIndicator onUpdate`, `src/renderer/src/App.tsx:3886-3889`) faz
  `setUpdateRequested(true)`; `updateGo` (`src/shared/appUpdate.ts:116`) decide quando vai; então o renderer
  chama `appUpdate.apply` (`src/main/app-update.ts:200`), que grava as abas para retomar e chama
  `quitAndInstall`.
- **O alfa 26.1109.2251 instalado não tem o prazo do #408**: nessa primeira troca a atualização espera as
  sessões pararem ("Atualiza quando as sessões pararem"). A partir do alfa novo vale
  `appUpdate.forceAfterMinutes` do `config.json` (padrão 5 min; força a troca depois desse tempo).
- O app precisa do `gh` logado na máquina (é de lá que vem o token para a release privada); sem ele a barra
  mostra "Atualização indisponível · tentar de novo".

## 5. Se o botão não vier: instalar direto pelo .exe

```powershell
Get-ChildItem "$out" -Filter 'Donel Dev Alfa-Setup-*.exe' | Sort-Object Name -Descending | Select-Object -First 1
```

1. Feche o Donel Dev Alfa (o dono, se houver sessão rodando; não mate o app por ele).
2. Rode o instalador mais novo da lista. A instalação é por usuário, sem admin, e o `userData` é compartilhado
   entre canais, então abas e config continuam.
3. Abra o alfa e confira a versão (janela "O que mudou" na primeira abertura).

## 6. Memória do Líder no PC (uma vez)

O PR `feature/lider-na-orquestradora` passa a rodar o Líder em `C:\Users\compu\seazone\_orquestradora`.
O Claude guarda a memória por pasta de trabalho, então o Líder passaria a enxergar uma pasta de memória nova
e vazia. Copie a antiga **sem sobrescrever** nada:

```powershell
$old = 'C:\Users\compu\.claude\projects\C--Users-compu-seazone\memory'
$new = 'C:\Users\compu\.claude\projects\C--Users-compu-seazone--orquestradora\memory'
if ((Test-Path $old) -and (Get-ChildItem $old -File -ErrorAction SilentlyContinue)) {
  # /XC /XN /XO: não toca em arquivo que já existe no destino (nem mais novo, nem mais antigo, nem diferente)
  robocopy $old $new /E /XC /XN /XO /NFL /NDL
  if ($LASTEXITCODE -ge 8) { throw "robocopy falhou ($LASTEXITCODE)" }   # 0 a 7 = ok
  # MEMORY.md existe nos dois: o robocopy o deixou como está; acrescente só as linhas que faltam
  $oldIdx = Join-Path $old 'MEMORY.md'; $newIdx = Join-Path $new 'MEMORY.md'
  if ((Test-Path $oldIdx) -and (Test-Path $newIdx)) {
    $have = Get-Content $newIdx
    $missing = Get-Content $oldIdx | Where-Object { $_.Trim() -and ($have -notcontains $_) }
    if ($missing) { Add-Content -Path $newIdx -Value $missing -Encoding utf8 }
  }
} else { 'Sem memória antiga para copiar.' }
```

A pasta antiga fica intacta (é cópia, não move). Rodar duas vezes não duplica nada.
