# AIHub 0.1.0 功能冻结

自 0.1.0-rc.1 候选版本起，AIHub 进入硬功能冻结。

## 允许修改

- P0/P1 缺陷修复。
- 测试确定性、诊断信息和发布稳定性修复。
- 七个现有 Provider 的官网兼容修复。
- 依赖锁定、构建、签名、安装包和发布文档修改。

## 禁止修改

- 新增用户可见功能、Provider、生产 IPC 或数据库字段。
- 改变已冻结的自动同步范围、预取数量、缺失策略或删除策略。
- 未经明确批准的界面和交互扩展。

任何例外必须由产品负责人明确批准，并重新运行受影响测试及全部 P0 发布门禁。

## 已批准的 P2 例外

2026-07-26，产品负责人明确指示“开启 P2”。P2 可靠性与系统集成改造在
`codex/p2-reliability-integration` 分支独立进行，范围以
[`docs/plans/aihub-p2-reliability-integration.md`](plans/aihub-p2-reliability-integration.md)
为准。

该批准不会自动放宽 0.1.0 RC 的发布门禁。P2 合入发布分支前仍须完成全量
TypeScript、Vitest、Electron E2E、生产 package/make，以及带正式证书的更新
构建验证。

## 0.1.0 发布硬门禁

- `pnpm install --frozen-lockfile`。
- 全工作区 TypeScript 检查和全部 Vitest。
- Electron Playwright E2E 全绿，并连续 10 轮无 P0 波动。
- Electron package、Windows Squirrel installer 和安装后 smoke 全绿。
- 豆包、Kimi、DeepSeek、腾讯元宝、千问的登录实站矩阵全绿。
- ChatGPT、Claude 保持 fixture、Mock 和可用时实站抽检；实站限制记录但不阻塞本次发布。

只有硬门禁全绿后，才允许创建 `codex/release-0.1.0-rc1`、RC 提交和注解标签 `v0.1.0-rc.1`。

## RC 内容边界

RC 提交只允许包含根配置、`apps/desktop/`、`packages/core/`、`packages/adapters/`、`scripts/` 和 `docs/`。必须排除 `ophel/`、构建输出、测试产物、临时数据库和用户数据。
