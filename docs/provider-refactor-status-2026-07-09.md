# AIHub Refactor Status - 2026-07-09

This document audits the current state of the `ProviderClient + WebsiteAdapter + observation pipeline` refactor against the requested restructuring plan.

It is a status ledger based on current code, tests, and the latest real-site smoke evidence in:

- [docs/provider-smoke-baseline-2026-07-09.md](C:/Users/li/Documents/AIhub/docs/provider-smoke-baseline-2026-07-09.md)
- [bootstrap.log](C:/Users/li/AppData/Roaming/@aihub/desktop/diagnostics/bootstrap.log)

## Status Legend

- `implemented`: code exists and has direct verification evidence
- `partial`: code exists, but proof is incomplete or only unit/integration level
- `open`: not implemented or not yet evidenced

## 1. ProviderClient Abstraction

Status: `implemented`

Evidence:

- [apps/desktop/src/main/provider-client.ts](C:/Users/li/Documents/AIhub/apps/desktop/src/main/provider-client.ts)
  - `ProviderClient` interface
  - `ApiProviderClient`
  - `ManualProviderClient`
- [apps/desktop/src/main/app-service.ts](C:/Users/li/Documents/AIhub/apps/desktop/src/main/app-service.ts)
  - `sendMessage`, `submitProviderEnter`, `captureProviderAnchor`, `syncLatestProviderResponse`, `getProviderDebugSnapshot`
- [apps/desktop/tests/app-service.test.ts](C:/Users/li/Documents/AIhub/apps/desktop/tests/app-service.test.ts)

Notes:

- API backend remains intentionally partial. The interface and configuration surface exist, but this is not yet a full provider-by-provider official API integration.
- OpenAI-compatible API request failures now emit `generation.failed`, close the assistant stream, and preserve the already-sent user message as completed.

## 2. WebsiteAdapter System

Status: `implemented`

Evidence:

- [packages/adapters/src/website-adapter.ts](C:/Users/li/Documents/AIhub/packages/adapters/src/website-adapter.ts)
- [packages/adapters/src/website-adapters](C:/Users/li/Documents/AIhub/packages/adapters/src/website-adapters)
- [packages/adapters/src/definitions.ts](C:/Users/li/Documents/AIhub/packages/adapters/src/definitions.ts)
- [apps/desktop/tests/website-adapter-registry.test.ts](C:/Users/li/Documents/AIhub/apps/desktop/tests/website-adapter-registry.test.ts)
- [apps/desktop/tests/website-adapter-anchor.test.ts](C:/Users/li/Documents/AIhub/apps/desktop/tests/website-adapter-anchor.test.ts)
- [apps/desktop/tests/website-adapter-fixtures.test.ts](C:/Users/li/Documents/AIhub/apps/desktop/tests/website-adapter-fixtures.test.ts)

Notes:

- Legacy selector definitions are still present as fallback sources by design.

## 3. Anchor-Based Reply Binding

Status: `implemented`

Evidence:

- [apps/desktop/src/provider-preload.ts](C:/Users/li/Documents/AIhub/apps/desktop/src/provider-preload.ts)
  - `captureConversationBaseline`
  - `assistantElement`
  - `syncLatestResponse`
- [apps/desktop/tests/provider-preload-integration.test.ts](C:/Users/li/Documents/AIhub/apps/desktop/tests/provider-preload-integration.test.ts)
  - anchor capture, post-anchor resync, old-reply rejection
  - the live send state machine emits `binding-assistant` after `message.started`
- [apps/desktop/tests/app-service.test.ts](C:/Users/li/Documents/AIhub/apps/desktop/tests/app-service.test.ts)
  - post-start phases such as `binding-assistant` and `detecting-completion` are persisted on the streaming assistant message
- [provider-smoke-doubao.json](C:/Users/li/AppData/Roaming/@aihub/desktop/diagnostics/provider-smoke-doubao.json)
  - real smoke shows `assistantBinding=bound-after-anchor:0->2`

## 4. Completion Detection via DOM + Polling + Network Idle

Status: `implemented`

Evidence:

- [apps/desktop/src/provider-preload.ts](C:/Users/li/Documents/AIhub/apps/desktop/src/provider-preload.ts)
  - network idle state
  - completion signal aggregation
  - recoverable blocker handling
- [apps/desktop/src/provider-generation-policy.ts](C:/Users/li/Documents/AIhub/apps/desktop/src/provider-generation-policy.ts)
- [apps/desktop/tests/provider-generation-policy.test.ts](C:/Users/li/Documents/AIhub/apps/desktop/tests/provider-generation-policy.test.ts)
- [apps/desktop/tests/provider-preload-integration.test.ts](C:/Users/li/Documents/AIhub/apps/desktop/tests/provider-preload-integration.test.ts)
  - network-gated completion
  - auth interruption during submit confirmation
- [provider-smoke-doubao.json](C:/Users/li/AppData/Roaming/@aihub/desktop/diagnostics/provider-smoke-doubao.json)
  - real completion on the restarted runtime

## 5. Network Monitor Hooks

Status: `implemented`

Evidence:

- [apps/desktop/src/provider-preload.ts](C:/Users/li/Documents/AIhub/apps/desktop/src/provider-preload.ts)
  - fetch/XHR event bridge
- provider adapter network configs under [packages/adapters/src/website-adapters](C:/Users/li/Documents/AIhub/packages/adapters/src/website-adapters)
- [apps/desktop/tests/website-adapter-registry.test.ts](C:/Users/li/Documents/AIhub/apps/desktop/tests/website-adapter-registry.test.ts)

## 6. Debug Snapshot / Recovery Controls

Status: `implemented`

Evidence:

- [apps/desktop/src/renderer/components/chat/ChatView.tsx](C:/Users/li/Documents/AIhub/apps/desktop/src/renderer/components/chat/ChatView.tsx)
- [apps/desktop/src/renderer/components/layout/TopBar.tsx](C:/Users/li/Documents/AIhub/apps/desktop/src/renderer/components/layout/TopBar.tsx)
- [apps/desktop/src/renderer/components/composer/Composer.tsx](C:/Users/li/Documents/AIhub/apps/desktop/src/renderer/components/composer/Composer.tsx)
- [apps/desktop/src/renderer/utils/provider-diagnostics.ts](C:/Users/li/Documents/AIhub/apps/desktop/src/renderer/utils/provider-diagnostics.ts)
- [apps/desktop/src/renderer/utils/message-status.ts](C:/Users/li/Documents/AIhub/apps/desktop/src/renderer/utils/message-status.ts)
- [docs/provider-web-regression-checklist.md](C:/Users/li/Documents/AIhub/docs/provider-web-regression-checklist.md)

Notes:

- Recoverable manual-send states are surfaced in the normal chat UI, including open-provider, submit-there, and resync actions.

## 7. Clean Mode

Status: `implemented`

Evidence:

- [apps/desktop/src/provider-preload.ts](C:/Users/li/Documents/AIhub/apps/desktop/src/provider-preload.ts)
- adapter CSS hooks under [packages/adapters/src/website-adapters](C:/Users/li/Documents/AIhub/packages/adapters/src/website-adapters)
- [apps/desktop/tests/provider-preload-integration.test.ts](C:/Users/li/Documents/AIhub/apps/desktop/tests/provider-preload-integration.test.ts)

## 8. Provider Smoke Tooling

Status: `implemented`

Evidence:

- [apps/desktop/src/main/provider-smoke.ts](C:/Users/li/Documents/AIhub/apps/desktop/src/main/provider-smoke.ts)
- [apps/desktop/src/main/main.ts](C:/Users/li/Documents/AIhub/apps/desktop/src/main/main.ts)
- scripts under [scripts](C:/Users/li/Documents/AIhub/scripts)
- [apps/desktop/tests/provider-smoke.test.ts](C:/Users/li/Documents/AIhub/apps/desktop/tests/provider-smoke.test.ts)
- [apps/desktop/tests/provider-smoke-summary.test.ts](C:/Users/li/Documents/AIhub/apps/desktop/tests/provider-smoke-summary.test.ts)

Notes:

