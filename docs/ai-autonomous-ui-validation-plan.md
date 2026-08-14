# LLM Workbench AI 无人值守 UI 与交互验证计划

版本：1.0

适用基线：LLM Workbench Electron 桌面端 `0.1.x`

最后更新：2026-07-22

主测试计划：[validation-test-plan.md](./validation-test-plan.md)

## 1. 当前结论

截至 2026-07-22，第一阶段无人值守测试基础已经实际落地：

- 已部署 Playwright Electron，使用真实 Electron 窗口执行点击、键盘、输入、弹窗、布局几何和截图回归。
- 已部署进程内 Mock Provider，以确定方式模拟认证、流式回复、慢首字、失败、恢复、停止生成和多 Provider 对比。
- 每轮使用独立临时 `userData`，不会访问或破坏真实用户数据库和 Provider 会话；成功后清理进程及临时目录。
- 已有 6 个核心 Electron E2E 场景，覆盖启动引导、建会话、流式消息、视觉基线、快捷键、主题、设置、搜索、失败恢复、停止生成、Provider 抽屉和双模型对比。
- `pnpm test:ai` 已能串联全工作区类型检查、Vitest、Electron 构建、Playwright E2E，并输出 Markdown、JSON、JUnit 和 HTML 报告。
- renderer console error、page error 和崩溃会使测试失败；失败时自动保留截图和 Playwright trace。

当前结论是“核心本地 UI 冒烟可无人值守”，不是“第 5 节全部 56 个 AUT 用例已经实现”。第 10 节仍是完整验收门槛；真实 Provider 首次登录、验证码和风控仍是不可绕过的外部边界。

## 2. 无人值守目标与边界

AI 自动测试必须同时证明以下五层结果：

1. 数据层：IPC、数据库和 provider event 的最终值正确。
2. DOM 层：目标控件存在、可见、可用且语义正确。
3. 几何层：控件位于视口内，无遮挡、重叠、裁切或异常滚动。
4. 视觉层：截图与批准基线无非预期差异，AI 语义检查未发现空白、错位、乱码或状态不一致。
5. 交互层：真实点击、键盘、输入、拖动、滚动和弹窗流程可以从起点完成到终点。

默认运行不需要用户参与。以下是无法承诺完全自动化的外部边界：

- 供应商首次登录、验证码、短信验证、扫码和风控确认。
- 操作系统 UAC、安全软件阻断或企业策略确认。
- 供应商主动改变服务条款、地区限制或账号配额。

处理原则：

- AI 不绕过认证或安全挑战。
- 已有持久化登录 session 时，真实供应商测试可无人值守运行。
- 遇到认证挑战，保存截图和诊断，将该供应商记为 `Blocked`，继续测试其他供应商，不等待用户。
- `Blocked` 不得算作 `Pass`，最终报告明确指出只需用户处理的最小事项。

## 3. 推荐自动化架构

### 3.1 四层执行器

| 层 | 执行器 | 作用 | 发布门禁 |
|---|---|---|---|
| U1 | Vitest + jsdom | 组件状态、事件回调、ARIA 和错误分支 | 每次提交 |
| U2 | Playwright Electron | 启动真实 Electron、点击/输入/键盘/截图/窗口尺寸 | 每次提交与 RC |
| U3 | 可控 Mock Provider + SQLite Fixture | 稳定重现 pending/streaming/completed/failed/auth/slow 等状态 | 每次提交与 RC |
| U4 | 真实 Provider smoke + AI Browser 检查 | 验证真实网站 DOM、登录、发送和页面可见结果 | 每周、RC、DOM 漂移后 |

U1/U2/U3 必须完全无人值守。U4 在账号 session 有效时无人值守；认证挑战是唯一正常阻塞项。

### 3.2 必需测试接缝

实施自动化时需要增加以下能力：

