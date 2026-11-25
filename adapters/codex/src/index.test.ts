import assert from "node:assert/strict";
import test from "node:test";

import { mergeManagedBlock } from "@zhishu/core";
import type { ProjectConfig } from "@zhishu/core";

import { AGENTS_MD_TARGETS, CODEX_BLOCK_END, CODEX_BLOCK_START, codexAdapter } from "./index.js";

const config: ProjectConfig = {
  schemaVersion: 1,
  source: { type: "workspace", path: "." },
  rulepacks: ["common", "go", "project-docs/go"],
  targets: ["codex"],
  project: { overrides: ".agent-rules/overrides.md" },
  updates: { channel: "stable", strategy: "manual" },
};

test("Codex 适配器生成 AGENTS.md 入口并保留非受管内容", () => {
  const block = codexAdapter.renderManagedBlock(config, {
    common: "entry.md",
    go: "入口.md",
    "project-docs/go": "文档入口.md",
  });
  assert.ok(block.startsWith(CODEX_BLOCK_START));
  assert.ok(block.endsWith(CODEX_BLOCK_END));
  assert.match(block, /\.agent-rules\/overrides\.md/);
  assert.match(block, /如已安装 `common`，再读取下方的通用入口/);
  assert.match(block, /\.agent-rules\/common\/entry\.md/);
  assert.match(block, /\.agent-rules\/go\/入口\.md/);
  assert.match(block, /\.agent-rules\/project-docs\/go\/文档入口\.md/);
  assert.match(block, /开发、排障或代码审查：读取相关开发规则包的入口/);
  assert.match(block, /新建、修改、审查或同步技术文档：读取对应的 `project-docs\/\*` 入口/);
  assert.match(block, /入口或其必要链接缺失时，说明缺失/);
  assert.match(block, /完成任务时说明实际读取的规则、验证结果、文档影响和未验证范围/);
  const merged = mergeManagedBlock("# 用户规则\n", block, codexAdapter);
  assert.match(merged, /^# 用户规则\n/);
  assert.equal(mergeManagedBlock(merged, block, codexAdapter), merged);
});

test("Codex 适配器拒绝不完整的旧受控区块", () => {
  const block = codexAdapter.renderManagedBlock(config, {});
  assert.throws(() => mergeManagedBlock(`${CODEX_BLOCK_START}\n旧内容`, block, codexAdapter), /边界不完整/);
  assert.throws(() => mergeManagedBlock(`${block}\n${block}`, block, codexAdapter), /边界不完整/);
});

test("AGENTS_MD_TARGETS 包含 2.0 平台并为 XR / 产研岗位包生成任务路由", () => {
  assert.ok(AGENTS_MD_TARGETS.includes("antigravity"));
  assert.ok(AGENTS_MD_TARGETS.includes("trae"));
  const xrConfig: ProjectConfig = {
    ...config,
    rulepacks: ["common", "xr-common", "product-pm", "3d-art", "ta-vfx-shader"],
    targets: ["codex", "antigravity", "trae"],
  };
  const block = codexAdapter.renderManagedBlock(xrConfig, {
    common: "entry.md",
    "xr-common": "15-AI通用入口规则.md",
    "product-pm": "15-AI通用入口规则.md",
    "3d-art": "15-AI通用入口规则.md",
    "ta-vfx-shader": "15-AI通用入口规则.md",
  });
  assert.match(block, /XR 空间计算项目通用基准/);
  assert.match(block, /产品需求、结构图、流程图、泳道图或验收梳理/);
  assert.match(block, /三维建模、图生 3D 修复、贴图规范或 FBX\/glTF 导出/);
  assert.match(block, /特效制作、Shader 编写、渲染性能或资产导入校验/);
});
