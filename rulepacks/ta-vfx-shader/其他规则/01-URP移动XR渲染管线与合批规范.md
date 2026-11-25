# 01 - URP 移动 XR 渲染管线与合批规范

> - 🟢 本文件适用于 Unity URP 渲染管线（重点覆盖移动 XR 一体机与跨档位 XR 项目）的立体渲染、合批、光照阴影与后处理红线。
> - 🔴 不适用：强行要求非 URP 项目或纯离线渲染工程套用 URP 专属配置。

---

## 1. 单通道立体渲染与图形 API 基线

- 🔴 **移动 XR 优先启用并验证 Single-Pass Instanced（单通道实例化立体渲染）**：相比 Multi-Pass 可显著减少一半 CPU 渲染提交与场景遍历开销；启用后必须全面检查所有自定义 Shader、粒子与屏幕效果的双目一致性。
- 🔴 **图形 API 与抗锯齿配置核对**：
  - 移动 XR 优先核对目标设备推荐的 Vulkan 路线与 MSAA（通常在 URP 中启用 4x MSAA 配合前向渲染解决头显锯齿闪烁），同时验证启用 MSAA 后是否因额外 Resolve Pass（如无必要开启 Depth/Opaque Texture 复制）导致瓦片 GPU 带宽翻倍；
  - 若使用固定或眼动注视点渲染（FFR / ETFR），必须在真机核查边缘文字与核心 UI 的清晰度边界。

## 2. SRP Batcher 与合批红线

在 URP 中，**SRP Batcher** 是降低 CPU `SetPass` / 渲染提交耗时的核心机制，材质与代码编写必须主动配合而非无意破坏：

- 🔴 **自定义 Shader 必须声明完整一致的 `UnityPerMaterial` CBUFFER**：所有材质面板暴露属性均须放入 `CBUFFER_START(UnityPerMaterial) ... CBUFFER_END` 中，并在 Inspector 验证 `SRP Batcher: compatible`。
- 🔴 **警惕隐性破批调用**：
  - 在 URP 中对大量普通物体滥用 `MaterialPropertyBlock` 会直接打断 SRP Batcher 合批；仅在确认采用 `GPU Instancing` 且实测收益更高时使用；
  - 避免在运行时每帧反复访问 `renderer.material` 隐式克隆新材质实例造成内存泄漏与合批失效（只读访问用 `sharedMaterial`，需要独立实例时显式管理并在销毁时释放）。
- 🔴 **减少不必要的 Shader 种类与透明队列混排**：同类静态物体尽量共享少数精简 Shader；不透明物体（Opaque）按前到后排序以利用 Early-Z，避免将实际不透明的物体误设为 Transparent 队列浪费片元着色。

## 3. 光照、阴影与烘焙策略

移动 XR 一体机的移动瓦片 GPU 对实时多光源与高分辨率阴影贴图极为敏感：

- 🔴 **静态环境优先烘焙光照（Baked Lightmap / Light Probes）**：严禁在移动一体机场景中堆砌多盏开启实时阴影的点光源或聚光灯。
- 🔴 **严控实时主光阴影成本**：若项目需要主方向光实时阴影，按项目预算控制阴影距离、级联数（Cascades，移动 XR 常严控为 1 级或精简级联）与阴影贴图分辨率，并在无需投影的小道具、粒子与远景物体上关闭 `Cast Shadows`。
- 🟡 **优先使用轻量光照模型**：移动 XR 大量常规背景与远景道具可评估 URP `Simple Lit` 或定制精简 PBR Shader，将完整高开销 PBR 留给近距英雄资产。

## 4. 后处理与相机 Pass 红线（防带宽爆炸）

移动 TBDR 架构对“把当前渲染目标回写系统内存再重新读回（Store/Load Resolve）”代价极高：

- 🔴 **严禁在移动 XR 一体机无节制开启重型全屏后处理**：避免默认叠加高开销 SSAO、屏幕空间反射（SSR）、景深（DOF）、动态模糊（Motion Blur，XR 中易诱发眩晕）与多层全屏 `GrabPass` / 多次 Blit。
- 🔴 **按需开启 `Depth Texture` 与 `Opaque Texture`**：如果场景中只有极少数小物体用了深度软粒子或折射，开启全局相机深度/不透明拷贝会迫使每帧额外拷贝双目高分辨率纹理；必须先通过真机 Profiler 评估整体带宽代价再决定是否保留。
- 🔴 **单相机优先，慎用多相机叠加（Camera Stacking）**：多个 Overlay Camera 叠加容易增加全屏清除、深度重建与提交开销；确需叠加时必须核查透明清除策略与真机 GPU 耗时。
