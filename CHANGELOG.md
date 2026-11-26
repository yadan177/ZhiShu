# 变更记录

## 2.2.0 (Desktop) - 2026-11-26

### Added
- **全产品冲突恢复与异常态闭环出口**：
  - 项目规则新增可审查的「覆盖修复」（`allowDriftRepair`）与「强制卸载 / 清理孤立锁文件」（`planForceUninstall` / `applyForceUninstall`），严格保留 `.agent-rules/overrides.md` 与项目非受管文件；「我的项目」「项目规则」「规则进化」补齐手动「刷新」与更新态「重新检查」。
  - 插件、技能与 MCP 冲突行全面补齐 **「覆盖修复」**（`force: true` 差异预览）、**「强制卸载」** 与 **「清除记录」**（`forgetReceipt`），彻底消除漂移、目录被删或宿主 CLI 缺失时的永久死锁。
  - 「来源管理」新增来源「编辑」（`sources:update`）与移除二次确认；「插件与技能」新增自定义 MCP 编辑与重复 ID 校验、MCP 抽屉「显示明文」切换；「AI 工具」支持 MCP 版本更新检测、旧版 MCP 回执接管（`mcp:inspect-legacy` / `mcp:adopt-legacy`）、旧版 Codex 插件目录迁移接管以及接管弹窗逐项勾选。
  - 「规则进化」新增提案「重新打开」（`evolution:reopen`）、「归档」（`evolution:archive`）、「恢复默认巡检源」（`evolution:reset-watch-sources`）、巡检运行态恢复（`evolution:watch-status` / `evolution:watch-state`）、预览弹窗内「重新检测并重预览」、未保存补丁放弃确认以及同机 CLI 提案目录 `fs.watch` + 窗口聚焦自动刷新；CLI 补齐 `zhishu evolve recheck` / `reopen`。

### Fixed
- **P0 闭环、状态机与安全修复**：
  - 项目操作锁、资产操作锁、MCP 锁与进化锁统一升级为结构化 PID/TTL 锁，解决崩溃后死锁无法恢复的问题；`inspectProjectRoot` 显式检出孤立 `.agent-rules.lock.json` 并去重损坏配置问题。
  - 旧版过期回执（如 `v0.1.5`）遇磁盘合法官方插件（如 `v2.1.0`）时自动以磁盘现行官方快照生成干净接管候选，并统一使用 `computeCanonicalSourceDigest` 规范摘要；`PluginLibrary.list()` 忽略 `.DS_Store` / `Thumbs.db` 并隔离单条损坏快照。
  - `McpConfigEngine` 引入 JSON 键序规范化哈希、损坏配置安全降级预览、HTTP 带连字符 Header（如 `X-API-Key`）、Codex 引号表头 `[mcp_servers."id"]` 与 CRLF 兼容，并修复 `maskedBefore` 对自定义 `secret: true` 字段的脱敏遗漏。
  - 规则进化修复通道 2 Go/Python 规则路径与 10 项默认锚点标题、修复 `conflict` 提案编辑补丁后 `recheck` 落盘与 `approved` 指纹去重、拦截 `input.id` 覆写与 3xx 重定向 SSRF、将 Git 同步缓存标记为只读防 `reset --hard` 覆盖，并为官方文档巡检接入 `electronGenericFetch` 系统代理。
  - 应用内更新器修复 `checkNow()` 状态机死锁、下载中断/超限时的流关闭与 `.part`/`.sh` 清理、空闲超时与背压控制、macOS 替换脚本 4 处边界缺陷、Windows `shell.openPath` UAC 提权及 `electron-updater` 取消令牌。
  - CLI 改用严格参数解析器，支持 flag 位于目录参数之前精准作用于目标目录并拦截未知参数。
