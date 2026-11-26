---
name: fs-evolution-capture
description: 用于在 AI 对话开发、排障、架构或体验评审中，将经用户纠正的可复用工程规范、参数校准或自检步骤提炼为脱敏的原子增量提案，通过 zhishu evolve capture 投递至智枢「规则进化」待审收件箱等待人工审批落盘。
metadata:
  title: 对话现场规则进化捕获
  version: "2.1.0"
  role: fullstack-dev
  rulepacks:
    - common
---

# 对话现场规则进化捕获

## 1. 触发时机与路由边界

当用户在对话中明确纠偏、总结出通用避坑经验，或要求“把这条沉淀到智枢规范 / 技能”时启用本技能。首先按以下边界判断归属，避免把项目特例混入共享资产：

| 经验类型 | 目标归属 | 目标路径示例 |
|---|---|---|
| 仅当前仓库有效的端口、目录、业务专有名词 | 项目本地覆盖 | 当前项目 `.agent-rules/overrides.md`（不投递共享进化箱） |
| 通用工程红线、参数阈值、选型约束、跨平台标准 | 底层共享规则（`rule`） | `rulepacks/<pack-id>/<对应专题>.md` |
| 可复用操作步骤、核对清单、输出模板或脚本用法 | 岗位能力技能（`skill`） | `plugins/<plugin-name>/skills/<skill-name>/SKILL.md` |

## 2. 执行步骤（ACE 原子增量原则）

1. **只读核对目标锚点**：先确认目标共享规则文件或 `SKILL.md` 的相对路径与精确章节标题（`anchorHeading`），选择最小增量操作：
   - `add-item`：在指定章节末尾追加 1 条精炼条款；
   - `update-item`：精确替换该章节内已有片段（必填 `beforeSnippet` 与 `afterSnippet`）；
   - `deprecate-item`：废弃过时条款（必填 `beforeSnippet`）。
   - **禁止整篇重写目标文档**，也不得盲目追加与现有条款高度重复的条目。
2. **强制脱敏检查**：提交前逐项剥离以下敏感或私密信息，否则入箱引擎会直接拒绝：
   - 任何明文 Token、API Key、AppSecret、Bearer 凭据、私钥块或内网密码；
   - 本机私有绝对路径（如 `/Users/<name>/...`、`C:\Users\<name>\...`），统一改用相对路径或占位符；
   - 具体客户名、内部域名或项目专属代码片段。
3. **投递至智枢待审收件箱**：
   - 若本机已安装 `zhishu` CLI，直接执行：
     ```bash
     zhishu evolve capture \
       --title "<不超过 60 字的提案标题>" \
       --target-kind rule \
       --target-path "rulepacks/<pack>/<doc>.md" \
       --anchor "## <精确章节标题>" \
       --op add-item \
       --after "- <脱敏后的原子条款>" \
       --evidence "<本次纠偏或实测核验依据>"
     ```
   - 若当前环境无 `zhishu` CLI，输出符合 `schemas/evolution.schema.json` 的 JSON 提案草稿，指引用户在智枢桌面端「规则进化 → 导入提案」导入。

## 3. 安全红线

- **绝不静默改写共享规则源或岗位插件正文**：所有写入必须经过智枢桌面端「规则进化 → 查看变更 → 确认写入」或 CLI `zhishu evolve apply --apply` 的人工 Diff 审批与自动化校验门禁。
- 交付结果必须列出：投递状态（新建 / 同指纹折叠 / 被拦截原因）、目标文件与锚点章节、以及下一步人工审阅指引。
