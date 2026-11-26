import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { PluginLibrary } = require("../build/plugin-library.cjs");
const { AssetOperations } = require("../build/asset-operations.cjs");

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const builtinPluginsDir = path.join(repoRoot, "plugins");

function createMockCodexHost() {
  const installed = new Map();
  return {
    async inspect(name) {
      const entry = installed.get(name);
      return entry
        ? { installed: true, enabled: true, source: entry.destination, cached: true }
        : { installed: false, enabled: false, cached: false };
    },
    async validate(name, receipt) {
      const entry = installed.get(name);
      if (!entry) return ["Codex 中已找不到该插件"];
      if (receipt.host?.pluginId !== `${name}@zhishu-${name}`) return ["宿主标识不匹配"];
      return [];
    },
    async install(name, destination, sourceFiles) {
      installed.set(name, { destination, files: new Map(sourceFiles) });
      return {
        pluginId: `${name}@zhishu-${name}`,
        cachePath: path.join(destination, ".mock-cache"),
        activePath: path.join(destination, "plugins", name),
        files: {},
      };
    },
    async remove(name) {
      installed.delete(name);
    },
  };
}

test("Phase 4：内置官方岗位插件目录可扫描 6 个岗位插件与 43 个 Skills，且保留元数据", async () => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "zhishu-phase4-scan-")));
  try {
    const library = new PluginLibrary(path.join(root, "imports"), [builtinPluginsDir]);
    const list = await library.list();

    assert.equal(list.length, 6);
    assert.deepEqual(
      list.map((item) => item.name),
      [
        "zhishu-product-pm",
        "zhishu-ui-design",
        "zhishu-3d-art",
        "zhishu-ta-vfx",
        "zhishu-unity-dev",
        "zhishu-fullstack-dev",
      ],
    );
    const totalSkills = list.reduce((sum, item) => sum + item.skills.length, 0);
    assert.equal(totalSkills, 43);

    for (const plugin of list) {
      assert.equal(plugin.preset, true);
      assert.equal(plugin.kind, "capability-plugin");
      assert.equal(plugin.runtimeDependencies.length, 0);
      assert.ok(plugin.ruleCategories && plugin.ruleCategories.length > 0);
      assert.ok(plugin.skillTitles && Object.keys(plugin.skillTitles).length === plugin.skills.length);
    }

    const sampleSkill = await library.readSkill("zhishu-product-pm@2.1.0", "pm-flowchart-swimlane");
    assert.equal(sampleSkill.title, "业务流程图与泳道图生成");
    assert.match(sampleSkill.content, /# 业务流程图与泳道图生成/);
    const pmSpatial = await library.readSkill("zhishu-product-pm@2.1.0", "pm-xr-spatial-ui-plan");
    assert.equal(pmSpatial.title, "XR 空间界面规划");
    const uiSpatial = await library.readSkill("zhishu-ui-design@2.1.0", "ui-xr-spatial-layout");
    assert.equal(uiSpatial.title, "XR 空间界面布局设计");
    const unitySpatial = await library.readSkill("zhishu-unity-dev@2.1.0", "unity-xr-spatial-ui");
    assert.equal(unitySpatial.title, "Unity XR 空间 UI 实现");
    const fsSpatial = await library.readSkill("zhishu-fullstack-dev@2.1.0", "fs-xr-spatial-ui-impl");
    assert.equal(fsSpatial.title, "跨端空间 UI 开发实现");
    const unityDiag = await library.readSkill("zhishu-unity-dev@2.1.0", "unity-arch-sequence-diagram");
    assert.equal(unityDiag.title, "Unity 架构与时序图生成");
    const fsDiag = await library.readSkill("zhishu-fullstack-dev@2.1.0", "fs-arch-sequence-diagram");
    assert.equal(fsDiag.title, "系统架构与时序图生成");
    const fsEvo = await library.readSkill("zhishu-fullstack-dev@2.1.0", "fs-evolution-capture");
    assert.equal(fsEvo.title, "对话现场规则进化捕获");
    assert.match(fsEvo.content, /zhishu evolve capture/);
    await assert.rejects(() => library.readSkill("zhishu-product-pm@2.1.0", "../etc/passwd"), /技能标识无效/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Phase 4：内置岗位插件在 Antigravity 与 Codex 完成预览、安装、漂移拦截与干净卸载，且诚实拒绝不兼容目标", async () => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "zhishu-phase4-install-")));
  try {
    const userHome = path.join(root, "home");
    const codexHome = path.join(userHome, ".codex");
    await mkdir(path.join(userHome, ".gemini", "config"), { recursive: true });
    await mkdir(codexHome, { recursive: true });

    const library = new PluginLibrary(path.join(root, "imports"), [builtinPluginsDir]);
    const assets = new AssetOperations(library, path.join(root, "ide-assets"), {
      userHome,
      codexHome,
      host: createMockCodexHost(),
      findCli: async () => undefined,
    });

    const targetKey = "zhishu-product-pm@2.1.0";
    for (const ide of ["antigravity", "codex"]) {
      const preview = await assets.preview("install", targetKey, ide);
      assert.deepEqual(preview.conflicts, []);
      assert.ok(preview.changes.length >= 7);
      await assets.apply(preview.token);
    }

    const antigravitySkill = path.join(
      userHome,
      ".gemini/config/plugins/zhishu-product-pm/skills/pm-prd-authoring/SKILL.md",
    );
    assert.match(await readFile(antigravitySkill, "utf8"), /PRD 需求文档编写/);

    const installed = await assets.list();
    assert.equal(installed.length, 2);
    assert.equal(installed.find((item) => item.target.ideId === "codex")?.recognition, "host-verified");
    assert.equal(installed.find((item) => item.target.ideId === "antigravity")?.recognition, "files-verified");

    // 验证受管文件发生本地漂移时卸载预览会明确拦截。
    const original = await readFile(antigravitySkill, "utf8");
    await writeFile(antigravitySkill, `${original}\n<!-- local edit -->\n`);
    const driftPreview = await assets.preview("uninstall", "", "antigravity", "plugin-zhishu-product-pm");
    assert.ok(driftPreview.conflicts.some((item) => item.includes("pm-prd-authoring/SKILL.md")));
    await assert.rejects(() => assets.apply(driftPreview.token), /存在冲突/);

    // 还原后干净卸载。
    await writeFile(antigravitySkill, original);
    for (const ide of ["antigravity", "codex"]) {
      const uninstall = await assets.preview("uninstall", "", ide, "plugin-zhishu-product-pm");
      assert.deepEqual(uninstall.conflicts, []);
      await assets.apply(uninstall.token);
    }
    assert.deepEqual(await assets.list(), []);

    // 通用目录与 TraeWork 诚实拒绝多技能插件包。
    await assert.rejects(() => assets.preview("install", targetKey, "generic"), /仅支持独立 Skill/);
    await assert.rejects(() => assets.preview("install", targetKey, "traework"), /尚无 TraeWork 适配/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Phase 4：从岗位插件提取单个独立 Skill 导入后可在 4 类目标用户环境安装与卸载", async () => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "zhishu-phase4-skill-")));
  try {
    const userHome = path.join(root, "home");
    const codexHome = path.join(userHome, ".codex");
    await mkdir(path.join(userHome, ".gemini", "config"), { recursive: true });
    await mkdir(codexHome, { recursive: true });
    await mkdir(path.join(userHome, ".trae-cn"), { recursive: true });

    const library = new PluginLibrary(path.join(root, "imports"), [builtinPluginsDir]);
    const assets = new AssetOperations(library, path.join(root, "ide-assets"), {
      userHome,
      codexHome,
      findCli: async () => undefined,
    });

    const singleSkillDir = path.join(builtinPluginsDir, "zhishu-fullstack-dev/skills/fs-api-contract-sync");
    const inspected = await library.inspect(singleSkillDir);
    assert.equal(inspected.kind, "skill");
    assert.equal(inspected.name, "fs-api-contract-sync");
    const imported = await library.import(singleSkillDir, inspected.sourceDigest);

    // Antigravity、TraeWork 与通用目录独立路径互不冲突；Codex 与 generic 共用 ~/.agents/skills。
    for (const ide of ["antigravity", "traework", "generic"]) {
      const preview = await assets.preview("install", imported.key, ide);
      assert.deepEqual(preview.conflicts, []);
      await assets.apply(preview.token);
    }
    assert.match(
      await readFile(path.join(userHome, ".trae-cn/skills/fs-api-contract-sync/SKILL.md"), "utf8"),
      /接口契约与前后端联调核对/,
    );

    for (const ide of ["antigravity", "traework", "generic"]) {
      const uninstall = await assets.preview("uninstall", "", ide, "skill-fs-api-contract-sync");
      assert.deepEqual(uninstall.conflicts, []);
      await assets.apply(uninstall.token);
    }
    assert.deepEqual(await assets.list(), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
