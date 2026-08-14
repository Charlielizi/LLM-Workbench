# 免费 Windows 发布路线

本项目使用 SignPath Foundation 的免费开源签名，并通过公开 GitHub
Release 配合 `update.electronjs.org` 提供更新 Feed。该方案不需要购买 OV
证书，也不需要维护独立更新服务器。

## 一次性准备

1. 将 GitHub 仓库设为公开，并保留根目录 `LICENSE` 和
   `CODE_SIGNING_POLICY.md`。
2. 在 SignPath 创建 Open Source Signing 项目，安装 SignPath GitHub App，
   允许它访问本仓库。
3. 创建一个 Windows Authenticode 签名策略和一个 Artifact Configuration。
   可以从 `signpath/artifact-configuration.xml` 开始。该配置只签名
   `LLM-Workbench-Setup.exe`，避免修改 `.nupkg` 后破坏 Squirrel 的
   `RELEASES` 哈希。
4. 在 GitHub Actions 中配置：

   - Secret `SIGNPATH_API_TOKEN`
   - Variable `SIGNPATH_ORGANIZATION_ID`
   - Variable `SIGNPATH_PROJECT_SLUG`
   - Variable `SIGNPATH_SIGNING_POLICY_SLUG`
   - Variable `SIGNPATH_ARTIFACT_CONFIGURATION_SLUG`

5. 在 SignPath 的 GitHub 项目设置中启用源代码来源验证，并按其要求配置
   MFA、提交者和审批角色。

## 发布

先将 `apps/desktop/package.json` 的版本号改成要发布的版本，然后创建标签：

```powershell
git tag v0.1.0
git push origin v0.1.0
```

`.github/workflows/release-windows-signpath.yml` 会在 Windows runner 上：

1. 安装依赖并执行类型检查和桌面测试；
2. 以 `AIHUB_SIGNING_MODE=signpath` 构建未签名 Squirrel 包；
3. 将 `LLM-Workbench-Setup.exe` 交给 SignPath 签名；
4. 验证 Authenticode 状态为 `Valid`；
5. 将签名安装程序、`RELEASES` 和 `.nupkg` 发布到 GitHub Release。

当前应用会把更新地址编译进程序，格式为：

```text
https://update.electronjs.org/Charlielizi/LLM-Workbench/win32-x64/VERSION/
```

因此每次发布前必须先更新应用版本号。Feed 目录必须能返回
`RELEASES`；Electron 的 Windows Squirrel 更新机制会直接读取该文件。

## 本地验证

GitHub Actions 完成后，在干净 Windows 虚拟机中运行：

```powershell
Get-AuthenticodeSignature .\LLM-Workbench-Setup.exe |
  Format-List Status,SignerCertificate,TimeStamperCertificate

Invoke-WebRequest `
  "https://update.electronjs.org/OWNER/REPO/win32-x64/VERSION/RELEASES" `
  -UseBasicParsing
```

然后安装旧版本，再安装/运行新版本，确认更新检查、下载、重启和版本切换。

## 重要限制

SignPath Foundation 的证书发布者是 SignPath Foundation，而不是个人开发者。
SmartScreen 的信誉也不会因为首次签名就立即建立。免费路线适合开源项目，
如果未来必须显示个人或公司发布者名称，则需要改用商业 OV 证书或其他付费
签名方案。
