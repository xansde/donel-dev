# Build diário do canal alfa — roda de manhã pela tarefa agendada
# "Donel Dev Alfa diario" (registrada por scripts/registrar-alfa-diario.ps1).
# Gera o instalador a partir de origin/staging numa worktree só dele e deixa
# o .exe com a data no nome em "%USERPROFILE%\Donel Dev Alfa - diario".
# Sem commit novo em staging desde o último build, não faz nada.

param([string]$Repo = (Split-Path -Parent $PSScriptRoot))

$ErrorActionPreference = 'Stop'

$repo = $Repo
$worktree = Join-Path $repo '.claude\worktrees\alfa-diario'
$outDir = Join-Path $env:USERPROFILE 'Donel Dev Alfa - diario'
$log = Join-Path $outDir 'build.log'
$lastCommitFile = Join-Path $outDir 'ultimo-commit.txt'
$keep = 5

New-Item -ItemType Directory -Force -Path $outDir | Out-Null
Start-Transcript -Path $log -Force | Out-Null
try {
  git -C $repo fetch --quiet origin staging
  $commit = (git -C $repo rev-parse origin/staging).Trim()
  if ((Test-Path $lastCommitFile) -and ((Get-Content $lastCommitFile -Raw).Trim() -eq $commit)) {
    Write-Output "staging sem mudança desde o último build ($commit). Nada a fazer."
    return
  }

  if (-not (Test-Path $worktree)) {
    git -C $repo worktree add --detach $worktree $commit
  } else {
    git -C $worktree checkout --quiet --detach --force $commit
    git -C $worktree clean -fdq -e node_modules
  }

  Push-Location $worktree
  try {
    npm install --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { throw "npm install falhou ($LASTEXITCODE)" }
    npm run dist:alfa -- --config.npmRebuild=false
    if ($LASTEXITCODE -ne 0) { throw "dist:alfa falhou ($LASTEXITCODE)" }
  } finally {
    Pop-Location
  }

  $exe = Get-ChildItem (Join-Path $worktree 'release') -Filter 'Donel Dev Alfa-Setup-*.exe' | Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if (-not $exe) { throw 'instalador não encontrado em release\' }
  $dest = Join-Path $outDir ("Donel Dev Alfa-Setup-{0}.exe" -f (Get-Date -Format 'yyyy-MM-dd'))
  Copy-Item -LiteralPath $exe.FullName -Destination $dest -Force
  Set-Content -Path $lastCommitFile -Value $commit -Encoding utf8
  Remove-Item -Path (Join-Path $outDir 'FALHOU.txt') -ErrorAction SilentlyContinue

  Get-ChildItem $outDir -Filter 'Donel Dev Alfa-Setup-*.exe' | Sort-Object Name -Descending | Select-Object -Skip $keep | Remove-Item -Force
  Write-Output "Pronto: $dest ($commit)"
} catch {
  Set-Content -Path (Join-Path $outDir 'FALHOU.txt') -Value ("{0}  {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm'), $_) -Encoding utf8
  throw
} finally {
  Stop-Transcript | Out-Null
}