- **P1/P2 交互体验、跨宿主与打包瘦身**：
  - 全应用弹窗与抽屉改为内联报错展示，修复遮罩覆盖报错；`App.tsx` 统一 `effectiveSelectedRulepacks` 合并企业必选包、为所有页面增加同步防重入锁与侧边栏写操作保护、同步修复 `applyPreview`/`recoverProject` 模式切换；修复 `Dropdown` 贴近滚动边缘打开即闪退与 `PreviewDialog` `Esc`/焦点管理。
  - 扩展 macOS/Linux/Windows GUI 场景下 Codex CLI 探测路径与单飞缓存；`tools:snapshot` 合并冗余探测请求；TRAE 探测兼容 `/Applications/TRAE CN.app`；处理 `codex` 与 `generic` 共用 `~/.agents/skills` 的提示与互斥。
  - 移除未使用的 `react-icons`（85 MB）并将已打包前端依赖移至 `devDependencies`，使 macOS DMG 体积降至 ~124 MB；`electron-builder.config.cjs` 改为按环境变量条件配置 `mac.identity`；补齐 `ci.yml` 桌面 `typecheck`、`desktop-build.yml` 核心/适配器/插件监听与 `desktop-release.yml` 前置发布说明门禁。

## 2.1.3 (Desktop) - 2026-11-26

### Fixed
- **macOS Apple Silicon 安装包签名修复与门禁校验**：新增 [after-pack-mac-sign.cjs](packages/desktop-app/scripts/after-pack-mac-sign.cjs) 在未配置 Apple Developer ID 时执行完整 ad-hoc 深度重签，并在 [verify-update-assets.mjs](packages/desktop-app/scripts/verify-update-assets.mjs) 增加 `Contents/_CodeSignature/CodeResources` 与 `codesign --verify --deep --strict` 门禁，修复 `2.1.2` 下载安装后被 AppleSystemPolicy 拦截无法启动的问题。
- **Antigravity / OpenAI Codex / TRAE 三端插件与 Skill 图标补全**：为 6 个内置官方岗位插件补齐 `assets/logo.svg`、`logo` 与 `interface` 元数据，为 43 个 Skills 补齐 `assets/icon.svg` 与 `agents/openai.yaml`；Codex 适配器自动补全 `.codex-plugin/plugin.json`；「AI 工具」页新增内容摘要比对支持同版本号一键更新。
- **桌面端 GitHub 网络系统代理适配与瞬态重试**：新增 [resilient-fetch.ts](packages/desktop-app/electron/resilient-fetch.ts) 与 [electron-fetch.ts](packages/desktop-app/electron/electron-fetch.ts)，主进程全链路改走 Chromium `electron.net.fetch` / `electron.net.request` 自动继承系统代理与 PAC 配置，增加单次瞬态重试、超时控制与中文限流/代理错误提示。
- **版本检查错误 Tips 自动消失与手动关闭**：[App.tsx](packages/desktop-app/src/App.tsx) 右下角 `.software-toast` 增加 6 秒自动消失计时与 `×` 关闭按钮，移除无可用更新时侧边栏重复残留的错误文本。

## 2.1.2 (Desktop) - 2026-11-26

### Added
- **桌面端应用内安全下载、双向 SHA-256 校验与一键安装**：
  - `.github/workflows/desktop-release.yml` 发版自动生成并上传 `SHA256SUMS.txt`；[desktop-releases.ts](packages/desktop-app/electron/desktop-releases.ts) 同步解析 `SHA256SUMS.txt` 与 GitHub Release 资产 `digest` / `size`。
  - 新增纯 Node 下载校验引擎 [desktop-updater.ts](packages/desktop-app/electron/desktop-updater.ts) 与重构后的 [software-update.ts](packages/desktop-app/electron/software-update.ts)：支持受信任 GitHub CDN 重定向守卫、流式下载进度、双向 SHA-256 交叉核验、本地完整包缓存复用与旧包清理、启动前 TOCTOU 复核、中途取消（`software-update:cancel`）、macOS 可写目录原子替换重启（不可写回退自动打开 DMG）以及 Windows 自动拉起已校验安装向导。
  - 侧边栏版本卡片新增进度条、「取消」按钮、`已就绪` 显式确认态与失败后的「浏览器下载」兜底链接。
  - 新增 [desktop-updater.test.mjs](packages/desktop-app/tests/desktop-updater.test.mjs) 并扩充 [desktop-releases.test.mjs](packages/desktop-app/tests/desktop-releases.test.mjs) 单元测试。

