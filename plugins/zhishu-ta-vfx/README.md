# 智枢岗位插件：技术美术（TA）（`zhishu-ta-vfx`）

- 适用角色：技术美术（TA）、特效师（VFX）、渲染管线维护者。
- 关联底层规则：`common`、`ta-vfx-shader`、`unity`、`xr-common`（执行时动态读取目标项目 `.agent-rules/`，不复制规则正文）。
- 包含技能（5 个）：
  1. `ta-vfx-perf-audit` — 特效性能体检
  2. `ta-shader-review` — Shader 代码审查与优化
  3. `ta-render-material-check` — 渲染管线与材质规范检查
  4. `ta-unity-importer-gen` — Unity 资产导入校验脚本生成
  5. `ta-device-profile-report` — 真机性能剖析与报告输出
