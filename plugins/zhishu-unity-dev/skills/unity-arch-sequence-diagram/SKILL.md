---
name: unity-arch-sequence-diagram
description: 用于基于真实 Unity / XR 工程源码或技术方案，绘制清晰分层的 Unity 系统架构图（模块分层、程序集依赖、渲染/资源/SDK 边界）与核心运行时时序图（启动引导、场景与资源异步加载、XR 交互、网络同步与断线重连）。当 Unity 研发做技术方案评审、双端联调对齐或梳理复杂异步链路时使用；不用于画产品业务泳道图。
metadata:
  title: Unity 架构与时序图生成
  version: "2.1.0"
  role: unity-dev
  rulepacks:
    - common
    - unity
    - project-docs/unity
    - xr-common
---

# Unity 架构与时序图生成

## 1. 开始前核对

1. 优先读取项目 `.agent-rules/overrides.md`、`.agent-rules/project-docs/unity/其他规则/04-UnityAI技术文档任务入口.md` 与 `02-Unity技术文档编写规范.md`（若已安装），以及 `.agent-rules/common/03-跨端接口契约与联调规范.md`。
2. 若基于现有工程画图，**必须先从真实源码与配置核对事实**：读取 `Packages/manifest.json`、`ProjectSettings/EditorBuildSettings.asset`、各 `.asmdef` 程序集依赖、启动引导脚本（Bootstrap）、资源加载管理器及网络/XR SDK 适配层；**严禁编造不存在的类名、模块或未安装的第三方框架**。
3. 若用于未编码的方案评审，在图标题与说明中显式标注 `设计方案（待实现）`，与现有架构事实严格区分。

## 2. 制图执行规范

1. **系统架构图（`flowchart TB/LR`）**：
   - 清晰按职责分层分区（`subgraph`）：表现与交互层（UGUI / UI Toolkit / XR 射线与手势输入）→ 业务域与状态管理 → 基础设施层（资源加载 Addressables/YooAssets、音频总线、本地存储、网络通信）→ 平台与引擎适配层（OpenXR / PICO SDK / Android 原生桥）→ 外部依赖边界（业务服务端、CDN/热更源）；
   - 箭头标明依赖方向或协议形态（事件通知、异步句柄、HTTPS/WebSocket/UDP），不把几十个细碎 `MonoBehaviour` 全堆进顶层总览图。
2. **核心运行时时序图（`sequenceDiagram`）**：
   - 聚焦单一关键链路（如：冷启动与首场景加载、资源热更与句柄释放、登录鉴权与长连接重连、XR 摘戴休眠恢复、多人房间状态同步）；
   - 使用 `alt` / `opt` / `par` 显式表达主线程与异步边界、加载失败降级、对象销毁取消（`CancellationToken`）及断线重连补拉；
   - 参与者名称简洁明确，并附与真实类/组件的映射表。
3. **Mermaid 语法安全**：所有包含括号、斜杠或泛型符号的节点标签用双引号包裹，避免渲染报错。

## 3. 输出结构

- **一、架构/链路口径声明**（现状核查还是待实现方案 + 依据的关键源码/配置文件列表）
- **二、Unity 系统架构图**（Mermaid `flowchart` + 核心层职责表）
- **三、核心运行时时序图**（Mermaid `sequenceDiagram` + 异常/取消/超时处理说明）
- **四、关键源码锚点与待确认缺口**（标注实际核对到的脚本路径或待补全设计点）

## 4. 交付自检与红线

- 严禁把规则示例里的 `Addressables`、`Mirror`、`UniTask` 等写进并未使用它们的项目现状架构图。
- 时序图必须至少交代失败/取消/超时等核心异常分支，不只画理想成功路径。
