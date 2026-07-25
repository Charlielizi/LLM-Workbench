# Provider Smoke Baseline - 2026-07-10

This file records the latest verified real-site smoke outcomes after the `ProviderClient + WebsiteAdapter + observation pipeline` refactor work.

Current source of truth:

- workspace runtime restarted from the current codebase on `2026-07-10`
- smoke outputs under `%APPDATA%\\@aihub\\desktop\\diagnostics`
- runtime-scoped smoke requests targeted at the active workspace instance via `runtime-info.json`
- bootstrap evidence from [bootstrap.log](C:/Users/li/AppData/Roaming/@aihub/desktop/diagnostics/bootstrap.log)

Scope:

- Windows desktop dev build
- AIHub Electron app running from the current workspace
- provider smoke runs triggered while the app is already running

## Outcome Matrix

| Provider | Outcome | Verification | Failure phase | Failure code | Notes |
|---|---|---|---|---|---|
| `doubao` | `completed` | `normal-send-completed` | `none` | `none` | Latest rerun on `2026-07-10 15:59` Asia/Shanghai completed on runtime `f59b9eb1-0ccc-4ef7-bc1f-90ed4d7b0ae7`. Its ordered trace includes `waiting-first-token -> binding-assistant -> detecting-completion`, with `completionDecision=complete` and `assistantBinding=bound-after-anchor:0->2`. |
| `kimi` | `completed` | `normal-send-completed` | `none` | `none` | Current workspace runtime now completes Kimi end to end as well. The latest scoped smoke shows `assistantBinding=bound-after-anchor:0->2`, `completionDecision=complete`, and a matching `runtime.instanceId` in the result JSON. |
| `chatgpt` | `failed` | `auth-blocked` | `checking-auth` | `auth_required` | Latest runtime-scoped smoke on `2026-07-10 11:03` Asia/Shanghai resolves on runtime `22d6a204-a7a0-4b76-8fba-f86242e371d6` and reports `Login or provider verification is required before sending.` |
| `claude` | `failed` | `auth-blocked` | `checking-auth` | `auth_required` | Latest rerun on `2026-07-09 21:45` Asia/Shanghai lands on `https://claude.ai/logout` and now classifies cleanly as auth-blocked instead of timing out. |
| `qianwen` | `failed` | `auth-blocked` | `checking-auth` | `auth_required` | Compose path succeeds far enough to emit ordered typing-phase diagnostics, then provider auth/verification interrupts submit. |
| `hunyuan` (`腾讯元宝`) | `failed` | `auth-blocked` | `checking-auth` | `auth_required` | Current observed blocker is login/verification on the provider page. |
| `deepseek` | `failed` | `auth-blocked` | `checking-auth` | `auth_required` | Latest rerun on `2026-07-09 21:49` Asia/Shanghai lands on `https://chat.deepseek.com/sign_in` and classifies cleanly as auth-blocked. |

## What Changed In This Round

