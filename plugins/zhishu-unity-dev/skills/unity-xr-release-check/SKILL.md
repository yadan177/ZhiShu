---
name: unity-xr-release-check
description: 用于在构建 PICO、Quest、OpenXR 或 Android/PCVR 正式发布包（APK / AAB / 可执行包）前执行全量发布门禁核查，覆盖双轨版本号/构建号、Android 签名 Keystore、包名与权限最小化、SDK 与渲染配置、调试开关剥离、音频与 XR 合规项。当 Unity/XR 项目进入封板出包或提审前检查时使用。
metadata:
  title: PICO / XR 打包发布前检查
  version: "2.1.0"
  role: unity-dev
  rulepacks:
    - common
    - unity
    - pico
    - xr-common
---

# PICO / XR 打包发布前检查

## 1. 开始前核对

1. 优先读取项目 `.agent-rules/overrides.md`、`.agent-rules/common/02-软件版本迭代与发布管理规范.md`、`.agent-rules/unity/其他规则/06-项目配置规则.md`、`.agent-rules/pico/PICO Unity SDK.md` 及 `.agent-rules/xr-common/`（若已安装）。
2. 检查项目实际配置文件：`ProjectSettings/ProjectSettings.asset`、`ProjectSettings/EditorBuildSettings.asset`、`Packages/manifest.json`、`Assets/Plugins/Android/AndroidManifest.xml`（如有）及当前 XR Plug-in Management / PICO SDK 配置。
3. 明确本次出包目标：**内部测试包（Dev/QA）**、**客户交付包**，还是**应用商店提审正式包（PICO Store / Quest Store / 其他）**。

## 2. 打包前八大必查门禁

1. **双轨版本号与包标识**：
   - 对外展示版本（`bundleVersion`）符合 SemVer 且与发布计划/Tag 一致；
   - Android / XR 内部构建号（`AndroidBundleVersionCode`）相比上一已出版本**严格单调递增**；
   - `applicationIdentifier`（包名）与目标渠道匹配，测试包与正式包严格隔离防呆。
2. **签名与构建安全**：
   - 正式包使用受托管的正式 Release Keystore 签名（绝不使用 Debug Key），签名密码与密钥文件不入 Git；
   - 核对 Scripting Backend（IL2CPP）、Target Architecture（ARM64，满足现代商店 64 位强制要求）、Managed Stripping Level 及 `link.xml` 防反射裁剪配置。
3. **调试开关与环境地址剥离**：
   - 关闭 `Development Build`、`Autoconnect Profiler`、`Script Debugging` 与调试控制台/GM 后门；
   - 确认服务端 API 地址、埋点与日志级别指向正确目标环境（严禁正式包连测试服或打印敏感 Token）。
4. **XR / PICO SDK 与权限最小化**：
   - 核对 XR Plug-in Management 已勾选正确 Provider（如 PICO / OpenXR），立体渲染模式为 Single Pass Instanced；
   - 核对 `AndroidManifest.xml` 权限最小化（去除无用的定位、读写外部存储、录音/透视等敏感权限，MR 透视或麦克风权限须与商店隐私声明一致）；
   - 若面向 PICO Store 等渠道，核对 App ID、Entitlement Check（版权校验）及设备兼容性声明符合当前官方文档。
5. **场景清单与资源包完整性**：
   - 检查 `EditorBuildSettings` 中勾选的场景顺序、首场景正确且无测试 Sandbox 场景误入正式包；
   - 如使用 Addressables / AssetBundle，确认内容已完成对应平台构建并核对远程/本地目录路径。
6. **音频、图标与包体卫生**：
   - 核对应用图标与名称配置、无长音频 `PCM` 常驻、头显摘戴暂停静音正常、总包体体积与首包大小符合目标平台上限。
7. **Git 状态与产物归档**：
   - 确认工作区干净、从准确 Commit 构建、记录 `版本号 + 构建号 + Commit SHA + APK SHA-256` 并保留符号表（Symbols）便于线上崩溃反混淆。

## 3. 输出结构

- **一、出包元数据核对表**（包名 / 展示版本 / 构建号 / 目标平台 / 环境 / Commit）
- **二、八大发布门禁逐项检查表**（`门禁项 | 核查来源 | 当前状态（✅/❌/待真机确认） | 风险与处理`）
- **三、阻断放行清单与真机安装冒烟步骤**

## 4. 交付自检与红线

- 严禁未经查阅实际 `ProjectSettings` / `AndroidManifest.xml` 就勾掉检查项；读不到的平台专属字段显式标为 `待人工核对`。
- 商店审核规则随官方平台更新，提醒在正式提审前对照厂商当前最新商店审核清单复核一次。
