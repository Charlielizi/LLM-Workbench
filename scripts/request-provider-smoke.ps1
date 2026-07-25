param(
  [Parameter(Mandatory = $true)]
  [ValidateSet("chatgpt", "claude", "doubao", "kimi", "deepseek", "hunyuan", "yuanbao", "qianwen")]
  [string]$Provider,

  [string]$UserDataDir = "",

  [ValidateSet("normal-send", "background-send", "manual-recovery", "resync-latest")]
  [string]$Scenario = "normal-send",

  [int]$TimeoutSeconds = 0,

  [string]$Prompt = "",

  [switch]$ClearPreviousResult
)

$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($Prompt) -and $env:AIHUB_SMOKE_PROMPT) {
  $Prompt = $env:AIHUB_SMOKE_PROMPT
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

function Get-UserDataDirs {
  param(
    [string]$ExplicitDir
  )

  if (-not [string]::IsNullOrWhiteSpace($ExplicitDir)) {
    return @($ExplicitDir)
  }

  $candidates = @(
    (Join-Path $env:APPDATA "AIHub"),
    (Join-Path $env:APPDATA "@aihub\desktop"),
    (Join-Path $env:APPDATA "Electron")
  )

  $resolved = @(
    $candidates |
      Where-Object { -not [string]::IsNullOrWhiteSpace($_) } |
      Select-Object -Unique
  )

  $liveRuntimes = @()
  foreach ($candidate in $resolved) {
    $runtime = Get-RuntimeTarget -UserDataDir $candidate
    if (-not $runtime -or -not $runtime.pid) {
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

function Get-RuntimeTarget {
  param(
    [string]$UserDataDir
  )

  $runtimeInfoPath = Join-Path (Join-Path $UserDataDir "diagnostics") "runtime-info.json"
  if (-not (Test-Path $runtimeInfoPath)) {
    return $null
  }

  try {
    return Get-Content -LiteralPath $runtimeInfoPath -Raw | ConvertFrom-Json
  } catch {
    return $null
  }
}

$userDataDirs = Get-UserDataDirs -ExplicitDir $UserDataDir

$resolvedProvider = Resolve-ProviderId -RawProvider $Provider

foreach ($dir in $userDataDirs) {
  $runtime = Get-RuntimeTarget -UserDataDir $dir
  $diagnosticsDir = Join-Path $dir "diagnostics"
  $requestPath = Join-Path $diagnosticsDir "provider-smoke-request.json"
  $scenarioSuffix = if ($Scenario -eq "normal-send") { "" } else { "-{0}" -f $Scenario }
  $resultPath = Join-Path $diagnosticsDir ("provider-smoke-{0}{1}.json" -f $resolvedProvider, $scenarioSuffix)

  New-Item -ItemType Directory -Force -Path $diagnosticsDir | Out-Null

  if ($ClearPreviousResult -and (Test-Path $resultPath)) {
    Remove-Item -LiteralPath $resultPath -Force
  }

  $requestObject = @{
    provider = $resolvedProvider
    scenario = $Scenario
  }

  if ($TimeoutSeconds -gt 0) {
    $requestObject.timeoutMs = $TimeoutSeconds * 1000
  }

  if (-not [string]::IsNullOrWhiteSpace($Prompt)) {
    $requestObject.prompt = $Prompt
  }

  if ($runtime -and $runtime.instanceId) {
    $requestObject.targetRuntimeInstanceId = [string]$runtime.instanceId
  }

  $scopedPayload = $requestObject | ConvertTo-Json

  Set-Content -LiteralPath $requestPath -Value $scopedPayload -Encoding utf8

  Write-Host ("Smoke request written: {0}" -f $requestPath)
  Write-Host ("Expected result path:  {0}" -f $resultPath)
  Write-Host ("Smoke scenario:       {0}" -f $Scenario)
  if ($runtime -and $runtime.instanceId) {
    Write-Host ("Target runtime instance: {0} (pid={1}, startedAt={2})" -f `
      $runtime.instanceId, `
      $runtime.pid, `
      $runtime.startedAt)
  }
}

if ($Scenario -eq "background-send") {
  Write-Host "Next step: start AIHub and leave the provider drawer closed until the smoke run completes."
} else {
  Write-Host "Next step: start AIHub and keep the provider drawer visible until the smoke run completes."
}
