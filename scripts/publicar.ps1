#Requires -Version 5.1
<#
.SYNOPSIS
    Publica uma versão do Donel Dev na pasta compartilhada com os colegas.

.DESCRIPTION
    Um comando só: empacota, copia o instalador para a pasta compartilhada com
    NOME FIXO, arquiva a versão anterior, regenera o LEIA-ME e o CHANGELOG de lá
    e imprime o rascunho do aviso. Nada é enviado a ninguém.

    Nome fixo (`Donel-Dev-Setup.exe`) é o que faz o link ser estável: o colega
    guarda o link da pasta uma vez e sempre baixa a versão atual. A cópia é
    feita SOBRE o arquivo existente (nunca apaga primeiro) — assim o Google
    Drive mantém o mesmo file ID e quem salvou o link do arquivo também
    continua funcionando.

    ATENÇÃO — este arquivo precisa continuar salvo em UTF-8 COM BOM. O Windows
    PowerShell 5.1 lê .ps1 sem BOM como ANSI e os acentos das mensagens saem
    corrompidos. Se editar com uma ferramenta que remove BOM, rode:
      $c = Get-Content -Raw -Encoding UTF8 scripts\publicar.ps1
      [IO.File]::WriteAllText((Resolve-Path scripts\publicar.ps1), $c, (New-Object Text.UTF8Encoding($true)))

.PARAMETER Destino
    Pasta compartilhada de destino. Se omitido, usa $env:DONEL_DEST, depois
    scripts\publicar.local.json, depois tenta achar o Google Drive montado.

.PARAMETER SkipBuild
    Não empacota — publica o instalador que já está em release\. Use quando
    acabou de rodar `npm run dist` e só quer copiar.

.PARAMETER ManterVersoes
    Quantas versões antigas manter em <Destino>\versoes (padrão 3). Cada uma
    ocupa ~110 MB.

.EXAMPLE
    npm run publicar
.EXAMPLE
    powershell -File scripts\publicar.ps1 -Destino "G:\Meu Drive\Donel Dev" -SkipBuild
#>
[CmdletBinding()]
param(
    [string]$Destino,
    [switch]$SkipBuild,
    [int]$ManterVersoes = 3
)

$ErrorActionPreference = 'Stop'

$repo = Split-Path -Parent $PSScriptRoot
$NOME_FIXO = 'Donel-Dev-Setup.exe'

function Escreva([string]$texto, [string]$cor = 'Gray') { Write-Host $texto -ForegroundColor $cor }
function Falhe([string]$texto) { Write-Host ''; Write-Host "  x $texto" -ForegroundColor Red; Write-Host ''; exit 1 }
function GravaUtf8([string]$path, [string]$conteudo) {
    [System.IO.File]::WriteAllText($path, $conteudo, (New-Object System.Text.UTF8Encoding($false)))
}
# Tudo que vai para a pasta compartilhada passa por aqui: comentario HTML e
# nota interna nunca chegam ao colega.
function LimpaMarkdown([string]$txt) {
    $txt = $txt -replace '(?s)<!--.*?-->\r?\n?', ''
    return ($txt -replace "(\r?\n){3,}", "`r`n`r`n")
}

# ---------------------------------------------------------------- 1. Destino

function ResolveDestino([string]$informado) {
    if ($informado) { return $informado }
    if ($env:DONEL_DEST) { return $env:DONEL_DEST }

    $conf = Join-Path $PSScriptRoot 'publicar.local.json'
    if (Test-Path $conf) {
        $lido = (Get-Content -Raw -Encoding UTF8 $conf | ConvertFrom-Json)
        if ($lido.destino) { return $lido.destino }
    }

    # Google Drive para Desktop monta uma unidade com "Meu Drive"/"My Drive".
    foreach ($d in (Get-PSDrive -PSProvider FileSystem)) {
        foreach ($nome in @('Meu Drive', 'My Drive')) {
            $tentativa = Join-Path (Join-Path $d.Root $nome) 'Donel Dev'
            if (Test-Path $tentativa) { return $tentativa }
        }
    }
    return $null
}

$Destino = ResolveDestino $Destino

if (-not $Destino) {
    Write-Host ''
    Escreva '  Nao encontrei a pasta compartilhada de destino.' Yellow
    Write-Host ''
    Escreva '  Passo unico, uma vez so:' Gray
    Escreva '    1. Instale o Google Drive para Desktop e entre com alexandre.lentz@seazone.com.br' Gray
    Escreva '    2. Crie a pasta "Donel Dev" no Meu Drive e compartilhe com os colegas (leitor)' Gray
    Escreva '    3. Rode:  npm run publicar -- -Destino "G:\Meu Drive\Donel Dev"' Gray
    Write-Host ''
    Escreva '  O caminho fica gravado em scripts\publicar.local.json e nao precisa ser repetido.' DarkGray
    Write-Host ''
    exit 1
}

