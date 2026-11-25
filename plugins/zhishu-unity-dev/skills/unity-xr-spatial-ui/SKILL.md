---
name: unity-xr-spatial-ui
description: 用于在 Unity（OpenXR / XR Interaction Toolkit / PICO XR SDK / Meta XR SDK / visionOS PolySpatial）中设计、实现或重构 XR 空间 UI 系统，涵盖 World Space Canvas / UI Toolkit 空间化配置、头部 Yaw-only 初始生成、Lazy Follow 死区与帧率无关阻尼、多窗拓扑与防重叠调度、MR 墙面/桌面/3D 物体碰撞避让、射线与裸手直触热区防抖以及 Canvas 动静拆分性能优化。当 Unity 研发编写空间面板控制器、窗口管理器或排查空间 UI 穿模/抖动/点不准时使用；不用于纯 2D 屏幕 UGUI 或通用 C# 代码审查（走 unity-code-review）。
metadata:
  title: Unity XR 空间 UI 实现
  version: "2.0.0"
  role: unity-dev
  rulepacks:
    - common
    - unity
    - pico
    - xr-common
---

# Unity XR 空间 UI 实现

## 1. 开始前核对

1. 优先读取项目 `.agent-rules/overrides.md`、`.agent-rules/unity/其他规则/17-XR空间UI实现规则.md`、`.agent-rules/unity/其他规则/04-UGUI设计规则.md`（或 `05-UI Toolkit设计规则.md`）与 `.agent-rules/xr-common/`；若项目已安装 `ui-design`，同步读取 `.agent-rules/ui-design/其他规则/08-XR空间布局与摆放架构规范.md`。
2. 核对目标工程现有事实（禁止猜测或未经授权引入新包）：
   - Unity 版本与渲染管线（URP / Built-in）、已安装的 XR 包（OpenXR / XRI / PICO / Meta / PolySpatial）；
   - 项目已采用的 UI 框架（UGUI World Space Canvas 还是 UI Toolkit）与输入模块；
   - 目标头显设备、VR/MR 显示模式与设计侧提供的物理宽高/视距规格。

## 2. 工程设计与实现步骤

1. **统一世界空间画布与尺度映射**：
   - 采用 World Space Canvas（绑定 `worldCamera` 与 XR `GraphicRaycaster`）或已验证的 UI Toolkit 空间 Panel，显式固定 `Canvas Scale` / `Dynamic Pixels Per Unit`，动态文本统一用 `TextMeshPro` SDF 渲染，绝不使用 `Screen Space - Overlay`。
2. **实现安全定位与跟随组件**：
   - **Yaw-Only 首次弹出**：对头部 `forward` 做水平面投影（`Vector3.ProjectOnPlane`），处理垂直仰俯退化向量，按默认视距与眼高微俯偏移生成，并强制离眼安全距 `>= 0.45m`；
   - **惰性跟随（Lazy Follow）**：设置水平角度死区与距离死区，采用帧率无关指数阻尼或 `SmoothDamp`，用户悬停/拖拽/输入期间自动冻结跟随；**严禁挂在相机节点下做头部硬锁**。
3. **实现多窗调度、拖拽缩放与防穿模避让**：
   - 通过集中式 `SpatialWindowManager` 维护活动窗口上限、弧形/折角（15°–25°）槽位、外部附属条（Ornament）父子同步与 Recenter 一键召回；
   - 生成与结束拖拽时通过 `NonAlloc` 物理投射（严格过滤障碍 LayerMask）或 MR 深度/网格查询执行前推避让或贴墙吸附，并确保无房间网格时可优雅降级；
   - 拖拽保持仅绕 Y 轴朝向用户（零 Roll），按规格实现动态等角缩放或真实物理尺寸。
4. **落位交互热区防抖与移动一体机性能优化**：
   - 命中热区与视觉解耦，配置射线拖拽防抖阈值与近距直触按压行程/防连击冷却；输入事件通过统一抽象层接入，不写死单一厂商 SDK 轮询；
   - 按动静拆分嵌套 Canvas、关闭非交互图元 `Raycast Target`、杜绝 `Update` 热路径 GC 与移动一体机全屏实时模糊，为 L1–L4 浮层设置真实物理 Z 偏移防止双目 Z-fighting。

## 3. 输出结构

1. **一、工程现状与空间参数确认**（Unity/XR SDK 基线、目标设备、Canvas Scale/视距与假设项）
2. **二、核心组件与代码实现 / 修改方案**（定位生成、跟随 Solver、多窗调度、防穿模避让与输入热区）
3. **三、性能与双目深度检查结论**（Canvas 动静拆分、Raycast Target、GC 分配与物理 Z 偏移核对）
4. **四、真机必验清单**（坐/站姿弹出、射线/裸手防抖、MR 墙面避让、热稳态帧率与设备切换）

## 4. 交付自检与红线

- 严禁直接用 `head.position + head.forward * d` + `head.rotation` 弹出交互面板，严禁头部硬锁。
- 严禁在 `Update` 中对静止窗口每帧做无过滤物理扫描或产生托管堆分配。
- 必须明确区分 Unity Editor 模拟验证与目标头显（PICO / Quest / Vision Pro）真机实测结果，不得以 Editor 运行通过冒充真机验收。
