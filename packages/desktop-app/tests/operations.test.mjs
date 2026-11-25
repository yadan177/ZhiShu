import assert from "node:assert/strict";
import { cp, mkdtemp, mkdir, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { DesktopOperations, inspectWorkspaceSource } = require("../build/operations.cjs");
const sourceRoot = path.resolve(import.meta.dirname, "../../..");
const currentVersion = require("../../../package.json").version;
const nextVersion = `${currentVersion.split(".").slice(0, 2).join(".")}.${Number(currentVersion.split(".")[2]) + 1}`;
const prevVersion = "0.1.4";
const sourceLoader = async () => ({
  snapshot: { root: sourceRoot, version: currentVersion, digest: `sha256:${"a".repeat(64)}`, commit: "b".repeat(40) },
  cleanup: async () => {},
});

test("桌面操作：预览安装、应用、预览卸载、保留项目文件并还原原有 AGENTS.md", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "zhishu-desktop-test-"));
  try {
    await mkdir(path.join(root, ".agent-rules"));
    await writeFile(path.join(root, "AGENTS.md"), "# 项目自己的规则\n", "utf8");
    await writeFile(path.join(root, ".agent-rules", "overrides.md"), "# 项目覆盖\n", "utf8");
    await writeFile(path.join(root, ".agent-rules", "notes.md"), "保留笔记\n", "utf8");
    const operations = new DesktopOperations(sourceLoader);
    assert.equal((await operations.inspect(root)).installed, false);

    const install = await operations.previewInstall(root, "unity");
    assert.deepEqual(install.conflicts, []);
    assert.ok(install.changes.some((change) => change.path === "agent-rules.yaml"));
    assert.ok(install.changes.some((change) => change.path === "AGENTS.md" && change.action === "modify"));
    assert.equal((await readFile(path.join(root, "AGENTS.md"), "utf8")), "# 项目自己的规则\n");
    const installed = await operations.applyInstall(root);
    assert.equal(installed.valid, true);
    assert.deepEqual(installed.rulepacks, ["common", "unity", "project-docs/unity"]);

    const uninstall = await operations.previewUninstall(root);
    assert.deepEqual(uninstall.conflicts, []);
    assert.deepEqual(uninstall.retainedPaths, [".agent-rules/notes.md", ".agent-rules/overrides.md"]);
    assert.ok(uninstall.changes.some((change) => change.path === "AGENTS.md" && change.action === "modify"));
    assert.equal((await operations.applyUninstall(root)).installed, false);
    assert.equal((await readFile(path.join(root, "AGENTS.md"), "utf8")), "# 项目自己的规则\n");
    assert.equal((await readFile(path.join(root, ".agent-rules", "overrides.md"), "utf8")), "# 项目覆盖\n");
    assert.equal((await readFile(path.join(root, ".agent-rules", "notes.md"), "utf8")), "保留笔记\n");
    await assert.rejects(readFile(path.join(root, "agent-rules.yaml"), "utf8"), { code: "ENOENT" });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("预览后项目入口变化时不应用安装", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "zhishu-desktop-stale-"));
  try {
    const operations = new DesktopOperations(sourceLoader);
    await operations.previewInstall(root, "java");
    await writeFile(path.join(root, "AGENTS.md"), "后来的用户内容\n", "utf8");
    await assert.rejects(operations.applyInstall(root), /拒绝应用未经审查的差异/);
    await assert.rejects(readFile(path.join(root, "agent-rules.yaml"), "utf8"), { code: "ENOENT" });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("孤立锁文件不会被桌面安装接管", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "zhishu-desktop-orphan-"));
  try {
    await writeFile(path.join(root, ".agent-rules.lock.json"), "用户数据\n", "utf8");
    const operations = new DesktopOperations(sourceLoader);
    await assert.rejects(operations.previewInstall(root, "go"), /孤立的规则锁文件/);
    assert.equal(await readFile(path.join(root, ".agent-rules.lock.json"), "utf8"), "用户数据\n");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("五种技术栈均预览开发规则和对应文档规则", async () => {
  const expected = {
    unity: ["common", "unity", "project-docs/unity"],
    "js-ts": ["common", "javascript", "typescript", "project-docs/js-ts"],
    java: ["common", "java", "project-docs/java"],
    go: ["common", "go", "project-docs/go"],
    python: ["common", "python", "project-docs/python"],
  };
  const root = await mkdtemp(path.join(os.tmpdir(), "zhishu-desktop-stacks-"));
  try {
    const operations = new DesktopOperations(sourceLoader);
    for (const [stack, packs] of Object.entries(expected)) {
      const preview = await operations.previewInstall(root, stack);
      assert.deepEqual(preview.conflicts, [], stack);
      const config = preview.changes.find((change) => change.path === "agent-rules.yaml")?.after;
      for (const pack of packs) assert.match(config, new RegExp(`- ${pack.replace(/\//g, "\\/")}`));
    }
    await operations.clearPreview();
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("Qoder、Cursor、WorkBuddy 可分别安装；多平台只写一份共享规则", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "zhishu-desktop-platforms-"));
  try {
    for (const target of ["qoder", "cursor", "workbuddy"]) {
      const project = path.join(root, target);
      await mkdir(project);
      const operations = new DesktopOperations(sourceLoader);
      const preview = await operations.previewInstall(project, "go", [target]);
      assert.deepEqual(preview.conflicts, []);
      assert.deepEqual(preview.targets, [target]);
      assert.ok(preview.changes.some((change) => change.path === "AGENTS.md"));
      const installed = await operations.applyInstall(project);
      assert.equal(installed.valid, true);
      assert.deepEqual(installed.targets, [target]);
      const lock = JSON.parse(await readFile(path.join(project, ".agent-rules.lock.json"), "utf8"));
      assert.deepEqual(Object.keys(lock.targets), [target]);
      assert.equal((await readFile(path.join(project, "AGENTS.md"), "utf8")).split("<!-- agent-rule:start -->").length - 1, 1);
      assert.deepEqual((await operations.previewUninstall(project)).conflicts, []);
      assert.equal((await operations.applyUninstall(project)).installed, false);
    }
    const combo = path.join(root, "all");
    await mkdir(combo);
    const operations = new DesktopOperations(sourceLoader);
    const targets = ["codex", "qoder", "cursor", "workbuddy"];
    await operations.previewInstall(combo, "java", targets);
    assert.deepEqual((await operations.applyInstall(combo)).targets, targets);
    assert.equal((await readFile(path.join(combo, "AGENTS.md"), "utf8")).split("<!-- agent-rule:start -->").length - 1, 1);
    assert.deepEqual((await operations.previewUninstall(combo)).targets, targets);
    await assert.rejects(operations.previewInstall(path.join(root, "qoder"), "go", ["unknown"]), /请选择至少一个受支持的平台/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("已安装项目可预览并调整平台，规则源无新版本也能应用", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "zhishu-desktop-platform-edit-"));
  const digest = `sha256:${"a".repeat(64)}`;
  try {
    const operations = new DesktopOperations(sourceLoader, async () => ({ version: currentVersion, digest, assetUrl: "https://example.test/current" }));
    await operations.previewInstall(root, "go", ["codex"]);
    await operations.applyInstall(root);
    const originalRules = await readFile(path.join(root, ".agent-rules", "common", "entry.md"), "utf8");
    const result = await operations.checkUpdate(root, ["codex", "qoder", "cursor", "workbuddy"]);
    assert.equal(result.available, true);
    assert.equal(result.targetsChanged, true);
    const preview = await operations.previewUpdate(root);
    assert.deepEqual(preview.conflicts, []);
    assert.ok(preview.changes.some((change) => change.path === "agent-rules.yaml" && change.action === "modify"));
    assert.ok(preview.changes.some((change) => change.path === ".agent-rules.lock.json" && change.action === "modify"));
    assert.ok(!preview.changes.some((change) => change.path.startsWith(".agent-rules/") && change.path !== ".agent-rules.lock.json"));
    assert.deepEqual((await operations.applyUpdate(root)).targets, ["codex", "qoder", "cursor", "workbuddy"]);
    assert.equal(await readFile(path.join(root, ".agent-rules", "common", "entry.md"), "utf8"), originalRules);
    assert.equal((await readFile(path.join(root, "AGENTS.md"), "utf8")).split("<!-- agent-rule:start -->").length - 1, 1);
    await operations.checkUpdate(root, ["qoder"]);
    await operations.previewUpdate(root);
    const qoderOnly = await operations.applyUpdate(root);
    assert.deepEqual(qoderOnly.targets, ["qoder"]);
    assert.equal(qoderOnly.valid, true);
    await operations.previewUninstall(root);
    assert.equal((await operations.applyUninstall(root)).installed, false);
  } finally { await rm(root, { recursive: true, force: true }); }
});

async function nextSource(root) {
  await cp(path.join(sourceRoot, "rulepacks"), path.join(root, "rulepacks"), { recursive: true });
  await cp(path.join(sourceRoot, "LICENSE"), path.join(root, "LICENSE"));
  const visit = async (folder) => {
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      const file = path.join(folder, entry.name);
      if (entry.isDirectory()) await visit(file);
      else if (entry.name === "pack.json") {
        const manifest = JSON.parse(await readFile(file, "utf8"));
        manifest.version = nextVersion;
        await writeFile(file, `${JSON.stringify(manifest, null, 2)}\n`);
      }
    }
  };
  await visit(path.join(root, "rulepacks"));
}

test("桌面更新：只检查版本、预览不写入、确认后更新并保留本地文件", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "zhishu-desktop-update-"));
  const next = await mkdtemp(path.join(os.tmpdir(), "zhishu-next-source-"));
  const currentDigest = `sha256:${"a".repeat(64)}`;
  const nextDigest = `sha256:${"c".repeat(64)}`;
  const release = { version: nextVersion, digest: nextDigest, assetUrl: "https://example.test/next" };
  try {
    await nextSource(next);
    await mkdir(path.join(root, ".agent-rules"));
    await writeFile(path.join(root, "AGENTS.md"), "# 自有入口\n");
    await writeFile(path.join(root, ".agent-rules", "notes.md"), "自有文件\n");
    const operations = new DesktopOperations(async (selected) => selected ? {
      snapshot: { root: next, version: nextVersion, digest: nextDigest, commit: "d".repeat(40) }, cleanup: async () => {},
    } : {
      snapshot: { root: sourceRoot, version: currentVersion, digest: currentDigest, commit: "b".repeat(40) }, cleanup: async () => {},
    }, async () => release);
    const targets = ["codex", "qoder", "cursor", "workbuddy"];
    await operations.previewInstall(root, "unity", targets);
    await operations.applyInstall(root);
    const oldLock = await readFile(path.join(root, ".agent-rules.lock.json"), "utf8");
    assert.deepEqual(await operations.checkUpdate(root), { root: await realpath(root), currentVersion, latestVersion: nextVersion, available: true, targetsChanged: false });
    assert.equal(await readFile(path.join(root, ".agent-rules.lock.json"), "utf8"), oldLock);
    const preview = await operations.previewUpdate(root);
    assert.equal(preview.kind, "update");
    assert.deepEqual(preview.conflicts, []);
    assert.ok(preview.changes.some((change) => change.path === ".agent-rules/unity/pack.json" && change.action === "modify"));
    assert.ok(preview.retainedPaths.includes(".agent-rules/notes.md"));
    assert.ok(preview.retainedPaths.includes(".agent-rules/overrides.md"));
    assert.equal(await readFile(path.join(root, ".agent-rules.lock.json"), "utf8"), oldLock);
    const updated = await operations.applyUpdate(root);
    assert.equal(updated.valid, true);
    assert.equal(updated.version, nextVersion);
    assert.deepEqual(updated.targets, targets);
    assert.equal(await readFile(path.join(root, "AGENTS.md"), "utf8").then((value) => value.startsWith("# 自有入口\n")), true);
    assert.equal(await readFile(path.join(root, ".agent-rules", "notes.md"), "utf8"), "自有文件\n");
    assert.equal((await operations.checkUpdate(root)).available, false);
  } finally { await rm(root, { recursive: true, force: true }); await rm(next, { recursive: true, force: true }); }
});

