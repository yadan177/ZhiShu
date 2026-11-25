# 变更记录

## 2.0.0 - 2026-11-25

### Changed
- **全面更名为智枢（ZhiShu）并统一双轨 2.0.0 发版**：统一仓库包名（`@zhishu/core`、`@zhishu/adapter-codex`、`zhishu`、`zhishu-desktop`）、CLI 命令 `zhishu`、桌面端 `productName`（`智枢`）/ `appId`、官方 `3-W1` 矢量图标、发布资产名与全量产品/技术文档；规则包/CLI/岗位插件（`v2.0.0`）与桌面端（`desktop-v2.0.0`）统一升至 `2.0.0`。
- **桌面端重构为 2.0 左侧 4 模块架构**：升级为「我的项目（含项目规则工作台）」「插件与技能」「AI 工具」「来源管理」四大工作台；优化「项目规则」首次安装主操作为「安装规则 → 变更预览 → 确认安装」；全应用界面文字统一改为系统默认无衬线字体（macOS 苹方 / Windows 微软雅黑），仅代码与 Diff 预览框保留系统等宽字体。

### Added
- **20 个底层规则包（158 份规则文档）与跨设备 XR 空间 UI 规范体系**：
  - 新增 `ui-design`、`project-docs/ui-design`、`xr-common`、`product-pm`、`3d-art`、`ta-vfx-shader` 等可选规则包。
  - 新增 [08-XR空间布局与摆放架构规范.md](rulepacks/ui-design/其他规则/08-XR空间布局与摆放架构规范.md)（80% 跨设备空间拓扑/多窗/Ornaments/Yaw-only 生成/防穿模/Z 景深底座 + 20% Apple Vision Pro / Meta Quest / PICO 设备差异适配矩阵）与 [17-XR空间UI实现规则.md](rulepacks/unity/其他规则/17-XR空间UI实现规则.md)（Unity World Space、Yaw-only 投影、Lazy Follow 阻尼、碰撞避让与一体机性能），并联动更新 `product-pm` 与 `xr-common`。
  - 完善五种技术栈的技术文档规则，将 Code Wiki、源码核查、实测验证与增量同步流程融入既有文档规范。
- **6 大官方岗位插件（42 个 Skills）与确定性校验脚本**：
  - 落地产品经理（8）、UI 设计师（7）、三维设计师（6）、技术美术 TA（5）、Unity 开发工程师（8）、全栈开发工程师（8）共 6 大岗位插件、42 个 Skills，新增覆盖产品规划、UI 布局设计、Unity 实现与 WebXR/visionOS 跨端实现的 4 份空间 UI 协同 Skills。
  - 为核心 Skills 内置确定性脚本（`validate-xmind.mjs`、`figma-audit.js`、`check-markdown-links.mjs`），支持 Antigravity、OpenAI Codex、TRAE 与通用目录（`~/.agents/skills`）预览同步。
- **独立 MCP 脱敏配置与三级资产来源治理**：
  - 内置 `飞书 MCP` 预设并支持添加自定义 `stdio` / `http` MCP，密钥仅落盘本机 `0o600` 配置且预览自动脱敏。
  - 新增企业源（支持私有 Git / 本地目录、企业必选规则锁定与 `0o600` 凭据隔离）、个人源与内置只读官方源管理。
- **CLI 多岗位扩展与跨文件一致性总门禁**：
  - `zhishu` CLI 新增 `init --rulepacks`、`recover` 与 6 平台 `--targets`（`codex,antigravity,trae,qoder,cursor,workbuddy`）。
  - 新增 `scripts/validate-plugins.mjs` 与 `scripts/validate-consistency.mjs` 总门禁接入 `npm run check`，统一守护适配器声明、规则统计、插件统计、XMind 结构图与文档链接一致性。

## 0.1.5 - 2026-09-27

- 卸载默认显示受管文件数量、`AGENTS.md` 处理方式和保留文件清单；需要逐行差异时可使用 `uninstall --details`。`uninstall --apply` 继续复核卸载计划，成功后只显示结果摘要。

## 0.1.4 - 2026-09-26

- 安装和卸载项目规则时逐字保留原有入口文件，包括空文件、无末尾换行和 CRLF 换行。
- 为新安装记录入口文件原本是否存在；旧版锁文件继续按原有格式处理。

## 0.1.3 - 2026-09-26

- 修复卸载项目规则后，已有 `AGENTS.md` 入口末尾多出空行的问题。

## 0.1.2 - 2026-09-26

- 新增 `agent-rule uninstall`：先预览卸载差异，再用 `--apply` 显式移除业务项目中的受管规则；保留本地覆盖规则与其他非受管文件。
- 移除未实现的 TRAE 专用适配资料；TraeCode 可按其官方规则设置读取项目中的 `AGENTS.md`。
- 清理过时的过程文档、过程脚本、重复示例和历史规则副本；历史版本仍可通过 Git 查阅。
- 在规则包 Release 资产中附带仓库 `LICENSE`，并将其纳入项目安装、完整性校验与更新差异。

## 0.1.1 - 2026-09-25

- 在通用入口规则中明确：更新共享规则必须先审查差异，并由用户决定是否应用。
- npm 包新增中文包级 README；CLI 命令入口和注册表独立安装纳入自动测试。
- 为 npm 发布工作流配置 GitHub Actions Trusted Publisher，并固定兼容的 npm CLI 版本；本版本已通过 OIDC 发布验收。
- 增加真实 GitHub Release 和 npm 包的独立安装验收脚本。

## 0.1.0 - 2026-09-25

- 初始化 TypeScript workspace 和 `agent-rule` CLI。
- 增加平台无关的项目检测与受管文件生成能力。
- 增加 Codex 适配器和 AgentRuleKit 插件骨架。
- 增加初始化、审查、文档影响和更新准备 Skills。
- 增加 Schemas、示例和 CI 骨架。
- 迁移 14 个规则包，共 116 份开发与技术文档规则。
- 归档 Codex、TRAE、Qoder 的 30 份适配器入口资料。
- 支持将本地工作区规则安装到 `.agent-rules/`，记录文件摘要并检测漂移。
- 增加规则包清单、依赖和本地链接 CI 校验，并在 Release 产物中记录可核查的 Git 来源提交。
- 首次发布 GitHub Release 与公开 npm 包 `agentrulekit@0.1.0`。
