# AIHub P2：可靠性与系统集成

最后更新：2026-07-26
实施分支：`codex/p2-reliability-integration`
基线提交：`7764dae`

## 目标

P2 把 P0/P1 已完成的统一工作区补成可长期使用、可恢复、可维护的桌面产品。
重点不是继续扩充聊天功能，而是降低数据丢失、误删除、后台失联和更新失败的
风险。

## 已批准范围

- SQLite 在线备份、校验、保留策略和重启恢复。
- 回收站、自动清理及官网会话删除墓碑。
- V1 全量数据的隐私过滤导出和预览式合并导入。
- 本地内容、Provider 会话、全部数据三种分级重置。
- Windows 托盘、关闭行为、开机启动和隐私可控通知。
- HTTPS Squirrel 更新状态机、更新前备份及正式发布签名门禁。
- 标准/高对比度/跟随系统外观设置。

不在本阶段实现：云同步、跨设备同步、知识文档正文的可移植恢复、Provider
Cookie 备份、静默强制更新、增量备份、用户自行配置更新源。

## 行为契约

### 1. 备份与恢复

- 使用 SQLite 在线备份 API，不复制活动 WAL 文件。
- 每份备份包含版本化 manifest、数据库 schema 版本、大小、统计和 SHA-256。
- 创建后执行 `PRAGMA integrity_check`；损坏、大小不符、哈希不符或高于当前
  schema 的备份不能进入恢复流程。
- 恢复预览还会核对数据库实际 schema 与 manifest，错配清单不能进入恢复流程。
- 自动备份开启时，启动、设置变化和应用长期运行期间都会检查；24 小时内最多
  创建一份自动备份。
- 保留策略只自动清理 `scheduled` 备份，绝不清理手动、恢复前、重置前或更新前
  备份。
- 恢复前先创建 `pre-restore` 备份。目标数据库只在下次启动、旧数据库关闭后
  原子替换；Provider Cookie 和登录态不属于备份。

### 2. 回收站与删除墓碑

- 会话、文件夹、标签、系统提示词、知识文档先软删除，并保留关联关系。
- 保留期为 7/30/90 天或永不自动清理；设置缩短后立即执行到期检查，长期运行时
  每小时再次检查。
- 永久清理文件夹或提示词时解除活动会话关联；清理会话时同时清理消息全文索引。
- 删除过的官网会话写入 `(provider, external_id)` 墓碑。清空回收站不会让自动
  同步把它“复活”；只有用户恢复、显式允许重新导入或显式导入 V1 数据才清除
  对应墓碑。

### 3. 可移植 V1 数据导入

- 主进程选择并读取文件，最大 512 MB；渲染进程只收到文件名、计数、警告和
  30 分钟有效的随机 token，不收到本地路径。
- 预览后再次读取并校验 SHA-256，文件变化则拒绝导入。
- 校验消息 ID 唯一、会话 ID 唯一、消息的 `conversationId` 和 Provider 与父会话
  一致，并继续拒绝本地路径。
- 导出瞬间仍为 pending/streaming 的消息会标记为可诊断的失败状态，避免导入后
  留下永远无法完成的“生成中”消息。
- 导入为单个 SQLite 事务的合并操作；同 ID 数据不覆盖，标签同名冲突跳过。
- 同一 Provider 作用域只允许一个默认系统提示词；本地已有默认项时保留本地默认，
  导入项保存为非默认，并在预览中显示调整数量。
- 导入会话、消息、文件夹、标签、系统提示词及关联；Provider 原始 HTML 不进入
  全量导出；知识库只在导出中保留元数据，因不包含正文和原始路径而明确忽略。

### 4. 分级重置

- `local-content`：先备份，再清除本地会话、消息、组织、提示词、知识库及诊断事件；
  保留设置和 Provider 登录态。
- `provider-sessions`：只清除七个 `persist:provider-{id}` 分区的 Cookie、缓存和
  站点存储；保留 AIHub 本地内容和设置。
- `everything`：先备份本地数据，再清除本地内容、设置和全部 Provider 登录态。
  备份不能恢复登录态。
- 三种范围均要求输入精确的 `AIHub`，完成后重启真实应用。

### 5. 系统集成与通知

- 托盘可以关闭；“关闭到托盘”只在托盘启用时生效。
- 开机启动使用 Electron 登录项设置，由 SQLite 设置即时驱动。
- 生成完成、生成失败、同步失败通知可分别关闭；正文预览默认关闭并截断。
- 窗口可见且聚焦时不发送系统通知，避免与应用内反馈重复。
- 后台发现新版本时每个版本只通知一次；点击通知显示并聚焦 AIHub。

### 6. 更新与发布安全

- 更新源必须为 HTTPS；`RELEASES` 响应有超时和 1 MB 上限。
- 版本比较兼容 Squirrel 对预发布号的规范化，`rc1` 与 `rc.1` 等价，
  并按数字顺序比较 `rc2` 与 `rc10`。
- `manual` 仅手动检查，`notify` 后台检查并提醒，`auto-download` 在发现版本后
  下载；从 `notify` 切到 `auto-download` 会继续当前待下载版本。
- 安装前必须成功创建 `pre-update` 备份，否则不调用 `quitAndInstall`。
- 正式构建必须设置：
  - `AIHUB_RELEASE_BUILD=1`
  - `AIHUB_UPDATE_URL=https://...`
  - `AIHUB_WINDOWS_CERT_FILE=<pfx-path>`
  - `AIHUB_WINDOWS_CERT_PASSWORD=<secret>`
- `AIHUB_UPDATE_URL` 在主进程构建时写入产物；证书密码不写入源代码或产物。
  缺少 HTTPS 源或证书的正式构建会在 Forge 配置阶段失败。

## 数据与 IPC

新增设置字段均可选并由 `normalizeAppSettings` 补默认值：

`contrastMode`、`automaticBackup`、`backupRetentionDays`、
`trashRetentionDays`、`trayEnabled`、`closeBehavior`、`launchAtLogin`、
`notificationPreferences`、`updatePolicy`。

新增 IPC 均在 `@aihub/core` 使用 Zod 校验：

- `backup:list/create/delete/preview-restore/restore`
- `trash:list/restore/purge/empty/allow-web-reimport`
- `data:preview-import/import/reset`
- `update:get-state/check/download/install`

## 验收矩阵

- [x] 旧设置补默认值、嵌套通知偏好和 Provider 兼容。
- [x] 在线备份、损坏拒绝、新 schema 拒绝、恢复前备份、下次启动原子恢复。
- [x] 回收站关联恢复、到期清理、永久清理和官网会话墓碑。
- [x] V1 导出隐私过滤、导入结构校验、哈希防变更、冲突合并和知识元数据忽略。
- [x] 目标 Provider 分区单独清理、分级重置和重置前备份。
- [x] 托盘关闭语义、隐私通知、前台抑制、更新提醒。
- [x] 更新版本解析、HTTPS 限制、策略切换和安装前备份。
- [x] 设置页备份/回收站/重置/更新/高对比度组件流程。
- [x] 完整 TypeScript、Core 17/17、Desktop 307/307、Electron E2E 13/13、
  最新打包 exe smoke、生产 package/make 最终门禁。
- [ ] 正式证书环境下的 Authenticode 签名与真实 HTTPS 更新源 smoke。
