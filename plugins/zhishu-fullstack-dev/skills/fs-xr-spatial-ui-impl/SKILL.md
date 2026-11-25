---
name: fs-xr-spatial-ui-impl
description: 用于在非 Unity 工程中开发或审查空间 UI 与跨端伴随界面，包括 WebXR（Three.js / React Three Fiber / A-Frame）、Apple visionOS（SwiftUI WindowGroup / Ornament / Volume / RealityKit）以及与 XR 头显联动的 Web/桌面伴随控制端。覆盖物理尺度与角尺寸换算、Yaw-only 窗口生成、多窗折角/弧形布局、Ornaments 附属条、眼动/射线/手势事件防抖、MR 透视可读背板及跨设备参数适配；不用于 Unity C# 工程（走 unity-xr-spatial-ui）或常规纯 2D Web 组件样式审计（走 fs-ui-component-audit）。
metadata:
  title: 跨端空间 UI 开发实现
  version: "2.0.0"
  role: fullstack-dev
  rulepacks:
    - common
    - javascript
    - typescript
    - xr-common
---

# 跨端空间 UI 开发实现

## 1. 开始前核对

1. 优先读取项目 `.agent-rules/overrides.md`、目标语言规则包（如 `.agent-rules/typescript/`、`.agent-rules/javascript/`）及 `.agent-rules/xr-common/`；若项目同时安装了 `ui-design`，必读 `.agent-rules/ui-design/其他规则/07-XR空间界面规范.md` 与 `.agent-rules/ui-design/其他规则/08-XR空间布局与摆放架构规范.md`。
2. 核对目标工程实际技术栈与设备基线（不得凭空切换框架）：
   - **WebXR 路线**：Three.js / React Three Fiber / WebXR Device API / Troika SDF Text 等现有依赖；
   - **原生空间路线**：Apple visionOS SwiftUI（`WindowGroup` / `ornament` / `RealityView` / `Volume`）或跨端桥接层；
   - **伴随控制端路线**：与头显联动的 Web/Electron 控制台与跨端状态同步契约。

## 2. 空间 UI 工程落地步骤

1. **建立物理尺度、拓扑与景深映射**：
   - 将设计稿物理尺寸（米）、默认视距（近距 `0.45–0.65m` / 中距 `1.2–2.5m` / 远距 `> 3.0m`）与引擎坐标单位精确绑定；
   - 超宽工作区实现为主窗 + 内倾 `15°–25°` 侧翼或柱面弧形布局；导航与工具条剥离为外挂附属条（visionOS 使用原生 `.ornament(...)`，WebXR 使用父子绑定且 Z 轴微前移 `+0.02–0.04m` 的独立容器）；
   - 按 L1–L4 景深层级施加真实物理 Z 偏移，杜绝双目 Z-fighting。
2. **实现 Yaw-Only 生成、防头锁与防穿模**：
   - 窗口首次生成仅取头显水平朝向（忽略 Pitch/Roll，处理垂直仰俯退化向量），落在眼高微俯处并保证最小离眼距离 `>= 0.45m`；
   - 严禁将交互面板直接挂在相机节点下做头部硬锁；惰性跟随需实现角度/距离死区、帧率无关指数阻尼及交互期冻结；
   - 支持多窗并发上限、槽位错开与 MR 深度/网格避让（不可用时安全回退）。
3. **跨设备输入容错与渲染性能保护**：
   - **visionOS**：遵循眼动注视高亮（`.hoverEffect()`）与防眼动漂移控件间距，善用原生 Glass 材质与系统 Window Bar；
   - **WebXR（Quest / PICO 浏览器）**：兼容手柄射线与裸手捏合，提供清晰光标落点、按下防抖阈值、SDF 清晰文字渲染、严控离屏 Canvas 重绘与实时全屏模糊 Overdraw，并避免热路径每帧对象分配导致 JS GC 掉帧。
4. **跨端伴随控制联动（如涉及）**：
   - 若包含桌面/平板伴随端同步控制头显内空间面板位置、重置视角或输入长文本，确保接口字段、状态同步幂等性与断线回退一致。

## 3. 输出结构

1. **一、技术栈与目标设备基线**（WebXR / visionOS / 伴随端、设备差异参数与已核对依赖）
2. **二、空间布局与交互实现方案**（尺度换算、拓扑/Ornament、Yaw-only 生成、防穿模与输入防抖代码）
3. **三、性能与可读性检查**（渲染帧时风险、文字清晰度、MR 背板对比度、物理 Z 偏移与 GC 排查）
4. **四、设备实测清单**（明确浏览器/模拟器已验项与头显真机待验项）

## 4. 交付自检与红线

- 严禁把普通 2D 屏幕像素或 CSS `z-index` 假设等同于双目三维空间物理深度与角尺寸。
- 严禁在 WebXR 动画循环（`requestAnimationFrame` / XR frame loop）中高频创建临时 `Vector3` / `Quaternion` 或每帧全量重绘 DOM 贴图。
- 不得把桌面浏览器预览通过冒充头显真机（Vision Pro / Quest / PICO）体验与帧率达标。
