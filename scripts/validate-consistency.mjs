#!/usr/bin/env node

import { access, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { validateXmindFile } from "../plugins/zhishu-product-pm/skills/pm-product-structure/scripts/validate-xmind.mjs";
import { checkMarkdownLinks } from "../plugins/zhishu-fullstack-dev/skills/fs-doc-changelog-sync/scripts/check-markdown-links.mjs";

const defaultRepoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function collectRulepackStats(rulepacksRoot) {
  let packCount = 0;
  let docCount = 0;
  async function visit(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await visit(full);
      } else if (entry.isFile() && entry.name === "pack.json") {
        const manifest = JSON.parse(await readFile(full, "utf8"));
        packCount++;
        if (Array.isArray(manifest.rules)) {
          docCount += manifest.rules.length;
        }
      }
    }
  }
  if (await exists(rulepacksRoot)) await visit(rulepacksRoot);
  return { packCount, docCount };
}

async function collectPluginStats(pluginsRoot) {
  let pluginCount = 0;
  let skillCount = 0;
  if (!(await exists(pluginsRoot))) return { pluginCount, skillCount };
  for (const entry of await readdir(pluginsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    const manifestPath = path.join(pluginsRoot, entry.name, "plugin.json");
    if (!(await exists(manifestPath))) continue;
    pluginCount++;
    const skillsDir = path.join(pluginsRoot, entry.name, "skills");
    if (await exists(skillsDir)) {
      for (const skillEntry of await readdir(skillsDir, { withFileTypes: true })) {
        if (skillEntry.isDirectory() && (await exists(path.join(skillsDir, skillEntry.name, "SKILL.md")))) {
          skillCount++;
        }
      }
    }
  }
  return { pluginCount, skillCount };
}

async function collectSchemaCount(schemasRoot) {
  if (!(await exists(schemasRoot))) return 0;
  const entries = await readdir(schemasRoot, { withFileTypes: true });
  return entries.filter((entry) => entry.isFile() && entry.name.endsWith(".schema.json")).length;
}

/**
 * 检查 adapters/<id>/adapter.json 与版本、输出路径、user-assets.ts 实际能力是否自洽。
 */
export async function validateAdaptersConsistency(repoRoot, expectedVersion) {
  const adaptersRoot = path.join(repoRoot, "adapters");
  const issues = [];
  let checkedAdapters = 0;
  if (!(await exists(adaptersRoot))) return { checkedAdapters, issues };

  for (const entry of (await readdir(adaptersRoot, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    const adapterDir = path.join(adaptersRoot, entry.name);
    const manifestPath = path.join(adapterDir, "adapter.json");
    if (!(await exists(manifestPath))) continue;

    checkedAdapters++;
    const relManifest = path.relative(repoRoot, manifestPath);
    let manifest;
    try {
      manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    } catch (error) {
      issues.push(`${relManifest}: JSON 解析失败 (${error instanceof Error ? error.message : String(error)})`);
      continue;
    }

    if (manifest.id !== entry.name) {
      issues.push(`${relManifest}: id="${manifest.id}" 与目录名 "${entry.name}" 不一致`);
    }
    if (expectedVersion && manifest.version !== expectedVersion) {
      issues.push(`${relManifest}: version="${manifest.version}" 与工作区版本 "${expectedVersion}" 不一致`);
    }
    if (manifest.outputs && typeof manifest.outputs.templates === "string") {
      const templateTarget = path.resolve(repoRoot, manifest.outputs.templates);
      if (!(await exists(templateTarget))) {
        issues.push(`${relManifest}: outputs.templates 指向的路径不存在 (${manifest.outputs.templates})`);
      }
    }

    const userAssetsPath = path.join(adapterDir, "user-assets.ts");
    if (await exists(userAssetsPath)) {
      const code = await readFile(userAssetsPath, "utf8");
      const caps = manifest.capabilities && typeof manifest.capabilities === "object" ? manifest.capabilities : {};
      const hasSkillImpl = /export\s+(?:async\s+)?function\s+\w*(?:SkillRoot|Delivery|discover\w*Skills)\b/.test(code);
      const hasPluginImpl = /export\s+(?:class\s+\w*PluginHost|function\s+\w*PluginRoot)\b/.test(code);
      const hasMcpImpl = /export\s+function\s+\w*McpConfigPath\b/.test(code);

      if (hasSkillImpl && typeof caps.skills === "string" && /not-implemented/i.test(caps.skills)) {
        issues.push(`${relManifest}: 已实现 user-assets.ts 技能逻辑，但 capabilities.skills 仍标为 "${caps.skills}"`);
      }
      if (hasPluginImpl && typeof caps.plugins === "string" && /not-implemented/i.test(caps.plugins)) {
        issues.push(`${relManifest}: 已实现 user-assets.ts 插件宿主逻辑，但 capabilities.plugins 仍标为 "${caps.plugins}"`);
      }
      if (hasMcpImpl && typeof caps.mcp === "string" && /not-implemented/i.test(caps.mcp)) {
        issues.push(`${relManifest}: 已实现 user-assets.ts MCP 路径逻辑，但 capabilities.mcp 仍标为 "${caps.mcp}"`);
      }
    }
  }
  return { checkedAdapters, issues };
}

/**
 * 检查核心总览文档中的动态统计数字与磁盘权威真相是否一致。
 */
export async function validateOverviewDocsConsistency(repoRoot, stats) {
  const candidates = [
    "plugins/README.md",
    "项目文档/技术文档/README.md",
    "项目文档/技术文档/01-技术总览.md",
    "项目文档/产品文档/智枢-产品需求文档.md",
    "项目文档/产品文档/智枢-生态调研与架构设计.md",
  ];
  const issues = [];
  let checkedDocs = 0;

  for (const relPath of candidates) {
    const absPath = path.join(repoRoot, relPath);
    if (!(await exists(absPath))) continue;
    checkedDocs++;
    const content = await readFile(absPath, "utf8");
    const lines = content.split(/\r?\n/);

    let inFence = false;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (/^\s*(?:```|~~~)/.test(line)) {
        inFence = !inFence;
        continue;
      }
      if (inFence) continue;
      // 跳过显式描述历史版本演进/旧版的对比语句
      if (/(?:历史|旧版|早期|此前|升级前|原本|原先|从\s*\d+\s*扩)/.test(line)) continue;

      const lineNo = i + 1;

      for (const m of line.matchAll(/(\d+)\s*套\s*JSON\s*Schema/g)) {
        const found = Number(m[1]);
        if (found !== stats.schemaCount) {
          issues.push(`${relPath}:${lineNo} 声明 "${m[0]}"，实际 schemas/ 共 ${stats.schemaCount} 套`);
        }
      }

      for (const m of line.matchAll(/(?<!其余\s*|另外\s*)(\d+)\s*(?:大|个)\s*岗位插件/g)) {
        const found = Number(m[1]);
        if (found !== stats.pluginCount) {
          issues.push(`${relPath}:${lineNo} 声明 "${m[0]}"，实际 plugins/ 共 ${stats.pluginCount} 个岗位插件`);
        }
      }

      for (const m of line.matchAll(/(?:共\s*|\b\d+\s*插件\s*[/／]\s*)(\d+)\s*个?\s*Skills?\b/g)) {
        const found = Number(m[1]);
        if (found !== stats.skillCount) {
          issues.push(`${relPath}:${lineNo} 声明 "${m[0]}"，实际 plugins/ 共 ${stats.skillCount} 个 Skills`);
        }
      }

      for (const m of line.matchAll(/(\d+)\s*个?规则包[（(·\s,，、]*共?\s*(\d+)\s*份/g)) {
        const foundPacks = Number(m[1]);
        const foundDocs = Number(m[2]);
        if (foundPacks !== stats.rulepackCount || foundDocs !== stats.docCount) {
          issues.push(
            `${relPath}:${lineNo} 声明 "${m[0]}"，实际 rulepacks/ 共 ${stats.rulepackCount} 个规则包 / ${stats.docCount} 份文档`,
          );
        }
      }

      if (relPath === "项目文档/技术文档/01-技术总览.md" && stats.pluginCount > 0 && /岗位插件[\s\S]{0,24}仍属规划范围/.test(line)) {
        issues.push(`${relPath}:${lineNo} 仍称岗位插件“仍属规划范围”，与实际已落地 ${stats.pluginCount} 插件 / ${stats.skillCount} Skills 矛盾`);
      }
    }
  }

  return { checkedDocs, issues };
}

/**
 * 仓库跨文件一致性总门禁。
 */
export async function validateConsistency(repoRoot = defaultRepoRoot, options = {}) {
  const pkgPath = path.join(repoRoot, "package.json");
  const workspaceVersion = (await exists(pkgPath))
    ? JSON.parse(await readFile(pkgPath, "utf8")).version
    : undefined;

  const { packCount: rulepackCount, docCount } = await collectRulepackStats(path.join(repoRoot, "rulepacks"));
  const { pluginCount, skillCount } = await collectPluginStats(path.join(repoRoot, "plugins"));
  const schemaCount = await collectSchemaCount(path.join(repoRoot, "schemas"));

  const stats = { workspaceVersion, rulepackCount, docCount, pluginCount, skillCount, schemaCount };
  const issues = [];

  const adapterResult = await validateAdaptersConsistency(repoRoot, workspaceVersion);
  issues.push(...adapterResult.issues);

  const docsResult = await validateOverviewDocsConsistency(repoRoot, stats);
  issues.push(...docsResult.issues);

  // 校验产品结构图 .xmind（若存在）
  const xmindRel = "项目文档/产品文档/智枢-产品结构图.xmind";
  const xmindPath = path.join(repoRoot, xmindRel);
  let xmindResult = null;
  if (await exists(xmindPath)) {
    xmindResult = await validateXmindFile(xmindPath, {
      maxDepth: 6,
      maxZhLen: 7,
      maxSheets: 1,
      requireSummary: true,
    });
    for (const issue of xmindResult.issues) {
      issues.push(`${xmindRel}: ${issue}`);
    }
  }

  // 校验项目文档目录下相对链接有效性
  let linkResult = null;
  const projectDocsDir = path.join(repoRoot, "项目文档");
  if (options.checkDocLinks !== false && (await exists(projectDocsDir))) {
    linkResult = await checkMarkdownLinks(projectDocsDir);
    for (const issue of linkResult.issues) {
      issues.push(`项目文档/${issue}`);
    }
  }

  return {
    valid: issues.length === 0,
    stats,
    checkedAdapters: adapterResult.checkedAdapters,
    checkedOverviewDocs: docsResult.checkedDocs,
    xmind: xmindResult,
    docLinks: linkResult,
    issues,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await validateConsistency();
  if (!result.valid) {
    console.error(`跨文件一致性门禁失败（发现 ${result.issues.length} 项问题）：`);
    for (const issue of result.issues) console.error(`- ${issue}`);
    process.exit(1);
  }
  const { stats, checkedAdapters, checkedOverviewDocs, xmind, docLinks } = result;
  console.log(
    `跨文件一致性校验通过：${stats.rulepackCount} 规则包/${stats.docCount} 文档，${stats.pluginCount} 插件/${stats.skillCount} Skills，${stats.schemaCount} Schema，${checkedAdapters} 适配器清单，${checkedOverviewDocs} 份核心总览文档` +
      (xmind ? `，XMind ${xmind.totalNodes} 节点/${xmind.summaryCount} 概要` : "") +
      (docLinks ? `，文档链接检查 ${docLinks.checkedFiles} 份` : ""),
  );
}
