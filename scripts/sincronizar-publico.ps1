# Sincroniza o codigo deste repo de trabalho para a copia de trabalho do repo
# PUBLICO (github.com/xansde/donel), que e o canal estavel.
#
# O que este script faz: espelha as pastas de CODIGO e os arquivos de build.
# O que ele NAO faz: commit, push, nem qualquer envio. Ele termina imprimindo o
# `git status` do lado publico para VOCE revisar e commitar — mesma regra do
# `publicar.ps1` (automacao gera rascunho, nunca envia).
#
# Nunca sao copiados (o repo publico tem versao propria, editada a mao):
#   README.md, LICENSE, CLAUDE.md, package.json
# Nunca vao para o publico (processo interno):
#   specs/, docs/, scripts/, design/, .claude/
#
# Uso:
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/sincronizar-publico.ps1
#   ... -Publico "C:\caminho\da\copia\publica"   (default: ..\donel-dev-publico)

[CmdletBinding()]
param(
  # Default resolvido no corpo: $PSScriptRoot nao esta populado durante a
  # ligacao dos parametros, so depois que o script comeca a rodar.
  [string]$Publico
)

$ErrorActionPreference = 'Stop'

$origem = Split-Path -Parent $PSScriptRoot
if ([string]::IsNullOrWhiteSpace($Publico)) {
  $Publico = Join-Path (Split-Path -Parent $origem) 'donel-dev-publico'
}
$destino = [System.IO.Path]::GetFullPath($Publico)

if (-not (Test-Path (Join-Path $destino '.git'))) {
  throw "Nao encontrei um repo git em '$destino'. Clone github.com/xansde/donel primeiro, ou passe -Publico <caminho>."
}

Write-Host "origem : $origem"
Write-Host "destino: $destino"
Write-Host ''

# Pastas espelhadas COM delecao (/MIR): arquivo removido aqui sai de la tambem.
#
# `skills` entrou em 03/08 (spec 010): o fork `esteira-donel-3.0.0` e o lado
# SKILL do contrato, e dois testes de `tests/` rodam o emissor Python dele
# (`esteiraSkillMirrorContract`, `esteiraEspinha`). Sem a pasta, o `npm test`
# do publico quebraria — e um teste que so passa aqui nao vale como gate.
#
# `docs/esteira-dev` entrou em 07/10 (promocao do beta de 07/10): a spec 012
# moveu o contrato para docs/esteira-dev/contract/v1/, e uma dezena de testes
# espelhados o le de la. So esse pacote entra — o resto de docs/ segue fora.
$pastas = @('src', 'tests', 'patches', 'design-system', 'skills', 'docs/esteira-dev')
$excluirPastas = @('node_modules', 'dist', 'storybook-static', 'coverage', '.vite', 'test-results')
# Testes que confrontam specs/ ou .esteira/ do repo de trabalho — pastas que
# nunca vao para o publico, entao la eles so podem falhar.
$excluirArquivos = @('esteiraLayoutCanalV2.test.ts')

foreach ($pasta in $pastas) {
  $de = Join-Path $origem $pasta
  $para = Join-Path $destino $pasta
  if (-not (Test-Path $de)) { continue }
  Write-Host "espelhando $pasta ..."
  $args = @($de, $para, '/MIR', '/NFL', '/NDL', '/NJH', '/NJS', '/NP', '/XD') + $excluirPastas + @('/XF') + $excluirArquivos
  & robocopy.exe @args | Out-Null
  # robocopy usa exit codes de bitmask: 0-7 e sucesso, >=8 e erro real.
  if ($LASTEXITCODE -ge 8) { throw "robocopy falhou em '$pasta' (exit $LASTEXITCODE)" }
}

# Arquivos soltos copiados um a um (sem /MIR — nao ha delecao a propagar).
#
# Os tres da esteira entraram em 11/08 (decisao do dono, promocao do beta de
# 05/08): testes espelhados os exercitam, e teste que so passa no repo de
# trabalho nao vale como gate — mesmo precedente de `skills` acima. A pasta
# scripts/ como um todo CONTINUA fora (publicar.ps1 e este arquivo sao processo
# interno); entram so as ferramentas da esteira que a suite chama.
#
$arquivos = @(
  '.gitignore',
  '.gitattributes',
  'CHANGELOG.md',
  'electron-builder.yml',
  'electron.vite.config.ts',
  'tsconfig.json',
  'vitest.config.ts',
  'package-lock.json',
  'scripts/esteira-check.mjs',
  'scripts/esteira-custo-fase.mjs',
  '.esteira/review-policy.json'
)

foreach ($arquivo in $arquivos) {
  $de = Join-Path $origem $arquivo
  if (-not (Test-Path $de)) { continue }
  $para = Join-Path $destino $arquivo
  $pastaPai = Split-Path -Parent $para
  if (-not (Test-Path $pastaPai)) { New-Item -ItemType Directory -Force -Path $pastaPai | Out-Null }
  Copy-Item -Path $de -Destination $para -Force
  Write-Host "copiado $arquivo"
}

# package.json diverge de proposito (license/repository/author + os scripts
# `publicar*`, que dependem de scripts/ e nao existem no publico). Nao copiamos:
# so avisamos quando dependencia ou versao mudou, para voce levar a mao.
$aqui = Get-Content (Join-Path $origem 'package.json') -Raw | ConvertFrom-Json
$la = Get-Content (Join-Path $destino 'package.json') -Raw | ConvertFrom-Json

$diferencas = @()
if ($aqui.version -ne $la.version) { $diferencas += "version: '$($la.version)' -> '$($aqui.version)'" }
foreach ($bloco in @('dependencies', 'devDependencies')) {
  $a = $aqui.$bloco; $b = $la.$bloco
  foreach ($p in $a.PSObject.Properties) {
    if ($b.PSObject.Properties.Name -notcontains $p.Name) { $diferencas += "$bloco + $($p.Name)@$($p.Value)" }
    elseif ($b.$($p.Name) -ne $p.Value) { $diferencas += "$bloco ~ $($p.Name): $($b.$($p.Name)) -> $($p.Value)" }
  }
  foreach ($p in $b.PSObject.Properties) {
    if ($a.PSObject.Properties.Name -notcontains $p.Name) { $diferencas += "$bloco - $($p.Name)" }
  }
}

Write-Host ''
if ($diferencas.Count -gt 0) {
  Write-Host 'ATENCAO — package.json precisa de edicao MANUAL no repo publico:' -ForegroundColor Yellow
  $diferencas | ForEach-Object { Write-Host "  $_" -ForegroundColor Yellow }
} else {
  Write-Host 'package.json: nenhuma diferenca de versao/dependencia.' -ForegroundColor Green
}

Write-Host ''
Write-Host '--- git status do repo publico ---'
& git -C $destino status --short

Write-Host ''
Write-Host 'Nada foi commitado nem enviado. Para promover, no repo publico:' -ForegroundColor Cyan
Write-Host "  cd `"$destino`"" -ForegroundColor Cyan
Write-Host '  npm test                 # confira o verde antes' -ForegroundColor Cyan
Write-Host '  git add -A && git commit && git push' -ForegroundColor Cyan
