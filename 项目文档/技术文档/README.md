# 智枢技术文档索引

本目录维护 **智枢（ZhiShu）** 的工程事实、架构总览、安装与发布操作以及规则资产合规索引。产品定位、2.0 规划与界面设计稿基线分别维护于 [产品文档](../产品文档/智枢-产品需求文档.md) 与 [生态调研与架构设计](../产品文档/智枢-生态调研与架构设计.md)，不在此重复定义。

## 按读者任务导航

| 读者任务 | 建议阅读路径 |
|---|---|
| 第一次了解仓库架构与运行方式 | [01 - 技术总览](./01-技术总览.md) → [安装与更新指南](./安装与更新指南.md) |
| 了解业务项目规则安装、更新、恢复与卸载 | [安装与更新指南](./安装与更新指南.md) → [01 - 技术总览（核心链路与契约）](./01-技术总览.md#四核心链路与关键符号) |
| 了解桌面端插件与技能的用户环境安装机制 | [用户环境资产安装机制](./用户环境资产安装机制.md) → [01 - 技术总览（桌面端主进程与 IPC）](./01-技术总览.md#2-桌面应用packagesdesktop-app) |
| 维护或选装 UI 设计规则与设计文档 | [UI 设计规则说明](./UI设计规则说明.md) → [生态调研与架构设计（Figma 设计契约）](../产品文档/智枢-生态调研与架构设计.md#四figma-ui-设计交付契约已定稿) |
| 发布 CLI、规则包或桌面应用新版本 | [版本发布指南](./版本发布指南.md) → [CHANGELOG.md](../../CHANGELOG.md) |
| 复核规则包内容来源与权利依据 | [内容权利复核表](./内容权利复核表.md) → [规则包内容来源清单](./规则包内容来源清单.md)（自动生成） |

## 现有文档清单

| 文档 | 说明 | 状态 | 维护方式 / 负责人 |
|---|---|---|---|
| [01-技术总览.md](./01-技术总览.md) | 当前源码基线架构、运行单元、核心链路、关键符号、契约与本地验证入口 | 有效 | 仓库所有者 |
| [安装与更新指南.md](./安装与更新指南.md) | 业务项目接入、检测、初始化、差异更新、中断恢复、安全卸载与本地离线试用 | 有效 | 仓库所有者 |
| [用户环境资产安装机制.md](./用户环境资产安装机制.md) | 桌面版 `2.1.0` 的本机导入快照、Antigravity / Codex / TraeWork 跨工具插件与技能及 MCP 交付机制 | 有效 | 仓库所有者 |
| [UI设计规则说明.md](./UI设计规则说明.md) | `ui-design`（含 XR 空间界面与布局架构）与 `project-docs/ui-design` 规则包的范围、调整依据与选装验证 | 有效 | 仓库所有者 |
| [版本发布指南.md](./版本发布指南.md) | 规则包 + npm CLI 与桌面应用双轨发布流程、门禁脚本与许可打包策略 | 有效 | 仓库所有者 |
| [内容权利复核表.md](./内容权利复核表.md) | 20 个规则包及历史副本的内容权属人工复核台账（待持续补录） | 有效 | 仓库所有者（人工复核） |
| [规则包内容来源清单.md](./规则包内容来源清单.md) | 20 个规则包、158 份规则文档的规范化文本 SHA-256 与来源线索索引 | 自动生成 | 由 [generate-provenance-inventory.mjs](../../scripts/generate-provenance-inventory.mjs) 生成，禁止手改 |

## 模块—源码—文档—验证覆盖矩阵

| 模块 / 资产 | 关键入口与实现 | 关联技术文档 | 验证方式与现状 |
|---|---|---|---|
| 核心引擎 `@zhishu/core`（`2.1.0`） | [packages/core/src/index.ts](../../packages/core/src/index.ts)（`detect` / `adapter` / `project` / `release` / `assets` / `user-assets` / `mcp` / `sources` / `evolution`） | [01-技术总览](./01-技术总览.md)、[安装与更新指南](./安装与更新指南.md)、[用户环境资产安装机制](./用户环境资产安装机制.md) | `npm run check`（`node:test` 单测 + `tsc`）已通过 |
| 命令行 `zhishu`（`2.1.0`） | [packages/cli/src/index.ts](../../packages/cli/src/index.ts)（`esbuild` 打包至 `dist/index.js`，含 `evolve` 进化子命令） | [01-技术总览](./01-技术总览.md)、[安装与更新指南](./安装与更新指南.md) | `npm run check`（含 CLI / 进化 / 远程 / 打包安装 E2E 测试）已通过 |
| 桌面应用 `zhishu-desktop`（`2.1.0`） | [packages/desktop-app/electron/main.ts](../../packages/desktop-app/electron/main.ts)、[preload.ts](../../packages/desktop-app/electron/preload.ts)、[evolution-operations.ts](../../packages/desktop-app/electron/evolution-operations.ts)、[src/App.tsx](../../packages/desktop-app/src/App.tsx)、[src/EvolutionPage.tsx](../../packages/desktop-app/src/EvolutionPage.tsx) | [01-技术总览](./01-技术总览.md)、[用户环境资产安装机制](./用户环境资产安装机制.md)、[桌面版说明](../../packages/desktop-app/README.md) | `typecheck` + `test` + macOS 真机交互实测已通过（真实 Codex CLI 项需设置 `ZHISHU_CODEX_CLI`）；Windows 交互待验收 |
| Codex 与共享入口适配器 `@zhishu/adapter-codex` | [adapters/codex/src/index.ts](../../adapters/codex/src/index.ts)、[adapters/codex/user-assets.ts](../../adapters/codex/user-assets.ts)、[adapters/codex/adapter.json](../../adapters/codex/adapter.json) | [01-技术总览](./01-技术总览.md)、[用户环境资产安装机制](./用户环境资产安装机制.md) | `npm run check` 覆盖 `AGENTS.md` 渲染与模拟宿主测试；Codex 桌面端插件交互待验收 |
| 其他平台适配器（`antigravity` / `traework` / `cursor` / `qoder` / `workbuddy`） | [adapters/antigravity/user-assets.ts](../../adapters/antigravity/user-assets.ts)、[adapters/traework/user-assets.ts](../../adapters/traework/user-assets.ts)、[adapters/traework/product-design.ts](../../adapters/traework/product-design.ts)、各平台 `adapter.json` | [01-技术总览](./01-技术总览.md)、[用户环境资产安装机制](./用户环境资产安装机制.md)、各目录 `README.md` | 单元测试覆盖 Antigravity / TraeWork 本地资产与 MCP 隔离交付及共享 `AGENTS.md` 生成；Antigravity 已通过真机自装与路由探针 |
| 权威底层规则库 `rulepacks/` | [rulepacks/README.md](../../rulepacks/README.md)（20 包 / 158 份 Markdown） | [UI设计规则说明](./UI设计规则说明.md)、[内容权利复核表](./内容权利复核表.md)、[规则包内容来源清单](./规则包内容来源清单.md) | `validate-rulepacks.mjs`、`generate-provenance-inventory.mjs --check`、`check-rule-docs.sh` 均已通过 |
| 数据契约与自动化脚本 | [schemas/](../../schemas/)（8 套 JSON Schema：`adapter`、`asset`、`evolution`、`mcp`、`project-config`、`project-lock`、`rulepack`、`source`）、[scripts/](../../scripts/) | [01-技术总览](./01-技术总览.md)、[版本发布指南](./版本发布指南.md) | `scripts/tests/*.test.mjs` 覆盖发布门禁、清单、进化 CLI E2E、一致性总门禁与 E2E 校验 |
| 岗位插件与技能库 `plugins/` | [plugins/README.md](../../plugins/README.md)（6 岗位插件 / 43 Skills） | [用户环境资产安装机制](./用户环境资产安装机制.md)、[01-技术总览](./01-技术总览.md) | `validate-plugins.mjs` 与 `builtin-plugins.test.mjs` 跨工具隔离安装测试均已通过；Antigravity 已实测自装与 20 题路由验证 |
| 预留能力目录 `workflows/` | [workflows/README.md](../../workflows/README.md) | [智枢-产品需求文档](../产品文档/智枢-产品需求文档.md) | 规划占位，尚未实现具体资产 |
