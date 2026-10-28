# Registra (ou atualiza) a tarefa agendada que roda scripts/build-alfa-diario.ps1
# todo dia às 06:30, como o usuário logado. Se o PC estiver desligado nesse
# horário, roda assim que ligar. Desfazer:
#   Unregister-ScheduledTask -TaskName 'Donel Dev Alfa diario' -Confirm:$false

# O script é copiado para a pasta dos instaladores: a tarefa não depende de
# uma worktree que pode ser apagada. O repo é o checkout principal.
$repo = Split-Path -Parent (Resolve-Path (git -C $PSScriptRoot rev-parse --git-common-dir))
$outDir = Join-Path $env:USERPROFILE 'Donel Dev Alfa - diario'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
$script = Join-Path $outDir 'build-alfa-diario.ps1'
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'build-alfa-diario.ps1') -Destination $script -Force
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$script`" -Repo `"$repo`""
$trigger = New-ScheduledTaskTrigger -Daily -At '06:30'
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -RunOnlyIfNetworkAvailable -ExecutionTimeLimit (New-TimeSpan -Hours 1)
Register-ScheduledTask -TaskName 'Donel Dev Alfa diario' -Action $action -Trigger $trigger -Settings $settings -Description 'Gera o instalador do Donel Dev Alfa a partir de staging' -Force | Out-Null
Write-Output "Tarefa 'Donel Dev Alfa diario' registrada: todo dia às 06:30."
