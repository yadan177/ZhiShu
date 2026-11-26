# 智枢桌面版 2.1.0

本版本与规则包 / CLI / 岗位插件 `v2.1.0` 双轨同步发布，新增第 5 一级模块 **「规则进化」** 工作台，打通对话现场捕获、跨项目覆盖共性升格与外部官方文档巡检三条自动进化通道，同时严格坚守「原子增量 Diff 预览 → 人工确认写入 → 写后自动校验失败回滚」安全红线。

## 核心更新

- **全新第 5 一级模块「规则进化」工作台**：
  - **通道 1（对话现场捕获）**：新增全栈岗位技能 `fs-evolution-capture` 与 `zhishu evolve capture` CLI，支持跨 IDE 将纠偏结论脱敏投递至本机桌面端待审收件箱（自动拦截明文密钥/私钥与本机私有路径），并支持 JSON 手工导入。
  - **通道 2（本地覆盖共性升格）**：一键只读扫描「我的项目」全部已登记项目的 `.agent-rules/overrides.md`（绝不改写原项目文件），自动聚类跨项目共性条款生成升格提案。
  - **通道 3（外部官方文档巡检）**：内置 Apple visionOS HIG、Meta Horizon OS 空间设计、PICO Unity XR SDK 与 TypeScript tsconfig 参考 4 个 HTTPS 巡检源（可自定义管理、防 SSRF 校验、支持中途取消与单源失败重试）。
  - **人工审批原子落盘与防膨胀**：右侧「提案审阅抽屉」支持核对证据、切换可写目标源、编辑原子补丁与导出标准 `.patch` 文件；「进化变更预览」默认聚焦变更行号（支持切换全文）并拦截只读源、基线漂移与过期陈旧提案；点击「确认写入」后自动执行 Markdown 链接、清单与 Skill Frontmatter 门禁，失败完整回滚原文件。
- **跨设备 XR 空间 UI 官方参数核验与校准**：同步校准 Apple visionOS、Meta Horizon OS 与 PICO OS 关键视距、交互热区与安全参数，并同步至 5 份空间 UI 协同 Skills。
- **修复官方源 20 规则包可选状态**：移除历史 `releasedInOfficial015` 残留判断，在「项目规则」选择「智枢官方源」时全部 20 个规则包正常可选。

## 安装与说明

- macOS 提供 Apple Silicon DMG（`ZhiShu-Desktop-2.1.0-macOS-arm64.dmg`），Windows 提供 x64 EXE（`ZhiShu-Desktop-2.1.0-Windows-x64.exe`）；下载后手动安装。
- 当前安装包尚未配置代码签名与 macOS 公证，首次打开时系统可能提示安全确认；Windows 实机交互、TraeWork 本地技能识别与 Qoder / Cursor / WorkBuddy 规则客户端加载仍待持续实测验收。
