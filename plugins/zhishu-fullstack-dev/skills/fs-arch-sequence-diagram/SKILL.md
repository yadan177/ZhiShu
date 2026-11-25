---
name: fs-arch-sequence-diagram
description: 用于基于真实全栈工程源码（JS/TS、Go、Java、Python、桌面端/Web）或技术设计方案，绘制清晰的系统架构图（端/网关/服务/数据/外部依赖与进程边界）和核心调用时序图（鉴权、跨端联调、事务写入、异步队列与异常回滚）。当研发做技术方案评审、双端接口对齐或为项目补全架构与时序视图时使用；不用于画产品功能结构树。
metadata:
  title: 系统架构与时序图生成
  version: "2.0.0"
  role: fullstack-dev
  rulepacks:
    - common
    - project-docs/js-ts
    - project-docs/go
    - project-docs/java
    - project-docs/python
---

# 系统架构与时序图生成

## 1. 开始前核对

1. 优先读取项目 `.agent-rules/overrides.md`、当前技术栈对应的 `.agent-rules/project-docs/*` 编写规范及 `.agent-rules/common/03-跨端接口契约与联调规范.md`（若已安装）。
2. 若绘制**现有系统**的架构或时序图，必须先从源码入口核对事实（如 `package.json` / `go.mod` / `pom.xml` / `pyproject.toml`、路由与控制器、IPC/RPC 边界、数据库与缓存客户端、外部 API 调用点），**严禁把未接入的中间件（如未使用的 Redis / MQ / K8s）凭想象画进现状图**。
3. 若绘制**新方案设计图**，在标题与图例中显式标明 `设计草案（待实现）`，并与现有系统边界区分开。

## 2. 制图执行规范

1. **系统架构图（`flowchart TB/LR`）**：
   - 使用 `subgraph` 清晰隔离运行进程与信任边界：客户端/前端/桌面渲染进程 → 网关/Preload IPC/API 入口 → 核心领域服务层 → 数据持久化与本地文件存储 → 外部第三方服务/远端源；
   - 连线必须标注协议与安全特征（如 `HTTPS + JWT`、`Electron IPC contextBridge`、`gRPC`、`原子写入 0o600`、`git execFile`），避免只画无标注的空白连线。
2. **核心链路时序图（`sequenceDiagram`）**：
   - 每张时序图聚焦一条核心主链路（如：登录与 Token 刷新、预览差异与原子事务提交/回滚、双端接口联调与幂等防重、长连接重连与状态补拉、异步任务回调）；
   - 使用 `alt` / `else` / `opt` / `par` 显式画出参数校验失败、冲突拦截、超时重试与事务回滚路径；
   - 标明关键数据载荷与追踪标识（如 `Idempotency-Key`、`requestId`、预览 Token）。
3. **单图克制与语法安全**：每张架构图建议 8–18 个核心组件节点、每张时序图建议 3–6 个参与者；含括号、泛型、冒号或路径的标签统一用双引号包裹，确保 Mermaid 一次渲染通过。

## 3. 输出结构

- **一、制图范围与事实依据**（现状核查或方案草案 + 核对的核心源码入口列表）
- **二、系统架构图**（Mermaid `flowchart` + 模块职责与边界表）
- **三、核心链路时序图**（Mermaid `sequenceDiagram` + 关键状态码/幂等/回滚说明）
- **四、架构风险与待确认边界**（指出隐含单点、循环依赖、跨端契约缺口或未验证项）

## 4. 交付自检与红线

- 现状架构图中每一个组件和连线必须在源码或配置中有明确出处；未核实的外部部署拓扑显式标为 `待运维确认`。
- 时序图必须反映真实调用顺序与失败回滚逻辑，禁止把异步回调或并发分支画成虚假同步直线。
