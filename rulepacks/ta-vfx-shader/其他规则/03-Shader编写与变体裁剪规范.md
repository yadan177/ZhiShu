# 03 - Shader 编写与变体裁剪规范

> - 🟢 本文件适用于实时 3D 与 XR（重点面向 Unity URP HLSL / ShaderGraph）的自定义 Shader 编写、双目立体兼容、移动精度控制与变体治理。
> - 🔴 不适用：把特定引擎版本的私有内部宏当成跨版本永久不变的写法。

---

## 1. 双目立体渲染兼容性红线（Single-Pass Instanced）

XR 自定义 Shader 最容易踩的坑是桌面编辑器单眼正常、上头显后右眼黑屏、位置错乱或屏幕特效只渲染半边：

- 🔴 **必须完整接入立体渲染实例化宏**：
  - 顶点输入结构声明 `UNITY_VERTEX_INPUT_INSTANCE_ID`；
  - 顶点到片元结构声明 `UNITY_VERTEX_OUTPUT_STEREO`；
  - 顶点着色器中调用 `UNITY_SETUP_INSTANCE_ID(input)`、`UNITY_TRANSFER_INSTANCE_ID(input, output)`（如需）与 `UNITY_INITIALIZE_VERTEX_OUTPUT_STEREO(output)`；
  - 片元着色器开头必须调用 `UNITY_SETUP_STEREO_EYE_INDEX_POST_VERTEX(input)`。
- 🔴 **屏幕空间 UV 与深度/颜色纹理采样必须适配纹理数组（Texture2DArray）**：
  - 在 Single-Pass Instanced 下，相机深度图、不透明图与全屏后处理目标通常为 `Texture2DArray`；必须使用 URP 提供的立体安全宏（如 `UnityStereoTransformScreenSpaceTex` / `SampleSceneDepth` / `SampleSceneColor` 或按当前 URP 版本官方立体接口），严禁直接裸写 `SAMPLE_TEXTURE2D(_CameraDepthTexture, ...)` 导致右眼采样错乱或编译报错。

❌ 反例：手写水面/扫描线自定义 Shader 时直接用 `tex2D(_CameraDepthTexture, screenUV)` 且省略 `UNITY_VERTEX_OUTPUT_STEREO`，编辑器单眼一切正常，打成一体机包后右眼扫描线位置完全漂移。

✅ 正例：使用当前项目 URP 版本的标准立体宏初始化眼索引，通过立体兼容封装采样深度与屏幕空间 UV，并在目标头显实测双眼画面对齐。

## 2. 移动 GPU 精度、采样与指令优化

- 🔴 **合理使用半精度 `half`（FP16）与全精度 `float`（FP32）**：
  - 顶点世界坐标、深度重建、大数值 UV 滚动偏移、高精度矩阵变换必须保持 `float`，防止精度溢出抖动；
  - 颜色、法线方向、光照衰减、常规标量插值优先使用 `half`，在移动 GPU 上可显著减少寄存器占用并提升并行吞吐。
- 🔴 **减少片元着色器昂贵计算**：
  - 能放在顶点着色器（Vertex Shader）预计算的向量变换、雾效因子、静态 UV 缩放偏移，不搬进片元着色器逐像素重复计算；
  - 严控单片元纹理采样次数，避免在片元内使用高成本循环（如多步 Raymarching / 大核循环模糊）与非必要的动态 `if` 分支导致的线程束分歧；
  - 避免滥用高耗时三角函数、`pow` / `ddx` / `ddy` 在高频全屏透明片元中的嵌套调用。
- 🔴 **保证 SRP Batcher 兼容**：自定义 HLSL Shader 所有可调材质属性必须按要求收拢进 `UnityPerMaterial` CBUFFER，并确保跨 Pass 的 CBUFFER 声明一致。

## 3. Shader 变体治理与编译卡顿防范

