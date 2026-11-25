---
name: ta-device-profile-report
description: 用于整理与分析 Unity Profiler、Frame Debugger、RenderDoc、Snapdragon Profiler / OVR Metrics / PICO 性能监控工具采集的真机数据，定位 CPU/GPU/内存/发热瓶颈并输出标准化的跨岗位性能优化剖析报告。当项目需要性能摸底、里程碑真机剖析或排查掉帧发热时使用。
metadata:
  title: 真机性能剖析与报告输出
  version: "2.0.0"
  role: ta-vfx
  rulepacks:
    - common
    - ta-vfx-shader
    - unity
    - xr-common
---

# 真机性能剖析与报告输出

## 1. 开始前核对

1. 优先读取项目 `.agent-rules/overrides.md`、`.agent-rules/ta-vfx-shader/其他规则/04-资产导入自动化校验与真机剖析规范.md` 及 `.agent-rules/xr-common/其他规则/03-真机验证与跨岗位协同基线.md`（若已安装）。
2. 收集完整测试元数据：**设备型号与系统版本、应用版本号/构建号/Git Commit、构建类型（必须为非 Deep Profiling 的正式或标准 Development Release 真机包）、测试场景与时长、目标刷新率（72/90/120Hz）**。
3. 坚持**证据驱动**：严格基于用户提供的实测数据、日志、截图或指标表分析，严禁臆造或外推不存在的帧率与内存数值。

## 2. 剖析与归因步骤

1. **判定主瓶颈类型（CPU Bound vs GPU Bound vs Memory/Thermal Bound）**：
   - 对比目标单帧预算（如 72Hz ≈ 13.8ms，90Hz ≈ 11.1ms）与实测 CPU Main / Render Thread / GPU Frame Time；
   - 识别是否因持续运行 10–15 分钟后机身升温触发 CPU/GPU 降频（Thermal Throttling）导致后期掉帧。
2. **拆解 Top N 热点**：
   - **CPU 侧**：主线程脚本热点、GC Alloc 尖刺、物理/碰撞、动画蒙皮、音频解码与 DrawCall 提交开销（`Gfx.WaitForPresent` 等同步等待须区分真实渲染瓶颈）；
   - **GPU 侧**：DrawCall / SetPass 数量、三角面与顶点带宽、片元着色与透明 Overdraw、阴影 Pass、后处理与分辨率缩放；
   - **内存侧**：总 PSS / 纹理显存 / 网格 / 音频常驻内存 / 托管堆泄漏趋势。
3. **转化为分岗位可执行整改项**：将每个热点精确拆派给对应责任角色（3D 美术减面/合图、TA 改 Shader/降 Overdraw、Unity 研发消 GC/池化/异步加载、产品评估降级），并预估收益与验证方式。

## 3. 输出结构

- **一、测试环境与版本基线表**（设备 / 系统 / 版本与 Commit / 场景 / 采样工具）
- **二、核心指标总览对比表**（`指标 | 目标预算 | 实测均值 | 实测峰值/P99 | 达标状态`）
- **三、Top 5 性能瓶颈根因拆解**（附原始数据证据）
- **四、分岗位优化排期与收益评估表**（`优先级 | 责任岗位 | 优化项 | 具体改法 | 预期收益 | 复测指标`）
- **五、待补充采样缺口**（例如尚缺 RenderDoc 抓帧或 15 分钟温控长测）

## 4. 交付自检与红线

- 严禁拿 Unity Editor Profiler 数据冒充真机性能结论；如输入仅含 Editor 数据，必须在报告开头显著标明“仅编辑器采样，不能代表移动真机表现”。
- 所有优化建议必须能回到可复测的量化指标，便于下一轮回归验证闭环。
