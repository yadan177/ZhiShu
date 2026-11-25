# 智枢岗位插件与技能目录（`plugins/`）

本目录维护智枢官方内置的 **6 大岗位插件、共 42 个 Skills**，采用统一的开放标准插件布局（根级 `plugin.json` + `skills/<skill-slug>/SKILL.md`），兼容 Antigravity 与 OpenAI Codex 原生插件格式；任意单个技能目录也可独立导入并安装到 Antigravity、OpenAI Codex、TraeWork 与通用标准目录（`~/.agents/skills`）。

所有插件与技能**不复制规则正文**，执行时动态读取目标项目 `.agent-rules/` 中已安装的对应底层规则包与 `.agent-rules/overrides.md`，避免规则双源漂移。

## 已内置岗位插件清单（6 插件 / 42 Skills）

| 插件目录与标识 | 中文名称 | 技能数 | 关联底层规则包 |
|---|---|---|---|
| `zhishu-product-pm` | 产品经理 | 8 | `common`、`product-pm`、`xr-common` |
| `zhishu-ui-design` | UI 设计师 | 7 | `common`、`ui-design`、`project-docs/ui-design`、`xr-common` |
| `zhishu-3d-art` | 三维设计师 | 6 | `common`、`3d-art`、`xr-common` |
| `zhishu-ta-vfx` | 技术美术（TA） | 5 | `common`、`ta-vfx-shader`、`unity`、`xr-common` |
| `zhishu-unity-dev` | Unity 开发工程师 | 8 | `common`、`unity`、`pico`、`project-docs/unity`、`xr-common` |
| `zhishu-fullstack-dev` | 全栈开发工程师 | 8 | `common`、`javascript`、`typescript`、`go`、`java`、`python`、`xr-common` 及配套 `project-docs/*` |

## 校验与接入

- 结构与引用校验：`npm run check:plugins`（`node scripts/validate-plugins.mjs`），核对所有 `plugin.json`、`ruleCategories` 规则包存在性及 42 份 `SKILL.md` frontmatter 合法性与全局名称唯一性。
- 桌面端自动加载：桌面端 `PluginLibrary` 只读扫描本目录作为「官方预设」展示在「插件与技能 → 插件」页，用户按需多选目标 AI 工具预览差异后安装；打包时通过 `electron-builder` `extraResources` 随应用附带。
- 本机第三方插件导入快照仍保存在用户应用数据目录（`userData/plugin-imports`），与本目录严格隔离；Product Design 的 TraeWork 专属适配仍位于 `adapters/traework/`。详见 [用户环境资产安装机制](../项目文档/技术文档/用户环境资产安装机制.md)。
