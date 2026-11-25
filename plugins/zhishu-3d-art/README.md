# 智枢岗位插件：三维设计师（`zhishu-3d-art`）

- 适用角色：三维美术、模型师、资产整理负责人（覆盖传统手工建模与 Tripo / 混元 3D / Hyper3D 等图生 3D 管线）。
- 关联底层规则：`common`、`3d-art`、`xr-common`（执行时动态读取目标项目 `.agent-rules/`，不复制规则正文）。
- 包含技能（6 个）：
  1. `art3d-img23d-prep` — 图生 3D 提示词与参考图准备
  2. `art3d-ai-mesh-retopo` — AI 生成模型修复与重拓扑
  3. `art3d-xr-asset-audit` — XR 模型与贴图规范体检
  4. `art3d-export-check` — FBX / glTF 导出校验
  5. `art3d-intake-manifest` — 美术资产入库清单生成
  6. `art3d-blender-batch` — Blender 批处理脚本生成
