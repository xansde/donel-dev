# Instala o proxy de saída no PC do dono (docs/handoffs/2026-11-06-proxy-no-pc.md).
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\proxy-saida\instalar-pc.ps1 [-Porta 3128] [-NovaSenha]
#   $env:BW_SESSION = bw unlock --raw; powershell ... instalar-pc.ps1 -SoBitwarden   (só guarda a senha no Bitwarden)
#
# - Copia proxy-saida.mjs para %APPDATA%\donel-dev\proxy-saida (não depende do checkout).
# - Senha: gerada uma vez, guardada com DPAPI (só este usuário do Windows lê) em senha.dpapi; a config do
#   proxy só tem o hash. Ela nunca é impressa. -NovaSenha troca (aí reinstale as VPS).
# - Escuta SÓ no IP da Tailscale deste PC (lido de `tailscale ip -4`).
# - Tarefa agendada "Donel Proxy de Saida": sobe no logon do Windows, sem janela, e volta em até 5 min se cair.
# - Com $env:BW_SESSION definido (bw unlock), grava/atualiza a senha no Bitwarden (item "Donel proxy de saida (PC)").
param(
  [int]$Porta = 3128,
  [string]$Usuario = 'donel-vps',
  [string]$Bind = '',
  [switch]$NovaSenha,
  [switch]$SoBitwarden
)
$ErrorActionPreference = 'Stop'
# Sem isto o .NET Framework põe um BOM UTF-8 no começo de todo stdin que escrevemos (senha e arquivos).
[Console]::InputEncoding = New-Object Text.UTF8Encoding $false
$dir = Join-Path $env:APPDATA 'donel-dev\proxy-saida'
$taskName = 'Donel Proxy de Saida'
New-Item -ItemType Directory -Force $dir | Out-Null

if (-not $Bind) { $Bind = ((& tailscale ip -4) | Select-Object -First 1).Trim() }
if ($Bind -notmatch '^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d{1,3}\.\d{1,3}$') {
  throw "IP da Tailscale inválido ou não encontrado: '$Bind'"
}
$node = (Get-Command node -ErrorAction Stop).Source

function Save-Bitwarden([string]$senha) {
  # Nome e notas em ASCII: o pipe do PowerShell 5.1 para o bw não leva acento inteiro.
  $itemName = 'Donel proxy de saida (PC)'
  $existing = (& bw list items --search $itemName --session $env:BW_SESSION | ConvertFrom-Json) | Where-Object { $_.name -eq $itemName }
  $item = [ordered]@{
    type = 1; name = $itemName
    notes = "Proxy HTTP CONNECT no PC ($Bind`:$Porta, so Tailscale). Usado pelas VPS. scripts/proxy-saida no Donel Dev."
    login = [ordered]@{ username = $Usuario; password = $senha; uris = @(@{ uri = "http://$Bind`:$Porta" }) }
  }
  $encoded = ($item | ConvertTo-Json -Depth 5) | & bw encode
  if ($existing) { & bw edit item $existing[0].id $encoded --session $env:BW_SESSION | Out-Null; 'Bitwarden: item atualizado' }
  else { & bw create item $encoded --session $env:BW_SESSION | Out-Null; 'Bitwarden: item criado' }
  if ($LASTEXITCODE -ne 0) { throw 'Bitwarden recusou (cofre trancado? rode bw unlock --raw)' }
}


Copy-Item -Force (Join-Path $PSScriptRoot 'proxy-saida.mjs') (Join-Path $dir 'proxy-saida.mjs')

$senhaFile = Join-Path $dir 'senha.dpapi'
if ($NovaSenha -or -not (Test-Path $senhaFile)) {
  $bytes = New-Object byte[] 24
  [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  $senha = ([Convert]::ToBase64String($bytes)).Replace('+', 'A').Replace('/', 'B').Replace('=', '')
  ConvertTo-SecureString $senha -AsPlainText -Force | ConvertFrom-SecureString | Set-Content -Encoding ascii $senhaFile
}
$secure = Get-Content $senhaFile | ConvertTo-SecureString
$senha = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))
if ($SoBitwarden) {
  if (-not $env:BW_SESSION) { throw 'defina $env:BW_SESSION = bw unlock --raw antes' }
  Save-Bitwarden $senha
  $senha = $null
  exit 0
}

# Hash pela própria ferramenta (scrypt), senha pelo stdin.
$psi = New-Object Diagnostics.ProcessStartInfo $node, ('"{0}" hash' -f (Join-Path $dir 'proxy-saida.mjs'))
$psi.UseShellExecute = $false; $psi.RedirectStandardInput = $true; $psi.RedirectStandardOutput = $true
$p = [Diagnostics.Process]::Start($psi)
$p.StandardInput.Write($senha); $p.StandardInput.Close()
$hash = $p.StandardOutput.ReadToEnd().Trim(); $p.WaitForExit()
if ($p.ExitCode -ne 0 -or -not $hash.StartsWith('scrypt$')) { throw 'falhou ao gerar o hash da senha' }

$config = [ordered]@{
  modo = 'pc'; bind = $Bind; porta = $Porta; usuario = $Usuario; senhaHash = $hash
  log = (Join-Path $dir 'conexoes.log')
}
[IO.File]::WriteAllText((Join-Path $dir 'pc.json'), ($config | ConvertTo-Json), (New-Object Text.UTF8Encoding $false))

# wscript esconde a janela do node e fica vivo enquanto ele roda (a tarefa sabe se o proxy está de pé).
$vbs = @"
Set sh = CreateObject("WScript.Shell")
WScript.Quit sh.Run("""$node"" ""$dir\proxy-saida.mjs"" ""$dir\pc.json""", 0, True)
"@
Set-Content -Encoding ascii (Join-Path $dir 'iniciar.vbs') $vbs

# Para a instância anterior, se houver, antes de registrar de novo. A tarefa primeiro: se o wscript dela ainda
# estiver vivo, o Start-ScheduledTask abaixo é ignorado (a tarefa não roda duas instâncias).
if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) { Stop-ScheduledTask -TaskName $taskName }
Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
  Where-Object { $_.CommandLine -like '*proxy-saida.mjs*pc.json*' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force }

$action = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument ('"{0}"' -f (Join-Path $dir 'iniciar.vbs'))
# Logon sobe; a repetição a cada 5 min é o vigia: se o node morreu, sobe de novo (rodando, é ignorada).
$trigger = @(
  (New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"),
  (New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 5))
)
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew -StartWhenAvailable
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings `
  -Description 'Donel Dev: proxy de saída das VPS (só Tailscale, só Anthropic). scripts/proxy-saida.' -Force | Out-Null
Start-ScheduledTask -TaskName $taskName
for ($i = 0; $i -lt 20 -and -not (Get-NetTCPConnection -State Listen -LocalPort $Porta -ErrorAction SilentlyContinue); $i++) {
  Start-Sleep -Milliseconds 500
}

if ($env:BW_SESSION) { Save-Bitwarden $senha }
$senha = $null

$listening = Get-NetTCPConnection -State Listen -LocalPort $Porta -ErrorAction SilentlyContinue
"proxy do PC: tarefa '$taskName' registrada; escutando em: " + (($listening | ForEach-Object { "$($_.LocalAddress):$($_.LocalPort)" }) -join ', ')