- `@playwright/test` 和 Electron launcher，测试代码放在 `apps/desktop/e2e/`。
- 独立命令：`test:renderer`、`test:e2e`、`test:visual`、`test:ai`、`test:rc`。
- 每轮创建独立临时 `userData`，禁止读写真实用户数据库和真实 provider profile。
- 通过测试专用启动参数或环境变量指定 `userData`；入口只在测试环境接受它，生产构建不得暴露任意路径控制。
- 可控 Mock Provider 页面提供 composer、submit、user turn、assistant stream、stop、auth blocker、shadow root 和虚拟列表 Fixture。
- 固定时钟、随机 ID 和动画；截图前等待字体、网络、React 更新和布局稳定。
- 为核心控件增加稳定的 `data-testid`，同时保留正确的 `aria-label`；测试不得依赖 Tailwind class 或图标 SVG 结构。
- 测试 Fixture 通过公开 IPC/业务入口创建，或在启动前放入隔离数据库；不得在生产环境暴露绕过鉴权的测试 IPC。
- 捕获 renderer/main/provider console error、unhandled rejection、page error、崩溃和失败网络请求。

### 3.3 建议稳定选择器

最低应提供：

```text
app-shell
sidebar
sidebar-collapse
conversation-search
provider-filter
conversation-list
conversation-item-<id>
new-conversation-<provider>
topbar
provider-status
message-list
message-<id>
message-status-<id>
composer-input
send-message
stop-generation
provider-drawer
settings-modal
transfer-modal
comparison-modal
system-prompt-modal
toast-viewport
```

动态 ID 可用于已知 Fixture；通用定位优先使用角色、可访问名称和稳定业务属性。

## 4. 自动判定规则

### 4.1 DOM 与交互判定

每个关键动作后自动检查：

- 目标唯一存在，`visible`、`enabled` 与 `aria-*` 状态符合预期。
- 点击点没有被其他元素覆盖；真实 `click()` 成功，而不是直接调用 React handler。
- 键盘焦点落在期望控件，Tab/Shift+Tab 顺序可继续，Esc 能关闭顶层弹窗。
- 输入值逐字一致；中文、emoji、多行和组合键不丢字符。
- busy 时重复提交被阻止；终态后按钮恢复。
- 页面没有未允许的 console error、page error、unhandled rejection 或崩溃。

### 4.2 几何与布局判定

对 `app-shell`、sidebar、workspace、topbar、composer、modal 和 provider drawer 采集 bounding box：

- 左、上坐标不得超出视口；右、下不得被裁切，设计允许滚动的内容区除外。
- sidebar、workspace、provider drawer 不得发生面积大于 4 px² 的非设计重叠。
- 顶栏不得覆盖窗口拖拽区以外的交互控件。
- composer、send、stop、错误恢复按钮必须处于可见区域。
- modal 完整位于视口内；小窗口下内容区可滚动，但标题和关闭按钮始终可见。
- 不得出现非设计的横向页面滚动条。
- 状态文字不得被裁切到完全不可读；被省略的标题必须有可访问全称或 tooltip。

### 4.3 截图基线

- 固定窗口、字体、主题、DPI 模拟、语言、Fixture 和时间。
- 对动态时间、随机 ID、光标、provider 网页广告区设置 mask。
- 像素差异门限：局部小抗锯齿可容忍；关键区域任意结构变化直接失败。
- 初始建议：全图差异像素比例不超过 0.5%，单一区域不超过 2%；建立真实基线后按组件收紧。
- 基线更新必须附 before/after 和原因，不能在失败后自动覆盖批准基线。

### 4.4 AI 视觉语义检查

AI 对关键截图独立检查：

- 空白主区、白屏、透明层或加载遮罩未消失。
- 文字乱码、不可读对比度、主题混色。
- 按钮、输入框、弹窗、Toast、状态徽标重叠或裁切。
- 消息角色、顺序、streaming/failed/completed 视觉状态与 DOM/数据库不一致。
- Provider drawer 覆盖 composer 或关闭后残留。
- 1280×720、125%/150% 缩放下主要操作不可见。

AI 视觉发现需要用 DOM/几何或重复截图二次确认：

- 连续两次稳定复现且有几何/状态证据：`Fail`。
- 仅模型主观判断、像素与几何均正常：记录 `Visual Warning`，不单独阻断 P0。
- 白屏、关键控件不可见、关键交互被遮挡：直接 P0 `Fail`。

## 5. 无人值守 UI 与交互用例