test("桌面更新：预览后的配置变化和发布资产变化会阻止写入", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "zhishu-desktop-update-stale-"));
  const next = await mkdtemp(path.join(os.tmpdir(), "zhishu-next-source-"));
  let release = { version: nextVersion, digest: `sha256:${"c".repeat(64)}`, assetUrl: "https://example.test/next" };
  try {
    await nextSource(next);
    const operations = new DesktopOperations(async (selected) => selected ? {
      snapshot: { root: next, version: nextVersion, digest: release.digest, commit: "d".repeat(40) }, cleanup: async () => {},
    } : await sourceLoader(), async () => release);
    await operations.previewInstall(root, "go"); await operations.applyInstall(root);
    await operations.checkUpdate(root); await operations.previewUpdate(root);
    const configPath = path.join(root, "agent-rules.yaml");
    const original = await readFile(configPath, "utf8");
    await writeFile(configPath, `${original}\n# changed\n`);
    await assert.rejects(operations.applyUpdate(root), /项目配置在预览后发生变化/);
    await writeFile(configPath, original);
    assert.equal((await operations.inspect(root)).version, currentVersion);
    await operations.checkUpdate(root); await operations.previewUpdate(root);
    release = { ...release, digest: `sha256:${"e".repeat(64)}` };
    await assert.rejects(operations.applyUpdate(root), /发布版本在预览后发生变化/);
    assert.equal((await operations.inspect(root)).version, currentVersion);
  } finally { await rm(root, { recursive: true, force: true }); await rm(next, { recursive: true, force: true }); }
});

