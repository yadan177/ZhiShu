# 智枢桌面版 2.1.3

本版本为桌面端稳定性、macOS 安装签名、跨宿主图标与网络代理修复版（搭配规则包 / CLI / 岗位插件 `v2.1.0` 双轨运行）。

## 核心修复

- **修复 macOS 安装包残缺签名导致无法打开**：
  - 在 `electron-builder` 打包链路新增 `afterPack` ad-hoc 深度重签脚本（`codesign --force --deep --sign -`），并在 CI 校验脚本中强制增加 `_CodeSignature/CodeResources` 与 `codesign --verify --deep --strict` 门禁，彻底消除 Apple Silicon macOS 上因缺少签名资源导致的“已损坏/安全策略拒绝启动”问题。
- **修复 Antigravity / OpenAI Codex / TRAE 插件与 Skill 图标缺失**：
  - 为内置 6 个官方岗位插件补齐矢量图标 `assets/logo.svg`、根级 `logo` 与完整 `interface` 元数据；为 43 个官方 Skills 补齐 `assets/icon.svg` 与 `agents/openai.yaml` 图标配置。
  - OpenAI Codex 交付层在原插件缺少 `.codex-plugin/plugin.json` 时自动补全规范清单与路径，确保 Codex `plugin/list` 与界面正确渲染岗位名称、品牌色与图标；「AI 工具」页新增内容摘要比对，已装同版本号旧图标插件会显示 `有内容更新` 支持一键无痛升级。
- **修复 GitHub 网络不稳定与系统代理不生效**：
  - 桌面端主进程全部 GitHub API 与安装包/规则包下载请求统一切换为 Chromium 原生网络栈（常规请求走 `electron.net.fetch`，手动重定向校验走 `electron.net.request`），自动继承 macOS / Windows 系统代理与 PAC 配置。
  - 新增 `502/503/504` 与瞬态网络抖动单次自动重试、15 秒超时控制，以及明确的中文超时/代理异常与 `403` 频率受限提示。
- **修复版本检查失败后右下角 Tips 永不消失**：
  - 右下角错误提示条新增 **6 秒自动消失** 与右侧 **`×` 手动关闭按钮**，同时精简左侧版本卡片错误展示，避免无新版本时重复残留报错文案。

## 安装与说明

- macOS 提供 Apple Silicon DMG（`ZhiShu-Desktop-2.1.3-macOS-arm64.dmg`），Windows 提供 x64 EXE（`ZhiShu-Desktop-2.1.3-Windows-x64.exe`），随 Release 同步附带 `SHA256SUMS.txt`。
- macOS 请将 `智枢.app` 拖入「应用程序（`/Applications`）」后打开；由于尚未接入 Apple Developer ID 公证，浏览器首次下载打开时如遇“未验证开发者”提示，可在「系统设置 → 隐私与安全性」点击「仍要打开」放行一次。后续版本可通过左下角应用内更新自动替换重启。