- Doubao no longer times out during `send-message` on the restarted runtime.
- The concrete fix was in [apps/desktop/src/provider-preload.ts](C:/Users/li/Documents/AIhub/apps/desktop/src/provider-preload.ts): `waitForUiSettle()` now uses `requestAnimationFrame` with a timeout fallback instead of depending on `rAF` only.
- Smoke diagnostics now keep a longer event window and derive `phaseTrace` from status events in ascending order, which makes successful and failed runs easier to compare.
- Claude is no longer ambiguous: the latest smoke moved it from `unclassified-failure / provider_submission_timeout` to a clean `auth-blocked` classification.
- Smoke requests are now scoped to the active workspace runtime instance, and smoke results record `runtime.instanceId`, `pid`, and `adapterEventSinceCreatedAt`, which removes cross-instance result pollution.
- The desktop app now also ignores stale smoke results from older runtime instances when showing provider diagnostics in the UI.
- Kimi is now a second verified completed provider on the current runtime, not just an old pre-scope success sample.
- The latest Doubao rerun proves the newly completed reply-binding phase is emitted by a real provider send, not only by the fixture pipeline.
- Post-start send phases are now persisted on the streaming assistant message, and OpenAI-compatible API failures terminate the assistant stream through `generation.failed`.
- A real Doubao `manual-recovery` smoke completed on runtime `92441944-eb66-4a90-99a9-5f09cd01eac5`. It exercised `recoverable-blocked -> submitting -> binding-assistant -> detecting-completion`, produced synchronized completed messages, and restored the persisted backend setting to `web` afterward.
- That first manual-recovery run exposed a stale page-level loading marker. Completion detection now treats streaming markers as assistant-turn-local; global generation state remains guarded by stop controls and network activity.
- A real Doubao `resync-latest` smoke completed on runtime `7cb977f1-381c-4213-b54d-5af409a40e8e`. The runner deleted the local completed assistant message, invoked the production resync command, and recovered a new completed assistant with `fallback-latest-visible-assistant`; the result records `resyncAttempted=true` and `resyncSucceeded=true`.
- A real Doubao `background-send` smoke completed on runtime `ffd798bf-1e39-4a90-a53b-f2277da20b6f` with `websiteVisible=false` for the entire run. It waited beyond the 30-second detach window, synchronized the streamed answer, deleted the local assistant message, and recovered it from the preload's last-completed snapshot with `resyncAttempted=true` and `resyncSucceeded=true`.

## Current Read

What is proven:

- The refactored observation pipeline can complete at least two real providers end to end on the current runtime: Doubao and Kimi.
- Doubao now also proves the real manual recovery path from prompt fill through resumed observation and completion.
- Doubao proves missed-client-reply recovery from the provider page after the local assistant record is intentionally removed.
- ChatGPT, Claude, Qianwen, and Hunyuan now fail with provider-auth-specific classifications rather than generic submit or compose ambiguity.
- The smoke output is now strong enough to distinguish:
  - real auth-blocked sessions
  - real end-to-end completions
  - runtime hangs caused by the preload send path
  - wrong-instance smoke consumption versus the active workspace runtime

What is not yet proven:

- Checklist-grade real-session validation for all providers beyond smoke flows
- Stable authenticated completion baselines for more than two providers

## Evidence Pointers

- [provider-smoke-doubao.json](C:/Users/li/AppData/Roaming/@aihub/desktop/diagnostics/provider-smoke-doubao.json)
- [provider-smoke-doubao-manual-recovery.json](C:/Users/li/AppData/Roaming/@aihub/desktop/diagnostics/provider-smoke-doubao-manual-recovery.json)
- [provider-smoke-doubao-resync-latest.json](C:/Users/li/AppData/Roaming/@aihub/desktop/diagnostics/provider-smoke-doubao-resync-latest.json)
- [provider-smoke-doubao-background-send.json](C:/Users/li/AppData/Roaming/@aihub/desktop/diagnostics/provider-smoke-doubao-background-send.json)
- [provider-smoke-kimi.json](C:/Users/li/AppData/Roaming/@aihub/desktop/diagnostics/provider-smoke-kimi.json)
- [provider-smoke-chatgpt.json](C:/Users/li/AppData/Roaming/@aihub/desktop/diagnostics/provider-smoke-chatgpt.json)
- [provider-smoke-claude.json](C:/Users/li/AppData/Roaming/@aihub/desktop/diagnostics/provider-smoke-claude.json)
- [provider-smoke-qianwen.json](C:/Users/li/AppData/Roaming/@aihub/desktop/diagnostics/provider-smoke-qianwen.json)
- [provider-smoke-hunyuan.json](C:/Users/li/AppData/Roaming/@aihub/desktop/diagnostics/provider-smoke-hunyuan.json)
- [provider-smoke-deepseek.json](C:/Users/li/AppData/Roaming/@aihub/desktop/diagnostics/provider-smoke-deepseek.json)
- [runtime-info.json](C:/Users/li/AppData/Roaming/@aihub/desktop/diagnostics/runtime-info.json)
- [bootstrap.log](C:/Users/li/AppData/Roaming/@aihub/desktop/diagnostics/bootstrap.log)
