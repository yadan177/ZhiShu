import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { PluginLibrary } = require("../build/plugin-library.cjs");
const { AssetOperations } = require("../build/asset-operations.cjs");
const { McpOperations } = require("../build/mcp-operations.cjs");
const { ToolInspector } = require("../build/tool-inspector.cjs");

async function setup() {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "zhishu-stage2-")));
  const userHome = path.join(root, "home");
  const codexHome = path.join(userHome, ".codex");
  await mkdir(path.join(userHome, ".gemini", "config"), { recursive: true });
  await mkdir(codexHome, { recursive: true });
  await mkdir(path.join(userHome, ".trae-cn"), { recursive: true });

  const library = new PluginLibrary(path.join(root, "library"));
  const assets = new AssetOperations(library, path.join(root, "ide-assets"), {
    userHome,
    codexHome,
    findCli: async () => undefined,
  });
  const mcp = new McpOperations(path.join(root, "mcp-assets"), { userHome, codexHome });
  const inspector = new ToolInspector({ userHome, codexHome, findCli: async () => undefined });
  return { root, userHome, codexHome, library, assets, mcp, inspector };
}

test("Stage 2：同一独立 Skill 在 Codex 与 Antigravity 完成预览、安装、状态识别与干净卸载", async () => {
  const { root, userHome, library, assets, mcp, inspector } = await setup();
  try {
    const skillDir = path.join(root, "src-skill");
    await mkdir(skillDir);
    await writeFile(
      path.join(skillDir, "SKILL.md"),
      "---\nname: cross-tool-skill\ndescription: Cross-tool skill test\nmetadata:\n  version: 1.0.0\n---\n# Cross Tool\n",
    );
    const inspected = await library.inspect(skillDir);
    const imported = await library.import(skillDir, inspected.sourceDigest);

    for (const tool of ["codex", "antigravity"]) {
      const preview = await assets.preview("install", imported.key, tool);
      assert.deepEqual(preview.conflicts, []);
      await assets.apply(preview.token);
    }

    assert.match(
      await readFile(path.join(userHome, ".agents/skills/cross-tool-skill/SKILL.md"), "utf8"),
      /Cross Tool/,
    );
    assert.match(
      await readFile(path.join(userHome, ".gemini/config/skills/cross-tool-skill/SKILL.md"), "utf8"),
      /Cross Tool/,
    );

    const probed = await inspector.inspect(await assets.list(), await mcp.listInstalled());
    assert.equal(probed.find((t) => t.id === "codex")?.counts.skills, 1);
    assert.equal(probed.find((t) => t.id === "antigravity")?.counts.skills, 1);
    assert.equal(probed.find((t) => t.id === "antigravity")?.available, true);

    for (const tool of ["codex", "antigravity"]) {
      const uninstall = await assets.preview("uninstall", "", tool, "skill-cross-tool-skill");
      assert.deepEqual(uninstall.conflicts, []);
      await assets.apply(uninstall.token);
    }
    assert.deepEqual(await assets.list(), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Stage 2：Antigravity 安装插件且通用目录拒绝非 Skill 插件", async () => {
  const { root, userHome, library, assets } = await setup();
  try {
    const pluginDir = path.join(root, "src-plugin");
    await mkdir(path.join(pluginDir, "skills/hello"), { recursive: true });
    await writeFile(
      path.join(pluginDir, "plugin.json"),
      JSON.stringify({ name: "xr-role-sample", version: "1.0.0", description: "Sample plugin" }),
    );
    await writeFile(
      path.join(pluginDir, "skills/hello/SKILL.md"),
      "---\nname: hello\ndescription: Hello skill\n---\nHi\n",
    );
    const inspected = await library.inspect(pluginDir);
    const imported = await library.import(pluginDir, inspected.sourceDigest);

    await assert.rejects(assets.preview("install", imported.key, "generic"), /仅支持独立 Skill/);

    const preview = await assets.preview("install", imported.key, "antigravity");
    assert.deepEqual(preview.conflicts, []);
    await assets.apply(preview.token);
    assert.ok(await readFile(path.join(userHome, ".gemini/config/plugins/xr-role-sample/plugin.json"), "utf8"));

    const uninstall = await assets.preview("uninstall", "", "antigravity", "plugin-xr-role-sample");
    await assets.apply(uninstall.token);
    await assert.rejects(readFile(path.join(userHome, ".gemini/config/plugins/xr-role-sample/plugin.json")), /ENOENT/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Stage 2：飞书预设与自定义 MCP 在 Antigravity / Codex 脱敏预览、更新、计数与干净卸载", async () => {
  const { root, userHome, codexHome, assets, mcp, inspector } = await setup();
  try {
    await writeFile(path.join(codexHome, "config.toml"), 'model = "gpt-5"\n');
    const catalog = await mcp.listCatalog();
    assert.equal(catalog[0].id, "feishu-mcp");

    await mcp.saveCustomServer({
      schemaVersion: 1,
      id: "internal-wiki",
      title: "企业知识库 MCP",
      version: "1.0.0",
      transport: "http",
      url: "https://wiki.internal.example/mcp",
      envSchema: [{ key: "WIKI_TOKEN", label: "访问令牌", required: true, secret: true }],
    });
    assert.equal((await mcp.listCatalog()).length, 2);

    const secret = "fs_secret_token_9b4e";
    for (const toolId of ["antigravity", "codex"]) {
      const preview = await mcp.preview("install", "feishu-mcp", toolId, {
        FEISHU_APP_ID: "cli_app_01",
        FEISHU_APP_SECRET: secret,
      });
      assert.deepEqual(preview.conflicts, []);
      assert.ok(!preview.maskedAfter.includes(secret));
      assert.match(preview.maskedAfter, /••••9b4e/);
      await mcp.apply(preview.token);
    }

    const probed = await inspector.inspect(await assets.list(), await mcp.listInstalled());
    assert.equal(probed.find((t) => t.id === "antigravity")?.counts.mcps, 1);
    assert.equal(probed.find((t) => t.id === "codex")?.counts.mcps, 1);

    const updatePreview = await mcp.preview("update", "feishu-mcp", "antigravity", {
      FEISHU_APP_ID: "cli_app_02",
      FEISHU_APP_SECRET: "fs_new_secret_7c21",
    });
    assert.match(updatePreview.maskedAfter, /••••7c21/);
    await mcp.apply(updatePreview.token);
    const agyJson = JSON.parse(await readFile(path.join(userHome, ".gemini/config/mcp_config.json"), "utf8"));
    assert.equal(agyJson.mcpServers["feishu-mcp"].env.FEISHU_APP_ID, "cli_app_02");

    for (const toolId of ["antigravity", "codex"]) {
      const uninstall = await mcp.preview("uninstall", "feishu-mcp", toolId);
      assert.deepEqual(uninstall.conflicts, []);
      await mcp.apply(uninstall.token);
    }
    assert.deepEqual(await mcp.listInstalled(), []);
    assert.match(await readFile(path.join(codexHome, "config.toml"), "utf8"), /model = "gpt-5"/);

    await mcp.removeCustomServer("internal-wiki");
    assert.equal((await mcp.listCatalog()).length, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
