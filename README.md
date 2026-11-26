# 智枢（ZhiShu）

智枢定位为独立于任何 AI 编程 IDE 的多项目产品：智枢装在用户电脑上，管理多个项目及各自的规则。通用插件和 Skills 分别交付到所选 IDE 的个人环境，一次安装可在该 IDE 的多个项目中调用；智枢本身不安装进 IDE。桌面应用同时管理插件与技能，CLI 管理项目规则。产品方向是以产品规划、UI 设计、前端、后端、Unity 等场景插件为主要使用入口。Codex 是首个规则入口实现目标；桌面版也可为 Qoder、Cursor、WorkBuddy 生成共享的 `AGENTS.md` 项目入口，后三者的实际客户端加载仍待验收。

## 产品结构

- **规则**定义企业和项目应遵守的要求；通用基线、企业规则和项目覆盖需要可审查地组合。
- **Skills**定义完成一类任务的流程；通用流程应读取当前项目生效的规则，不复制规则正文。
- **能力插件**是用户主要选择的场景能力，可组合多个 Skills、工具连接和交接产物；不同企业和项目的配置、权限仍需分别管理。
- **IDE 适配器**负责把选定资产交付到各工具。桌面版 1.2.0 支持独立 Skill 的 Codex／TraeWork 本地用户环境安装，以及通过官方 Codex CLI 安装原生插件；Product Design 0.1.56 可交付为 TraeWork 入口 Skill。其他原生插件宿主和云端交付仍待开发与验收。

智枢的“插件与技能”模块允许用户按需要自由选择，安装到 Codex、TraeWork 等目标软件的用户环境；不按项目技术栈分组安装，也不设置项目级绑定或启用开关。每个软件的安装、更新和卸载分别记录；项目页继续管理各项目的规则。完整定位、2.0 架构规划与当前实现边界见 [智枢产品需求文档](项目文档/产品文档/智枢-产品需求文档.md) 与 [生态调研与架构设计](项目文档/产品文档/智枢-生态调研与架构设计.md)。

## 当前状态

规则包、CLI 与官方岗位插件当前版本为 `2.1.0`（标签 `v2.1.0`）；桌面应用版本为 `2.1.0`（标签 `desktop-v2.1.0`）。当前代码包含：

- 基于证据检测技术栈、多岗位规则包组合与规则自动进化引擎的 TypeScript 核心包（`@zhishu/core`）。
- 支持 `detect`、`init`（含 `--rulepacks` 与 6 平台 `--targets`）、`validate`、`check`、`diff`、`update`、`recover`、`uninstall` 和 `evolve`（`capture` / `list` / `scan-overrides` / `preview` / `apply --apply` / `reject` / `export`）的 `zhishu` CLI。
- 管理共享 `AGENTS.md` 受控区块的 Codex、Antigravity、TRAE、Qoder、Cursor 和 WorkBuddy 项目入口（其中 Qoder、Cursor、WorkBuddy 的实际客户端加载仍待验收）。
- 智枢桌面端（左侧 5 模块：「我的项目 / 项目规则」「插件与技能」「AI 工具」「来源管理」「规则进化」），支持多项目登记、多岗位规则组合、中断事务恢复、独立 MCP 脱敏配置、企业/个人/官方三级来源治理，以及三通道规则自动进化与人工 Diff 审批落盘。
- 本机插件/Skill 只读快照导入与跨工具用户环境同步（Antigravity、OpenAI Codex、TraeWork 与通用目录 `~/.agents/skills`）；Product Design 0.1.56 可适配为 TraeWork Skill 包。详见 [用户环境资产安装机制](项目文档/技术文档/用户环境资产安装机制.md)。
- 规则包、项目配置、锁文件、资产、进化提案、MCP、来源与适配器 8 套 JSON Schema。
- 20 个规则包、158 份规则文档（含跨设备 XR 空间 UI 布局规范与 Unity XR 空间 UI 实现规则），以及 `plugins/` 下 6 大官方岗位插件（共 43 个 Skills：产品经理、UI 设计师、三维设计师、技术美术 TA、Unity 开发工程师、全栈开发工程师，含对话现场规则进化捕获 `fs-evolution-capture`）；UI 规则说明见 [UI 设计规则说明](项目文档/技术文档/UI设计规则说明.md)。
- 在 `adapters/` 维护平台入口资料；规则正文仍只在 `rulepacks/`。
- 将规则真实安装到业务工程，预览差异后再应用更新；发生受管文件漂移或未知文件碰撞时拒绝覆盖。
- GitHub Release 规则包下载与 SHA-256 验证，以及跨文件一致性自动化总门禁（`npm run check`）。
- macOS Apple Silicon 与 Windows x64 桌面安装包，可选择项目、规则包组合与目标平台，预览后安装、更新或卸载规则；Windows 安装包由 GitHub Actions 构建，真实桌面交互仍待持续验收。