所有用例使用隔离 userData 和确定性 Fixture。每个用例至少保存结束截图；失败时保存起点、动作前、动作后截图以及 Playwright trace/video。

### 5.1 启动与应用壳

| ID | P | 自动动作 | 自动断言 |
|---|---|---|---|
| AUT-BOOT-01 | P0 | 空白 userData 启动 Electron | 5 秒内窗口可见；app-shell、sidebar、workspace、topbar 唯一存在；无白屏/error |
| AUT-BOOT-02 | P0 | 完成首次引导并重启 | 引导只出现一次；主界面可操作；设置已持久化 |
| AUT-BOOT-03 | P0 | 启动第二实例 | 第二实例退出；第一实例获得焦点；没有第二个数据库写入者 |
| AUT-BOOT-04 | P0 | 在 1280×720、1280×820、1920×1080 启动 | 核心区域全部在视口内；无非设计横向滚动和重叠 |
| AUT-BOOT-05 | P1 | 最小化、恢复、改变窗口尺寸 20 次 | 布局稳定；drawer/sidebar 宽度受限；无残留透明层 |
| AUT-BOOT-06 | P0 | 注入 renderer 初始化失败和 snapshot 失败 | 有可见错误/Toast；应用不假装成功；错误可复制或诊断 |

### 5.2 导航、侧栏和快捷键

| ID | P | 自动动作 | 自动断言 |
|---|---|---|---|
| AUT-NAV-01 | P0 | 逐个点击七家“新会话” | 生成七个唯一会话；当前项高亮；标题/provider 图标正确 |
| AUT-NAV-02 | P0 | 搜索标题、正文、中文和无结果，再清空 | 列表数量和内容精确；clear 后恢复；焦点仍在搜索框 |
| AUT-NAV-03 | P1 | 切换全部及七个 provider filter | 只显示目标 provider；当前会话状态不串改 |
| AUT-NAV-04 | P1 | 置顶、取消置顶、重命名、打开/关闭右键菜单 | 排序即时变化；菜单在视口内；点击外部和 Esc 可关闭 |
| AUT-NAV-05 | P1 | 折叠/展开侧栏，拖到最小/最大宽度 | 图标仍可点击；workspace 不被遮挡；宽度在设计边界 |
| AUT-NAV-06 | P1 | 执行 Ctrl+F、新会话、侧栏、主题、provider 快捷键 | 对应动作只执行一次；输入控件内不误触发全局动作 |
| AUT-NAV-07 | P0 | 批量选择 20 个会话，置顶/标签/文件夹后退出 | 计数、按钮状态和结果正确；退出后选择框/工具条消失 |
| AUT-NAV-08 | P0 | 批量删除，先取消再确认 Fixture 分支 | 取消无变化；确认只删除选中项；其他会话仍可点击 |

### 5.3 Composer、消息和状态

| ID | P | 自动动作 | 自动断言 |
|---|---|---|---|
| AUT-CHAT-01 | P0 | 在 composer 输入中英、emoji、多行，点击发送 | user bubble 逐字一致；输入清空；send 禁用/stop 显示符合阶段 |
| AUT-CHAT-02 | P0 | Mock Provider 发 pending→streaming→completed | 同一个 assistant bubble 更新；状态顺序正确；没有重复 bubble |
| AUT-CHAT-03 | P0 | slow-first-token Fixture | 可见 waiting 状态；界面仍可操作；未提前显示 failed/completed |
| AUT-CHAT-04 | P0 | streaming 时点击 Stop | stop 消失；状态终止；部分正文保留；composer 重新可用 |
| AUT-CHAT-05 | P0 | streaming 时切会话再切回 | 流仍在来源会话；其他会话没有内容闪现；滚动位置合理 |
| AUT-CHAT-06 | P0 | 快速双击 Send 和连续按 Enter | 只产生一个 user bubble 和一次 IPC 调用 |
| AUT-CHAT-07 | P0 | 触发 auth、recoverable、API、network 四类失败 | 每类有可读状态、详情和正确恢复按钮；布局不跳变/遮挡 |
| AUT-CHAT-08 | P0 | 点击 Retry，Fixture 第二次成功 | 原失败上下文不丢；只新增设计允许的消息；最终 completed |
| AUT-CHAT-09 | P0 | Hover user/assistant 消息，执行复制、编辑、删除 | 操作按钮可见可点；剪贴板、编辑框、确认结果正确 |
| AUT-CHAT-10 | P0 | 编辑较早消息并重发 | 后续 bubble 从 UI 消失；新分支顺序正确；没有孤立空白 |
| AUT-CHAT-11 | P1 | 渲染 200 条消息并滚动首尾 | 虚拟/普通列表无跳跃白块；自动滚动仅在用户位于底部时发生 |
| AUT-CHAT-12 | P0 | 渲染 Markdown、代码、公式、图片、引用和危险 HTML | 内容可见；代码可复制；危险元素不存在且无副作用 |

