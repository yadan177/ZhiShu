import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
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

const sha256 = (data) => `sha256:${createHash("sha256").update(data).digest("hex")}`;

async function setup() {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "zhishu-legacy-takeover-")));
  const userHome = path.join(root, "home");
  const legacyDir = path.join(root, "legacy-receipts");
  await mkdir(path.join(userHome, ".gemini/config/plugins"), { recursive: true });
  await mkdir(legacyDir, { recursive: true });
  const library = new PluginLibrary(path.join(root, "imports"), [builtinPluginsDir]);
  const operations = new AssetOperations(library, path.join(root, "ide-assets"), {
    userHome,
    codexHome: path.join(userHome, ".codex"),
    findCli: async () => undefined,
    legacyReceiptDirs: [legacyDir],
  });
  return { root, userHome, legacyDir, library, operations };
}

test("旧版 zhishu-desktop 回执可只读发现、显式接管且绝不改动目标目录文件", async () => {
  const { root, userHome, legacyDir, operations } = await setup();
  try {
    const dest = path.join(userHome, ".gemini/config/plugins/zhishu-product-pm");
    await mkdir(path.join(dest, "skills/pm-prd"), { recursive: true });
    const manifestJson = JSON.stringify(
      {
        name: "zhishu-product-pm",
        displayName: "产品经理",
        version: "0.1.5",
        description: "Legacy fixture",
        author: { name: "智枢官方" },
      },
      null,
      2,
    );
    const skillBody = "---\nname: pm-prd\ndescription: legacy\n---\n# Legacy\n";
    await writeFile(path.join(dest, "plugin.json"), manifestJson);
    await writeFile(path.join(dest, "skills/pm-prd/SKILL.md"), skillBody);

    const legacyReceipt = {
      id: "plugin-zhishu-product-pm",
      kind: "capability-plugin",
      title: "产品经理",
      version: "0.1.5",
      target: { ideId: "antigravity", scope: "ide-user" },
      installedAt: "2026-10-01T00:00:00.000Z",
      destination: dest,
      sourceKey: "zhishu-product-pm@0.1.5",
      sourceDigest: sha256("legacy-digest"),
      managedFiles: {
        "plugin.json": sha256(manifestJson),
        "skills/pm-prd/SKILL.md": sha256(skillBody),
      },
    };
    await writeFile(path.join(legacyDir, "antigravity--plugin-zhishu-product-pm.json"), JSON.stringify(legacyReceipt, null, 2));

    // 只读扫描阶段不得静默写入当前 receipts
    const candidates = await operations.inspectLegacy();
    assert.equal(candidates.length, 1);
    assert.equal(candidates[0].kind, "legacy-receipt");
    assert.equal(candidates[0].originLabel, "旧版回执");
    assert.equal(candidates[0].version, "0.1.5");
    assert.deepEqual(candidates[0].issues, []);
    assert.deepEqual(await operations.list(), []);

    // 显式接管：仅补写本地回执，绝不修改目标插件目录
    const result = await operations.adoptLegacy([candidates[0].key]);
    assert.equal(result.adoptedCount, 1);
    assert.equal(result.legacy.length, 0);
    assert.equal(result.assets.length, 1);
    assert.equal(result.assets[0].id, "plugin-zhishu-product-pm");
    assert.equal(result.assets[0].version, "0.1.5");
    assert.deepEqual(result.assets[0].issues, []);
    assert.equal(await readFile(path.join(dest, "plugin.json"), "utf8"), manifestJson);
    assert.equal(await readFile(path.join(dest, "skills/pm-prd/SKILL.md"), "utf8"), skillBody);

    // 重复接管已失效 key 必须被明确拒绝
    await assert.rejects(() => operations.adoptLegacy([candidates[0].key]), /已失效或已被接管/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("未纳管官方预设插件（无旧版回执）可发现、接管并无冲突升级至当前版本", async () => {
  const { root, userHome, operations } = await setup();
  try {
    const dest = path.join(userHome, ".gemini/config/plugins/zhishu-ui-design");
    await mkdir(path.join(dest, "skills/old-skill"), { recursive: true });
    await writeFile(
      path.join(dest, "plugin.json"),
      JSON.stringify(
        {
          name: "zhishu-ui-design",
          displayName: "UI 设计师",
          version: "0.1.5",
          description: "Legacy unmanaged official plugin",
          author: { name: "智枢官方" },
        },
        null,
        2,
      ),
    );
    await writeFile(path.join(dest, "skills/old-skill/SKILL.md"), "---\nname: old-skill\ndescription: old\n---\nOld\n");

    const candidates = await operations.inspectLegacy();
    assert.equal(candidates.length, 1);
    assert.equal(candidates[0].kind, "unmanaged-official");
    assert.equal(candidates[0].originLabel, "未纳管官方插件");
    assert.equal(candidates[0].id, "plugin-zhishu-ui-design");
    assert.equal(candidates[0].version, "0.1.5");

    const adopted = await operations.adoptLegacy([candidates[0].key]);
    assert.equal(adopted.adoptedCount, 1);
    assert.equal(adopted.assets[0].issues.length, 0);

    // 接管后即可正常执行更新预览与应用升级到内置 2.1.0
    const preview = await operations.preview("update", "zhishu-ui-design@2.1.0", "antigravity", "plugin-zhishu-ui-design");
    assert.deepEqual(preview.conflicts, []);
    assert.ok(preview.changes.length > 0);
    const updated = await operations.apply(preview.token);
    assert.equal(updated[0].version, "2.1.0");
    assert.deepEqual(updated[0].issues, []);
    assert.deepEqual(await operations.inspectLegacy(), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("第三方插件、伪造官方目录、幽灵回执与符号链接均不被误识别或跟随", async () => {
  const { root, userHome, legacyDir, operations } = await setup();
  try {
    const pluginsRoot = path.join(userHome, ".gemini/config/plugins");

    // 1. 第三方插件（如 figma / feishu）
    const figmaDir = path.join(pluginsRoot, "figma");
    await mkdir(figmaDir, { recursive: true });
    await writeFile(
      path.join(figmaDir, "plugin.json"),
      JSON.stringify({ name: "figma", version: "1.0.0", author: { name: "Figma" } }),
    );

    // 2. 冒充 zhishu- 前缀但作者非智枢官方或不在官方预设清单
    const fakeDir = path.join(pluginsRoot, "zhishu-third-party");
    await mkdir(fakeDir, { recursive: true });
    await writeFile(
      path.join(fakeDir, "plugin.json"),
      JSON.stringify({ name: "zhishu-third-party", version: "1.0.0", author: { name: "智枢官方" } }),
    );
    const spoofAuthorDir = path.join(pluginsRoot, "zhishu-3d-art");
    await mkdir(spoofAuthorDir, { recursive: true });
    await writeFile(
      path.join(spoofAuthorDir, "plugin.json"),
      JSON.stringify({ name: "zhishu-3d-art", version: "0.1.5", author: { name: "ThirdParty" } }),
    );

    // 3. 幽灵旧版回执（目标目录已不存在）
    await writeFile(
      path.join(legacyDir, "antigravity--plugin-zhishu-ta-vfx.json"),
      JSON.stringify({
        id: "plugin-zhishu-ta-vfx",
        kind: "capability-plugin",
        title: "技术美术 (TA)",
        version: "0.1.5",
        target: { ideId: "antigravity", scope: "ide-user" },
        installedAt: "2026-10-01T00:00:00.000Z",
        destination: path.join(pluginsRoot, "zhishu-ta-vfx"),
        sourceKey: "zhishu-ta-vfx@0.1.5",
        sourceDigest: sha256("ghost"),
        managedFiles: { "plugin.json": sha256("{}") },
      }),
    );

    // 4. 符号链接插件目录（非 Windows）
    if (process.platform !== "win32") {
      const outside = path.join(root, "outside-plugin");
      await mkdir(outside, { recursive: true });
      await writeFile(
        path.join(outside, "plugin.json"),
        JSON.stringify({ name: "zhishu-unity-dev", version: "0.1.5", author: { name: "智枢官方" } }),
      );
      await symlink(outside, path.join(pluginsRoot, "zhishu-unity-dev"));
    }

    assert.deepEqual(await operations.inspectLegacy(), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