- This round tightened smoke fidelity further:
  - `waitForUiSettle()` now has an `rAF` timeout fallback
  - smoke diagnostics now retain a larger event window
  - verification `phaseTrace` is built from ordered `message.status` events instead of arbitrary recent event order
- smoke requests are now pinned to a target runtime instance and results record runtime provenance
- the desktop UI now distinguishes `matched`, `missing`, and `stale` smoke results instead of silently accepting same-directory leftovers
  - clean mode now reinjects adapter CSS into shadow roots that are created after clean mode is already enabled

## 9. Real-Site Evidence

Status: `partial`

What is proven:

- `doubao` now completes end to end again on the restarted runtime.
- the `2026-07-10 15:59` Doubao rerun on runtime `f59b9eb1-0ccc-4ef7-bc1f-90ed4d7b0ae7` includes the full `binding-assistant` phase in its ordered real-site trace.
- a dedicated real `manual-recovery` scenario now completes on Doubao and restores the original provider backend settings in a `finally` path.
- a dedicated real `resync-latest` scenario now proves that deleting the local assistant record and invoking production resync recovers the current webpage reply.
- a dedicated real `background-send` scenario now proves that Doubao can send, stream, complete, and resynchronize while the provider drawer remains closed beyond the detach window.
- `kimi` now also completes end to end on the current workspace runtime.
- the remaining five providers now all fail cleanly as `auth_required / checking-auth` with provider-page evidence in their debug snapshots.
- the refactored runtime can now distinguish a real send-path hang from a real auth interruption.
- the smoke pipeline can now distinguish the active workspace runtime from stale AIHub instances targeting the same `%APPDATA%` directory.
- the in-app diagnostics view now enforces the same runtime-instance boundary as the smoke scripts.

What is not yet proven:

- checklist-grade manual regression coverage across all providers beyond smoke

Evidence:

- [docs/provider-smoke-baseline-2026-07-09.md](C:/Users/li/Documents/AIhub/docs/provider-smoke-baseline-2026-07-09.md)
- live smoke files under [C:/Users/li/AppData/Roaming/@aihub/desktop/diagnostics](C:/Users/li/AppData/Roaming/@aihub/desktop/diagnostics)

## 10. Overall Read

Refactor implementation status: `implemented`

Cross-provider authenticated validation status: `partial`

Every architecture, interface, preload command, recovery control, adapter, fixture category, and integration path requested by the restructuring plan is implemented. The remaining gap is provider-account proof breadth, not missing restructuring work.

What changed materially in this round:

1. the Doubao regression was fixed at the preload runtime layer, not by another selector tweak
2. Claude was re-baselined from an ambiguous timeout to a clean auth-blocked failure
3. Kimi and DeepSeek were re-baselined onto the new structured verification format
4. Kimi is now a second verified completed provider on the active workspace runtime
5. smoke verification is now strong enough to reconstruct ordered provider send phases from a real run and attribute them to the correct runtime instance
6. clean mode no longer depends on provider shadow DOM being fully present at first injection time
7. post-start phases now update the persisted assistant message instead of existing only in adapter logs
8. API request failures now close the assistant stream with a structured failure event instead of leaving it indefinitely streaming
9. the Windows Squirrel build now has required author metadata and pnpm explicitly allows the `electron-winstaller`/`esbuild` install scripts; `AIHub-Setup.exe` was generated successfully from the current tree
10. smoke tooling now supports an isolated `manual-recovery` scenario with separate result files and automatic settings restoration
11. a real Doubao manual-recovery run exposed and fixed stale page-level streaming-marker interference
12. a real Doubao resync run recovered an intentionally removed local assistant message from the current provider page
13. hidden provider automation now keeps a normal-sized offscreen surface during work, releases it after terminal events, and caches the last completed reply for recovery when a virtualized DOM is unavailable

Useful follow-up validation goals are:

1. add at least one more authenticated end-to-end completion beyond Doubao and Kimi
2. broaden checklist-grade real-session validation of slow and blocked completion paths across authenticated providers
3. continue shrinking provider-specific ambiguity until remaining failures are dominated by account state or provider-side policy rather than runtime uncertainty
