# AIHub UI 全面优化计划 — 达到 Open WebUI 级别的用户体验

> 批准时间: 2026-06-24
> 状态: Phase 1–14 已实现，进入完整验证与运行审计

## 实施进度

- [x] Tailwind CSS v4 与双主题变量接入
- [x] Zustand 应用、设置、输入草稿与 Toast store
- [x] `App.tsx` 切换为布局、侧栏、聊天、输入框、弹窗等组件化架构
- [x] Lucide 图标、侧栏折叠与拖拽宽度
- [x] 日期分组、草稿恢复、自动扩展输入框与 Token 估算
- [x] 清理旧 `styles.css`，Renderer 完成 Tailwind 迁移
- [x] TypeScript 检查、Renderer 生产构建与 Desktop Vitest 验证
- [x] Phase 2：搜索、置顶、右键菜单与 Provider 过滤
- [x] Phase 3：Markdown、高亮代码块与消息操作
- [x] Phase 4：输入增强、草稿、Token 与附件 UI
- [x] Phase 5：Provider 右侧抽屉、能力徽章与登录恢复
- [x] Phase 6：系统提示词数据库、注入与管理 UI
- [x] Phase 7：任意 Provider 迁移与可选压缩
- [x] Phase 8：多 Provider 并行对比
- [x] Phase 9：本地知识库
- [x] Phase 10：文件夹、标签、批量操作与导入导出
- [x] Phase 11：快捷键系统
- [x] Phase 12：Toast 与 Provider 状态通知
- [x] Phase 13：设置面板
- [x] Phase 14：欢迎与新手引导

## Context

AIHub 是一个通过 DOM 自动化驱动 7 个 AI 服务商官网的 Electron 桌面应用（ChatGPT、Claude、豆包、Kimi、DeepSeek、腾讯元宝、千问）。当前 Electron 版 UI 极其简陋：单个 282 行的 `App.tsx` 包含全部 UI 逻辑，410 行手写 CSS，仅暗色主题，无组件拆分，无 Markdown 渲染，无消息操作，无搜索，无系统提示词。目标是通过纯客户端改造，达到 Open WebUI 级别的交互体验。

**核心约束**：不使用任何 API，所有操作通过 DOM 自动化完成。这意味着 Open WebUI 中的 system prompt、temperature 等 API 功能需要通过"消息包装注入"等变通方案实现。

---

## 关键文件

| 文件 | 作用 |
|---|---|
| `apps/desktop/src/renderer/App.tsx` | 当前单体 UI 组件，需完全拆分 |
| `apps/desktop/src/renderer/styles.css` | 410 行手写 CSS，迁移到 Tailwind |
| `apps/desktop/src/main/app-service.ts` | 中心编排服务，所有新功能的 IPC 处理入口 |
| `apps/desktop/src/main/database.ts` | SQLite 数据库，需扩展 schema |
| `apps/desktop/src/main/ipc.ts` | 7 个 IPC 通道，需大幅扩展 |
| `apps/desktop/src/preload.ts` | 渲染进程 API 暴露层 |
| `apps/desktop/src/provider-preload.ts` | Provider DOM 操作脚本 |
| `apps/desktop/src/main/provider-runtime.ts` | Provider WebContentsView 管理 |
| `packages/core/src/types.ts` | 核心类型定义 |
| `packages/core/src/schemas.ts` | Zod 验证 schema |
| `packages/adapters/src/definitions.ts` | 7 个 Provider 的 DOM 选择器定义 |

---

## Phase 1: 基础架构重构 (P0)

### 1A. 安装依赖

```
pnpm add zustand tailwindcss @tailwindcss/vite lucide-react react-markdown remark-gfm rehype-highlight highlight.js
```

### 1B. Tailwind CSS 集成

- 在 `apps/desktop/vite.renderer.config.ts` 添加 Tailwind Vite 插件
- 新建 `apps/desktop/src/renderer/index.css`（`@import "tailwindcss"`）
- 新建主题 CSS 变量文件（深色/浅色双主题）
- 逐组件从 `styles.css` 迁移到 Tailwind class，删除旧 CSS

### 1C. Zustand 状态管理

新建 3 个 store：

