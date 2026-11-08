# Do PC, instala (ou reinstala) o relay do proxy de saída numa VPS, pela Tailscale.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\proxy-saida\instalar-vps.ps1 `
#     -Destino root@vps-time-homologacoes [-Settings]
#   ... -Desinstalar   desfaz na VPS
#
# A senha sai do senha.dpapi do PC e vai só pelo stdin do ssh (nunca argumento, log ou arquivo temporário).
# -Settings também põe o proxy no ~/.claude/settings.json da VPS: vale para todo Claude dela, inclusive as
# sessões que já estão rodando (o CLI relê o env do settings.json em voo). Sem ele, só as sessões que o Donel
# abrir daqui em diante pegam o proxy.
param(
  [Parameter(Mandatory = $true)][string]$Destino,
  [switch]$Settings,
  [switch]$Desinstalar
)
$ErrorActionPreference = 'Stop'
# Sem isto o .NET Framework põe um BOM UTF-8 no começo de todo stdin que escrevemos (senha e arquivos).
[Console]::InputEncoding = New-Object Text.UTF8Encoding $false
$dir = Join-Path $env:APPDATA 'donel-dev\proxy-saida'
$remote = '/tmp/donel-proxy-saida-instalar'

function Send-File([string]$local, [string]$remotePath) {
  # Bytes crus pelo stdin do ssh: nada de CRLF nem BOM do PowerShell.
  $psi = New-Object Diagnostics.ProcessStartInfo 'ssh', "-o BatchMode=yes $Destino `"mkdir -p $remote && chmod 700 $remote && cat > $remotePath`""
  $psi.UseShellExecute = $false; $psi.RedirectStandardInput = $true
  $p = [Diagnostics.Process]::Start($psi)
  $bytes = [IO.File]::ReadAllBytes($local)
  $p.StandardInput.BaseStream.Write($bytes, 0, $bytes.Length); $p.StandardInput.Close(); $p.WaitForExit()
  if ($p.ExitCode -ne 0) { throw "falhou ao copiar $local para $Destino" }
}

if ($Desinstalar) {
  Send-File (Join-Path $PSScriptRoot 'desinstalar-vps.sh') "$remote/desinstalar-vps.sh"
  & ssh -o BatchMode=yes $Destino "bash $remote/desinstalar-vps.sh; rm -rf $remote"
  exit $LASTEXITCODE
}

$config = Get-Content (Join-Path $dir 'pc.json') -Raw | ConvertFrom-Json
$secure = Get-Content (Join-Path $dir 'senha.dpapi') | ConvertTo-SecureString
$senha = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))

Send-File (Join-Path $PSScriptRoot 'proxy-saida.mjs') "$remote/proxy-saida.mjs"
Send-File (Join-Path $PSScriptRoot 'instalar-vps.sh') "$remote/instalar-vps.sh"

$remoteArgs = "--upstream $($config.bind):$($config.porta) --usuario $($config.usuario)"
if ($Settings) { $remoteArgs += ' --settings' }
$psi = New-Object Diagnostics.ProcessStartInfo 'ssh', "-o BatchMode=yes $Destino `"bash $remote/instalar-vps.sh $remoteArgs; rc=`$?; rm -rf $remote; exit `$rc`""
$psi.UseShellExecute = $false; $psi.RedirectStandardInput = $true
$p = [Diagnostics.Process]::Start($psi)
$p.StandardInput.Write("$senha`n"); $p.StandardInput.Close(); $p.WaitForExit()
$senha = $null
exit $p.ExitCode
