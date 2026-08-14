# Provider Web Regression Checklist

This checklist is for validating the reworked web-provider pipeline in real provider sessions after the `ProviderClient + WebsiteAdapter + observation pipeline` migration.

The automated manual-recovery smoke can be requested separately without overwriting the normal-send result:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/request-provider-smoke.ps1 -Provider doubao -Scenario manual-recovery -TimeoutSeconds 60 -ClearPreviousResult
powershell -ExecutionPolicy Bypass -File scripts/watch-provider-smoke.ps1 -Provider doubao -Scenario manual-recovery -TimeoutSeconds 120
```

The runner restores the original provider settings after completion, timeout, or fatal failure.

The missed-reply recovery path has a separate scenario that deletes the first locally synchronized assistant message and recovers it from the live provider page:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/request-provider-smoke.ps1 -Provider doubao -Scenario resync-latest -TimeoutSeconds 60 -ClearPreviousResult
powershell -ExecutionPolicy Bypass -File scripts/watch-provider-smoke.ps1 -Provider doubao -Scenario resync-latest -TimeoutSeconds 120
```

The background-send scenario closes the provider drawer, waits past the 30-second detach window, and then verifies that the offscreen provider surface still synchronizes the reply:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/request-provider-smoke.ps1 -Provider doubao -Scenario background-send -TimeoutSeconds 90 -ClearPreviousResult
powershell -ExecutionPolicy Bypass -File scripts/watch-provider-smoke.ps1 -Provider doubao -Scenario background-send -TimeoutSeconds 150
```

The goal is not just "message sent successfully". The goal is to prove that LLM Workbench and the provider website stay synchronized across:

- normal send and stream
- delayed first token
- manual recovery
- blocker / verification interruption
- reply resynchronization after missed UI updates
- send and stream while the provider drawer remains closed

## Preconditions

- Start the desktop app with a clean development build:
  - `pnpm --filter @aihub/desktop test -- --run app-service.test.ts provider-preload-integration.test.ts`
  - `pnpm typecheck`
- Make sure the target provider website is already reachable in LLM Workbench.
- Use a provider account that is stable enough to send several messages in a row.
- Keep the provider drawer visible for ordinary cases; the background-send case must keep it closed for the entire send and reply.

To trigger the built-in smoke request on Windows:

- `pnpm smoke:provider -- -Provider chatgpt`
- in a second terminal, wait for and summarize the result:
  - `pnpm smoke:watch -- -Provider chatgpt`
- to run a sequential provider matrix without request collisions:
- `pnpm smoke:matrix`
  - optional subset:
    - `pnpm smoke:matrix -- -Providers doubao,qianwen,hunyuan`
- to summarize the latest smoke JSON files across providers:
  - `pnpm smoke:summary`
- by default, the smoke scripts now target only the newest live LLM Workbench runtime
  diagnostics directory instead of broadcasting to every historical
  `LLM Workbench` / `@aihub/desktop` / `Electron` directory
- optional explicit user-data root:
  - `pnpm smoke:provider -- -Provider qianwen -UserDataDir "C:\Users\<you>\AppData\Roaming\AIHub"` (legacy data path)
  - `pnpm smoke:watch -- -Provider qianwen -UserDataDir "C:\Users\<you>\AppData\Roaming\AIHub"` (legacy data path)

## Debug Controls

The desktop chat header now exposes the recovery/debug controls used in this checklist:

- `Open provider page`
- `Retry provider recovery`
- `Submit in provider page`
- `Capture provider anchor`
- `Resync latest provider reply`
- `Load provider debug snapshot`
- `Copy provider diagnostics`
- `Toggle provider clean mode`

Use `Copy provider diagnostics` whenever a case fails. Save the copied text alongside the provider name, case id, and time.

## Expected Signals

During successful web-provider sends, expect these phases in order:

1. `checking-auth`
2. `capturing-anchor`
3. `typing-message` when text is injected by LLM Workbench
4. `submitting`
5. `confirming-submit`
6. `waiting-first-token`
7. `streaming`
8. `detecting-completion` only when text is already visible but completion is still waiting
9. `completed`

During manual recovery, expect this sequence:

1. `recoverable-blocked` after prompt fill
2. user fixes the provider page manually
3. `Submit in provider page`
4. normal monitored flow resumes from `submitting` onward

## Core Cases

Run every case at least on:

- `chatgpt`
- `claude`
- `doubao`
- `qianwen`
- `hunyuan` (`腾讯元宝`)

If time is limited, prioritize the Chinese providers first because their DOM and virtual-list behavior are the most fragile.

### Case 1: Normal Send

1. Create a fresh conversation.
2. Send a short prompt from LLM Workbench.
3. Wait for the reply to complete.

Pass criteria:

- the user message becomes `completed`
- exactly one assistant message is created in LLM Workbench
- assistant text matches the provider page
- copied diagnostics show:
  - `binding=bound-after-anchor...`
  - `fallback=false`
  - `decision=complete...` or a final completed state after completion check

### Case 2: Slow First Token

1. Send a prompt that usually takes longer to start.
2. Watch the message status before any visible assistant text appears.

Pass criteria:

- LLM Workbench stays in `waiting-first-token` instead of failing early
- once the provider starts streaming, the same assistant message continues
- no duplicate assistant message appears

### Case 3: Network-Gated Completion

1. Send a prompt that streams for multiple seconds.
2. Open a debug snapshot while the provider is visibly still working.

Pass criteria:

- LLM Workbench does not mark completion while the provider still shows generation state or active network
- diagnostics eventually show `network=active` before final completion
- completion only happens after network or generation indicators settle

### Case 4: Manual Recovery

1. Switch the provider backend to `manual`.
2. Send a prompt from LLM Workbench.
3. Confirm the user message lands in `recoverable-blocked`.
4. Fix any provider-side issue if needed.
5. Use `Submit in provider page`.

Pass criteria:

- LLM Workbench does not lose the original user message context
- the resumed send creates or resumes exactly one assistant reply
- if the first manual submit fails, a second submit can still recover the same message path
- provider summary failure state clears after successful completion

### Case 5: Auth / Verification Block

1. Trigger a provider state where login, captcha, rate limit, or verification blocks the send.
2. Send a prompt or resume a manual prompt.

Pass criteria:

- LLM Workbench records a recoverable failure, not a silent stall
- the failing phase is visible in provider diagnostics and provider summary
- copied diagnostics include the blocker reason
- after the blocker is cleared, submit or resync can continue without restarting the whole app

### Case 6: Missed Reply Resync

1. Send a prompt and wait until the provider page clearly shows the assistant reply.
2. Before LLM Workbench fully reflects the reply, use `Resync latest provider reply`.

Pass criteria:

- LLM Workbench binds to the latest assistant after the active anchor
- no older assistant turn is incorrectly recovered
- no duplicate assistant record is created

### Case 7: Anchor Integrity

1. In a conversation with older assistant turns, click `Capture provider anchor`.
2. Send a new prompt.
3. If possible, scroll so the provider page rerenders part of the message list.

Pass criteria:

- LLM Workbench binds to the new assistant turn only
- old assistant replies and recommendation cards are ignored
- diagnostics still show `bound-after-anchor...`

### Case 8: Clean Mode Safety

1. Turn on clean mode.
2. Repeat a normal send.
3. Turn clean mode off.

Pass criteria:

- composer, submit button, and assistant query still work
- clean mode does not hide the actual active composer or reply container
- clean mode still applies when the provider creates late shadow-root UI after the page first loads
- send success rate is unchanged

## Evidence To Capture

For each provider and case, record:

- provider name
- case id
- whether backend was `web` or `manual`
- final message result: pass or fail
- copied provider diagnostics
- smoke output JSON path when using the built-in provider smoke run
- screenshot of LLM Workbench and the provider page when failing
- exact blocker text if verification/login/rate limit appears

When using the built-in smoke path, check the desktop diagnostics directory for:

- `provider-smoke-<provider>.json`

That file now includes:

- final provider summary state
- provider debug snapshot
- recent adapter events

## Failure Triage

Use this mapping when a real-site case fails:

- `checking-auth`
  - provider login state, teaser composer, verification wall, unexpected auth modal
- `typing-message`
  - composer selector drift, input injection rejected, contenteditable behavior changed
- `confirming-submit`
  - provider accepted the click but did not clear composer, did not render a user turn, or changed submit busy indicators
- `waiting-first-token`
  - provider accepted the prompt but assistant turn discovery or generation detection did not start
- `recoverable-blocked`
  - provider created a visible blocker after submit; inspect blocker text and adapter-specific detection
- duplicated or stale assistant reply
  - anchor capture or assistant binding regression, usually in virtualized conversations

## Exit Criteria

The real-site regression pass is complete only if:

- every priority provider completes Cases 1 through 6
- at least one virtual-list or long-conversation run covers Case 7
- at least one provider verifies Case 8
- every failure has copied diagnostics attached
- there is no reproducible "provider page already replied but LLM Workbench stayed stale" case left without a captured explanation
