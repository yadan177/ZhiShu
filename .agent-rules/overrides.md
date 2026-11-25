# 智枢（ZhiShu）项目本地覆盖规则

本文件优先级高于 `.agent-rules/` 下所有共享规则包（但不得覆盖用户当前明确要求与安全限制）。

## 1. 严格区分两类规则作用域（禁止混用）

本仓库同时承载**智枢软件产品代码/项目文档**与**底层规则库资产（`rulepacks/`）**，两类工作必须严格隔离，不得混用规则：

| 作用域 | 覆盖路径 | 适用规则包 | 禁止事项 |
|---|---|---|---|
| **作用域 A · 软件研发、产品/UI 与项目文档** | `packages/`、`adapters/`、`scripts/`、`schemas/`、`项目文档/`（及后续 `plugins/`、`workflows/`） | `common`、`javascript`、`typescript`、`project-docs/js-ts`、`product-pm`、`ui-design`、`project-docs/ui-design` | **严禁**套用 `rule-authoring`（不得强行把业务代码文档、PRD 或技术文档写成 `# 01 - ` 规则正文格式） |
| **作用域 B · 底层规则正文维护（元规则）** | **仅限** `rulepacks/` 下的底层规则正文（`rulepacks/**/*.md`，不含 `rulepacks/README.md`） | `common`、`rule-authoring` | **严禁**脱离 `rule-authoring` 编写规则正文；**严禁**将 `rule-authoring` 扩散到软件源码、PRD 或普通技术文档 |

## 2. 规则单一权威来源与本仓同步

- `rulepacks/` 是本仓库所有底层规则正文的**唯一编辑来源**；禁止直接修改 `.agent-rules/` 下的受管文件（本文件 `.agent-rules/overrides.md` 除外）。
- 修改 `rulepacks/` 后，必须执行：
  1. `npm run manifests`
  2. `node scripts/generate-provenance-inventory.mjs --write`
  3. `bash scripts/check-rule-docs.sh`
  4. `node packages/cli/dist/index.js diff .` 审查差异后，运行 `node packages/cli/dist/index.js update . --apply` 同步本仓库 `.agent-rules/`，再以 `node packages/cli/dist/index.js validate .` 校验完整性。

## 3. 本仓库技术栈与代码事实

以下仓库事实优先于共享规则中的通用工具链示例，未获明确授权不得新增、替换或升级依赖：

- **运行时与模块**：Node.js `>= 22`，纯 ESM（`"type": "module"`），npm workspaces（`packages/core`、`packages/cli`、`packages/desktop-app`、`adapters/codex`）。
- **语言与构建**：TypeScript `5.9`；CLI 使用 `esbuild` 打包，桌面端使用 `Electron 44 + React 19 + Vite 6`（独立 CSS 变量样式体系，不引入 Tailwind）。
- **测试与静态检查**：统一使用 Node 原生 `node:test` + `node:assert/strict` 与 `tsc --noEmit`；仓库当前未引入 ESLint / Prettier / Jest / Vitest，禁止因共享规则示例擅自添加。
- **产品与 UI 事实**：
  - 遵循 `AGENTS.md` 中的桌面极简风格（不添加段落式介绍、功能解释或重复说明；所有下拉框使用自定义组件，禁用系统原生下拉框）。
  - 桌面端 UI 协同参考当前定稿 Figma 设计稿（文件 Key：`3tPcBDcNjByW8JvSRcaAux`，页面 `01 品牌与组件` / `02 界面设计`）与 `packages/desktop-app/` 代码实现。
  - 智枢软件本体为桌面端 / CLI 工具，不涉及 XR 头显渲染与空间交互；开发智枢本体时**不适用** `ui-design/其他规则/07-XR空间界面规范.md` 与 `product-pm/其他规则/03-XR产品体验与验收准出规则.md`。

## 4. 项目文档目录与维护事实

以下实际目录布局优先于 `project-docs/js-ts` 和 `project-docs/ui-design` 的默认目录示例：

- **产品文档根目录**：`项目文档/产品文档/`（核心资产：`智枢-产品需求文档.md`、`智枢-生态调研与架构设计.md`、`智枢-产品结构图.xmind`）。
- **技术与设计文档根目录**：`项目文档/技术文档/`（含 `安装与更新指南.md`、`UI设计规则说明.md`、`内容权利复核表.md`、`规则包内容来源清单.md` 等）。
- 沿用现有文档结构与命名，不为满足模板示例擅自搬迁文件；自动生成文档（如 `规则包内容来源清单.md`）豁免手工 frontmatter。

## 5. 本仓库验证清单

- 常规改动：`npm run check`
- 桌面端改动：额外执行 `npm run typecheck --workspace zhishu-desktop` 与 `npm run test --workspace zhishu-desktop`
- 规则库或自举配置改动：额外执行 `bash scripts/check-rule-docs.sh` 与 `node packages/cli/dist/index.js validate .`