- `stores/app-store.ts` — 替代 App.tsx 中所有 useState，管理 providers/conversations/selectedId，订阅 `window.aihub.onSnapshot()`
- `stores/settings-store.ts` — 主题偏好、默认 Provider、侧栏宽度、快捷键绑定，持久化到 localStorage
- `stores/composer-store.ts` — 按 conversationId 保存草稿

### 1D. 组件拆分

将 `App.tsx` 逐步拆分为：

```
components/
  layout/    → AppShell, TopBar, Sidebar
  sidebar/   → ConversationList, ConversationItem, SidebarSearch, NewConversationMenu, ProviderFilterTabs
  chat/      → ChatView, MessageList, MessageBubble, MessageContent, CodeBlock, MessageActions, MessageStatus
  composer/  → Composer
  modals/    → TransferModal, SettingsModal, SystemPromptModal
  shared/    → Modal, Toast, ContextMenu, EmptyState
hooks/       → useKeyboard, useAutoScroll, useConversationSearch
utils/       → date-grouping, token-estimate
```

### 1E. 主题系统

- CSS 变量定义深色/浅色两套配色
- `data-theme` 属性切换，`settings-store` 持久化偏好
- 默认跟随系统 `prefers-color-scheme`

### 1F. 图标系统

使用 `lucide-react`：Search, Plus, Pin, Trash, Copy, RotateCcw, Edit, Settings, ChevronLeft/Right, Folder, Tag, Paperclip, Send, StopCircle, Moon, Sun 等

---

## Phase 2: 侧栏重构 (P0)

### 2A. 会话搜索

- 新 IPC 通道 `conversation:search`
- SQLite LIKE 查询（< 10k 会话时足够）
- 300ms 防抖输入

### 2B. 日期分组

"今天 / 昨天 / 本周 / 本月 / 更早" 分组标题

### 2C. 置顶会话

- DB: `conversations` 表新增 `pinned INTEGER`, `pinned_at TEXT`
- 新 IPC: `conversation:pin`
- 置顶项显示在列表顶部

### 2D. 右键菜单

Context Menu: 重命名、删除、置顶、导出、迁移、复制 ID

### 2E. 可拖拽调整宽度的侧栏

- 拖拽手柄调整宽度 (200px-480px)
- 双击重置为默认 270px
- 折叠模式仅显示图标

### 2F. Provider 过滤标签

在会话列表上方显示 Provider 切换标签，点击过滤

---

## Phase 3: 聊天界面升级 (P0)

### 3A. Markdown 渲染

- 使用 `react-markdown` + `remark-gfm` + `rehype-highlight`
- 支持表格、删除线、任务列表、代码块语法高亮
- 不引入 `rehype-raw`（安全考虑）

### 3B. 代码块组件

- 语言标签 + 一键复制按钮
- highlight.js 语法高亮（JS/TS, Python, Rust, Go, Java, C/C++, SQL, JSON, YAML, Shell, HTML, CSS）

### 3C. 消息操作栏

Hover 显示：复制 / 重试 / 编辑重发 / 删除

新 IPC: `message:delete`, `message:edit-resend`

### 3D. 消息状态指示器

- streaming: 脉冲动画圆点
- pending: 时钟图标
- failed: 感叹号 + 重试按钮

### 3E. 流式文本动画

streaming 状态时在文本末尾显示闪烁光标

---

## Phase 4: 输入区域升级 (P1)

### 4A. 自动扩展 Textarea

随内容自动增高，最大 220px

### 4B. Token 估算

英文 ~4 字符/token，中文 ~2 字符/token，显示在输入框下方

### 4C. 草稿自动保存

切换会话时恢复草稿，发送后清除

### 4D. 文件附件 UI (P1)

拖拽区域 + 文件预览 chips，实际注入 Provider DOM 需逐 Provider 扩展适配器选择器

---

## Phase 5: Provider 管理升级 (P1)

### 5A. 分屏抽屉（替代全屏切换）

当前 `setWebsiteVisible` 隐藏整个 React UI。改为右侧抽屉：

- 主进程修改 `ProviderRuntime.layout()` 接受自定义 bounds
- 新 IPC: `provider:set-layout`
- React UI 始终可见，Provider 网站在右侧抽屉
- 可拖拽分割线调整比例

### 5B. Provider 能力标签

在 `ProviderDefinition` 中新增静态 `capabilities` 数组，UI 中显示为徽章

### 5C. 登录状态恢复流程

