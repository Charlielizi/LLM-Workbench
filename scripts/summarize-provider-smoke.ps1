param(
  [string[]]$Providers = @("chatgpt", "claude", "doubao", "kimi", "deepseek", "hunyuan", "qianwen"),

  [string]$UserDataDir = ""
)

$ErrorActionPreference = "Stop"

function Get-UserDataDirs {
  param(
    [string]$ExplicitDir
  )

  if (-not [string]::IsNullOrWhiteSpace($ExplicitDir)) {
    return @($ExplicitDir)
  }

  $resolved = @(
    (Join-Path $env:APPDATA "AIHub"),
    (Join-Path $env:APPDATA "@aihub\desktop"),
    (Join-Path $env:APPDATA "Electron")
  ) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | Select-Object -Unique

  $liveRuntimes = @()
  foreach ($candidate in $resolved) {
    $runtimeInfoPath = Join-Path (Join-Path $candidate "diagnostics") "runtime-info.json"
    if (-not (Test-Path $runtimeInfoPath)) {
      continue
    }
    try {
      $runtime = Get-Content -LiteralPath $runtimeInfoPath -Raw | ConvertFrom-Json
    } catch {
      continue
    }
    if (-not $runtime.pid) {
      continue
    }
    $process = Get-Process -Id $runtime.pid -ErrorAction SilentlyContinue
    if (-not $process) {
      continue
    }
    $startedAt = if ($runtime.startedAt) {
      try { [datetime]$runtime.startedAt } catch { [datetime]::MinValue }
    } else {
      [datetime]::MinValue
    }
    $liveRuntimes += [pscustomobject]@{
      Dir = $candidate
      StartedAt = $startedAt
    }
  }

  if ($liveRuntimes.Count -gt 0) {
    $newest = $liveRuntimes |
      Sort-Object -Property StartedAt -Descending |
      Select-Object -First 1
    return @($newest.Dir)
  }

  return $resolved
}

function Resolve-ProviderId {
  param(
    [string]$RawProvider
  )

  switch ($RawProvider) {
    "yuanbao" { return "hunyuan" }
    default { return $RawProvider }
  }
}

function Get-LatestExistingResult {
  param(
    [string]$ProviderId,
    [string[]]$UserDataDirs
  )

  $candidates = @()
  foreach ($dir in $UserDataDirs) {
    $path = Join-Path (Join-Path $dir "diagnostics") ("provider-smoke-{0}.json" -f $ProviderId)
    if (Test-Path $path) {
      $candidates += Get-Item -LiteralPath $path
    }
  }

  $latest = $candidates |
    Sort-Object -Property LastWriteTimeUtc -Descending |
    Select-Object -First 1
  if (-not $latest) {
    return $null
  }

  try {
    $normalized = & node -e @"
const fs = require('node:fs');
const path = process.argv[1];
    const data = JSON.parse(fs.readFileSync(path, 'utf8').replace(/^\uFEFF/, ''));
const trimmed = {
  provider: data.provider ?? null,
  sendError: data.sendError ?? null,
  timeout: Boolean(data.timeout),
  error: data.error ?? null,
  assistantMessage: data.assistantMessage ?? null,
  verification: data.verification ?? null,
  diagnostics: {
    providerSummary: data.diagnostics?.providerSummary ?? null
  }
};
process.stdout.write(JSON.stringify(trimmed));
"@ $latest.FullName
    return [pscustomobject]@{
      Path = $latest.FullName
      Json = $normalized | ConvertFrom-Json
    }
  } catch {
    return [pscustomobject]@{
      Path = $latest.FullName
      Json = $null
    }
  }
}

$normalizedProviders = @(
  $Providers |
    ForEach-Object { $_ -split "," } |
    ForEach-Object { $_.Trim() } |
    Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
)

$userDataDirs = Get-UserDataDirs -ExplicitDir $UserDataDir
$rows = @()

foreach ($provider in $normalizedProviders) {
  $providerId = Resolve-ProviderId -RawProvider $provider
  $result = Get-LatestExistingResult -ProviderId $providerId -UserDataDirs $userDataDirs
  if (-not $result -or -not $result.Json) {
    $rows += [pscustomobject]@{
      Provider = $provider
      Outcome = "missing"
      Verification = "none"
      FailurePhase = "none"
      FailureCode = "none"
      Reason = "No smoke result file was found."
      Path = "none"
    }
    continue
  }

  $summary = $result.Json.diagnostics.providerSummary
  $assistant = $result.Json.assistantMessage
  $outcome = if ($assistant -and $assistant.status -eq "completed") {
    "completed"
  } elseif ($result.Json.timeout) {
    "timeout"
  } elseif ($result.Json.error) {
    "error"
  } else {
    "failed"
  }

  $rows += [pscustomobject]@{
    Provider = $provider
    Outcome = $outcome
    Verification = if ($result.Json.verification.kind) { $result.Json.verification.kind } else { "none" }
    FailurePhase = if ($summary.lastFailurePhase) { $summary.lastFailurePhase } else { "none" }
    FailureCode = if ($summary.lastFailureCode) { $summary.lastFailureCode } else { "none" }
    Reason = if ($summary.reason) { $summary.reason } elseif ($result.Json.sendError) { $result.Json.sendError } else { "none" }
    Path = $result.Path
  }
}

Write-Host "| Provider | Outcome | Verification | Failure phase | Failure code | Reason |"
Write-Host "|---|---|---|---|---|---|"
foreach ($row in $rows) {
  $reason = [string]$row.Reason
  $reason = $reason.Replace("`r", " ").Replace("`n", " ").Trim()
  Write-Host ("| {0} | {1} | {2} | {3} | {4} | {5} |" -f `
    $row.Provider, `
    $row.Outcome, `
    $row.Verification, `
    $row.FailurePhase, `
    $row.FailureCode, `
    $reason)
}
