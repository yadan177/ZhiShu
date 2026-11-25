---
name: art3d-blender-batch
description: 用于编写安全、可复现的 Blender Python (`bpy`) 批处理脚本，自动执行模型命名校验、轴心归底、清理变换、检查非流形/面数、批量生成规范导出（FBX/glTF）及资产数据报表导出。当三维设计师需要批量处理多个 Blender 模型或自动化导出检查时使用；不用于编写 Unity C# 运行时代码。
metadata:
  title: Blender 批处理脚本生成
  version: "2.0.0"
  role: 3d-art
  rulepacks:
    - common
    - 3d-art
---

# Blender 批处理脚本生成

## 1. 开始前核对

1. 优先读取项目 `.agent-rules/overrides.md` 与 `.agent-rules/3d-art/` 规则（若已安装），确认项目命名规则、导出目录、轴向约定与面数预算。
2. 明确用户本机的 **Blender 主版本号**（如 Blender 3.6 LTS vs 4.2+ —— 注意 4.x 在部分 Principled BSDF 接口与导出算子参数上有差异），未明确时优先兼容 4.x 并注明差异点。
3. 明确批处理输入范围（当前 `.blend` 内选中对象 / 指定集合 Collection / 指定文件夹下多个 `.blend` 文件）与是否需要**干跑预演模式（`DRY_RUN = True`）**。

## 2. 脚本编写规范

1. **安全防呆优先**：
   - 默认提供 `DRY_RUN` 开关，先打印将被重命名、修改或导出的对象列表，确认无误再真正落盘；
   - 批量修改 `.blend` 前不静默覆盖原文件，优先导出到独立输出目录或另存副本。
2. **正确处理上下文与选择状态**：
   - 显式保存并恢复 `active` 对象与选择状态，确保处于 `OBJECT` 模式后再执行 `bpy.ops.object.transform_apply` 或导出算子；
   - 避免对隐藏/禁用视图对象静默跳过而不告警，所有跳过项输出明确日志。
3. **覆盖高频三维资产批处理动作**：
   - 命名规范正则校验与去 `.001` 后缀；
   - 真实尺度检查、清除缩放/旋转变换、可选轴心归底居中；
   - 统计每个网格的三角面数（使用 `mesh.calc_loop_triangles()` 获取准确三角面数）、材质槽数与 UV 层数，导出 JSON/CSV 体检报告；
   - 按对象或集合批量导出 FBX / GLB（附标准 Unity/XR 轴向与单位参数）。

## 3. 输出结构

- **一、脚本能力与适用 Blender 版本说明**
- **二、完整可运行的 Python (`bpy`) 脚本**（带顶部配置区、详细中文注释、干跑开关与汇总日志）
- **三、运行方式**（Blender Scripting 面板运行步骤 + 命令行无头批处理命令 `blender --background ... --python ...`）
- **四、执行前备份与验证建议**

## 4. 交付自检与红线

- 严禁未经测试就宣称脚本“已在 Blender 运行通过”；未在本机调用真实 `blender` 可执行文件时，明确标注“静态编写完成，待在目标 Blender 版本中以 `DRY_RUN=True` 试跑”。
- 任何会删除场景对象、覆盖原 `.blend` 或清材质的操作必须默认关闭并加明显注释警示。