### 5.4 Provider Drawer 与诊断交互

| ID | P | 自动动作 | 自动断言 |
|---|---|---|---|
| AUT-PROV-01 | P0 | 点击 Open provider page | drawer 出现；workspace 宽度收缩；composer/消息不被覆盖 |
| AUT-PROV-02 | P0 | 关闭 drawer，等待 detach window，再触发后台 stream | drawer 不残留；LLM Workbench 状态继续更新；完成后资源释放 |
| AUT-PROV-03 | P1 | 拖动 drawer 到 320/1200 边界和中间值 | 宽度钳制；拖动顺滑；sidebar/workspace 无重叠 |
| AUT-PROV-04 | P0 | 依次点击 anchor、resync、recover、manual submit | 每次只有对应 loading/Toast；完成后按钮恢复；无重复调用 |
| AUT-PROV-05 | P1 | 开/关 Clean Mode 并切换两个 provider | `aria-pressed` 与 provider 各自状态一致；互不串用 |
| AUT-PROV-06 | P1 | 加载 debug snapshot、复制 diagnostics | 面板可读可滚动；复制成功；文本不含 Fixture 秘密 |

### 5.5 弹窗与复杂工作流

| ID | P | 自动动作 | 自动断言 |
|---|---|---|---|
| AUT-MOD-01 | P0 | 打开 Settings，逐个切换所有 tab，保存后重开 | 单一 modal；tab 内容和保存值正确；关闭后焦点回到触发按钮 |
| AUT-MOD-02 | P1 | 切换主题/default provider/backend/尺寸 | UI 即时变化；边界值正确；重启后保持 |
| AUT-MOD-03 | P0 | 设置导出、清空、导入；再导入损坏 JSON | 正常往返；错误 Toast 可见；损坏数据不改变当前设置 |
| AUT-MOD-04 | P0 | 新建/编辑/删除系统提示词并分配到会话 | 列表、表单、默认标记和 composer 状态一致 |
| AUT-MOD-05 | P0 | 打开 Transfer，切目标/压缩 provider、编辑预览、取消 | 8 标题可见；取消不建会话；modal 无溢出 |
| AUT-MOD-06 | P0 | 再次 Transfer 并确认 | modal 关闭；目标会话出现并被选中；源会话仍存在 |
| AUT-MOD-07 | P0 | 创建 2/3/4 provider Comparison | 选择按钮状态准确；低于2时确认禁用；列数和 provider 标题正确 |
| AUT-MOD-08 | P0 | Comparison 输入、发送、部分失败、返回聊天 | 各列状态独立；返回按钮可见；普通会话未被覆盖 |
| AUT-MOD-09 | P1 | 新建文件夹/标签并在会话和批量工具中选择 | popover 位于视口；选择即时呈现；删除后引用安全移除 |
| AUT-MOD-10 | P1 | 打开快捷键帮助、设置、transfer 多次并按 Esc | 任意时刻只处理顶层弹窗；无 backdrop/focus 残留 |

### 5.6 视觉、响应式和可访问性

