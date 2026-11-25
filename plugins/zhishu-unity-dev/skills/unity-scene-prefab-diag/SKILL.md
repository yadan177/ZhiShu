---
name: unity-scene-prefab-diag
description: 用于诊断 Unity 场景文件（.unity）、预制体（.prefab）及配套 .meta 中的脚本引用丢失（Missing Script/Reference）、Base Prefab 被意外 Apply 污染、高频冲突大场景、隐藏冗余对象、光照/碰撞配置异常及资源加载隐患。当研发排查场景报错、Prefab 覆盖错乱或做合并前诊断时使用。
metadata:
  title: 场景与预制体诊断
  version: "2.0.0"
  role: unity-dev
  rulepacks:
    - common
    - unity
---

# 场景与预制体诊断

## 1. 开始前核对

1. 优先读取项目 `.agent-rules/overrides.md`、`.agent-rules/unity/其他规则/08-版本控制规则.md` 与 `09-资源管理规则.md`（若已安装）。
2. 检查目标场景、Prefab 及对应 `.meta` 文件的 YAML 内容、Git Diff 或 Editor 报错日志，确认项目实际使用的 Prefab 变体（Prefab Variant）结构与场景拆分约定。
3. **安全原则**：严禁直接手改复杂 `.unity` / `.prefab` YAML 内部 `fileID` 导致引用损坏；如需批量扫描或修复，优先提供安全的 Unity Editor 诊断脚本或在 Editor 内执行并复核。

## 2. 六维诊断清单

1. **Missing Script 与断链引用**：检查是否存在 `m_Script: {fileID: 0}` 或指向无效 GUID 的序列化引用（常见于移动/删除脚本未同步 `.meta` 或跨分支合并冲突）。
2. **Base Prefab 与 Variant Override 污染**：
   - 检查场景实例或 Variant 是否把仅限单场景的坐标、测试开关或临时材质误 `Apply All` 回 Base Prefab；
   - 检查是否存在深层嵌套 Prefab 引发的重复覆写与合并冲突热点。
3. **场景职责臃肿与协作冲突**：检查单场景是否塞入了多个业务模块导致多人频繁冲突；评估按模块拆分 Additive 场景与运行时按需异步加载的可行性。
4. **隐藏/遗留调试对象与冗余组件**：排查测试用临时摄像机（多 `AudioListener` 告警）、遗留测试灯、禁用但仍挂着重资源引用的大节点（禁用物体引用的贴图/网格仍会被打进包里加载！）。
5. **碰撞体与渲染配置异常**：排查高面数网格误挂非凸或重度 `MeshCollider`、静态物体未合理标记 Static 标志、Canvas 嵌套与射线拦截冲突。
6. **Git 协作与 `.meta` 完整性**：核对每个新增/变更 Asset 是否都有一一对应的 `.meta` 文件，无孤立 `.meta` 或无 `.meta` 资产。

## 3. 输出结构

- **一、诊断对象与风险总览**（阻断引用缺失 / Prefab 污染 / 包体与性能隐患 / 协作风险）
- **二、问题明细表**：`级别 | 资产路径与节点层级 | 诊断依据 | 影响范围 | 安全修复步骤`
- **三、可选 Editor 只读扫描脚本**（需要大范围排查全工程场景与 Prefab 时提供）

## 4. 交付自检与红线

- 禁止在未查清 GUID 引用关系前建议直接删除疑似“无用”的 `.meta` 或资产文件。
- 涉及场景拆分或 Base Prefab 结构重构时，必须先提醒确认团队分支合并窗口，避免引发大规模场景冲突。
