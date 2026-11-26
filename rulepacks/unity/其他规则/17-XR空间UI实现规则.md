# 17 - Unity XR 空间 UI 实现规则

> - 🟢 本文件适用于 Unity 引擎（UGUI World Space Canvas / UI Toolkit World Space / OpenXR / XR Interaction Toolkit / PICO XR SDK / Meta XR SDK / visionOS PolySpatial）中实现 VR、MR、AR 空间界面的摆放、动态生成、跟随、避让、交互与性能优化。
> - 🔴 不适用：纯 2D 屏幕手游/PC 界面（见 [04-UGUI设计规则](./04-UGUI设计规则.md) 与 [05-UI Toolkit设计规则](<./05-UI Toolkit设计规则.md>)）；空间视觉与人体工学设计基线若已安装 `ui-design` 与 `xr-common`，须与 `.agent-rules/ui-design/其他规则/07-XR空间界面规范.md`、`.agent-rules/ui-design/其他规则/08-XR空间布局与摆放架构规范.md` 及 `.agent-rules/xr-common/` 保持一致。

---

## 1. 空间 UI 渲染体系与物理尺度映射

在头显立体渲染中，常规 `Screen Space - Overlay` 会贴死双眼并破坏双目深度，严禁用于 XR 主交互界面。

- 🔴 **统一采用世界空间渲染**：UGUI 项目必须使用 `Canvas Render Mode = World Space` 并显式绑定主 XR 相机（`worldCamera`）及对应 XR 射线投射器（如 `TrackedDeviceGraphicRaycaster`）；采用 UI Toolkit 时须使用项目已验证的 World Space Panel 渲染管线，不得未经授权混用两套 UI 框架。
- 🔴 **显式固化像素到物理米的换算比例**：在 Prefab 或配置资产中固定 `Canvas Scale`（例如 `1000 px = 1.0 m` 对应 `localScale = (0.001, 0.001, 0.001)`）及 `Dynamic Pixels Per Unit`，并在注释/配置中记录默认观看距离，确保设计稿尺寸与引擎物理尺寸严格一一对应。
- 🔴 **文字渲染必须防闪烁锯齿，文字密集面板优先评估硬件合成层（Composition Layers）**：
  - 常规世界空间动态文本统一使用 `TextMeshPro`（SDF 字体渲染）或平台原生高清文字层，禁止使用低分辨率位图 `Legacy Text` 或将动态文案烘焙为低分贴图；
  - 🟡 **高清晰度文本菜单/阅读面板优先采用硬件合成层**：普通 World Space Canvas 会先渲染进主眼缓冲（Eye Buffer），再经 XR 运行时透镜畸变二次采样导致小字模糊闪烁；对文字密集或高频阅读面板，优先评估 Unity 官方跨平台 **`XR Composition Layers`（`com.unity.xr.compositionlayers` 的 Quad / Cylinder UI Panel）**、Meta **`OVROverlay` / `OVROverlayCanvas`** 或 PICO **`PXR_Overlay`**，直接交由硬件合成器输出锐利点对点文字。同时严控合成层数量上限（如 Meta 硬件合成器单场景上限为 15 层，建议仅留给关键 UI/视频）并核对与 3D 场景的深度遮挡（Underlay / 深度提交）关系。
- 🟡 为不同视距层级（近距直触 `< 0.46m`、**避开 `0.50–0.80m` 交互歧义带**、中距主窗 `1.0–2.0m`、远距看板/锚点 `≤ 3.0m`）提供标准化的基类或 `ScriptableObject` 布局配置，避免每个界面手写散落的魔法数字。

## 2. 初始弹出（Yaw-Only）、朝向与惰性跟随

错误的空间定位算法是 XR 空间 UI 最常见的体验故障（弹窗拍地板、贴脸眩晕、转头剧烈抖动）。

### 2.1 首次生成必须采用 Yaw-Only 水平投影

- 🔴 **严禁直接沿相机三维朝向 `head.forward` 与 `head.rotation` 生成窗口**：必须将头部前向向量投影到水平面（`Vector3.ProjectOnPlane`），仅保留水平 Yaw 朝向，再叠加目标距离与眼高微俯偏移（通常低于眼高约 `0.10–0.25m` 或俯角 `5°–12°`）。
- 🔴 **处理正上方/正下方退化向量**：当用户几乎垂直仰头或低头时，`ProjectOnPlane(head.forward, Vector3.up)` 模长趋近于 `0`，必须回退取 `Vector3.ProjectOnPlane(head.up, Vector3.up)` 或缓存上一帧有效水平朝向，防止 `LookRotation` 产生零向量异常或窗口乱转。

