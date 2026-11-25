# 智枢（ZhiShu）仓库开发规则

## 当前边界

- 迁移前的规则目录已从当前工作树清理；历史内容仅从 Git 历史查阅，不得当作当前规则源直接安装。
- 规则正文只从 `rulepacks/` 读取和维护；适配器入口只从 `adapters/` 读取和维护。禁止直接编辑 `.agent-rules/` 中的受管副本（`.agent-rules/overrides.md` 除外），修改 `rulepacks/` 后通过智枢 CLI 同步。
- 严格隔离两类规则作用域：软件研发、产品/UI 与项目文档仅适用 `common` / `javascript` / `typescript` / `project-docs/js-ts` / `product-pm` / `ui-design` / `project-docs/ui-design`；`rule-authoring` 仅限用于 `rulepacks/` 下的底层规则正文编写，详见 `.agent-rules/overrides.md`。
- 新产品代码放在 `packages/`、`adapters/`、`plugins/`、`rulepacks/`、`workflows/`、`schemas/` 和 `项目文档/`。

## 产品方向

- 智枢是独立于任何 IDE 的多项目管理产品；宿主 IDE 插件包只是交付形式，不能把 Codex 插件包描述为整款产品。
- 面向用户提供“插件与技能”模块，按需要自由选择并安装到 Codex、TraeWork 等目标软件的用户环境；不按项目技术栈强制分组安装，不做项目级安装、绑定或启用。产品规划、UI、前端、后端、Unity 等场景当前是目标，不得描述为已实现。项目规则仍在项目中分别管理。
- 桌面界面保持简洁：不添加段落式介绍、功能解释或重复操作说明，仅展示标题、字段、状态、必要错误与可审查变更。“我的项目”“项目规则”“插件与技能”分别为独立页面。
- 项目规则页面的项目选择只读取“我的项目”列表；新增项目在“我的项目”操作。所有下拉选择统一使用自定义组件，不使用系统默认下拉框。
- Codex 是第一个实现的适配器，但核心必须保持平台无关。
- 规则正文只在 `rulepacks/` 维护；适配器和 Skills 必须引用该来源或由其生成。
- 规则、Skills 和能力插件是分别维护的产品资产；IDE 插件包是交付形式，不等同于能力插件库。新增资产与适配器应遵循 `项目文档/产品文档/智枢-产品需求文档.md` 与 `项目文档/产品文档/智枢-生态调研与架构设计.md` 的边界，不得把未实现的目录或能力描述为现状。
- 通用 Skill 不得写死某家企业的规则；企业配置、项目事实、工具权限与宿主差异必须在组合和交付时处理。
- 项目事实与项目本地覆盖规则的优先级高于共享规则。
- 不得静默覆盖未知项目文件，也不得在没有可审查差异的情况下更新规则。

## 验证

运行 `npm run check` 完成 TypeScript 构建与测试；桌面改动另运行桌面端 typecheck 与测试。未来发布实际 Codex Skills 或插件时，再使用官方校验器验证对应资产。


<!-- agent-rule:start -->
## 智枢

处理开发、设计、排障、审查或文档任务前，先读取 `.agent-rules/overrides.md`；如已安装 `common`，再读取下方的通用入口。先核对目标项目的需求、设计、代码、依赖、配置和已有约定，不要把规则示例当作项目事实。

已配置规则包：

- `common`：`.agent-rules/common/entry.md`
- `javascript`：`.agent-rules/javascript/15-AI通用入口规则.md`
- `typescript`：`.agent-rules/typescript/09-AI通用入口规则.md`
- `project-docs/js-ts`：`.agent-rules/project-docs/js-ts/其他规则/04-JS+TSAI技术文档任务入口.md`
- `product-pm`：`.agent-rules/product-pm/15-AI通用入口规则.md`
- `project-docs/ui-design`：`.agent-rules/project-docs/ui-design/其他规则/04-UI设计文档任务入口.md`
- `ui-design`：`.agent-rules/ui-design/15-AI通用入口规则.md`
- `rule-authoring`：`.agent-rules/rule-authoring/规则文档编写格式规范.md`

按任务继续读取规则，不要只看上述文件名就声称已遵守规则：

- 开发、排障或代码审查：读取相关开发规则包的入口，再按入口中的任务索引读取必要的专题规则。
- 新建、修改、审查或同步技术文档：读取对应的 `project-docs/*` 入口（按技术栈选择），再按入口中的任务索引读取必要的专题规则；开发任务还应按开发入口判断文档影响。
- 产品需求、结构图、流程图、泳道图或验收梳理：读取 `product-pm` 入口，再选择本次相关专题。
- UI 设计、交互、视觉、组件或资源交付：读取 `ui-design` 入口，再选择本次相关专题。
- UI 设计说明、页面状态和交付记录：读取 `project-docs/ui-design` 入口；设计文档与技术实现文档分别维护。
- 其他规则包仅在任务涉及时读取其入口。入口或其必要链接缺失时，说明缺失，不得声称已执行该规则。

共享规则不得覆盖用户当前要求、安全限制、项目本地规则或经过验证的项目事实。完成任务时说明实际读取的规则、验证结果、文档影响和未验证范围。
<!-- agent-rule:end -->
