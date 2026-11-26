# 智枢桌面版（ZhiShu Desktop）

当前版本为 **`2.1.0`**（[desktop-v2.1.0](https://github.com/yadan177/ZhiShu/releases/tag/desktop-v2.1.0)），与规则包 / CLI / 岗位插件 `v2.1.0` 双轨同步发布。采用左侧 5 模块架构（「我的项目 / 项目规则」「插件与技能」「AI 工具」「来源管理」「规则进化」），内置 6 大官方岗位插件（共 43 个 Skills）、飞书与自定义 MCP 脱敏配置、三级来源治理与三通道规则自动进化审批工作台。全应用界面文字采用操作系统默认无衬线字体（macOS 苹方 / Windows 微软雅黑），仅在代码与 Diff 预览框保留系统等宽字体。

## 核心能力

- **我的项目 & 项目规则**：维护独立的个人项目清单；支持从智枢官方源、企业/个人本地目录源与私有 Git 源自由组合 20 个规则包，并为 OpenAI Codex、Antigravity、TRAE、Qoder、Cursor、WorkBuddy 生成共享的 `.agent-rules/` 与 `AGENTS.md` 受控入口（所有下拉统一使用自定义 `Dropdown` 组件）；安装、更新、中断事务恢复与卸载均先展示逐文件变更预览，绝不静默覆盖 `.agent-rules/overrides.md` 或未知文件。
- **插件与技能 & AI 工具**：内置 6 大官方岗位插件（43 个 Skills），支持导入本机插件/Skill 快照与配置飞书/自定义 MCP（密钥仅存本机配置且预览脱敏），按需预览同步到 Antigravity、OpenAI Codex、TRAE / TraeWork（实验）与通用目录（`~/.agents/skills`）；「AI 工具」页统一盘点本机已装资产与探测状态。详见 [用户环境资产安装机制](../../项目文档/技术文档/用户环境资产安装机制.md)。
- **来源管理**：按「企业源 > 个人源 > 内置只读官方源」三级治理，支持本地目录源与私有 Git 源连接测试、浅克隆同步、`0o600` 本机凭据隔离与企业必选规则包锁定。
- **规则进化**：收拢对话现场捕获（`fs-evolution-capture` / `zhishu evolve capture` / JSON 导入）、跨项目只读 `overrides.md` 共性升格与外部官方文档 HTTPS 巡检三条通道；右侧审阅抽屉支持核对证据、切换可写目标源、编辑原子补丁与导出 `.patch`，点击「查看变更 → 确认写入」前强制拦截只读源、基线漂移与敏感明文，写入后自动执行门禁校验，失败完整回滚。
- **单实例与版本提醒**：桌面端保持单实例运行并在启动时检查 `desktop-v*` Release，发现新版后引导手动下载安装（macOS Apple Silicon DMG / Windows x64 EXE）。

## 开发与打包

在仓库根目录运行：

```bash
npm install
npm run typecheck --workspace zhishu-desktop
npm test --workspace zhishu-desktop
npm run pack:mac --workspace zhishu-desktop
npm run pack:win --workspace zhishu-desktop
```

本机构建输出 `release/ZhiShu-Desktop-2.1.0-macOS-arm64.dmg` 或 `release/ZhiShu-Desktop-2.1.0-Windows-x64.exe`。开发期可通过 `ZHISHU_DEV_PROFILE=/tmp/zhishu-dev npm run dev --workspace zhishu-desktop` 在隔离数据目录验证而不影响本机正式配置。

当前安装包尚未配置代码签名与 macOS 公证，首次打开时系统可能提示安全确认；桌面应用本身不会卸载电脑上的 CLI 或个人环境中的旧插件副本。Windows 实机交互、TraeWork 本地技能识别与 Qoder / Cursor / WorkBuddy 规则客户端加载仍待持续实测验收。
