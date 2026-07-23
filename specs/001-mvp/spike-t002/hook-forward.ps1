# T002 spike: forwards a Claude Code hook payload (received via stdin) to the
# local capture server. Enriches the payload with the event label passed as
# -EventLabel (redundant with hook_event_name in the JSON, kept as a
# cross-check) and with the DONEL_TAB_ID env var, if set at spawn time, to
# validate whether custom env vars set before spawning `claude` are visible
# inside the hook subprocess (correlation test for T009).
#
# Never blocks or alters Claude Code's behavior: always exits 0, short
# timeout on the POST, swallow any error.

param(
  [string]$EventLabel = "unknown",
  [string]$Endpoint = "http://127.0.0.1:8765/hook"
)

$ErrorActionPreference = "SilentlyContinue"

$stdin = [Console]::In.ReadToEnd()

$enriched = $null
try {
  $obj = $stdin | ConvertFrom-Json -ErrorAction Stop
  $obj | Add-Member -NotePropertyName "spike_event_label" -NotePropertyValue $EventLabel -Force
  $obj | Add-Member -NotePropertyName "donel_tab_id" -NotePropertyValue $env:DONEL_TAB_ID -Force
  $enriched = $obj | ConvertTo-Json -Depth 20 -Compress
} catch {
  # stdin wasn't valid JSON (or was empty) - forward raw with a wrapper so we
  # still see it happened.
  $wrapper = @{
    spike_event_label = $EventLabel
    donel_tab_id       = $env:DONEL_TAB_ID
    raw_stdin          = $stdin
  }
  $enriched = $wrapper | ConvertTo-Json -Compress
}

try {
  Invoke-RestMethod -Uri $Endpoint -Method Post -Body $enriched -ContentType "application/json" -TimeoutSec 2 | Out-Null
} catch {
  # Best-effort only; never fail the hook.
}

exit 0
