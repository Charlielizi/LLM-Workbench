param(
  [string[]]$Providers = @("chatgpt", "claude", "doubao", "kimi", "deepseek", "hunyuan", "qianwen"),

  [string]$UserDataDir = "",

  [int]$TimeoutSeconds = 660,

  [int]$PerProviderRequestTimeoutSeconds = 600,

  [string]$Prompt = "",

  [switch]$ClearPreviousResults
)

$ErrorActionPreference = "Stop"

$requestScript = Join-Path $PSScriptRoot "request-provider-smoke.ps1"
$watchScript = Join-Path $PSScriptRoot "watch-provider-smoke.ps1"

$normalizedProviders = @(
  $Providers |
    ForEach-Object { $_ -split "," } |
    ForEach-Object { $_.Trim() } |
    Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
)

$summaries = @()

foreach ($provider in $normalizedProviders) {
  Write-Host ""
  Write-Host ("=== {0} ===" -f $provider)

  $requestArgs = @(
    "-ExecutionPolicy", "Bypass",
    "-File", $requestScript,
    "-Provider", $provider,
    "-TimeoutSeconds", $PerProviderRequestTimeoutSeconds
  )
  if ($UserDataDir) {
    $requestArgs += @("-UserDataDir", $UserDataDir)
  }
  if ($ClearPreviousResults) {
    $requestArgs += "-ClearPreviousResult"
  }
  if (-not [string]::IsNullOrWhiteSpace($Prompt)) {
    $requestArgs += @("-Prompt", $Prompt)
  }

  & powershell @requestArgs

  $watchArgs = @(
    "-ExecutionPolicy", "Bypass",
    "-File", $watchScript,
    "-Provider", $provider,
    "-TimeoutSeconds", $TimeoutSeconds
  )
  if ($UserDataDir) {
    $watchArgs += @("-UserDataDir", $UserDataDir)
  }

  & powershell @watchArgs
  $exitCode = $LASTEXITCODE

  $summaries += [pscustomobject]@{
    Provider = $provider
    ExitCode = $exitCode
    Outcome = switch ($exitCode) {
      0 { "completed" }
      1 { "failed" }
      2 { "watch-timeout" }
      default { "error" }
    }
  }
}

Write-Host ""
Write-Host "=== Summary ==="
foreach ($summary in $summaries) {
  Write-Host ("{0}: {1} (exit={2})" -f $summary.Provider, $summary.Outcome, $summary.ExitCode)
}

$failed = $summaries | Where-Object { $_.ExitCode -ne 0 }
if ($failed.Count -gt 0) {
  exit 1
}

exit 0
