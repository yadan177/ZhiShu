---
name: fs-doc-changelog-sync
description: 用于在代码完成功能迭代、架构调整、接口变更或准备发版时，增量定位并同步受影响的技术文档（架构总览、系统架构图、核心时序图、使用指南）以及 CHANGELOG.md / Release Notes。当研发需要同步技术文档、整理发版变更日志或核对文档与源码漂移时使用。
metadata:
  title: 技术文档与变更日志同步
  version: "2.1.0"
  role: fullstack-dev
  rulepacks:
    - common
    - project-docs/js-ts
    - project-docs/go
    - project-docs/java
    - project-docs/python
---

# 技术文档与变更日志同步

## 1. 开始前核对

1. 优先读取项目 `.agent-rules/overrides.md`、`.agent-rules/common/02-软件版本迭代与发布管理规范.md` 及当前技术栈对应的 `project-docs/*` 入口（若已安装）。
2. 检查仓库既有文档布局（如 `项目文档/技术文档/`、`README.md`、`CHANGELOG.md`），**严格沿用现有目录结构与命名，不为了迎合通用模板搬迁或重写无关文件**。
3. 基于真实 `git diff` / 源码 / 配置文件 / 已执行的测试结果做事实核对，绝不把规划项或未运行验证写成“已完成现状”。

## 2. 增量同步步骤

1. **建立代码改动 → 全链路下游资产影响映射**：
   - 新增/删除模块、进程边界、IPC/API 或存储文件 → 同步技术总览、系统架构图与核心时序图；
   - 新增/修改 CLI 参数、配置项、启动命令或安装步骤 → 同步 README 与使用/安装指南；
   - 规则包/资产数、Schema 数、适配器能力或测试套件变化 → 同步核对静态清单（如 `adapter.json`、`plugin.json`、`pack.json`）与总览统计口径，禁止只改正文漏改顶部导语与元信息；
   - 页面入口、表单字段、交互动作或状态流转变更 → 显式评估并标注对产品文档（PRD）、结构图（`.xmind`）与 UI 设计稿（Figma）的同步影响，避免跨载体静默漂移。
2. **整理面向受众的 `CHANGELOG.md` / Release Notes**：
   - 将零散的内部提交提炼为清晰的人话条目，按 Keep a Changelog 归类（`Added` / `Changed` / `Fixed` / `Deprecated` / `Breaking Changes`）；
   - 凡涉及破坏性变更、配置升级或数据迁移，必须写明具体升级步骤；**严禁直接把原始 `git log` 流水账粘贴为发版说明**。
3. **执行确定性死链与一致性检查**：
   - 运行配套链接扫描脚本 [check-markdown-links.mjs](./scripts/check-markdown-links.mjs) 核验目标文档目录内所有相对路径链接与标题锚点有效：
     ```bash
     node <skill-dir>/scripts/check-markdown-links.mjs <docs-dir>
     ```
   - 核对文档中提到的版本号与 `package.json` / `VERSION` / 拟打 Tag 一致，并运行项目自带的校验命令（如 `npm run check`）。

## 3. 输出结构

- **一、文档影响范围评估表**（受影响文档路径 / 同步原因 / 是否改动）
- **二、技术文档增量更新摘要**
- **三、整理后的 `CHANGELOG` / Release Notes 条目**（可直接归档到 `## [Unreleased]` 或目标版本下）
- **四、已核查源码依据与未验证范围说明**

## 4. 交付自检与红线

- 设计文档（产品 PRD / UI 说明）与技术实现文档职责分离，同步技术文档时不越权篡改产品规划边界。
- 自动生成的台账或清单文件（如来源清单、manifest）必须通过仓库脚本重新生成，禁止手工修改。
