# Desfaz o instalar-pc.ps1. Desinstale as VPS antes (instalar-vps.ps1 -Desinstalar): sem o PC elas caem
# para o direto sozinhas, mas o relay continuaria tentando e avisando.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\proxy-saida\desinstalar-pc.ps1 [-Apagar]
#
# Sem -Apagar a pasta fica (log de conexões e senha.dpapi, para reinstalar com a mesma senha).
param([switch]$Apagar)
$ErrorActionPreference = 'Stop'
$dir = Join-Path $env:APPDATA 'donel-dev\proxy-saida'
$taskName = 'Donel Proxy de Saida'

if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) {
  Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
  Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
}
Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
  Where-Object { $_.CommandLine -like '*proxy-saida.mjs*pc.json*' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
if ($Apagar -and (Test-Path $dir)) { Remove-Item -Recurse -Force $dir }
'proxy do PC removido' + ($(if ($Apagar) { ' (pasta apagada)' } else { " (pasta mantida em $dir)" }))