Shader 变体呈指数级爆炸会直接导致：打包时间暴涨、安装包与运行时内存飙升、以及真机首帧遭遇未预热变体时剧烈卡顿掉帧。

- 🔴 **严格区分 `shader_feature` 与 `multi_compile`**：
  - 仅在编辑期材质面板静态勾选的开关，**必须使用 `shader_feature_local`**（未被引用的变体自动裁剪，且不占用全局关键字配额）；
  - 只有在运行时必须动态切换且材质未静态引用时，才允许谨慎评估 `multi_compile_local` 或全局 `multi_compile`；
  - 避免在单个 Shader 中叠加大量互不互斥的布尔关键字。
- 🔴 **严控无效管线变体与变体剔除（Stripping）**：
  - 检查并裁剪本项目明确不使用的管线变体（如不使用的阴影级联、额外点光阴影、Debug 视图、未采用的 Fog 模式、未使用的 Lightmap 变体），可通过 `IPreprocessShaders` 或 URP 变体剔除配置落地并记录剔除日志；
  - 避免把 `Standard` / 超大 Uber Shader 无节制用于只需简单贴图+染色的特效或 UI。
- 🔴 **运行时预热防卡顿**：关键核心场景的高频 Shader 变体应通过项目约定的 `ShaderVariantCollection` / PSO 缓存策略在加载阶段预热，严禁在玩家关键交互瞬间才触发首次管线编译。

## 4. Shader 代码库与 SubGraph 资产复用规范

避免为每个材质或特效把相同的立体采样、溶解、菲涅尔、UV 流动逻辑到处复制粘贴，无既有目录约定时建议按以下结构沉淀可复用 Shader 资产：

```text
Assets/Art/VFX/_Common/Shaders/   # 或项目约定的共享 Shaders 根目录
├── Includes/                     # 公共 .hlsl 头文件（立体采样、菲涅尔、溶解、噪波、相机近距淡出）
├── SubGraphs/                    # ShaderGraph 可复用子节点（如 SGSub_CameraFade、SGSub_Dissolve）
└── Uber/                         # 少量高复用通用主 Shader（粒子 / 半透明 / 扫描线）
```

- 🔴 **跨 2 个以上 Shader 共用的核心算法必须抽取**：立体深度采样封装、相机距离淡出、通用溶解与边缘光等逻辑统一放入 `Includes/*.hlsl` 或 `SubGraphs/`，严禁复制多份导致修复一处立体 Bug 漏改十处。
- 🔴 **公共 Include 保持无业务硬编码与版本标注**：共享 `.hlsl` / `SubGraph` 只依赖标准 URP 头文件与入参，不硬编码具体项目全局属性名；文件头注明适用 URP 版本范围与输入/输出精度约定，确保可随 `_Common` 打包跨项目复用。

❌ 反例：8 个特效 Shader 各自拷贝一份 60 行的深度软边与溶解代码，升级 URP 版本后逐个文件排查编译报错且漏修 2 个。

✅ 正例：将立体安全深度采样与溶解函数抽入 `Includes/VFX_Common.hlsl` 与 `SubGraphs/SGSub_Dissolve.shadersubgraph`，所有业务特效 Shader 统一引用并单点维护。

## 5. 跨图形 API 编译与审查清单

- [ ] Shader 在目标图形 API（Vulkan / OpenGL ES / Metal 等项目目标）下零编译错误与隐式截断警告。
- [ ] 所有立体渲染宏与屏幕空间纹理采样已验证兼容 Single-Pass Instanced。
- [ ] `UnityPerMaterial` CBUFFER 声明完整，Inspector 确认兼容 SRP Batcher。
- [ ] 关键字优先使用 `shader_feature_local`，无失控 `multi_compile` 组合膨胀。
- [ ] 共用立体采样与效果算法已沉淀至 `Includes/` 或 `SubGraphs/`，无大面积复制粘贴。
- [ ] 复杂 Shader 已标注适用硬件档位，必要时提供轻量 `Fallback` 或 Shader LOD 降级方案。
