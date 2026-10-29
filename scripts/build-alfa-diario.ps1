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

  # node_modules emprestado do checkout principal (junção): um npm install do
  # zero recompila o node-pty e exige Visual Studio, que esta máquina não tem.
  # Só vale com o mesmo package-lock; se as dependências mudaram, para e avisa.
  $lockHere = (Get-FileHash (Join-Path $worktree 'package-lock.json')).Hash
  $lockMain = (Get-FileHash (Join-Path $repo 'package-lock.json')).Hash
  if ($lockHere -ne $lockMain) { throw 'as dependências de staging mudaram: rode npm install no checkout principal e tente de novo' }
  $modules = Join-Path $worktree 'node_modules'
  $item = Get-Item $modules -Force -ErrorAction SilentlyContinue
  if ($item -and -not $item.LinkType) { Remove-Item -LiteralPath $modules -Recurse -Force }
  if (-not (Test-Path $modules)) { New-Item -ItemType Junction -Path $modules -Target (Join-Path $repo 'node_modules') | Out-Null }

  Push-Location $worktree
  try {
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
