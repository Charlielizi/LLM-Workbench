# AIHub

Windows-first Electron prototype that presents ChatGPT, Claude, 豆包, Kimi,
DeepSeek, 腾讯元宝（混元）and 千问 through one local interface while keeping
each provider in an isolated persistent browser session.

## Development

```powershell
pnpm install
pnpm dev
```

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

## Current vertical slice

- Seven isolated, lazily loaded `WebContentsView` provider sessions
- Login/recovery by temporarily showing the provider website
- Unified local conversations and streamed provider events
- SQLite persistence in Electron's user-data directory
- Previewed ChatGPT-to-Claude context transfer
- Adapter circuit breaker and strict IPC validation
