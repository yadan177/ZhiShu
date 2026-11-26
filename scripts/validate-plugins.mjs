import { lstat, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { parse } from "yaml";

const repoRoot = process.cwd();
const pluginsDir = path.join(repoRoot, "plugins");
const rulepacksDir = path.join(repoRoot, "rulepacks");

async function collectRulepackIds(directory, ids = new Set()) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await collectRulepackIds(absolute, ids);
    } else if (entry.name === "pack.json") {
      const manifest = JSON.parse(await readFile(absolute, "utf8"));
      if (typeof manifest.id === "string") ids.add(manifest.id);
    }
  }
  return ids;
}

function isObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

async function checkIconAsset(baseDir, rawRelative, label) {
  if (typeof rawRelative !== "string" || !rawRelative.trim()) {
    errors.push(`${label}: 缺少图标路径声明`);
    return;
  }
  const normalized = rawRelative.trim();
  if (path.isAbsolute(normalized) || normalized.includes("..")) {
    errors.push(`${label}: 图标路径必须位于目录内部 "${rawRelative}"`);
    return;
  }
  const resolved = path.resolve(baseDir, normalized);
  if (resolved !== baseDir && !resolved.startsWith(`${baseDir}${path.sep}`)) {
    errors.push(`${label}: 图标路径越界 "${rawRelative}"`);
    return;
  }
  try {
    const stat = await lstat(resolved);
    if (stat.isSymbolicLink() || !stat.isFile()) {
      errors.push(`${label}: 图标必须为普通文件，禁止符号链接 "${rawRelative}"`);
    } else if (stat.size === 0) {
      errors.push(`${label}: 图标文件不能为空 "${rawRelative}"`);
    }
  } catch {
    errors.push(`${label}: 声明的图标文件不存在 "${rawRelative}"`);
  }
}

const rulepackIds = await collectRulepackIds(rulepacksDir);
const entries = await readdir(pluginsDir, { withFileTypes: true });
const pluginDirs = entries.filter((entry) => entry.isDirectory() && !entry.name.startsWith(".")).sort((a, b) => a.name.localeCompare(b.name));

let totalPlugins = 0;
let totalSkills = 0;
const seenSkillNames = new Set();
const errors = [];