GitHub 仓库已公开；[桌面版 `2.1.0`](https://github.com/yadan177/ZhiShu/releases/tag/desktop-v2.1.0) 与 [`v2.1.0` 规则包 Release](https://github.com/yadan177/ZhiShu/releases/tag/v2.1.0) 通过双轨标签自动构建发布（历史版本保留于 GitHub Releases 与 [CHANGELOG.md](CHANGELOG.md)）。Qoder、Cursor、WorkBuddy 的实际客户端加载、Windows 实机交互及 Codex 桌面端 Hook 调度仍待验收。

## 业务项目如何使用

在个人电脑安装桌面应用或 CLI。规则本身安装在每个业务项目的 `.agent-rules/` 中并提交 Git：

```bash
npm install -g zhishu
zhishu detect /absolute/path/to/project
zhishu init /absolute/path/to/project
zhishu validate /absolute/path/to/project
```

`init` 只在没有 `agent-rules.yaml` 的项目执行。它检测技术栈，从官方 GitHub Release 下载并校验规则包；已有 `AGENTS.md` 的非受管内容会保留。完整步骤见 [安装与更新指南](项目文档/技术文档/安装与更新指南.md)。

桌面版 `2.1.0` 先在「我的项目」添加项目，再到「项目规则」通过自定义下拉框选择项目，支持按岗位自由组合 20 个规则包并多选 OpenAI Codex、Antigravity、TRAE、Qoder、Cursor、WorkBuddy。所有所选平台共用项目中的一套 `.agent-rules/` 规则和一个 `AGENTS.md` 受控入口；同时可在「规则进化」审阅三通道进化提案并原子写入可写规则源。CLI 同样支持 `--targets`、`--rulepacks` 与 `evolve` 命令。

更新分成三步：`check` 发现新版本，`diff` 展示变更供人审查，`update --apply` 才修改项目文件。桌面版通过「安装规则 / 查看变更 → 确认应用」完成审查写入；项目本地覆盖规则和未知文件受保护。

不再使用时，先运行 `zhishu uninstall /absolute/path/to/project` 查看卸载摘要；如需逐行差异，加 `--details`。审查后运行 `zhishu uninstall /absolute/path/to/project --apply` 卸载项目规则；项目本地文件会保留。

图形界面安装包见 [桌面版 `2.1.0` Release](https://github.com/yadan177/ZhiShu/releases/tag/desktop-v2.1.0)，源码和构建方式见 [桌面版说明](packages/desktop-app/README.md)。两个平台均需手动安装；安装包尚未签名，Mac 包尚未公证。

## 规则来源

迁移前的两个源目录已从当前工作树清理；如需追溯原文，可查看 Git 提交 `a7ac7b9`。当前安装和维护只使用 `rulepacks/` 中的规则正文，适配器入口在 `adapters/` 维护。

## 本地开发

环境要求：Node.js 22 或更高版本，以及 npm。

```bash
npm install
npm run check
node packages/cli/dist/index.js detect .
```

初始化一个临时或外部测试工程：

```bash
node packages/cli/dist/index.js init /absolute/path/to/project --source-workspace /absolute/path/to/ZhiShu
node packages/cli/dist/index.js validate /absolute/path/to/project
```

完整架构、模块职责与本地验证入口见 [技术文档索引](项目文档/技术文档/README.md) 与 [技术总览](项目文档/技术文档/01-技术总览.md)；发布流程见 [版本发布指南](项目文档/技术文档/版本发布指南.md)，内容复核见 [内容权利复核表](项目文档/技术文档/内容权利复核表.md)。在没有审查受管文件范围前，不要对已有业务工程直接运行 `init`。

## 仓库结构

```text
packages/core/             平台无关核心逻辑
packages/cli/              zhishu 命令行工具
packages/desktop-app/      桌面图形界面
adapters/                  平台入口与兼容性说明
plugins/                  未来独立场景能力插件的资产目录
rulepacks/                 权威规则包目标目录
workflows/                 未来平台无关任务工作流的预留位置
schemas/                   版本化数据契约
项目文档/                  产品文档（PRD、架构调研、结构图）与技术文档（安装、发布、规则与权利复核）
```
