# Registra (ou atualiza) a tarefa agendada que roda scripts/build-alfa-diario.ps1
# a cada 10 minutos, como o usuário logado. Sem commit novo em staging o script
# não faz nada; com commit novo, sai instalador novo e o app oferece atualizar.
# Desfazer:
#   Unregister-ScheduledTask -TaskName 'Donel Dev Alfa diario' -Confirm:$false

# O script é copiado para a pasta dos instaladores: a tarefa não depende de
# uma worktree que pode ser apagada. O repo é o checkout principal.
$repo = Split-Path -Parent (Resolve-Path (git -C $PSScriptRoot rev-parse --path-format=absolute --git-common-dir))
$outDir = Join-Path $env:USERPROFILE 'Donel Dev Alfa - diario'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
$script = Join-Path $outDir 'build-alfa-diario.ps1'
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'build-alfa-diario.ps1') -Destination $script -Force
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$script`" -Repo `"$repo`""
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 10)
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -RunOnlyIfNetworkAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 50) -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName 'Donel Dev Alfa diario' -Action $action -Trigger $trigger -Settings $settings -Description 'Gera o instalador do Donel Dev Alfa a partir de staging' -Force | Out-Null
Write-Output "Tarefa 'Donel Dev Alfa diario' registrada: a cada 10 minutos."