for (const dirEntry of pluginDirs) {
  const pluginRoot = path.join(pluginsDir, dirEntry.name);
  if ((await lstat(pluginRoot)).isSymbolicLink()) {
    errors.push(`${dirEntry.name}: 插件目录不得为符号链接`);
    continue;
  }
  const manifestPath = path.join(pluginRoot, "plugin.json");
  let manifest;
  try {
    manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  } catch (error) {
    errors.push(`${dirEntry.name}: 缺少或无法解析 plugin.json (${error instanceof Error ? error.message : String(error)})`);
    continue;
  }
  if (!isObject(manifest)) {
    errors.push(`${dirEntry.name}: plugin.json 必须是 JSON 对象`);
    continue;
  }
  if (manifest.name !== dirEntry.name || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(manifest.name)) {
    errors.push(`${dirEntry.name}: manifest.name 必须与目录名一致且为 kebab-case`);
  }
  if (typeof manifest.version !== "string" || !/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(manifest.version)) {
    errors.push(`${dirEntry.name}: manifest.version 必须为合法 SemVer`);
  }
  const displayName = isObject(manifest.interface) ? manifest.interface.displayName : undefined;
  if (typeof manifest.displayName !== "string" || !manifest.displayName.trim() || displayName !== manifest.displayName) {
    errors.push(`${dirEntry.name}: 需同时声明一致的 displayName 与 interface.displayName`);
  }
  if (typeof manifest.description !== "string" || !manifest.description.trim()) {
    errors.push(`${dirEntry.name}: 缺少 description`);
  }
  if (manifest.skills !== "./skills/") {
    errors.push(`${dirEntry.name}: skills 字段必须为 "./skills/"`);
  }
  await checkIconAsset(pluginRoot, manifest.logo, `${dirEntry.name}: plugin.json logo`);
  if (!isObject(manifest.interface)) {
    errors.push(`${dirEntry.name}: 缺少 interface 元数据块`);
  } else {
    await checkIconAsset(pluginRoot, manifest.interface.logo, `${dirEntry.name}: interface.logo`);
    await checkIconAsset(pluginRoot, manifest.interface.composerIcon, `${dirEntry.name}: interface.composerIcon`);
    if (typeof manifest.interface.brandColor !== "string" || !/^#[0-9A-Fa-f]{6}$/.test(manifest.interface.brandColor)) {
      errors.push(`${dirEntry.name}: interface.brandColor 必须为 6 位十六进制颜色值`);
    }
  }
  if (!Array.isArray(manifest.ruleCategories) || manifest.ruleCategories.length === 0) {
    errors.push(`${dirEntry.name}: 缺少 ruleCategories`);
  } else {
    for (const packId of manifest.ruleCategories) {
      if (!rulepackIds.has(packId)) {
        errors.push(`${dirEntry.name}: ruleCategories 引用了不存在的规则包 "${packId}"`);
      }
    }
  }
  if (!Array.isArray(manifest.suggestedPrompts) || manifest.suggestedPrompts.length < 1 || manifest.suggestedPrompts.length > 3) {
    errors.push(`${dirEntry.name}: suggestedPrompts 应为 1-3 条有效提示词`);
  }

  const skillsDir = path.join(pluginRoot, "skills");
  let skillEntries;
  try {
    skillEntries = (await readdir(skillsDir, { withFileTypes: true })).filter((e) => e.isDirectory()).sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    errors.push(`${dirEntry.name}: 缺少 skills/ 目录`);
    continue;
  }
  if (skillEntries.length === 0) {
    errors.push(`${dirEntry.name}: skills/ 不能为空`);
    continue;
  }

  for (const skillEntry of skillEntries) {
    const skillPath = path.join(skillsDir, skillEntry.name, "SKILL.md");
    let content;
    try {
      content = await readFile(skillPath, "utf8");
    } catch {
      errors.push(`${dirEntry.name}/${skillEntry.name}: 缺少 SKILL.md`);
      continue;
    }
    const header = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(content);
    if (!header) {
      errors.push(`${dirEntry.name}/${skillEntry.name}: SKILL.md 缺少合法 YAML frontmatter`);
      continue;
    }
    const meta = parse(header[1]);
    const body = header[2].trim();
    if (!isObject(meta) || meta.name !== skillEntry.name || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(meta.name)) {
      errors.push(`${dirEntry.name}/${skillEntry.name}: frontmatter.name 必须与目录名一致且为 kebab-case`);
    }
    if (seenSkillNames.has(meta?.name)) {
      errors.push(`${dirEntry.name}/${skillEntry.name}: Skill 名称 "${meta.name}" 在全局插件中重复`);
    }
    if (typeof meta?.name === "string") seenSkillNames.add(meta.name);
    if (typeof meta?.description !== "string" || meta.description.trim().length < 20) {
      errors.push(`${dirEntry.name}/${skillEntry.name}: frontmatter.description 过短或缺失`);
    }
    if (!isObject(meta?.metadata) || typeof meta.metadata.title !== "string" || !meta.metadata.title.trim()) {
      errors.push(`${dirEntry.name}/${skillEntry.name}: frontmatter.metadata.title 缺失`);
    }
    if (!body || body.length < 200) {
      errors.push(`${dirEntry.name}/${skillEntry.name}: SKILL.md 正文内容不完整`);
    }

    // 校验 SKILL.md 中引用的本地相对文件（如 ./scripts/...、./references/...）真实存在且非符号链接
    const skillDir = path.join(skillsDir, skillEntry.name);
    let inFence = false;
    for (const line of body.split(/\r?\n/)) {
      if (/^\s*(?:```|~~~)/.test(line)) {
        inFence = !inFence;
        continue;
      }
      if (inFence) continue;
      const cleaned = line.replace(/`[^`]*`/g, "");
      for (const link of cleaned.matchAll(/!?\[[^\]]*\]\((<[^>]+>|[^)\s]+)(?:\s+["'][^"']+["'])?\)/g)) {
        const raw = link[1].startsWith("<") && link[1].endsWith(">") ? link[1].slice(1, -1) : link[1];
        if (/^[a-z][a-z\d+.-]*:/i.test(raw) || raw.startsWith("#") || raw.includes("<") || raw.includes(">")) continue;
        const localPath = decodeURIComponent(raw).split("#", 1)[0].split("?", 1)[0];
        if (!localPath) continue;
        const target = path.resolve(skillDir, localPath);
        if (target !== skillDir && !target.startsWith(`${skillDir}${path.sep}`)) {
          errors.push(`${dirEntry.name}/${skillEntry.name}: SKILL.md 本地引用越出技能目录 "${raw}"`);
          continue;
        }
        try {
          const stat = await lstat(target);
          if (stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory())) {
            errors.push(`${dirEntry.name}/${skillEntry.name}: SKILL.md 引用了符号链接或特殊文件 "${raw}"`);
          } else if (stat.isFile() && stat.size === 0) {
            errors.push(`${dirEntry.name}/${skillEntry.name}: SKILL.md 引用的文件为空 "${raw}"`);
          }
        } catch {
          errors.push(`${dirEntry.name}/${skillEntry.name}: SKILL.md 引用的本地文件不存在 "${raw}"`);
        }
      }
    }

    // 检查子技能的 Codex / TRAE 图标声明（agents/openai.yaml）
    const agentMetaPath = path.join(skillDir, "agents", "openai.yaml");
    try {
      const agentStat = await lstat(agentMetaPath);
      if (agentStat.isSymbolicLink() || !agentStat.isFile()) {
        errors.push(`${dirEntry.name}/${skillEntry.name}: agents/openai.yaml 必须为普通文件`);
      } else {
        const agentMeta = parse(await readFile(agentMetaPath, "utf8"));
        const agentInterface = isObject(agentMeta?.interface) ? agentMeta.interface : undefined;
        if (!agentInterface || typeof agentInterface.display_name !== "string" || !agentInterface.display_name.trim()) {
          errors.push(`${dirEntry.name}/${skillEntry.name}: agents/openai.yaml 缺少 interface.display_name`);
        } else {
          await checkIconAsset(skillDir, agentInterface.icon_small, `${dirEntry.name}/${skillEntry.name}: agents/openai.yaml icon_small`);
          await checkIconAsset(skillDir, agentInterface.icon_large, `${dirEntry.name}/${skillEntry.name}: agents/openai.yaml icon_large`);
        }
      }
    } catch {
      errors.push(`${dirEntry.name}/${skillEntry.name}: 缺少 agents/openai.yaml 图标元数据`);
    }

    // 检查 scripts/ 子目录下所有文件均为普通非空文件（不允许符号链接）
    const scriptsDir = path.join(skillDir, "scripts");
    try {
      const scriptEntries = await readdir(scriptsDir, { withFileTypes: true });
      for (const scriptEntry of scriptEntries) {
        const scriptFile = path.join(scriptsDir, scriptEntry.name);
        const stat = await lstat(scriptFile);
        if (stat.isSymbolicLink() || !stat.isFile()) {
          errors.push(`${dirEntry.name}/${skillEntry.name}/scripts/${scriptEntry.name}: 必须为普通文件，禁止符号链接`);
        } else if (stat.size === 0) {
          errors.push(`${dirEntry.name}/${skillEntry.name}/scripts/${scriptEntry.name}: 脚本文件不能为空`);
        }
      }
    } catch (error) {
      if (error?.code !== "ENOENT") {
        errors.push(`${dirEntry.name}/${skillEntry.name}: 读取 scripts/ 目录失败 (${error instanceof Error ? error.message : String(error)})`);
      }
    }
    totalSkills++;
  }
  totalPlugins++;
}

if (errors.length > 0) {
  console.error("插件校验失败：");
  for (const err of errors) console.error(`- ${err}`);
  process.exit(1);
}

console.log(`插件资产校验通过：${totalPlugins} 个岗位插件，${totalSkills} 个 Skills`);
