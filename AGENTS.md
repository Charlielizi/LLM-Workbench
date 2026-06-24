# AIHub — Developer Guide for AI Assistants

## Project Overview

AIHub is a Windows-first Electron desktop application that unifies seven AI provider websites (ChatGPT, Claude, 豆包, Kimi, DeepSeek, 腾讯元宝, 千问) into a single local interface. Each provider runs in an isolated, persistent `WebContentsView` (Electron `BrowserView`-style view) controlled via a preload script over IPC. Messages are normalized into a common schema and persisted in SQLite on the user's machine.

The monorepo is structured with **pnpm workspaces** (`pnpm-workspace.yaml`):
- `apps/desktop` — Electron + React + Vite + SQLite main client
- `apps/windows-native` — .NET 8 WebView2 lightweight alternative
- `apps/windows-native-tests` — C# test project
- `packages/core` — Shared TypeScript types, Zod schemas, and transfer protocol
- `packages/adapters` — DOM selector definitions for each provider website

---

## Key Architecture Rules

### TypeScript
- **Target**: ES2022, **module**: ESNext, **moduleResolution**: Bundler
- Strict mode with `noUncheckedIndexedAccess: true`
- Use Zod for all IPC payload validation in `packages/core/src/schemas.ts`
- Avoid runtime `any` — prefer `unknown` + Zod.parse

### Import Conventions
- Monorepo packages are imported by name (e.g., `@aihub/core`, `@aihub/adapters`), not by relative path
- External Electron imports use `import X from "electron"` (ESM-style)
- Node builtins use `node:` prefix (e.g., `import path from "node:path"`)

### IPC Architecture (apps/desktop)
- **Main process** handles all business logic via `AppService`
- IPC channels are registered in `apps/desktop/src/main/ipc.ts` and validated with Zod schemas from `@aihub/core`
- The **preload script** (`apps/desktop/src/preload.ts`) exposes a typed `AIHubApi` via `contextBridge.exposeInMainWorld("aihub", ...)`
- Renderer never accesses Node APIs or Electron internals (`contextIsolation: true`, `sandbox: true`)
- Provider websites are loaded in separate `WebContentsView` instances with their own partition and a provider-specific preload (`provider-preload.ts`)

### Provider Website Integration
- No private API calls — the app drives **public website UI** through semantic DOM adapters
- Each provider has its own persistent `session.fromPartition("persist:provider-{id}")`
- DOM selectors (composer, submit button, assistant messages, login markers) are defined in `packages/adapters/src/definitions.ts`
- A **circuit breaker** (`ProviderRuntime.tripCircuit`) marks a provider as degraded and shows its website for recovery
- Navigation to non-allowed origins is intercepted and opened externally via `shell.openExternal`

### Data Layer
- SQLite via Node built-in `node:sqlite` (Node 22+, `DatabaseSync`)
- Schema migrations in `AppDatabase.migrate()` — tables: `providers`, `conversations`, `messages`, `message_fragments`, `transfers`, `adapter_events`
- All timestamps are ISO-8601 strings
- Conversation transfer (ChatGPT → Claude) uses a structured Markdown format with 8 required headings (defined in `packages/core/src/transfer.ts`)

### Testing
- **TypeScript**: Vitest (`pnpm --filter @aihub/desktop test`)
- **C#**: `dotnet test` for the native test project
- Test files live in `<project>/tests/` or alongside source with `.test.ts` extension

### Build & Package
- **Desktop**: Electron Forge with Vite plugin (`forge.config.ts`); produces an MSI/Squirrel installer for Windows
- **Native**: `dotnet publish` targeting `net8.0-windows`
- `pnpm dev` starts the desktop dev server
- `pnpm build` runs `electron-forge package`

---

## File Navigation Map

### Apps
| Path | Purpose |
|---|---|
| `apps/desktop/src/main/main.ts` | Electron entry, window creation, provider lifecycle |
| `apps/desktop/src/main/app-service.ts` | Core orchestration — conversations, messages, transfer |
| `apps/desktop/src/main/database.ts` | SQLite persistence (DatabaseSync) |
| `apps/desktop/src/main/provider-runtime.ts` | Per-provider WebContentsView lifecycle |
| `apps/desktop/src/main/ipc.ts` | Zod-validated IPC handlers |
| `apps/desktop/src/renderer/App.tsx` | React UI — sidebar, message list, composer, transfer modal |
| `apps/desktop/src/preload.ts` | contextBridge API surface |
| `apps/desktop/src/provider-preload.ts` | Injected into provider website views |
| `apps/desktop/tests/` | Vitest test directory |

### Packages
| Path | Purpose |
|---|---|
| `packages/core/src/types.ts` | ProviderId, NormalizedMessage, ProviderAdapter interface, events |
| `packages/core/src/schemas.ts` | Zod schemas for all IPC payloads |
| `packages/core/src/transfer.ts` | Markdown transfer protocol and validation |
| `packages/adapters/src/definitions.ts` | DOM selectors for 7 providers |

### Native Variant
| Path | Purpose |
|---|---|
| `apps/windows-native/` | .NET 8 WebView2 client, independent of Electron |
| `apps/windows-native-tests/` | Associated C# tests |

---

## Common Tasks

**Adding a new provider:**
1. Add its ID to `PROVIDER_IDS` in `packages/core/src/types.ts`
2. Add its label in `PROVIDER_LABELS`
3. Add corresponding Zod schema enum update in `packages/core/src/schemas.ts`
4. Add DOM selectors in `packages/adapters/src/definitions.ts`
5. Provider runtime (WebContentsView, IPC) auto-wires via `PROVIDER_IDS` loop — no main-process changes

**Adding a new IPC channel:**
1. Add the handler in `apps/desktop/src/main/ipc.ts` with Zod validation
2. Add the method to `AppService` in `apps/desktop/src/main/app-service.ts`
3. Expose the call via `preload.ts`
4. Add the type definition in `apps/desktop/src/global.d.ts`

**Modifying the transfer protocol:**
- Edit `REQUIRED_HEADINGS` and generator functions in `packages/core/src/transfer.ts`
- Both preview (`buildTransferDraft`) and compression (`buildCompressionPrompt`) must stay in sync

---

## Conventions

- **File names**: kebab-case for most files (e.g., `app-service.ts`, `provider-runtime.ts`)
- **Classes**: PascalCase (e.g., `AppService`, `ProviderRuntime`, `AppDatabase`)
- **TypeScript files**: use `.ts` (not `.tsx`) for non-React files
- **CSS**: single `styles.css` in `apps/desktop/src/renderer/styles.css`
- **Git**: branch prefix `codex/`; no commits unless explicitly requested
- **No `any` types** — prefer `unknown` with Zod or explicit interfaces
- **No inline code comments** unless explaining non-obvious intent
- **All IPC-bound data must pass through a Zod schema** — no raw `unknown` across the bridge
- **Use pnpm filters** (`pnpm --filter @aihub/desktop <cmd>`) instead of root npm scripts

This project runs on **Windows** (primary) with macOS secondary support. Path separators, line endings, and shell commands default to Windows conventions.