| ID | P | 自动动作 | 自动断言 |
|---|---|---|---|
| AUT-VIS-01 | P0 | 对 Welcome、空会话、普通会话截图 | 像素阈值通过；无白屏、乱码、重叠、裁切 |
| AUT-VIS-02 | P0 | 对 pending/streaming/completed/failed/recoverable 截图 | 状态视觉可区分；文字与 DOM 状态一致；按钮可见 |
| AUT-VIS-03 | P1 | light/dark/system 三主题截图 | 不混用错误主题色；文字/控件可读；图标没有消失 |
| AUT-VIS-04 | P1 | 1280×720、1920×1080、2560×1440 截图 | 核心布局稳定；宽屏不产生异常空洞；小屏可操作 |
| AUT-VIS-05 | P1 | 模拟 100/125/150% 缩放或等效 viewport | 主按钮和 modal 仍在视口；无文字覆盖 |
| AUT-VIS-06 | P1 | 超长会话名、provider 状态、错误详情和代码行 | 省略/换行符合设计；tooltip/可访问名称保留全文 |
| AUT-VIS-07 | P1 | 键盘 Tab 遍历并截图 focus ring | 所有核心操作可达；焦点明显；顺序与视觉布局一致 |
| AUT-VIS-08 | P1 | 运行 axe 等可访问性扫描 | P0 页面无 critical/serious；新问题附节点与修复建议 |

### 5.7 错误、Toast 与恢复

| ID | P | 自动动作 | 自动断言 |
|---|---|---|---|
| AUT-ERR-01 | P0 | 让每个主要 IPC 返回 Error | 对应 Toast/错误区可见；应用壳不崩；可继续其他操作 |
| AUT-ERR-02 | P0 | 让 snapshot/event 返回乱序和重复 | UI 不回退、不重复、不把旧错误覆盖新成功 |
| AUT-ERR-03 | P1 | 连续产生 5 个 Toast | 顺序、堆叠、自动消失和手动关闭正常；不盖住 composer |
| AUT-ERR-04 | P0 | renderer console.error、pageerror、unhandled rejection | 测试自动失败并归档堆栈；禁止静默忽略 |
| AUT-ERR-05 | P0 | 进程异常退出后重新启动同一隔离 userData | 可恢复到可交互界面；未完成消息有明确状态 |
| AUT-ERR-06 | P1 | 失败后执行恢复，再重复原成功路径 | 失败摘要清除；视觉恢复；无禁用按钮或遮罩残留 |

## 6. 真实供应商无人值守检查

对每个已登录供应商，AI 执行以下最小闭环：

1. 读取当前 runtime-info，确认只存在目标工作区实例。
2. 打开 LLM Workbench 对应会话，截图登录/ready 状态。
3. 通过 smoke request 发送唯一 TD-01。
4. 等待 user/assistant terminal state，同时监控 phase trace。
5. 打开 provider drawer，确认网页中出现同一唯一文本和对应回复。
6. 对 LLM Workbench 消息区与 provider 网页各截图，并检查无重复/旧回复绑定。
7. 关闭 drawer，执行 background-send；随后执行 resync-latest。
8. 保存 smoke JSON、runtime instanceId、diagnostics、截图和最终判定。

状态策略：

| 实际状态 | AI 行为 | 结果 |
|---|---|---|
| 已登录且可发送 | 完成全部闭环 | Pass/Fail |
| 登录过期/验证码 | 截图、诊断、记录 provider，不尝试绕过；继续下一家 | Blocked |
| Provider 5xx/限流 | 一次延迟重试；仍失败则保存响应与诊断 | Fail 或 External Blocked，按证据评审 |
| DOM selector 漂移 | 保存网页截图/DOM 诊断，不盲目重试 | Fail |
| runtime 结果陈旧 | 丢弃旧结果，重新定位当前实例 | 不计一次执行 |

## 7. 无人值守编排

当前已实现命令：

```powershell
pnpm test:ai
```

当前实现按以下顺序执行，并在任一步失败时返回非零退出码：

1. `pnpm typecheck` 与 `pnpm test`。
2. 构建 Electron 测试包。
3. 创建隔离临时 `userData`，启动带 Mock Provider 的真实 Electron 窗口。
4. 运行当前 6 个 Playwright Electron 核心场景和已批准视觉基线；失败时保存截图与 trace。
5. 生成 `manifest.json`、`results.json`、`junit.xml`、HTML 和 Markdown 报告，并关闭测试进程、清理临时 `userData`。

当前可用命令：

