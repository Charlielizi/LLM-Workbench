# Provider Web Regression Result Template

Use this template together with [provider-web-regression-checklist.md](C:/Users/li/Documents/AIhub/docs/provider-web-regression-checklist.md).

Create one copy per provider run, or keep one file per date and append multiple providers.

## Run Metadata

- Date:
- Tester:
- App build or commit:
- OS:
- Provider:
- Backend mode: `web` or `manual`
- Provider account or environment note:

## Preconditions

- Desktop tests passed: `yes` or `no`
- `pnpm typecheck` passed: `yes` or `no`
- Provider page reachable in AIHub: `yes` or `no`
- Clean login state confirmed before run: `yes` or `no`

## Case Results

| Case | Result | Notes | Diagnostics copied | Screenshot captured |
|---|---|---|---|---|
| 1. Normal Send |  |  |  |  |
| 2. Slow First Token |  |  |  |  |
| 3. Network-Gated Completion |  |  |  |  |
| 4. Manual Recovery |  |  |  |  |
| 5. Auth / Verification Block |  |  |  |  |
| 6. Missed Reply Resync |  |  |  |  |
| 7. Anchor Integrity |  |  |  |  |
| 8. Clean Mode Safety |  |  |  |  |

## Failure Summary

- Was there any reproducible `provider page already replied but AIHub stayed stale` case?
- If yes, which case id?
- If yes, did `Resync latest provider reply` recover it?
- If yes, did `Copy provider diagnostics` capture the blocker or binding path clearly?

## Provider Summary State

Record the final visible provider state from AIHub after the run:

- authenticated:
- degraded:
- websiteVisible:
- lastFailurePhase:
- lastFailureCode:
- reason:

## Diagnostics Excerpts

Paste the most useful lines from `Copy provider diagnostics`:

```text
provider=
state=
failurePhase=
failureCode=
reason=
binding=
fallback=
network=
decision=
signals=
```

## Screenshots And Files

- AIHub screenshot path:
- Provider page screenshot path:
- Any extra console/log capture path:

## Triage Notes

Use this section only when something fails.

- Suspected layer:
  - `adapter selectors`
  - `composer injection`
  - `submit confirmation`
  - `assistant binding`
  - `completion detection`
  - `manual recovery`
  - `provider blocker detection`
- Suspected provider DOM symptom:
- Suspected next fix:

## Exit Decision

- Provider run status: `pass`, `pass with caveats`, or `fail`
- Can this provider be considered stable enough for the current milestone?
- If not, what exact reproducible blocker remains?