test("桌面更新：受管文件漂移、同版本资产替换和降级均被拒绝", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "zhishu-desktop-update-guard-"));
  let release = { version: currentVersion, digest: `sha256:${"a".repeat(64)}`, assetUrl: "https://example.test/current" };
  try {
    const operations = new DesktopOperations(sourceLoader, async () => release);
    await operations.previewInstall(root, "unity"); await operations.applyInstall(root);
    assert.equal((await operations.checkUpdate(root)).available, false);
    const managed = path.join(root, ".agent-rules", "common", "entry.md");
    const original = await readFile(managed, "utf8");
    await writeFile(managed, `${original}\n用户修改`);
    await assert.rejects(operations.checkUpdate(root), /受管文件已发生漂移/);
    await writeFile(managed, original);
    release = { ...release, digest: `sha256:${"f".repeat(64)}` };
    await assert.rejects(operations.checkUpdate(root), /同版本资产可能已被替换/);
    release = { ...release, version: prevVersion, digest: `sha256:${"a".repeat(64)}` };
    await assert.rejects(operations.checkUpdate(root), /拒绝自动降级/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("Stage 1：本地规则源多岗位组合安装、增减规则包更新与 Antigravity/TRAE 共享入口", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "zhishu-desktop-xr-combo-"));
  try {
    await mkdir(path.join(root, "ProjectSettings"), { recursive: true });
    await writeFile(path.join(root, "ProjectSettings", "ProjectVersion.txt"), "m_EditorVersion: 2022.3.0f1\n");
    const wsInfo = await inspectWorkspaceSource(sourceRoot);
    assert.equal(wsInfo.packs.length, 20);
    const operations = new DesktopOperations(sourceLoader);
    const inspected = await operations.inspect(root);
    assert.equal(inspected.installed, false);
    assert.ok(inspected.detection.stacks.some((stack) => stack.id === "unity"));
    assert.deepEqual(inspected.recommendedRulepacks, ["common", "unity", "project-docs/unity"]);

    const targets = ["codex", "antigravity", "trae"];
    const preview = await operations.previewInstall(root, {
      rulepacks: ["unity", "xr-common", "product-pm", "ui-design"],
      targets,
      source: { type: "workspace", path: sourceRoot },
    });
    assert.deepEqual(preview.conflicts, []);
    assert.equal(preview.sourceType, "workspace");
    assert.deepEqual(preview.targets, targets);
    assert.ok(preview.rulepacks.includes("common"));
    assert.ok(preview.rulepacks.includes("project-docs/ui-design"));

    const installed = await operations.applyInstall(root);
    assert.equal(installed.installed, true);
    assert.equal(installed.valid, true);
    assert.equal(installed.sourceType, "workspace");
    assert.deepEqual(installed.targets, targets);
    assert.equal(installed.overridesExists, true);
    const agents = await readFile(path.join(root, "AGENTS.md"), "utf8");
    assert.match(agents, /product-pm/);
    assert.match(agents, /xr-common/);

    const nextPacks = ["unity", "xr-common", "product-pm", "ui-design", "3d-art", "ta-vfx-shader"];
    const check = await operations.checkUpdate(root, targets, nextPacks);
    assert.equal(check.available, true);
    assert.equal(check.rulepacksChanged, true);
    assert.equal(check.targetsChanged, false);
    const updatePreview = await operations.previewUpdate(root);
    assert.deepEqual(updatePreview.conflicts, []);
    assert.ok(updatePreview.changes.some((change) => change.path === "agent-rules.yaml" && change.action === "modify"));
    assert.ok(updatePreview.changes.some((change) => change.path.startsWith(".agent-rules/3d-art/")));
    assert.ok(updatePreview.changes.some((change) => change.path.startsWith(".agent-rules/ta-vfx-shader/")));
    const updated = await operations.applyUpdate(root);
    assert.equal(updated.valid, true);
    assert.deepEqual(updated.rulepacks, nextPacks);
    assert.equal((await operations.checkUpdate(root)).available, false);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("Stage 1：桌面端检测并恢复中断未完成事务", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "zhishu-desktop-recover-"));
  try {
    const operations = new DesktopOperations(sourceLoader);
    await operations.previewInstall(root, {
      rulepacks: ["common"],
      targets: ["codex", "antigravity"],
      source: { type: "workspace", path: sourceRoot },
    });
    await operations.applyInstall(root);
    const originalLock = await readFile(path.join(root, ".agent-rules.lock.json"), "utf8");
    const originalAgents = await readFile(path.join(root, "AGENTS.md"), "utf8");
    const originalConfig = await readFile(path.join(root, "agent-rules.yaml"), "utf8");

    const txDir = path.join(root, ".agent-rules.transaction-simulated");
    await cp(path.join(root, ".agent-rules"), path.join(txDir, "backup"), { recursive: true });
    await writeFile(path.join(txDir, "journal.json"), JSON.stringify({
      schemaVersion: 1,
      hadRules: true,
      snapshots: {
        "AGENTS.md": originalAgents,
        ".agent-rules.lock.json": originalLock,
        "agent-rules.yaml": originalConfig,
      },
    }), "utf8");
    await writeFile(path.join(root, "AGENTS.md"), "中断写入的半成品\n", "utf8");

    const broken = await operations.inspect(root);
    assert.equal(broken.valid, false);
    assert.equal(broken.interruptedTransactions.length, 1);

    const recovered = await operations.recover(root);
    assert.ok(recovered.recoveredPath);
    assert.equal(recovered.status.valid, true);
    assert.equal(recovered.status.interruptedTransactions.length, 0);
    assert.equal(await readFile(path.join(root, "AGENTS.md"), "utf8"), originalAgents);
  } finally { await rm(root, { recursive: true, force: true }); }
});
