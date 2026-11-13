# Gerar, publicar e instalar o alfa novo no PC do dono

Para uma sessão Claude rodando no PC Windows do dono (usuário `compu`). Escrito em 12/11/2026.

## Por que existe

O botão de atualização do alfa ("Baixando versão nova" e depois "Versão nova pronta · Reiniciar") só aparece quando há uma release do GitHub **mais nova** que a versão
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

Na prática, este passo deve passar direto: em 12/11 não há mudança em `package.json` nem em `package-lock.json`
entre `4127112c` (build anterior) e `origin/staging` (`git diff --stat 4127112c origin/staging -- package.json
package-lock.json` sai vazio). Só siga abaixo se o `1.4` der 1.

Se o lock **difere**, o script aborta com "as dependências de staging mudaram" (ele empresta o
`node_modules` do clone principal por junção, e só vale com o mesmo lock). Nunca mexa na branch, no índice nem
no `node_modules` do dono às cegas. Siga a regra do `CLAUDE.md` do repo ("Mesclou na staging, atualize o clone
principal"):

```powershell
$branch = (git -C $repo branch --show-current).Trim()
if ($branch -eq 'staging') {
  git -C $repo fetch origin
  git -C $repo pull --ff-only origin staging    # se recusar, não force: PARE e avise o dono
  # Só agora, se o lock do clone ainda difere de origin/staging (não deveria), troque as dependências:
  git -C $repo diff --quiet origin/staging -- package-lock.json
  if ($LASTEXITCODE -ne 0) { throw 'lock ainda difere depois do pull: PARE e avise o dono' }
  # Lock mudou entre o build anterior e agora? Então as dependências do node_modules estão velhas:
  if (Test-Path "$repo\node_modules.bak") { throw 'node_modules.bak já existe: confira antes' }
  Rename-Item "$repo\node_modules" 'node_modules.bak' -ErrorAction Stop   # guarda, não apaga
  npm --prefix $repo ci
} else {
  # Outra branch ou HEAD solto: só avança a staging local (fast-forward), sem trocar de branch
  git -C $repo fetch origin staging:staging
  # PARE aqui. Avise o dono: o package-lock do clone difere do da staging. Não troque a branch,
  # não faça checkout de arquivo, não mexa no índice.
}
```

Atenção: `npm ci` roda o postinstall que recompila o `node-pty`, e esta máquina não tem Visual Studio (nota no
próprio script). Se falhar: `Remove-Item "$repo\node_modules" -Recurse -Force` só da pasta recém-criada que
falhou, `Rename-Item "$repo\node_modules.bak" node_modules` e peça ao dono. Dependência nova de módulo nativo
precisa de decisão dele. Dá para conferir depois: `git -C $repo status` não deve mostrar nada novo além do que o
dono já tinha.

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
- Fim bom: o log termina com o rodapé do `Start-Transcript`, então a linha `Pronto: <caminho do .exe> (<commit>)`
  não é a última. Confira com `Select-String -Path "$out\build.log" -Pattern '^Pronto: '`.

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
- O clique em "Versão nova pronta · Reiniciar" (`UpdateIndicator onUpdate`, `src/renderer/src/App.tsx:3886-3889`) faz
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

## 6. Memória do Líder no PC (uma vez, só depois do #413)

**Só rode este passo depois que o PR #413 (`feature/lider-na-orquestradora`) estiver na staging e num alfa
instalado.** Antes disso o Líder ainda roda em `C:\Users\compu\seazone`, e a cópia não serve a nada.

O PR #413 passa a rodar o Líder em `C:\Users\compu\seazone\_orquestradora`.
O Claude guarda a memória por pasta de trabalho, então o Líder passaria a enxergar uma pasta de memória nova
e vazia. O script `scripts/levar-memoria-lider.mjs` (Node puro, testado em `tests/levar-memoria-lider.test.ts`)
leva a antiga para a nova **sem sobrescrever nem duplicar** nada:

- arquivo que só existe na antiga é copiado; mesmo nome e mesmo conteúdo, nada;
- mesmo nome com conteúdo **diferente** é um conflito: o da pasta nova fica, e a versão antiga vai ao lado como
  `<nome>.do-projeto-antigo.md` (se o índice antigo tinha entrada para ele, ela entra apontando para essa cópia);
- sem `MEMORY.md` na nova, o da antiga vai igual (seções, linhas em branco, BOM e fim de linha), só com os links
  dos conflitos apontando a cópia antiga (a âncora `#seção` fica);
- com `MEMORY.md` nos dois, o da nova ganha no fim as linhas da antiga que faltam nele. Entrada de índice é a linha de
  lista (`- [`, `* [` ou `1. [`) cujo primeiro link aponta um `.md`: se a nova não tem entrada para esse arquivo, ela
  entra; se tem com o mesmo texto, nada; se tem com **outro texto** (outro gancho), não entra (não duplica) e vai aos
  **Conflitos** com as duas linhas, para o dono decidir. Qualquer outra linha (título, nota com link no meio do
  texto) entra quando a nova não tem esse texto. O que a nova já tinha fica byte a byte;
- nomes e links comparam sem diferença de maiúsculas, como no Windows, e antes de gravar o script confere todos os
  destinos: se algum não cabe (uma pasta que na nova é arquivo, um `MEMORY.md` que é pasta, um `MEMORY.md` antigo
  que não é UTF-8), sai `PARADO` sem gravar nada;
- link simbólico na pasta antiga não é seguido: aparece como "ignorado (link simbólico)";
- a pasta antiga só é lida, e rodar de novo não muda nada. Limite: um bloco de código (```` ``` ````) dentro do
  índice é lido linha a linha como texto comum.

Primeiro, ache o script. O alfa pode ter saído da VPS (skill `alfa-na-vps`), e aí o PC não tem a worktree
`alfa-diario` em dia; por isso a busca vai em ordem, e o primeiro que existir vale (`$repo` é o do passo 1.3):

1. o clone principal, `$repo\scripts\levar-memoria-lider.mjs` (existe quando a `staging` local já tem o #413);
2. a worktree do alfa no PC, `$repo\.claude\worktrees\alfa-diario\scripts\levar-memoria-lider.mjs`;
3. a `staging` no GitHub, baixada para uma pasta temporária. O script só importa módulos `node:` (nada local), então
   o arquivo sozinho basta.

```powershell
$script = $null
foreach ($candidate in @("$repo\scripts\levar-memoria-lider.mjs",
                         "$repo\.claude\worktrees\alfa-diario\scripts\levar-memoria-lider.mjs")) {
  if (Test-Path $candidate) { $script = $candidate; break }
}
if (-not $script) {
  $dir = Join-Path $env:TEMP "levar-memoria-lider-$(Get-Date -Format yyyyMMddHHmmss)"
  New-Item -ItemType Directory -Path $dir | Out-Null
  $b64 = gh api "repos/xansde/donel-dev/contents/scripts/levar-memoria-lider.mjs?ref=staging" --jq .content
  if ($LASTEXITCODE -ne 0 -or -not $b64) { throw 'script não encontrado no clone, na worktree alfa-diario nem na staging do GitHub' }
  $text = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String(($b64 -join '')))
  $script = Join-Path $dir 'levar-memoria-lider.mjs'
  [IO.File]::WriteAllText($script, $text, (New-Object Text.UTF8Encoding($false)))
}
"Script usado: $script"   # diga ao dono qual dos três caminhos foi usado
Select-String -Path $script -Pattern "^import .* from '(?!node:)" | ForEach-Object { throw "o script importa algo local: $($_.Line)" }
```

Depois, só o plano (não grava nada):

```powershell
$old = 'C:\Users\compu\.claude\projects\C--Users-compu-seazone\memory'
$new = 'C:\Users\compu\.claude\projects\C--Users-compu-seazone--orquestradora\memory'
node $script $old $new
```

Leia o plano: **Copiados**, **Iguais**, **Conflitos**, **Linhas acrescentadas ao MEMORY.md** e, se houver,
**Ignorados** e **Destinos impossíveis**. Qualquer item `PARADO` (já existe `<nome>.do-projeto-antigo.md` com outro conteúdo, dois
arquivos indo para o mesmo nome, um destino que não cabe) faz o script sair com 1 e **não gravar nada**:
compare os arquivos, mostre ao dono e só siga quando ele decidir. Sem `PARADO`, grave:

```powershell
node $script $old $new --aplicar
$LASTEXITCODE   # 0 = gravado; 1 = conflito PARADO, nada gravado; 2 = GRAVAÇÃO PARCIAL
```

Rodar de novo responde "Nada a gravar". Conte ao dono os conflitos listados: nos de arquivo, as duas versões
ficaram lado a lado; nos de **entrada do MEMORY.md com outro texto**, o relatório mostra a linha antiga e a nova e
nada foi acrescentado: o dono escolhe qual gancho fica (ou junta os dois) e edita o `MEMORY.md` da pasta nova à mão.

Saída 2 (**GRAVAÇÃO PARCIAL**): uma gravação falhou no meio (sem permissão, arquivo aberto em outro programa). O
relatório lista o que foi gravado e o que faltou; o `MEMORY.md` é sempre o último, então nenhuma linha nova aponta
para arquivo que faltou. Cada arquivo é gravado num temporário ao lado (`<nome>.levando-<pid>`) e só renomeado
quando completo, então uma escrita cortada no meio (disco cheio) não deixa o `MEMORY.md` pela metade: ele fica como
estava. Corrija a causa e rode de novo com `--aplicar`: o já gravado aparece como igual e nada duplica.
