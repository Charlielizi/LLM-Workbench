# LLM Workbench 验证测试执行记录

配套计划：[validation-test-plan.md](./validation-test-plan.md)

## 1. 执行元数据

- 测试轮次：
- 版本：
- Git commit：
- 分支：
- 工作树：`clean` / `dirty`（附 diff 摘要）：
- 测试负责人：
- 开始/结束时间：
- 发布支持范围：
- 最终结论：`Pass` / `Conditional Pass` / `Fail`：

## 2. 环境

| 环境 | OS/Build | CPU/RAM | 显示/DPI | Node/pnpm | Electron/WebView2 | userData | 用途 |
|---|---|---|---|---|---|---|---|
| E1 |  |  |  |  |  |  |  |
| E2 |  |  |  |  |  |  |  |
| E3 |  |  |  |  |  |  |  |
| E4 |  |  |  |  |  |  |  |
| E5 |  |  |  |  |  |  |  |

网络条件：

- 正常：
- 限速/高延迟：
- 离线/恢复：

## 3. 基线命令

| 命令 | 时间 | 退出码 | 结果 | 日志路径/说明 |
|---|---|---:|---|---|
| `pnpm install --frozen-lockfile` |  |  |  |  |
| `pnpm typecheck` |  |  |  |  |
| `pnpm test` |  |  |  |  |
| `.\.dotnet\dotnet.exe test .\apps\AIHub.Windows.sln --configuration Release` |  |  |  |  |
| `pnpm --filter @aihub/desktop package` |  |  |  |  |

自动化统计：

- Test files：
- Tests passed/failed/skipped：
- 已知警告：

## 4. 套件汇总

| 套件 | P0 Pass/Total | P1 Pass/Total | Fail | Blocked | Not Run | 结论 |
|---|---:|---:|---:|---:|---:|---|
| Build/App |  |  |  |  |  |  |
| Message/Organization |  |  |  |  |  |  |
| Content/Data |  |  |  |  |  |  |
| Settings/Context |  |  |  |  |  |  |
| Transfer/Comparison |  |  |  |  |  |  |
| Providers |  |  |  |  |  |  |
| Security/Privacy |  |  |  |  |  |  |
| Performance/Stability |  |  |  |  |  |  |
| Package/Upgrade |  |  |  |  |  |  |
| Windows Native |  |  |  |  |  |  |
| AI UI/Interaction |  |  |  |  |  |  |

## 5. 用例记录

| Case ID | 环境 | 结果 | 实际结果摘要 | 缺陷 ID | 证据路径 | 执行人/时间 |
|---|---|---|---|---|---|---|
|  |  |  |  |  |  |  |

## 6. 供应商矩阵

| Provider | 账号状态 | runtime.instanceId | 正常发送 | 慢流 | 取消 | 锚点 | 后台 | Resync | Auth 阻断 | Manual | 历史同步 | 能力 | 总评 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| ChatGPT |  |  |  |  |  |  |  |  |  |  |  |  |  |
| Claude |  |  |  |  |  |  |  |  |  |  |  |  |  |
| 豆包 |  |  |  |  |  |  |  |  |  |  |  |  |  |
| Kimi |  |  |  |  |  |  |  |  |  |  |  |  |  |
| DeepSeek |  |  |  |  |  |  |  |  |  |  |  |  |  |
| 腾讯元宝 |  |  |  |  |  |  |  |  |  |  |  |  |  |
| 千问 |  |  |  |  |  |  |  |  |  |  |  |  |  |

供应商 `Blocked` 说明：

| Provider | 阻塞原因 | 首次时间 | 证据 | 解除条件 | 是否影响支持声明 |
|---|---|---|---|---|---|
|  |  |  |  |  |  |

## 7. 性能与稳定性

| 指标 | 上一基线 | 本轮结果 | 变化 | 预算 | 结论 |
|---|---:|---:|---:|---:|---|
| 冷启动中位数 |  |  |  | ≤5s |  |
| 暖启动中位数 |  |  |  | ≤3s |  |
| 10k 会话搜索 P95 |  |  |  | ≤500ms |  |
| 稳定态内存 |  |  |  | 回归 ≤20% |  |
| 60 分钟内存增长 |  |  |  | ≤20% |  |
| 并行发送成功率 |  |  |  | 100%（排除外部错误） |  |
| 崩溃/未处理异常 |  |  |  | 0 |  |

## 7.1 AI UI 与视觉结果

- `pnpm test:ai` 是否已实现：
- 执行模式：`local-only` / `real-providers` / `installed-build`
- AUT 用例：Pass / Fail / Blocked / Flaky / Skipped
- Screenshot baseline：Pass / Fail
- DOM/几何检查：Pass / Fail
- Console/page/unhandled errors：
- AI 视觉结论：
- HTML 报告：
- Playwright traces/videos：
- 是否发现白屏、乱码、遮挡、裁切或不可点击控件：
- 是否所有关键交互均由真实 click/keyboard/drag/scroll 完成：
- 唯一需要用户参与的登录/验证码事项：

## 8. 安装包

- 安装包名称：
- 版本：
- 文件大小：
- SHA-256：
- 构建日志：
- 干净安装：
- 上一版升级：
- 回滚验证：
- 卸载验证：
- 签名/扫描结果：

## 9. 缺陷

| ID | S级 | Case | 标题 | 状态 | 负责人 | 目标版本 | 回归范围 | 豁免 |
|---|---|---|---|---|---|---|---|---|
|  |  |  |  |  |  |  |  |  |

## 10. 证据索引

- 命令日志：
- Smoke JSON：
- Provider diagnostics：
- AI UI HTML/JSON/JUnit 报告：
- Screenshot before/after/diff：
- Playwright traces/videos：
- 截图/视频：
- 数据库校验：
- 安装包哈希：
- 性能原始数据：

敏感信息检查人/时间：

## 11. 发布门禁决定

- P0 通过率：
- P1 通过率：
- S0/S1 未关闭数量：
- S2 豁免数量：
- 支持但未通过 PVD-01～PVD-10 的供应商：
- 发布决定：`Go` / `Conditional Go` / `No-Go`
- 条件或阻断项：

签字：

- 测试负责人/时间：
- 开发负责人/时间：
- 发布负责人/时间：
