<#
.SYNOPSIS
  Instala (ou atualiza) o coletor de saúde do PC (t-16393812): compila saude-coletor.cs com o csc do Windows,
  acha a chave ssh que já fala com a VPS pessoal, testa, e registra a tarefa agendada oculta DonelSaudeColetor.
.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File instalar-saude-pc.ps1
  powershell -NoProfile -ExecutionPolicy Bypass -File instalar-saude-pc.ps1 -Chave C:\Users\compu\.ssh\id_ed25519
  powershell -NoProfile -ExecutionPolicy Bypass -File instalar-saude-pc.ps1 -Desinstalar
#>
param(
  [string]$Chave,
  [string]$Destino = 'alexandrelentz@100.110.135.26',
  [switch]$Desinstalar
)
$ErrorActionPreference = 'Stop'
$dir = Join-Path $env:LOCALAPPDATA 'donel-saude'
$exe = Join-Path $dir 'saude-coletor.exe'
$tarefa = 'DonelSaudeColetor'
$ssh = Join-Path $env:WINDIR 'System32\OpenSSH\ssh.exe'
$remoto = '/home/alexandrelentz/bin/rotinas/saude/saude_receber.sh pc'

function Parar {
  Stop-ScheduledTask -TaskName $tarefa -ErrorAction SilentlyContinue
  Get-Process saude-coletor -ErrorAction SilentlyContinue | Stop-Process -Force
  Start-Sleep -Seconds 1
}

if ($Desinstalar) {
  Parar
  Unregister-ScheduledTask -TaskName $tarefa -Confirm:$false -ErrorAction SilentlyContinue
  "Desinstalado. Os arquivos ficam em $dir (apague a pasta se quiser)."
  return
}

New-Item -ItemType Directory -Force $dir | Out-Null

# 1. Compila
$csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path $csc)) { throw "csc.exe não encontrado em $csc" }
Copy-Item (Join-Path $PSScriptRoot 'saude-coletor.cs') $dir -Force
Parar
& $csc /nologo /target:winexe /optimize+ "/out:$exe" (Join-Path $dir 'saude-coletor.cs')
if ($LASTEXITCODE -ne 0) { throw "a compilação falhou (saída acima)" }
"1. Compilado: $exe"

# 2. Chave ssh: a informada, a da tarefa DonelEspelhoLedger, a do ~/.ssh/config, ou qualquer chave de ~/.ssh que entre
$candidatas = New-Object System.Collections.Generic.List[string]
if ($Chave) { $candidatas.Add($Chave) }
$t = Get-ScheduledTask -TaskName 'DonelEspelhoLedger' -ErrorAction SilentlyContinue
if ($t) {
  foreach ($a in $t.Actions) {
    $txt = "$($a.Execute) $($a.Arguments)"
    foreach ($arq in [regex]::Matches($txt, '[A-Za-z]:\\[^"]+?\.(ps1|cmd|bat)')) {
      if (Test-Path $arq.Value) { $txt += ' ' + (Get-Content $arq.Value -Raw) }
    }
    foreach ($m in [regex]::Matches($txt, '-i\s+"?([^"\s]+)"?')) { $candidatas.Add($m.Groups[1].Value) }
  }
}
$cfg = Join-Path $env:USERPROFILE '.ssh\config'
if (Test-Path $cfg) {
  foreach ($m in [regex]::Matches((Get-Content $cfg -Raw), '(?im)^\s*IdentityFile\s+"?([^"\r\n]+)"?')) {
    $candidatas.Add(($m.Groups[1].Value -replace '^~', $env:USERPROFILE))
  }
}
Get-ChildItem (Join-Path $env:USERPROFILE '.ssh') -File -ErrorAction SilentlyContinue |
  Where-Object { $_.Extension -eq '' -and (Test-Path ($_.FullName + '.pub')) } |
  ForEach-Object { $candidatas.Add($_.FullName) }

$achada = $null
foreach ($c in ($candidatas | Select-Object -Unique)) {
  $c = [Environment]::ExpandEnvironmentVariables($c)
  if (-not (Test-Path $c)) { continue }
  & $ssh -i $c -o BatchMode=yes -o ConnectTimeout=15 -o StrictHostKeyChecking=accept-new $Destino 'true' 2>$null
  if ($LASTEXITCODE -eq 0) { $achada = $c; break }
}
if (-not $achada) { throw "nenhuma chave ssh entrou em $Destino (testadas: $($candidatas -join ', '))" }
"2. Chave ssh que entra na VPS: $achada"

@"
# saude-coletor (t-16393812) - gerado por instalar-saude-pc.ps1
ssh_exe=$ssh
ssh_chave=$achada
destino=$Destino
comando_remoto=$remoto
"@ | Set-Content -Encoding ASCII (Join-Path $dir 'saude-coletor.ini')

# 3. Uma amostra de teste (não envia) e um envio de teste pelo mesmo caminho do coletor
$amostra = Join-Path $dir 'ultima-amostra.json'
Remove-Item $amostra -ErrorAction SilentlyContinue
Start-Process -FilePath $exe -ArgumentList '--uma-vez' -Wait -WindowStyle Hidden
if (-not (Test-Path $amostra)) { throw "a amostra de teste não saiu (veja $dir\coletor.log)" }
"3. Amostra de teste:"
Get-Content $amostra -Raw
$resp = Get-Content $amostra -Raw | & $ssh -i $achada -o BatchMode=yes -o ConnectTimeout=15 $Destino $remoto
if ($LASTEXITCODE -ne 0) { throw "a VPS não recebeu a amostra de teste" }
"   Envio de teste: $resp"

# 4. Tarefa agendada oculta: no logon e a cada 5 min (se o processo morreu, volta; se está vivo, IgnoreNew)
$usuario = "$env:USERDOMAIN\$env:USERNAME"
$acao = New-ScheduledTaskAction -Execute $exe -WorkingDirectory $dir
$g1 = New-ScheduledTaskTrigger -AtLogOn -User $usuario
$g2 = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 5)
$conf = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -Hidden `
  -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew
$quem = New-ScheduledTaskPrincipal -UserId $usuario -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName $tarefa -Action $acao -Trigger @($g1, $g2) -Settings $conf -Principal $quem -Force | Out-Null
Start-ScheduledTask -TaskName $tarefa
"4. Tarefa $tarefa registrada e iniciada. Esperando 75 s para o primeiro envio..."
Start-Sleep -Seconds 75

# 5. Prova: RAM do processo e o log
$p = Get-Process saude-coletor -ErrorAction SilentlyContinue
if (-not $p) { throw "o processo saude-coletor não está rodando (veja $dir\coletor.log)" }
"5. RAM do coletor: {0:N1} MB de working set, {1:N1} MB privada; processos: {2}; janela: {3}" -f `
  ($p[0].WorkingSet64 / 1MB), ($p[0].PrivateMemorySize64 / 1MB), $p.Count, ($(if ($p[0].MainWindowHandle -eq 0) { 'nenhuma' } else { 'TEM JANELA' }))
"   Últimas linhas do log:"
Get-Content (Join-Path $dir 'coletor.log') -Tail 5
