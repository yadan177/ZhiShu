---
name: ta-shader-review
description: 用于审查与优化 Unity HLSL / ShaderLab / Shader Graph 代码，重点排查 URP 兼容性、Single Pass Instanced 立体渲染宏缺失、半精度（half）优化、指令与采样开销及 Shader 关键字变体爆炸风险。当用户编写、重构或排障 Shader 及 Shader Graph 时使用；不用于普通 C# 业务逻辑审查。
metadata:
  title: Shader 代码审查与优化
  version: "2.0.0"
  role: ta-vfx
  rulepacks:
    - common
    - ta-vfx-shader
    - unity
    - xr-common
---

# Shader 代码审查与优化

## 1. 开始前核对

1. 优先读取项目 `.agent-rules/overrides.md`、`.agent-rules/ta-vfx-shader/其他规则/03-Shader编写与变体裁剪规范.md` 与 `01-URP移动XR渲染管线与合批规范.md`（若已安装）。
2. 核对目标项目的 Unity 与 URP 版本、目标图形 API（Vulkan / OpenGLES / Metal / Direct3D）及立体渲染模式（Single Pass Instanced / Multiview）。
3. 通读完整 Shader / `.hlsl` / `.shadergraph` 及对应材质配置，不脱离上下文孤立评论单行代码。

## 2. 审查与优化清单

1. **XR 单通道立体渲染（Single Pass Instanced）兼容**：
   - 核对顶点/片元结构体与函数是否完整声明 `UNITY_VERTEX_INPUT_INSTANCE_ID`、`UNITY_VERTEX_OUTPUT_STEREO`、`UNITY_SETUP_INSTANCE_ID`、`UNITY_INITIALIZE_VERTEX_OUTPUT_STEREO` 与 `UNITY_SETUP_STEREO_EYE_INDEX_POST_VERTEX`；
   - 核对屏幕空间 UV、深度图/OpaqueTexture 采样是否使用 `UnityStereoTransformScreenSpaceTex` 或 URP 对应宏，防止右眼画面撕裂或偏移。
2. **SRP Batcher 兼容性**：
   - 核对材质属性是否完整包裹在 `CBUFFER_START(UnityPerMaterial) ... CBUFFER_END` 且与 `Properties` 声明类型/名称严格一致，避免意外打破 SRP Batcher 合批。
3. **Shader 变体爆炸治理**：
   - 审查 `#pragma multi_compile` 与 `#pragma shader_feature`：仅随材质开关的选项改用 `shader_feature_local`，避免无故声明全局关键字占用上限或产生数万条构建变体拖慢打包与内存。
4. **移动端片元开销与精度**：
   - 坐标与高精度 UV 保持 `float`，颜色/法线/光照系数优先使用 `half`；
   - 排查片元阶段高频动态分支、`discard`（影响 Tile-Based GPU Early-Z）、多余纹理采样、全屏循环模糊及可在顶点阶段预计算的矩阵运算。
5. **命名与复用性**：检查是否与现有公共 Shader 重复实现相同功能，核对命名是否符合项目前缀约定。

## 3. 输出结构

- **一、审查结论与兼容风险总览**（SRP Batcher / XR 立体渲染 / 变体规模 / 移动 GPU 开销）
- **二、问题与重构清单**：`位置（文件:行号） | 严重度 | 问题原因 | 优化方案与参考代码片段`
- **三、变体裁剪与验证建议**（如何在 Unity 中核查编译后变体数与 Frame Debugger 合批状态）

## 4. 交付自检与红线

- 不得把未确认的 URP 内部头文件 API 当作跨版本通用写法；如版本未确认，显式标注适用的 URP 版本前提。
- 修改 Shader 后必须提醒在目标真机验证双目渲染效果，避免仅在桌面 Game 视图单眼通过。
