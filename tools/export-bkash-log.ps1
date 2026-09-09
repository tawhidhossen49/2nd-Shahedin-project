# ---------------------------------------------------------------------------
# export-bkash-log.ps1
#
# Writes every bKash API call this site has made to a readable log file, for
# handing to bKash during their UAT / technical validation. They ask for the
# request and response of each call so they can confirm the integration hits
# the right endpoints in the right order.
#
# Produces two files on the Desktop:
#   bkash-api-log-<date>.txt    human readable, one block per call
#   bkash-api-log-<date>.json   the same rows as raw JSON
#
# Credentials are already redacted in the database (see the note at the top of
# supabase/functions/_shared/bkash.ts) - app_secret, the merchant password,
# id_token, refresh_token and the Authorization header never reach the table.
# These files are safe to email.
#
# USAGE
#   .\tools\export-bkash-log.ps1                 everything logged so far
#   .\tools\export-bkash-log.ps1 -SinceHours 6   only the last 6 hours
# ---------------------------------------------------------------------------
[CmdletBinding()]
param(
    [int]$SinceHours = 0,
    [string]$OutputDir
)

# Deliberately NOT 'Stop'. The Supabase CLI writes progress lines ("Initialising
# login role...") to stderr, and Windows PowerShell turns any stderr from a
# native command into a terminating error under 'Stop' even when it exits 0.
$ErrorActionPreference = 'Continue'

if (-not $OutputDir) { $OutputDir = [Environment]::GetFolderPath('Desktop') }
$stamp = Get-Date -Format 'yyyy-MM-dd_HHmm'
$txtPath  = Join-Path $OutputDir "bkash-api-log-$stamp.txt"
$jsonPath = Join-Path $OutputDir "bkash-api-log-$stamp.json"

# The Supabase CLI refuses to load this project's config unless the SMS hook
# placeholder is present. It is only read to validate config.toml locally and
# is never sent anywhere.
if (-not $env:SEND_SMS_HOOK_SECRETS) {
    $env:SEND_SMS_HOOK_SECRETS = 'v1,whsec_ZHVtbXlfbG9jYWxfdmFsaWRhdGlvbl9vbmx5X25vdF9wdXNoZWQ='
}

$where = ''
if ($SinceHours -gt 0) { $where = "where created_at > now() - interval '$SinceHours hours'" }

$sql = "select id, created_at, api, url, http_status, response_code, error_message, duration_ms, payment_id, request_body, response_body from bkash_api_log $where order by id asc;"

Write-Host "Reading the bKash API log from Supabase..." -ForegroundColor Cyan
# No 2>&1 here: the CLI's progress chatter belongs on stderr and must stay
# there, or PowerShell treats it as a command failure.
$raw = npx --yes supabase db query --linked $sql | Out-String

$start = $raw.IndexOf('{')
if ($start -lt 0) {
    Write-Host "Could not read the log from Supabase." -ForegroundColor Red
    Write-Host "Check you are logged in:  npx supabase login"
    return
}

$parsed = $raw.Substring($start) | ConvertFrom-Json
$rows = @($parsed.rows)

if (-not $rows -or $rows.Count -eq 0) {
    Write-Host "No bKash API calls have been logged yet." -ForegroundColor Yellow
    Write-Host "Run a test payment first, then export again."
    return
}

# --- JSON copy: the rows exactly as stored -------------------------------
$rows | ConvertTo-Json -Depth 20 | Set-Content -Path $jsonPath -Encoding UTF8

# --- Readable copy: one block per call ------------------------------------
$sb = New-Object System.Text.StringBuilder
[void]$sb.AppendLine("bKash API call log - Shahedin")
[void]$sb.AppendLine("Exported: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss K')")
[void]$sb.AppendLine("Calls:    $($rows.Count)")
[void]$sb.AppendLine("Note:     app_secret, password, id_token, refresh_token and the")
[void]$sb.AppendLine("          Authorization header are redacted by design.")
[void]$sb.AppendLine(("=" * 78))
[void]$sb.AppendLine()

foreach ($r in $rows) {
    $outcome = if ($r.response_code -eq '0000') { 'SUCCESS' } else { "FAILED ($($r.response_code))" }
    [void]$sb.AppendLine("[$($r.id)] $($r.api)  -  $outcome")
    [void]$sb.AppendLine("  Time        : $($r.created_at)")
    [void]$sb.AppendLine("  URL         : POST $($r.url)")
    [void]$sb.AppendLine("  HTTP status : $($r.http_status)")
    [void]$sb.AppendLine("  bKash code  : $($r.response_code)")
    if ($r.error_message) { [void]$sb.AppendLine("  Message     : $($r.error_message)") }
    if ($r.payment_id)    { [void]$sb.AppendLine("  paymentID   : $($r.payment_id)") }
    [void]$sb.AppendLine("  Duration    : $($r.duration_ms) ms")
    [void]$sb.AppendLine("  Request  --> " + ($r.request_body  | ConvertTo-Json -Depth 20 -Compress))
    [void]$sb.AppendLine("  Response <-- " + ($r.response_body | ConvertTo-Json -Depth 20 -Compress))
    [void]$sb.AppendLine(("-" * 78))
}

Set-Content -Path $txtPath -Value $sb.ToString() -Encoding UTF8

# --- Summary --------------------------------------------------------------
Write-Host ""
Write-Host "Exported $($rows.Count) API call(s):" -ForegroundColor Green
Write-Host "  $txtPath"
Write-Host "  $jsonPath"
Write-Host ""
Write-Host "Calls by API:"
$rows | Group-Object api | Sort-Object Name | ForEach-Object {
    $ok = @($_.Group | Where-Object { $_.response_code -eq '0000' }).Count
    Write-Host ("  {0,-16} {1,3} total, {2} succeeded" -f $_.Name, $_.Count, $ok)
}
