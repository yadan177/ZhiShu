---
name: art3d-export-check
description: 用于在 Blender、Maya 或 3ds Max 导出 FBX / glTF / GLB 进入 Unity/XR 工程前，系统校验坐标系轴向、米制比例、缩放冻结、Pivot 轴心、层级命名、材质槽剥离及多余灯光摄像机清理。当三维美术准备导出资产交付给引擎或排查模型导入后旋转 90 度/比例不对/材质丢失问题时使用。
metadata:
  title: FBX / glTF 导出校验
  version: "2.0.0"
  role: 3d-art
  rulepacks:
    - common
    - 3d-art
    - xr-common
---

# FBX / glTF 导出校验

## 1. 开始前核对

1. 优先读取项目 `.agent-rules/overrides.md` 与 `.agent-rules/3d-art/其他规则/04-资产命名轴向导出与入库校验规范.md`（若已安装）。
2. 明确源 DCC 软件（Blender / Maya / 3ds Max）、导出格式（FBX 还是 glTF/GLB）以及目标引擎（Unity / Unreal / WebGL）。
3. 核对目标项目已有的资产命名体系（如 `SM_` / `SK_` / `T_` / `M_` 或 `Mat_`），严禁与既有项目前缀混用。

## 2. 导出前逐项核对清单

1. **单位、比例与变换归零**：
   - DCC 场景单位设为米（Metric，`1.0`）；导出前对所有网格执行 `Apply Rotation & Scale`（使 Scale 恒为 `(1, 1, 1)`，无负缩放导致法线翻转）。
2. **轴向与朝向对齐**：
   - 核对 DCC（如 Blender Z-Up）到 Unity（左手系 Y-Up，+Z 朝前）的导出轴向参数（如 FBX 开启 `Apply Transform` 或正确设置 Forward/Up），确保模型拖入场景后 `Rotation = (0, 0, 0)` 且正面朝向 `+Z`。
3. **轴心（Pivot）与层级规范**：
   - 静态摆放物轴心位于底部中心并贴齐世界原点 `(0, 0, 0)`；可动零件（门、开关、指针）轴心精确位于真实旋转轴上；
   - 清理空父节点、多余辅助骨骼、默认摄像机、灯光与历史修改器（必要时先 Apply 修改器）。
4. **材质与内嵌贴图策略**：
   - 核对项目约定：常规 Unity 工程优先**分离贴图文件与 FBX**（`Path Mode: Auto/Strip`，不把大贴图重复塞进 FBX 膨胀仓库体积），并保证材质槽名称规范清晰便于引擎映射；glTF/GLB 按传输场景约定是否内嵌。
5. **命名与文件卫生**：
   - 全部文件名、节点名、材质槽名使用英文 ASCII（禁止中文、空格、`Cube.001`、`Final2` 等默认/临时命名）；确认导出后在目标引擎空白测试场景中拖入验证无报错。

## 3. 输出结构

- **一、DCC → 目标引擎导出参数预设表**（按用户实际使用的 Blender/Maya/3ds Max 与 FBX/glTF 输出精确勾选参数）
- **二、导出前 10 项必查防呆清单**
- **三、常见导入异常速查修复表**（如 X 轴偏 90°、模型缩放 0.01/100 倍、发黑翻面、材质丢失）

## 4. 交付自检与红线

- 针对 Blender 导出 Unity FBX 时，特别提醒验证根对象及子对象在 Unity Inspector 中 `Scale = 1` 且 `Rotation = 0`，避免代码控制旋转时出现隐性轴偏。
- 不得把未清理的工程源文件（`.blend` / `.spp` / `.psd`）误当最终运行时导出物塞入游戏运行时资源目录。