if (-not (Test-Path $Destino)) {
    New-Item -ItemType Directory -Path $Destino -Force | Out-Null
    Escreva "  + pasta de destino criada: $Destino" DarkGray
}

# Memoriza o destino para as proximas publicacoes.
$conf = Join-Path $PSScriptRoot 'publicar.local.json'
if (-not (Test-Path $conf)) {
    GravaUtf8 $conf (@{ destino = $Destino } | ConvertTo-Json)
    Escreva "  + destino memorizado em scripts\publicar.local.json" DarkGray
}

# ------------------------------------------------------- 2. Versao e contexto

$pkg = Get-Content -Raw -Encoding UTF8 (Join-Path $repo 'package.json') | ConvertFrom-Json
$versao = $pkg.version
$data = Get-Date -Format 'dd/MM/yyyy'
$dataArquivo = Get-Date -Format 'yyyy-MM-dd'

Push-Location $repo
try { $commit = (git rev-parse --short HEAD).Trim() } catch { $commit = 'desconhecido' }
try { $branch = (git rev-parse --abbrev-ref HEAD).Trim() } catch { $branch = 'desconhecido' }
$sujo = @(git status --porcelain)
Pop-Location

Write-Host ''
Escreva "  Donel Dev $versao  ·  $branch @ $commit" Cyan
Escreva "  destino: $Destino" DarkGray
if ($sujo.Count -gt 0) {
    Escreva "  ! arvore com $($sujo.Count) arquivo(s) nao commitado(s) — o build inclui essas mudancas" Yellow
}
Write-Host ''

# ------------------------------------------------------------ 3. Empacotamento

$instalador = Join-Path $repo "release\Donel Dev-Setup-$versao.exe"

if ($SkipBuild) {
    if (-not (Test-Path $instalador)) { Falhe "-SkipBuild pedido, mas nao existe: $instalador" }
    Escreva '  = empacotamento pulado (-SkipBuild)' DarkGray
} else {
    Escreva '  > npm run dist  (build + electron-builder, alguns minutos)' Gray
    Push-Location $repo
    npm run dist
    $codigo = $LASTEXITCODE
    Pop-Location
    if ($codigo -ne 0) { Falhe "npm run dist falhou (exit $codigo) — nada foi publicado." }
    if (-not (Test-Path $instalador)) { Falhe "build terminou mas nao achei o instalador: $instalador" }
}

$info = Get-Item $instalador
$tamanho = "{0:N0} MB" -f ($info.Length / 1MB)
$sha = (Get-FileHash $instalador -Algorithm SHA256).Hash
Escreva "  = instalador: $tamanho  ·  SHA256 $($sha.Substring(0,16))..." DarkGray

# ---------------------------------------------- 4. Arquiva a versao publicada

$pastaVersoes = Join-Path $Destino 'versoes'
if (-not (Test-Path $pastaVersoes)) { New-Item -ItemType Directory -Path $pastaVersoes -Force | Out-Null }

$alvoFixo = Join-Path $Destino $NOME_FIXO
if (Test-Path $alvoFixo) {
    # Guarda a versao que esta saindo do ar, para rollback.
    $anterior = Get-Item $alvoFixo
    $nomeArquivado = "Donel-Dev-Setup-{0:yyyy-MM-dd}-{1}.exe" -f $anterior.LastWriteTime, (Get-FileHash $alvoFixo -Algorithm SHA256).Hash.Substring(0, 8)
    $destinoArquivado = Join-Path $pastaVersoes $nomeArquivado
    if (-not (Test-Path $destinoArquivado)) {
        Move-Item -LiteralPath $alvoFixo -Destination $destinoArquivado
        Escreva "  + versao anterior arquivada em versoes\$nomeArquivado" DarkGray
    } else {
        Remove-Item -LiteralPath $alvoFixo -Force
    }
}

# Copy-Item -Force escreve SOBRE o arquivo (nao apaga e recria): o Google Drive
# trata como nova revisao do mesmo arquivo e o link antigo continua valido.
Copy-Item -LiteralPath $instalador -Destination $alvoFixo -Force
Escreva "  + publicado: $NOME_FIXO ($tamanho)" Green

# Poda: mantem so as N ultimas.
$antigas = Get-ChildItem $pastaVersoes -Filter 'Donel-Dev-Setup-*.exe' | Sort-Object LastWriteTime -Descending
if ($antigas.Count -gt $ManterVersoes) {
    $antigas | Select-Object -Skip $ManterVersoes | ForEach-Object {
        Remove-Item -LiteralPath $_.FullName -Force
        Escreva "  - podada: versoes\$($_.Name)" DarkGray
    }
}