```csharp
// ❌ 反例：直接用头部完整姿态生成，低头或歪头时窗口斜插地板/天花板
panel.position = head.position + head.forward * distance;
panel.rotation = head.rotation;

// ✅ 正例：Yaw-only 水平投影 + 退化向量兜底 + 眼高微俯偏置
Vector3 flatForward = Vector3.ProjectOnPlane(head.forward, Vector3.up);
if (flatForward.sqrMagnitude < 1e-4f)
{
    flatForward = Vector3.ProjectOnPlane(-head.up, Vector3.up);
}
flatForward.Normalize();

Vector3 targetPos = head.position + flatForward * distance + Vector3.down * verticalDropOffset;
// 仅绕 Y 轴朝向用户（UGUI 正面为 +Z 背向用户，故朝向远离头部的方向）
Quaternion targetRot = Quaternion.LookRotation(flatForward, Vector3.up);
panel.SetPositionAndRotation(targetPos, targetRot);
```

### 2.2 惰性跟随（Lazy Follow / Tag-Along）与防头锁红线

- 🔴 **严禁将常规交互面板挂载为 XR Camera 子物体做头部硬锁（Head-Locked）**。
- 🔴 **惰性跟随必须具备死区阈值 + 帧率无关阻尼**：
  - 设置水平角度死区（例如 `±20°–30°`）与距离死区（例如 `±0.25m`），用户在死区内小幅转头浏览面板时窗口纹丝不动；
  - 超出死区后才激活平滑缓动，且插值必须采用**帧率无关阻尼**（如 `1f - Mathf.Exp(-followSpeed * Time.deltaTime)` 或 `Vector3.SmoothDamp`），禁止直接写 `Vector3.Lerp(a, b, 0.1f)` 导致 72Hz 与 90Hz/120Hz 手感不一致；
  - 用户正在悬停、拖拽或输入文字期间，必须**暂时冻结自动跟随**，避免“越想点按钮，面板越跑”。

## 3. 多窗口调度、拖拽缩放与防穿模避让

### 3.1 多窗口拓扑与槽位管理

- 🔴 **集中管理同屏空间窗口生命周期**：多面板应用应由统一的空间窗口管理器（如 `SpatialWindowManager`）维护当前活动窗口列表、默认弧形半径、左右折角角度（约 `15°–25°`）与并发上限，禁止各业务脚本各自在眼前硬生成导致重叠与双目 Z-fighting。
- 🔴 **附属悬浮条（Ornament）与主窗绑定同一根节点**：底部抓手条、侧边导航条作为主窗容器的子节点并在局部 Z 轴向用户微前移（`-0.02m` 至 `-0.04m`，视 Canvas 正反面方向保持严格一致），确保移动、显隐与销毁严格同步。

### 3.2 拖拽操纵与距离缩放

- 🔴 **约束最小离眼安全距与水平稳定**：用户自由拖拽窗口时，钳制窗口到头部的最近距离 `≥ 0.45m`，并保持面板垂直不翻滚（零 Roll）；必要时仅做轻度俯仰朝向用户。
- 🟡 若设计约定采用**动态等角缩放（Dynamic Scaling）**，按 `scale = baseScale * Mathf.Clamp(currentDistance / referenceDistance, minFactor, maxFactor)` 连续缩放，并限制缩放上下限避免极近过小或极远失控。

### 3.3 防穿模与 MR 现实空间避让

- 🔴 **禁止窗口穿模插进 3D 主体或 MR 真实墙面**：生成窗口或结束拖拽时，通过有限次、按需触发的 `Physics.SphereCast`（或目标平台 MR 场景网格/深度查询接口）检测从头部到目标槽位间是否存在阻挡层（LayerMask 严格过滤仅检测墙面/桌面/大型 3D 障碍层）：
  - 若命中障碍，将窗口前推至命中点前方安全边距处（同时不得小于最小安全距 `0.45m`）；
  - 严禁在 `Update` 中对所有静止窗口每帧无节制执行全场景物理检测或产生 `RaycastHit[]` 托管堆分配（须复用预分配数组与 `NonAlloc` API）。
- 🔴 **MR 模式遵循现实安全与遮挡兜底**：平面识别或深度 API 不可用时，必须优雅回退至默认舒适视距与用户自由微调，不得因缺少房间网格而阻断窗口打开或抛出空引用异常。

## 4. 空间输入热区、防抖与跨设备抽象

- 🔴 **碰撞热区与视觉元素解耦**：按钮、关闭图标与滑块的可点击区域（RectTransform 命中区或 `BoxCollider`）应略大于纤细视觉图形，并在相邻高危按钮间保留足够物理安全间距。
- 🔴 **射线点击防抖与近距直触防连击**：
  - **远距射线 / 远距捏合**：配置合理的拖拽启动阈值（Drag Threshold），防止扣动扳机或双指捏合瞬间的轻微手抖把点击误判为拖拽取消；提供清晰落点光标与 Hover 态反馈；
  - **近距直触（Poke）**：设置按压触发深度、回弹复位阈值与最小防连击冷却时间，避免手指停留在面板临界深度引发连续误触发。
- 🔴 **跨设备输入抽象解耦**：业务 UI 按钮与窗口控制器仅订阅统一的交互事件接口（如 Unity Input System / XRI `IXRSelectInteractor`、`IPointerEnterHandler` 等），不将特定厂商 SDK（PICO / Meta / PolySpatial）按键查询散落写死在每个页面脚本中。
- 🔴 **避让系统保留输入**：严禁在业务空间 UI 中占用头显系统菜单键、掌心系统唤起手势或 Digital Crown 等系统保留交互。

