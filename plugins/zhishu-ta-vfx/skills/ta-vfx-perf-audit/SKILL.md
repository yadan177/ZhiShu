---
name: ta-vfx-perf-audit
description: 用于全面体检 Unity 粒子特效（Shuriken ParticleSystem / VFX Graph）在移动 XR 一体机与实时 3D 场景中的 Overdraw、填充率、发射器数量、贴图尺寸、光照/碰撞开销及复用目录规范。当 TA 或特效师审查特效 Prefab、排查爆炸/烟雾掉帧或制定特效预算时使用；不用于业务网络脚本调试。
metadata:
  title: 特效性能体检
  version: "2.1.0"
  role: ta-vfx
  rulepacks:
    - common
    - ta-vfx-shader
    - unity
    - xr-common
---

# 特效性能体检

## 1. 开始前核对

1. 优先读取项目 `.agent-rules/overrides.md`、`.agent-rules/ta-vfx-shader/15-AI通用入口规则.md` 与 `.agent-rules/ta-vfx-shader/其他规则/02-VFX特效与Overdraw预算规范.md`（若已安装）。
2. 确认目标项目渲染管线（URP / Built-in）、目标硬件档位（移动 XR 一体机 / PCVR）及粒子系统类型（Shuriken vs VFX Graph —— 注意部分移动 XR GPU 对 VFX Graph Compute 支持与开销需先核对真机基线）。
3. 检查目标特效 Prefab、材质、贴图序列帧与触发频率（常驻环境特效 vs 瞬时点击反馈 vs 技能大招）。

## 2. 六维特效体检

1. **半透明 Overdraw 与填充率**：
   - 检查粒子贴图四周是否留有大片无效全透明像素（应紧凑裁剪或改用自定义 Mesh 紧贴外形裁切）；
   - 检查是否有多层大面积贴脸烟雾、全屏径向模糊、软粒子深度采样的叠加触发（移动 XR 带宽头号瓶颈）。
2. **发射器与最大粒子上限（Max Particles）**：
   - 检查子发射器数量、峰值同屏粒子总数与 `Max Particles` 是否设置合理上限；是否开启了不必要的每帧物理碰撞（Collision）、实时光源（Lights）或复杂 Noise 模块。
3. **贴图与合图复用**：
   - 检查特效贴图是否超规格（如小火花用 2048 贴图）、是否开启多余 `Read/Write Enabled`、是否优先复用公共特效贴图库/序列帧图集（Flipbook）而不是每个特效复制一份重复素材。
4. **生命周期与池化回收**：
   - 确认 `Stop Action` / 对象池回收机制明确，绝不出现一次性特效播放完毕后永远残留在场景中空跑 Update 的泄漏问题。
5. **材质与合批影响**：
   - 检查同一特效内是否无故拆出多个材质或频繁修改 `material` 实例化拷贝（应使用 `MaterialPropertyBlock` 或统一合批材质）。
6. **XR 视觉舒适度**：
   - 避免高频全屏强闪光、突兀贴脸大粒子遮挡视野导致不适。

## 3. 输出结构

- **一、体检评级与瓶颈摘要**（放行 / 需优化 / 阻断）
- **二、分项核查表**：`检查项 | 当前表现 | 风险等级 | 优化方案（可量化）`
- **三、复用与目录归类建议**（可沉淀进公共特效库的元素提示）
- **四、真机必测场景**（如贴近观察、连续高频触发 10 次下的帧时与 Overdraw 视图复核）

## 4. 交付自检与红线

- 严禁仅靠 Editor 静态 Inspector 判断“移动 XR 跑得动”，必须标明需在真机叠加场景中复测 GPU 帧时。
- 涉及公共特效库改造时先检索已有资产，禁止重复造轮子。