# ------------------------------------------------------------- 5. CHANGELOG

$changelogRepo = Join-Path $repo 'CHANGELOG.md'
$cabecalhoVersao = "## $versao"

if ((Test-Path $changelogRepo) -and ((Get-Content -Raw -Encoding UTF8 $changelogRepo) -match [regex]::Escape($cabecalhoVersao))) {
    Escreva "  = CHANGELOG ja tem a secao $versao" DarkGray
} else {
    Push-Location $repo
    $tagAnterior = @(git tag --list 'publicado/*' --sort=-creatordate) | Select-Object -First 1
    if ($tagAnterior) { $intervalo = "$tagAnterior..HEAD" } else { $intervalo = '-20' }
    $linhas = @(git log $intervalo --pretty=format:'%s' --no-merges)
    Pop-Location

    $relevantes = @($linhas | Where-Object { $_ -match '^(feat|fix|perf)(\(|:)' } | ForEach-Object {
        $texto = $_ -replace '^(feat|fix|perf)(\([^)]*\))?:\s*', ''
        if ($_ -match '^fix') { "- Corrigido: $texto" } else { "- $texto" }
    })
    $ignoradas = $linhas.Count - $relevantes.Count
    if ($relevantes.Count -eq 0) { $relevantes = @('- (nenhum feat/fix desde a ultima publicacao — descreva a mao)') }

    $novaSecao = "$cabecalhoVersao — $data`r`n`r`n" + ($relevantes -join "`r`n") + "`r`n"
    if (Test-Path $changelogRepo) {
        $atual = Get-Content -Raw -Encoding UTF8 $changelogRepo
        $atual = $atual -replace '(?s)^(# [^\r\n]*\r?\n(?:\r?\n)?)', "`$1$novaSecao`r`n"
    } else {
        $atual = "# Donel Dev — o que mudou`r`n`r`n$novaSecao"
    }
    GravaUtf8 $changelogRepo $atual
    Escreva "  + CHANGELOG.md: secao $versao gerada dos commits ($ignoradas commit(s) tecnico(s) ignorado(s)) — revise se quiser" Yellow
}

GravaUtf8 (Join-Path $Destino 'CHANGELOG.md') (LimpaMarkdown (Get-Content -Raw -Encoding UTF8 $changelogRepo))

# --------------------------------------------------------------- 6. LEIA-ME

$template = Join-Path $repo 'docs\LEIA-ME-colegas.md'
if (-not (Test-Path $template)) { Falhe "template ausente: $template" }

$texto = LimpaMarkdown (Get-Content -Raw -Encoding UTF8 $template)
$texto = $texto.Replace('{{VERSAO}}', $versao).Replace('{{DATA}}', $data).Replace('{{TAMANHO}}', $tamanho).Replace('{{SHA256}}', $sha)
GravaUtf8 (Join-Path $Destino 'LEIA-ME.md') $texto
Escreva '  + LEIA-ME.md atualizado (versao, data, tamanho e SHA256 do build)' Green

# ------------------------------------------------------------------- 7. Tag

$tag = "publicado/$dataArquivo"
Push-Location $repo
$existe = @(git tag --list $tag)
if ($existe.Count -eq 0) {
    git tag -a $tag -m "Publicado $versao para os colegas em $data (sha256 $($sha.Substring(0,12)))"
    Escreva "  + tag local $tag criada (push e ato seu: git push origin $tag)" DarkGray
} else {
    Escreva "  = tag $tag ja existe" DarkGray
}
Pop-Location

# ---------------------------------------------------------------- 8. Relatorio

Write-Host ''
Escreva '  ---------------------------------------------------------------' DarkGray
Escreva "  Publicado: Donel Dev $versao" Green
Escreva "  Pasta:     $Destino" Gray
Escreva "  Arquivo:   $NOME_FIXO  (nome fixo — o link nao muda)" Gray
Escreva "  SHA256:    $sha" DarkGray
Escreva '  ---------------------------------------------------------------' DarkGray
Write-Host ''
Escreva '  Rascunho do aviso (NAO enviado — copie se e quando quiser):' Cyan
Write-Host ''
Escreva "    Subiu a versao $versao do Donel Dev na pasta de sempre." White
Escreva '    Mesmo link, baixa o Donel-Dev-Setup.exe e roda por cima — nao precisa desinstalar.' White
Escreva '    O que mudou esta no CHANGELOG.md da pasta.' White
Write-Host ''
Escreva '  Falta so conferir no Drive que a pasta esta compartilhada com quem precisa.' DarkGray
Write-Host ''