## 5. 移动一体机性能、Canvas 拆批与双目 Z 偏移

空间 UI 直接参与立体双目渲染，在移动 XR 一体机（TBDR 瓦片架构）上极易成为 GPU Overdraw 与 CPU `Canvas.BuildBatch` 瓶颈：

- 🔴 **动静拆分嵌套 Canvas**：将高频刷新区域（倒计时、进度条、实时曲线、滚动列表内容）与静态底板拆分为独立子 Canvas，减少整块大面板重建。
- 🔴 **关闭所有非交互图元的 `Raycast Target`**：背景板、图标装饰、静态文本默认关闭 `Raycast Target`，大幅降低射线每帧遍历与 UI 命中开销。
- 🔴 **零热路径 GC 与严格控制半透明 Overdraw**：
  - 禁止在 `Update` 中拼接字符串更新文本、反复 `GetComponent` 或每帧重建 `LayoutGroup`；静态排版完成后的复杂列表优先按需触发布局或对象池复用；
  - 禁止在移动一体机空间 UI 上叠加多层全屏/大面积实时高斯模糊（GrabPass / Blur），改用高不透明度微渐变材质 + 精细高光描边，确保单帧 GPU 渲染落入项目帧时预算内。
- 🔴 **物理 Z 轴分层杜绝双目 Z-Fighting**：主窗口（`0m`）、悬浮附属条（`+0.02–0.04m`）、下拉菜单与 Tooltip（`+0.04–0.06m`）、模态弹窗（`+0.06–0.10m`）之间使用真实物理 Z 偏移，严禁将叠加弹窗与父背景贴在完全相同的局部 Z 平面。

## 6. 主流头显平台工程适配要点

| 目标平台 | 工程实现与适配重点 | 常见易错点 |
|---|---|---|
| **PICO（OpenXR / PICO XR SDK / PICO OS 6）** | 优先基于 OpenXR + XRI 统一输入，兼顾 PICO OS 6 的眼动+捏合多模态与 6DoF 手柄；文字密集面板可评估 OpenXR Composition Layers / `PXR_Overlay`；世界空间锚点及关联 UI 建议保持在距头部 `≤ 3.0m` 稳定范围；MR 彩透显式核对相机清除颜色（Alpha=0）与底板不透明度 | 忽略相机背景 Alpha 导致透视黑屏；只测手柄射线漏测眼动/裸手切换；锚点过远导致追踪漂移 |
| **Meta Quest（OpenXR / Meta XR SDK）** | 避开 `0.50–0.80m` 中距交互歧义带（直触 `< 0.46m`、射线 `≥ 1.0m`）；兼容手柄射线与裸手近/远捏合无缝切换；高可读曲面/平面菜单优先评估 `OVROverlayCanvas` / `OVRCanvasMeshRenderer`（严控单场景合成层数，上限 15 层）并核对深度遮挡与 Passthrough 合成顺序 | 裸手捏合微抖导致点击丢失；过量半透明叠层或无节制开启合成层导致带宽暴涨与热降频 |
| **Apple visionOS（PolySpatial / 原生混合）** | 区分 Unity PolySpatial 托管空间（Bounded/Unbounded Volume）与原生 SwiftUI Window/Ornament 边界；遵循系统眼动 Hover 反馈、`60pt` 按钮中心距 / `16pt` 净间距及 Ornament 宽度不超主窗约束 | 在 PolySpatial 中假设自由任意自定义后处理模糊，或忽略眼动注视高亮与间距规范 |

> 参考依据（核验日期 `2026-11-25`）：Unity XR Composition Layers（`com.unity.xr.compositionlayers`）、Meta Horizon OS Developer Documentation（`OVROverlay` / Distance Zones / Target Sizing）、PICO Developer Documentation（PICO OS 6 / Spatial Anchors / `PXR_Overlay`）与 Apple visionOS HIG。具体 API 以目标工程已安装 SDK 版本为准。

## 7. 真机验证与完成检查

Unity Editor 桌面预览无法反映双目视差、透镜边缘清晰度、射线微抖与移动一体机真实帧时。

- [ ] 空间 UI 已采用 World Space 体系与明确物理尺度换算（PPU/Scale），动态文本使用 SDF 或高清文字方案。
- [ ] 首次弹出采用 Yaw-only 水平投影并处理了垂直仰俯退化向量；无头部硬锁，惰性跟随具死区、帧率无关阻尼与操作期冻结。
- [ ] 多窗由统一调度管理，拖拽具最小离眼安全距与防翻滚约束，生成/移动具备低开销防穿模避让与 MR 降级兜底。
- [ ] 非交互图元已关闭 `Raycast Target`，高频刷新已动静拆 Canvas，无热路径 GC，多层浮层具备真实物理 Z 偏移。
- [ ] 已列出需在目标头显真机实测的清单（坐/站姿弹出高度、双目文字清晰度、射线/直触防抖、MR 亮暗背景可读性及热稳态帧率），不以 Editor 运行通过冒充真机验收。