未登录时在聊天区显示醒目横幅 + "打开登录页" 按钮

---

## Phase 6: 系统提示词注入 (P0 — 核心差异化功能)

这是最关键的功能创新。由于无法通过 API 设置 system prompt，我们通过消息包装注入实现。

### 6A. 数据库

```sql
CREATE TABLE system_prompts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  content TEXT NOT NULL,
  provider TEXT,           -- NULL = 全 Provider 通用
  is_default INTEGER DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
ALTER TABLE conversations ADD COLUMN system_prompt_id TEXT;
```

### 6B. 消息包装函数

`packages/core/src/system-prompt.ts` — `wrapWithSystemPrompt()`:

```
[系统指令 - 请在整个对话中遵循以下指导]
{systemPrompt}
[系统指令结束]

{userMessage}
```

### 6C. 集成点

在 `AppService.sendMessage()` 中，发送前检查当前会话是否有绑定的系统提示词，如有则包装消息文本

### 6D. UI

- 系统提示词管理 Modal（CRUD + Provider 范围选择 + 设为默认）
- Composer 上方显示当前激活的提示词 chip
- 设置页面中的提示词库管理

新 IPC: `system-prompt:create/update/delete/list/set-for-conversation`

---

## Phase 7: 会话迁移系统升级 (P1)

### 7A. 任意 Provider 间迁移

当前仅支持 ChatGPT → Claude。泛化：

- `TransferPreview.targetProvider` 从 `"claude"` 改为 `ProviderId`
- `previewTransfer()` 接受 `targetProvider` 参数
- `confirmTransfer()` 使用目标 Provider 的 runtime

### 7B. 迁移对话框增强

- 目标 Provider 下拉选择器
- 压缩 Provider 选择（可选跳过压缩）
- 编辑预览

---

## Phase 8: 多模型并行对比 (P1)

### 8A. 数据库

```sql
CREATE TABLE comparison_sessions (id TEXT PK, title TEXT, created_at, updated_at);
CREATE TABLE comparison_participants (
  session_id FK, conversation_id FK, provider TEXT,
  PRIMARY KEY (session_id, conversation_id)
);
```

### 8B. 发送流程

选择 2-4 个 Provider → 同时创建会话 → 并行发送 → 各自独立流式更新

### 8C. 分栏布局

`ComparisonView.tsx` — N 列等宽布局，每列独立滚动，共享底部 Composer

新 IPC: `comparison:create`, `comparison:send`

---

## Phase 9: 本地知识库 (P2)

### 9A. 文档存储

```sql
CREATE TABLE documents (id TEXT PK, name, file_path, content TEXT, mime_type, size_bytes, created_at, updated_at);
CREATE TABLE conversation_documents (conversation_id FK, document_id FK, PK(...));
```

支持 .txt, .md, .json, .csv, .pdf 文本提取

### 9B. 关键词匹配检索（无向量数据库）

`packages/core/src/retrieval.ts` — TF-IDF-lite：按段落分块 → 关键词匹配 → 返回 Top-N 相关片段

### 9C. 上下文注入

发送消息时自动附加相关文档片段到消息前缀

### 9D. UI

- 知识库管理面板
- 每个会话可关联/取消关联文档

---

## Phase 10: 会话管理增强 (P1)

### 10A. 文件夹和标签

```sql
CREATE TABLE folders (id TEXT PK, name, parent_id FK, created_at);
CREATE TABLE tags (id TEXT PK, name UNIQUE, color, created_at);
CREATE TABLE conversation_tags (conversation_id FK, tag_id FK, PK(...));
ALTER TABLE conversations ADD COLUMN folder_id FK;
```

### 10B. 批量操作

IPC `conversation:bulk-action` — 批量删除/导出/迁移/移动/打标签

### 10C. 导出/导入

- Markdown 格式导出（带角色标题和时间戳）
- JSON 格式完整导出

### 10D. 全文搜索增强

SQLite FTS5 虚拟表，全文索引消息内容

---

## Phase 11: 快捷键系统 (P1)

