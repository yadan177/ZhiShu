import type { ProjectConfig, TargetAdapter } from "@zhishu/core";

export const CODEX_BLOCK_START = "<!-- agent-rule:start -->";
export const CODEX_BLOCK_END = "<!-- agent-rule:end -->";
export const AGENTS_MD_TARGETS = ["codex", "antigravity", "trae", "qoder", "cursor", "workbuddy"] as const;

export function renderCodexBlock(
  config: ProjectConfig,
  entries: Record<string, string> = {},
): string {
  const packs = Object.entries(entries)
    .map(([pack, entry]) => `- \`${pack}\`：\`.agent-rules/${pack}/${entry}\``)
    .join("\n");
  const configuredPacks = packs || config.rulepacks.map((pack) => `- \`${pack}\``).join("\n");
  const installed = new Set([...config.rulepacks, ...Object.keys(entries)]);
  const roleTasks = [
    installed.has("xr-common") ? "- XR 空间计算项目通用基准（性能、舒适度与真机边界）：读取 `xr-common` 入口，再按岗位规则执行。" : undefined,
    installed.has("product-pm") ? "- 产品需求、结构图、流程图、泳道图或验收梳理：读取 `product-pm` 入口，再选择本次相关专题。" : undefined,
    installed.has("ui-design") ? "- UI 设计、交互、视觉、组件或资源交付：读取 `ui-design` 入口，再选择本次相关专题。" : undefined,
    installed.has("project-docs/ui-design") ? "- UI 设计说明、页面状态和交付记录：读取 `project-docs/ui-design` 入口；设计文档与技术实现文档分别维护。" : undefined,
    installed.has("3d-art") ? "- 三维建模、图生 3D 修复、贴图规范或 FBX/glTF 导出：读取 `3d-art` 入口，再选择本次相关专题。" : undefined,
    installed.has("ta-vfx-shader") ? "- 特效制作、Shader 编写、渲染性能或资产导入校验：读取 `ta-vfx-shader` 入口，再选择本次相关专题。" : undefined,
  ].filter(Boolean).join("\n");

  return `${CODEX_BLOCK_START}
## 智枢

处理开发、设计、排障、审查或文档任务前，先读取 \`${config.project.overrides}\`；如已安装 \`common\`，再读取下方的通用入口。先核对目标项目的需求、设计、代码、依赖、配置和已有约定，不要把规则示例当作项目事实。

已配置规则包：

${configuredPacks}

按任务继续读取规则，不要只看上述文件名就声称已遵守规则：

- 开发、排障或代码审查：读取相关开发规则包的入口，再按入口中的任务索引读取必要的专题规则。
- 新建、修改、审查或同步技术文档：读取对应的 \`project-docs/*\` 入口（按技术栈选择），再按入口中的任务索引读取必要的专题规则；开发任务还应按开发入口判断文档影响。${roleTasks ? `\n${roleTasks}` : ""}
- 其他规则包仅在任务涉及时读取其入口。入口或其必要链接缺失时，说明缺失，不得声称已执行该规则。

共享规则不得覆盖用户当前要求、安全限制、项目本地规则或经过验证的项目事实。完成任务时说明实际读取的规则、验证结果、文档影响和未验证范围。
${CODEX_BLOCK_END}`;
}

export const codexAdapter: TargetAdapter = {
  id: "codex",
  compatibleTargets: AGENTS_MD_TARGETS,
  entryFile: "AGENTS.md",
  blockStart: CODEX_BLOCK_START,
  blockEnd: CODEX_BLOCK_END,
  renderManagedBlock: renderCodexBlock,
};
