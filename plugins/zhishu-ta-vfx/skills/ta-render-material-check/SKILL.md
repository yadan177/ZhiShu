---
name: ta-render-material-check
description: 用于检查 Unity URP 渲染管线配置、光照烘焙策略、阴影与后处理预算、材质球合批（SRP Batcher / GPU Instancing / Static Batching）及透明队列排序问题。当项目出现 DrawCall/SetPass 暴涨、合批失效、画面发灰/过曝或移动 XR 渲染超预算时使用。
metadata:
  title: 渲染管线与材质规范检查
  version: "2.1.0"
  role: ta-vfx
  rulepacks:
    - common
    - ta-vfx-shader
    - unity
    - xr-common
---

# 渲染管线与材质规范检查

## 1. 开始前核对

1. 优先读取项目 `.agent-rules/overrides.md`、`.agent-rules/ta-vfx-shader/其他规则/01-URP移动XR渲染管线与合批规范.md` 及 `.agent-rules/xr-common/其他规则/01-硬件档位与性能预算基准.md`（若已安装）。
2. 检查项目实际 URP Asset（`UniversalRenderPipelineAsset` / `UniversalRendererData`）、Quality Settings、Lighting Settings、Graphics Settings 及目标场景材质清单。
3. 核对项目命名约定（如材质前缀 `Mat_` vs `M_`），坚持以仓库既有事实为准。

## 2. 核心检查维度

1. **URP 管线与移动 XR 基础设置**：
   - 检查渲染路径（移动 XR 优先 Forward + MSAA 2x/4x，谨慎评估 Deferred 与 HDR 开销）；
   - 检查是否误开全局 `Depth Texture` / `Opaque Texture` 拷贝（若无特效需要应关闭以节省带宽）；
   - 检查实时阴影级联数、阴影贴图分辨率与投射距离是否超出移动一体机预算；核对动态多光源数量与静态烘焙光照比例。
2. **后处理（Post-Processing）红线**：
   - 核查是否开启高带宽全屏后处理（如高分辨率 Bloom、SSAO、DOF、Motion Blur —— 注意 XR 禁止 Motion Blur）；优先使用低成本色彩映射（LUT / ACES Tone Mapping）或按设备档位开关。
3. **合批破坏点排查**：
   - 排查 `SRP Batcher` 是否因非兼容 Shader、`MaterialPropertyBlock` 误用或频繁修改渲染状态被打断；
   - 检查同质大批量物体是否正确使用 `GPU Instancing` 或合并网格；排查因材质球重复复制导致的无谓 SetPass 增长。
4. **材质队列与资源规范**：
   - 检查透明队列（`Transparent`）与镂空队列（`AlphaTest`）误用，排查半透明排序穿插、未使用的冗余贴图槽引用（Shader 切换后残留贴图引用仍会被打进包里！）。

## 3. 输出结构

- **一、渲染配置与合批现状诊断**
- **二、问题分级清单**：`影响面 | 配置文件/材质位置 | 问题与性能代价 | 调整建议`
- **三、不同设备档位降级配置建议**（一体机默认档 vs PCVR 高画质档）
- **四、Frame Debugger 与真机验证步骤**

## 4. 交付自检与红线

- 严禁未经确认直接大改全局 URP 资产或光照模式导致全项目美术材质发黑/过曝；给出修改方案时必须注明视觉影响与回退方法。
- 特别检查切换 Shader 后材质序列化文件中残留的旧贴图引用。
