param(
  [Parameter(Mandatory = $true)]
  [ValidateSet("chatgpt", "claude", "doubao", "kimi", "deepseek", "hunyuan", "yuanbao", "qianwen")]
  [string]$Provider,

  [string]$UserDataDir = "",

  [ValidateSet("normal-send", "background-send", "manual-recovery", "resync-latest")]
  [string]$Scenario = "normal-send",

  [int]$TimeoutSeconds = 240,

  [int]$PollIntervalMs = 1000
)

$ErrorActionPreference = "Stop"
$observationStartedAtUtc = (Get-Date).ToUniversalTime()
$staleResultGraceMs = 10 * 1000

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
    $runtime = Get-RuntimeInfo -UserDataDir $candidate
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

function Get-RuntimeInfo {
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

function Get-RequestInfo {
  param(
    [string]$UserDataDir
  )

  $requestPath = Join-Path (Join-Path $UserDataDir "diagnostics") "provider-smoke-request.json"
  if (-not (Test-Path $requestPath)) {
    return $null
  }

  try {
    return [pscustomobject]@{
      Path = $requestPath
      Request = Get-Content -LiteralPath $requestPath -Raw | ConvertFrom-Json
    }
  } catch {
    return [pscustomobject]@{
      Path = $requestPath
      Request = $null
    }
  }
}

$resolvedProvider = Resolve-ProviderId -RawProvider $Provider
$scenarioSuffix = if ($Scenario -eq "normal-send") { "" } else { "-{0}" -f $Scenario }
$userDataDirs = Get-UserDataDirs -ExplicitDir $UserDataDir
$resultPaths = @(
  $userDataDirs | ForEach-Object {
    Join-Path (Join-Path $_ "diagnostics") ("provider-smoke-{0}{1}.json" -f $resolvedProvider, $scenarioSuffix)
  }
)
$deadline = (Get-Date).AddSeconds($TimeoutSeconds)

Write-Host "Watching smoke results:"
foreach ($path in $resultPaths) {
  Write-Host ("- {0}" -f $path)
}
Write-Host ("Timeout: {0}s" -f $TimeoutSeconds)

function Get-SmokeResult {
  param(
    [string]$Path
  )

  if (-not (Test-Path $Path)) {
    return $null
  }

  try {
    return Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json
  } catch {
    return $null
  }
}

function Is-StaleSmokeResult {
  param(
    [datetime]$LastWriteTimeUtc,
    [pscustomobject]$Result
  )

  if ($LastWriteTimeUtc -eq [datetime]::MinValue) {
    return $true
  }

  if ($Result -and $Result.startedAt) {
    try {
      $resultStartedAtUtc = ([datetime]$Result.startedAt).ToUniversalTime()
      if ($resultStartedAtUtc -ge $observationStartedAtUtc.AddMilliseconds(-1 * $staleResultGraceMs)) {
        return $false
      }
    } catch {
      # Fall back to file timestamp check below.
    }
  }

  return $LastWriteTimeUtc -lt $observationStartedAtUtc.AddMilliseconds(-1 * $staleResultGraceMs)
}

function Coalesce {
  param(
    $Value,
    $Fallback
  )

  if ($null -eq $Value -or $Value -eq "") {
    return $Fallback
  }

  return $Value
}

function Get-StatusLine {
  param(
    [pscustomobject]$Result
  )

  if ($null -eq $Result) {
    return "pending"
  }

  if ($Result.error) {
    return "error"
  }

  if ($Result.timeout) {
    return "timeout"
  }

  if ($Result.assistantMessage -and $Result.assistantMessage.status -eq "completed") {
    return "completed"
  }

  if ($Result.assistantMessage -and $Result.assistantMessage.status -eq "failed") {
    return "failed"
  }

  if ($Result.userMessage -and $Result.userMessage.status -eq "failed") {
    return "failed"
  }

  if ($Result.stage) {
    return [string]$Result.stage
  }

  return "running"
}

function Write-Summary {
  param(
    [pscustomobject]$Result,
    [string]$Path
  )

  $summary = $Result.diagnostics.providerSummary
  $snapshot = $Result.diagnostics.debugSnapshot
  $assistant = $Result.assistantMessage
  $user = $Result.userMessage

  Write-Host ""
  Write-Host ("provider={0}" -f $resolvedProvider)
  Write-Host ("scenario={0}" -f (Coalesce $Result.scenario $Scenario))
  Write-Host ("token={0}" -f (Coalesce $Result.token "none"))
  Write-Host ("status={0}" -f (Get-StatusLine -Result $Result))
  if ($Result.sendError) {
    Write-Host ("sendError={0}" -f $Result.sendError)
  }
  if ($Result.runtime) {
    Write-Host ("runtime instance={0} pid={1} startedAt={2}" -f `
      $Result.runtime.instanceId, `
      $Result.runtime.pid, `
      $Result.runtime.startedAt)
  }
  if ($Result.pollCount -ne $null) {
    Write-Host ("pollCount={0}" -f $Result.pollCount)
  }
  if ($Result.resyncAttempted -ne $null) {
    Write-Host ("resync attempted={0} succeeded={1}" -f $Result.resyncAttempted, $Result.resyncSucceeded)
  }
  if ($Result.heartbeatAt) {
    Write-Host ("heartbeatAt={0}" -f $Result.heartbeatAt)
  }
  if ($summary) {
    Write-Host ("summary authenticated={0} degraded={1} visible={2} phase={3} code={4}" -f `
      $summary.authenticated, `
      $summary.degraded, `
      $summary.websiteVisible, `
      (Coalesce $summary.lastFailurePhase "none"), `
      (Coalesce $summary.lastFailureCode "none"))
    if ($summary.reason) {
      Write-Host ("summary reason={0}" -f $summary.reason)
    }
  }
  if ($user) {
    Write-Host ("user status={0} phase={1}" -f $user.status, (Coalesce $user.statusPhase "none"))
  }
  if ($assistant) {
    $text = ""
    if ($assistant.content -and $assistant.content.Count -gt 0) {
      $text = [string]($assistant.content | ForEach-Object {
        if ($_.type -eq "text") { $_.text }
      } | Where-Object { $_ } | Select-Object -First 1)
    }
    if ($text.Length -gt 160) {
      $text = $text.Substring(0, 160) + "..."
    }
    Write-Host ("assistant status={0} phase={1}" -f $assistant.status, (Coalesce $assistant.statusPhase "none"))
    if ($text) {
      Write-Host ("assistant preview={0}" -f $text.Replace("`r", " ").Replace("`n", " "))
    }
  }
  if ($snapshot) {
    Write-Host ("decision={0}" -f $snapshot.completionDecision)
    Write-Host ("binding={0}" -f (Coalesce $snapshot.assistantBinding "none"))
    Write-Host ("network active={0} idle={1}" -f $snapshot.networkActiveCount, $snapshot.networkIdle)
    Write-Host ("signals text={0} stop={1} streaming={2} blocker={3} stableMs={4} elapsedMs={5}" -f `
      $snapshot.completionSignals.textLength, `
      $snapshot.completionSignals.hasStopButton, `
      $snapshot.completionSignals.hasStreamingIndicator, `
      $snapshot.completionSignals.hasRecoverableBlocker, `
      $snapshot.completionSignals.stableMs, `
      $snapshot.completionSignals.elapsedMs)
    if ($snapshot.completionSignals.recoverableBlockerReason) {
      Write-Host ("blocker reason={0}" -f $snapshot.completionSignals.recoverableBlockerReason)
    }
  }
  if ($Result.error) {
    Write-Host ("error={0}" -f $Result.error)
  }
  Write-Host ("json={0}" -f $Path)
}

$lastStatus = ""
while ((Get-Date) -lt $deadline) {
  $observations = @(
    $resultPaths | ForEach-Object {
      $path = $_
      $result = Get-SmokeResult -Path $path
      $lastWriteTime = if (Test-Path $path) { (Get-Item $path).LastWriteTimeUtc } else { [datetime]::MinValue }
      $isStale = if ($result) {
        Is-StaleSmokeResult -LastWriteTimeUtc $lastWriteTime -Result $result
      } else {
        $true
      }
      [pscustomobject]@{
        Path = $path
        Result = $result
        Status = Get-StatusLine -Result $result
        LastWriteTime = $lastWriteTime
        IsStale = $isStale
      }
    }
  )

  $freshObservations = @($observations | Where-Object { -not $_.IsStale })
  if ($freshObservations.Count -eq 0) {
    Start-Sleep -Milliseconds $PollIntervalMs
    continue
  }

  $best = $freshObservations |
    Sort-Object @{ Expression = { $_.Status -in @("completed", "failed", "timeout", "error") }; Descending = $true }, @{ Expression = { $_.LastWriteTime }; Descending = $true } |
    Select-Object -First 1

  $status = $best.Status

  if ($status -ne $lastStatus) {
    Write-Host ("[{0}] {1}" -f (Get-Date -Format "HH:mm:ss"), $status)
    $lastStatus = $status
  }

  if ($status -in @("completed", "failed", "timeout", "error")) {
    Write-Summary -Result $best.Result -Path $best.Path
    if ($status -eq "completed") {
      exit 0
    }
    exit 1
  }

  Start-Sleep -Milliseconds $PollIntervalMs
}

Write-Host ""
Write-Host ("Watcher timed out after {0}s without a final smoke result." -f $TimeoutSeconds)
if ($best -and $best.Result) {
  Write-Host ""
  Write-Host "Latest observed smoke state:"
  Write-Summary -Result $best.Result -Path $best.Path
}
Write-Host "Expected one of:"
foreach ($path in $resultPaths) {
  Write-Host ("- {0}" -f $path)
}
foreach ($dir in $userDataDirs) {
  $runtime = Get-RuntimeInfo -UserDataDir $dir
  $requestInfo = Get-RequestInfo -UserDataDir $dir
  if (-not $runtime -and -not $requestInfo) {
    continue
  }
  Write-Host ""
  Write-Host ("diagnostics dir={0}" -f (Join-Path $dir "diagnostics"))
  if ($runtime) {
    $runtimeAlive = $false
    if ($runtime.pid) {
      $runtimeAlive = $null -ne (Get-Process -Id $runtime.pid -ErrorAction SilentlyContinue)
    }
    Write-Host ("runtime instance={0} pid={1} alive={2} startedAt={3}" -f `
      (Coalesce $runtime.instanceId "none"), `
      (Coalesce $runtime.pid "none"), `
      $runtimeAlive, `
      (Coalesce $runtime.startedAt "none"))
  }
  if ($requestInfo) {
    $request = $requestInfo.Request
    if ($request) {
      Write-Host ("pending request path={0}" -f $requestInfo.Path)
      Write-Host ("pending request provider={0} targetRuntime={1} timeoutMs={2}" -f `
        (Coalesce $request.provider "none"), `
        (Coalesce $request.targetRuntimeInstanceId "none"), `
        (Coalesce $request.timeoutMs "none"))
    } else {
      Write-Host ("pending request path={0} (unreadable json)" -f $requestInfo.Path)
    }
  }
}
exit 2