## 2.1.1 (Desktop) - 2026-11-26

### Added
- **「AI 工具」旧版回执与未纳管官方插件显式接管（零静默写入）**：
  - `@zhishu/core` 新增 `UserAssetStore.adoptReceipt()`（互斥锁 + 真实目录核验 + 拒绝覆盖已有回执 + `0o600` 原子写入，绝不修改目标插件目录）。
  - 桌面端新增 `assets:inspect-legacy`（只读扫描旧版 `zhishu-desktop` 回执及 `~/.gemini/config/plugins/` 下满足 `author.name === "智枢官方"` 的未纳管官方 `zhishu-*` 插件，严格排除第三方插件、幽灵回执与符号链接）与 `assets:adopt-legacy` 受控 IPC，配套「接管旧版」提示条与「接管旧版记录」预览弹窗。
  - 新增 [legacy-takeover.test.mjs](packages/desktop-app/tests/legacy-takeover.test.mjs) 自动化单元测试。

### Changed
- **按完整产研设计流程重构「04 · AI 工具」页面**（同步更新 PRD、产品结构图 XMind、架构设计、Figma `04 · AI 工具` / `04-C` 画板与前端实现）：
  - 工具探测卡片补齐支持能力摘要与分类计数，列表头新增状态计数汇总（正常 / 可更新 / 需处理）与「查看全部」复位。
  - 已安装清单重构为单行左信息 / 右操作紧凑横排与 `~/...` 精简路径，并按状态条件显隐操作控件（已是最新单版本隐藏版本下拉框与「更新」按钮；存在更高版本显「可更新至 vX.Y.Z」与主按钮「更新」；仅 `>= 2` 本地候选版本显紧凑自定义下拉框）。

## 2.1.0 - 2026-11-26

### Added
- **三通道规则自动进化引擎与第 5 一级模块「规则进化」**：
  - 新增第 8 套数据契约 [schemas/evolution.schema.json](schemas/evolution.schema.json) 与平台无关进化引擎 [packages/core/src/evolution.ts](packages/core/src/evolution.ts)（`EvolutionStore`、ACE 原子增量补丁计算 `computeAtomicDeltaPatch`、跨项目只读覆盖扫描 `scanOverridesForPromotions`、防 SSRF 官方文档巡检 `watchOfficialDocs`、敏感凭据与私有路径硬阻断 `detectSensitiveContent`、写入后自动门禁与回滚 `validateEvolutionTargetFile`）。
  - 新增 `zhishu evolve` CLI 子命令（`capture` / `list` / `scan-overrides` / `preview` / `apply --apply` / `reject` / `export`）与第 43 个官方技能 [fs-evolution-capture](plugins/zhishu-fullstack-dev/skills/fs-evolution-capture/SKILL.md)，默认投递至同机智枢桌面端收件箱。
  - 桌面端升级为左侧 5 模块导航，新增 [EvolutionPage.tsx](packages/desktop-app/src/EvolutionPage.tsx) 与主进程 [evolution-operations.ts](packages/desktop-app/electron/evolution-operations.ts)（12 个受控 `evolution:*` IPC 与实时巡检进度推送），支持右侧提案审阅抽屉、聚焦增量行号的双栏 Diff 审批弹窗、只读源拦截、补丁导出与官方文档巡检源管理。
  - 完整补充 `@zhishu/core`、`zhishu-desktop` 与 CLI E2E 规则进化自动化测试套件。

### Changed
- **XR 空间界面与布局参数官方校准**：对照 Apple visionOS HIG、Meta Horizon OS 与 PICO OS 官方规范校准视距、热区与空间安全参数，并同步至对应底层规则包与 5 份 XR 空间 UI Skills。
- **工作区资产精简**：清理历史 `1.x`/`2.0.0` 独立桌面发布说明与已退役的 `adapters/{codex,qoder}/templates/` 静态迁移副本（历史记录保留于 Git 与 `CHANGELOG.md`）。

### Fixed
- 修复「项目规则」页选择「智枢官方源」时因残留 `releasedInOfficial015` 字段导致 6 个 2.0 新增规则包错误置灰不可选的问题。

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