```powershell
pnpm test:ai
pnpm test:ai -- --skip-build
pnpm test:ai -- --real-providers
pnpm --filter @aihub/desktop test:ai:e2e
pnpm --filter @aihub/desktop test:ai:e2e:update
```

`test:ai:e2e:update` 只用于人工确认后的基线更新，普通失败流程不会自动覆盖已批准基线。commit/锁文件指纹、installed-build smoke、视频、DB 快照、脱敏审计和完整 56 用例仍属于后续验收工作。

## 8. 重试与防止“假通过”

- 当前本地确定性用例设置 `retries: 0`，任何首次失败都会直接阻断，避免重试掩盖缺陷。
- 完整门禁后续可增加一次诊断性复跑，但首次失败仍必须记为 `Flaky` 并按失败处理。
- 真实供应商仅对明确网络/5xx 进行一次重试；selector、布局、串线、重复消息不重试掩盖。
- 任何测试不得通过直接改 store、直接调用 onClick 或直接写最终数据库状态替代用户动作。
- 成功必须同时有 UI 状态与业务状态；只收到 IPC 事件或只看到截图都不足以通过。
- 不允许失败时自动更新 screenshot baseline。
- 完整门禁报告必须列出 skipped、blocked、flaky；当前本地核心套件不使用 skip，真实 Provider 分类报告仍待并入统一报告。

## 9. 工件与 AI 报告

当前每轮实际输出：

```text
artifacts/ai-validation/<run-id>/
  manifest.json
  results.json
  report.md
  junit.xml
  html/index.html
  test-results/
    <failed-case>/failure.png
    <failed-case>/trace.zip
```

截图差异、视频、进程日志、Provider smoke、数据库快照和脱敏审计目录是完整门禁的后续目标，不在当前成功报告中伪造空产物。

最终报告必须回答：

- 界面是否正常显示，有无白屏、乱码、遮挡、裁切和非预期差异。
- 所有关键交互是否通过真实点击/键盘完成。
- UI 状态、IPC 状态、数据库状态和 provider 网页是否一致。
- 哪些失败可复现，首次坏截图和 trace 在哪里。
- 哪些供应商因登录验证被阻塞，是否是唯一需要用户参与的事项。
- 发布门禁是 Go、Conditional Go 还是 No-Go。

## 10. 实现完成标准

只有同时满足以下条件，LLM Workbench 才具备本计划定义的“用户零参与测试”能力：

- [ ] `pnpm test:ai -- --local-only` 可在干净机一次命令运行。
- [ ] 56 个 AUT 用例全部实现；P0 不使用 skip。
- [ ] 每个关键页面具备确定性截图基线和几何断言。
- [ ] 所有交互使用真实 locator、click、keyboard、drag、scroll。
- [ ] UI、IPC、数据库至少两层交叉验证，消息主路径做到三层验证。
- [x] console/page/unhandled error 自动导致失败。
- [ ] 失败自动保存 screenshot、diff、trace、video 和日志。
- [ ] 报告区分 Pass、Fail、Blocked、Flaky、Skipped。
- [x] 本地 Mock Provider 路径完全无人值守。
- [ ] 已登录真实供应商可无人值守测试；认证挑战不被绕过且不阻塞其他供应商。
- [ ] installed build 至少完成启动、导航、建会话、Mock 发送、设置和视觉 smoke。
- [ ] 自动化不得访问或破坏真实用户数据库；秘密脱敏审计通过。

## 11. 实施顺序

1. P0：隔离 userData、Mock Provider、稳定 test id、console/error 捕获。
2. P0：Playwright Electron 启动和 AUT-BOOT/AUT-NAV/AUT-CHAT 主路径。
3. P0：状态 Fixture、Provider Drawer、错误恢复和数据库交叉校验。
4. P1：弹窗、复杂工作流、键盘、可访问性和响应式几何。
5. P1：截图基线、AI 视觉语义检查和差异审批流。
6. P0：统一 `test:ai` 编排、报告、脱敏和 installed-build smoke。
7. P1：接入现有真实 provider smoke，形成账号有效时的无人值守七供应商矩阵。

每完成一个阶段，先在 CI/计划任务中连续运行 10 次；只有无 P0 flaky 才进入下一阶段。
