# AIHub 0.1.0-rc.1 验证记录

- 验证日期：2026-07-25（Asia/Shanghai）
- 候选基线：`b690c3430425`
- 候选版本：`0.1.0-rc.1`
- 状态：进行中，尚未允许创建 RC 分支、提交或标签

## 已通过

| 门禁 | 结果 | 证据 |
| --- | --- | --- |
| 桌面端 TypeScript | 通过 | `pnpm --filter @aihub/desktop typecheck` |
| 桌面端 Vitest | 通过 | 30 个文件、265 个测试 |
| 七 Provider 历史 fixture | 通过 | URL、标题、当前项、角色、远端消息键、顺序、partial、扫描上限 |
| 关键 Electron E2E | 通过 | 可信输入、失败恢复、取消、双 Provider 对比、自动同步 |
| 完整 Electron E2E | 通过 1 轮 | 8/8；连续 10 轮门禁尚未完成 |
| Electron package | 通过 | `apps/desktop/out/@aihub-desktop-win32-x64/AIHub.exe`；需以 RC 版本重建 |

## 启动自动同步验收

- SQLite 本地会话先于远端扫描进入首个 renderer 快照。
- Mock ChatGPT 提供 12 条稳定远端历史索引。
- 当前会话及最近 10 条正文完成预取。
- 最旧正文首次选择时按需补齐。
- 同一 userData 重启后仍为 12 条远端会话、24 条远端消息，无重复。
- 自动同步仅启用一个 Web 后端时，其他 Provider 不参与。

## 待完成硬门禁

| 门禁 | 状态 |
| --- | --- |
| `pnpm install --frozen-lockfile` | 待运行 |
| 全工作区 typecheck | 待运行 |
| 全工作区 Vitest | 待运行 |
| 完整 Electron E2E 连续 10 轮 | 待运行 |
| RC Electron package | 待重建 |
| Windows Squirrel installer | 待构建 |
| 安装后启动/本地快照/Mock 发送/设置/自动同步/重启幂等 smoke | 待运行 |
| 豆包实站 | 待验证 |
| Kimi 实站 | 待验证 |
| DeepSeek 实站 | 待验证 |
| 腾讯元宝实站 | 待验证 |
| 千问实站 | 待验证 |

## 非阻塞 Provider

| Provider | fixture/Mock | 实站 |
| --- | --- | --- |
| ChatGPT | 通过 | 待可用时抽检，不阻塞 |
| Claude | 通过 | 待可用时抽检，不阻塞 |

## 已知发布工程说明

- Windows/Electron 偶发出现引导 PID 与真正主进程 PID 分离。E2E 会保存首次 `bootstrap.log` 和 `runtime-info.json`，只终止该测试 userData 记录的进程树，并受控重启一次。
- 视觉测试固定为 `en-US` 和 1281×821 renderer viewport。
- `ophel/` 是独立嵌套仓库，已明确排除在 RC 内容之外。
