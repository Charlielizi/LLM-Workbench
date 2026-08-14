# LLM Workbench

![LLM Workbench logo](apps/desktop/assets/llm-workbench.svg)

Windows-first Electron prototype that presents ChatGPT, Claude, 豆包, Kimi,
DeepSeek, 腾讯元宝（混元）and 千问 through one local interface while keeping
each provider in an isolated persistent browser session.

The public product name is **LLM Workbench**. Legacy bridge names such as
`window.aihub`, `AIHUB_*`, `@aihub/*`, and the `aihub.sqlite` database filename
remain stable so existing local data and automation scripts continue to work.

## Development

```powershell
pnpm install
pnpm dev
```

## Autonomous Electron validation

The local AI validation path launches a real Electron window against an
isolated deterministic Mock Provider. It exercises visible controls with
Playwright, checks layout geometry and the approved screenshot baseline, and
never reads or writes the normal user profile.

```powershell
corepack pnpm test:ai
```

The command runs workspace type checks and Vitest, builds Electron, executes
the Playwright Electron suite, and writes Markdown, JSON, JUnit and HTML
results under `artifacts/ai-validation/<run-id>/`. Use `-- --skip-build` only
when validating an already current local build. Screenshot baselines are
updated separately with
`corepack pnpm --filter @aihub/desktop test:ai:e2e:update` and must be reviewed.

`corepack pnpm test:ai -- --real-providers` additionally runs the real-provider
text-equivalence matrix over CDP port `9222`: background short answer, long
answer, three contextual follow-ups, stop-and-resend, normalized website/body
hash comparison, screenshots, DOM summaries and redacted transport timelines.
Existing authenticated sessions run unattended. Logged-out ChatGPT or Claude
sessions are recorded as `AuthBlocked`; login, CAPTCHA, QR-code and risk-control
challenges are never bypassed. Use `AIHUB_CDP_PORT` to select a different port.

Start the authenticated desktop instance with its loopback-only CDP port before
running the real matrix:

```powershell
$env:AIHUB_CDP_PORT = "9222"
pnpm dev
# In another terminal:
pnpm test:real-providers
```

## 免费 Windows 发布

公开开源发布使用 SignPath Foundation 的免费签名，更新源使用 GitHub
Release 与 `update.electronjs.org`。首次配置、GitHub Actions 变量和干净
Windows 冒烟验证步骤见 [免费 Windows 发布路线](./docs/free-windows-release.md)。

### Native Windows build

The lightweight WebView2 + .NET implementation lives in `apps/windows-native`.
It uses the system Edge WebView2 runtime and creates one isolated user-data
folder per provider.

```powershell
.\.dotnet\dotnet.exe run --project .\apps\windows-native
```

This project drives public website UI through semantic DOM adapters. It does
not call private website APIs, bypass authentication challenges, or export
authentication cookies.

## Provider Regression

For the reworked web-provider pipeline, use these docs when validating real provider sessions:

- [Complete Validation Test Plan](./docs/validation-test-plan.md)
- [Validation Test Run Template](./docs/validation-test-run-template.md)
- [AI Autonomous UI and Interaction Validation](./docs/ai-autonomous-ui-validation-plan.md)
- [Provider Web Regression Checklist](./docs/provider-web-regression-checklist.md)
- [Provider Web Regression Result Template](./docs/provider-web-regression-template.md)

Provider smoke helpers:

- `pnpm smoke:provider -- -Provider chatgpt`
- `pnpm smoke:watch -- -Provider chatgpt`
- `pnpm smoke:matrix`
- `pnpm smoke:matrix -- -Providers doubao,qianwen,yuanbao`
- `pnpm smoke:summary`

## Current vertical slice

- Seven isolated, lazily loaded `WebContentsView` provider sessions
- Login/recovery by temporarily showing the provider website
- Unified local conversations and streamed provider events
- SQLite persistence in Electron's user-data directory
- Previewed ChatGPT-to-Claude context transfer
- Adapter circuit breaker and strict IPC validation