| 快捷键 | 功能 |
|---|---|
| `Ctrl+K` | 聚焦搜索 |
| `Ctrl+N` | 新建会话 |
| `Ctrl+\` | 切换侧栏 |
| `Ctrl+Shift+M` | 切换 Provider 抽屉 |
| `Ctrl+Shift+T` | 切换主题 |
| `Ctrl+Shift+C` | 复制最后 AI 回复 |
| `Ctrl+[` / `Ctrl+]` | 切换上/下会话 |
| `Ctrl+/` | 快捷键帮助 |
| `Esc` | 关闭弹窗 |

可自定义绑定，存储在 settings-store

---

## Phase 12: Toast 通知 + Provider 状态 (P1)

- Zustand toast store，底部右下角堆叠显示
- Provider 状态变化时 Toast 提示
- 侧栏会话项显示 streaming 状态

---

## Phase 13: 设置面板 (P1)

5 个标签页：通用设置 / 系统提示词 / 快捷键 / 知识库 / 关于

---

## Phase 14: 欢迎体验 (P2)

- 新手引导流程
- 建议卡片（快速开始）
- Provider 状态总览

---

## 新增 IPC 通道汇总

**会话管理**: `conversation:search`, `conversation:rename`, `conversation:delete`, `conversation:export`, `conversation:import`, `conversation:pin`, `conversation:bulk-action`, `conversation:set-folder`, `conversation:set-tags`, `conversation:set-documents`

**系统提示词**: `system-prompt:create`, `system-prompt:update`, `system-prompt:delete`, `system-prompt:list`, `system-prompt:set-for-conversation`

**迁移**: `transfer:preview` (扩展), `transfer:confirm` (扩展)

**对比**: `comparison:create`, `comparison:send`

**文档**: `document:add`, `document:remove`, `document:list`

**文件夹/标签**: `folder:create/rename/delete/list`, `tag:create/delete/list`

**设置**: `settings:get`, `settings:set`, `settings:export`, `settings:import`

**Provider**: `provider:set-layout`

**通用**: `app:open-external`, `message:delete`, `message:edit-resend`

每个通道需要：Zod schema (`packages/core/src/schemas.ts`) + IPC handler (`ipc.ts`) + AppService 方法 + preload 暴露 + 类型声明

---

## 实施顺序

| Sprint | 周期 | 内容 |
|---|---|---|
| 1 | 2-3 周 | Phase 1 (基础架构) + DB schema 扩展 + IPC 通道桩 |
| 2 | 2 周 | Phase 2 (侧栏) + Phase 3 (聊天界面) |
| 3 | 2 周 | Phase 5 (Provider 管理) + Phase 6 (系统提示词) |
| 4 | 1-2 周 | Phase 4 (输入区域) + Phase 12 (通知) + Phase 11 (快捷键) |
| 5 | 2 周 | Phase 7 (迁移升级) + Phase 8 (多模型对比) |
| 6 | 2 周 | Phase 10 (会话管理) + Phase 13 (设置) |
| 7 | 2 周 | Phase 9 (知识库) + Phase 14 (欢迎体验) |

---

## 新增依赖

| 包 | Phase | 用途 |
|---|---|---|
| `zustand` | 1 | 状态管理 |
| `tailwindcss` + `@tailwindcss/vite` | 1 | CSS 框架 |
| `lucide-react` | 1 | 图标库 |
| `react-markdown` | 3 | Markdown 渲染 |
| `remark-gfm` | 3 | GFM 支持 |
| `rehype-highlight` + `highlight.js` | 3 | 代码高亮 |

---

## 验证方案

每个 Phase 完成后：

1. **构建验证**: `pnpm --filter @aihub/desktop build` 无错误
2. **测试验证**: `pnpm test` 所有现有测试通过
3. **功能验证**: 启动 Electron 应用，验证新功能在至少 2 个 Provider（ChatGPT + 一个中文 Provider）上正常工作
4. **回归验证**: 确认消息发送/接收流式传输、Provider 状态检测、会话切换等核心功能未被破坏
5. **主题验证**: 深色/浅色主题切换后无颜色遗漏

## 风险与缓解

| 风险 | 缓解策略 |
|---|---|
| Provider DOM 选择器失效 | 保留 circuit breaker 机制 + 选择器测试套件 |
| 系统提示词被 Provider 检测/拒绝 | 包装方式拟人化，避免指令格式太明显 |
| SQLite 迁移安全性 | `ALTER TABLE ADD COLUMN` + try-catch + schema_version 追踪 |
| 大量会话时性能问题 | 延迟加载消息（选中时才加载）+ 分页 |
