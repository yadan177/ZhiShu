import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { EvolutionOperations } = require("../build/evolution-operations.cjs");
const { ProjectRegistry } = require("../build/project-registry.cjs");
const { SourceManager } = require("../build/source-manager.cjs");

function sha256(text) {
  return `sha256:${createHash("sha256").update(text).digest("hex")}`;
}

async function setupRuleRepo(root) {
  const repoDir = path.join(root, "writable-rules");
  const ruleFile = path.join(repoDir, "rulepacks/ui-design/其他规则/07-XR空间界面规范.md");
  await mkdir(path.dirname(ruleFile), { recursive: true });
  await writeFile(
    path.join(repoDir, "rulepacks/ui-design/pack.json"),
    JSON.stringify(
      {
        id: "ui-design",
        version: "2.1.0",
        status: "ready",
        kind: "common",
        entry: "15-AI通用入口规则.md",
        dependencies: ["common"],
        rules: ["其他规则/07-XR空间界面规范.md"],
      },
      null,
      2,
    ),
    "utf8",
  );
  await writeFile(
    ruleFile,
    [
      "# XR 空间界面规范",
      "",
      "## 2. 视距、视野角与物理可读性参数",
      "",
      "- 默认主窗口视距保持在 1.25m～2.0m 之间。",
      "- 裸手热区最小 44pt。",
      "",
    ].join("\n"),
    "utf8",
  );
  return { repoDir, ruleFile };
}

test("桌面端 EvolutionOperations：通道 1 导入脱敏拦截、通道 2 只读扫描、通道 3 部分失败/重试/取消", async () => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "zhishu-desktop-evo-")));
  try {
    const { repoDir } = await setupRuleRepo(root);
    const registry = new ProjectRegistry(path.join(root, "projects.json"));
    const sourceManager = new SourceManager(path.join(root, "sources"));

    // 登记 2 个带共性 overrides.md 的项目 + 1 个无 overrides 的项目
    const projA = path.join(root, "proj-a");
    const projB = path.join(root, "proj-b");
    const projC = path.join(root, "proj-c");
    await mkdir(path.join(projA, ".agent-rules"), { recursive: true });
    await mkdir(path.join(projB, ".agent-rules"), { recursive: true });
    await mkdir(projC, { recursive: true });
    const ovrAContent = "# 覆盖\n- 所有 visionOS 悬停控件必须具备 60pt 最小眼动热区保护。\n";
    const ovrBContent = "# 覆盖\n- visionOS 悬停按钮必须保留 60pt 最小眼动热区保护。\n";
    await writeFile(path.join(projA, ".agent-rules/overrides.md"), ovrAContent, "utf8");
    await writeFile(path.join(projB, ".agent-rules/overrides.md"), ovrBContent, "utf8");
    await registry.add(projA);
    await registry.add(projB);
    await registry.add(projC);

    let flakyFailOnce = true;
    const progressEvents = [];
    const mockFetch = async (input, init) => {
      const url = String(input);
      if (url.includes("slow.example.com")) {
        return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        });
      }
      if (url.includes("flaky.example.com")) {
        if (flakyFailOnce) {
          flakyFailOnce = false;
          throw new Error("ETIMEDOUT flaky.example.com");
        }
        return new Response("<html><title>Flaky Fixed</title><body><p>visionOS 2.6 adds 64pt gaze padding.</p></body></html>", {
          status: 200,
        });
      }
      return new Response("<html><title>Apple HIG</title><body><p>visionOS 2.5 recommends 60pt hover target.</p></body></html>", {
        status: 200,
      });
    };

    const ops = new EvolutionOperations(path.join(root, "evolution"), {
      registry,
      sourceManager,
      defaultWorkspaceRoot: async () => repoDir,
      fetcher: mockFetch,
      onWatchProgress: (p) => progressEvents.push(p),
    });

    // 1. 通道 1 导入含明文密钥 JSON 必须拦截
    const secretFile = path.join(root, "secret-proposal.json");
    await writeFile(
      secretFile,
      JSON.stringify({
        channel: "session-capture",
        targetKind: "rule",
        operation: "add-item",
        title: "含密钥提案",
        targetPath: "rulepacks/ui-design/其他规则/07-XR空间界面规范.md",
        anchorHeading: "## 2. 视距、视野角与物理可读性参数",
        afterSnippet: "- 调试 token=ghp_1234567890abcdefghij1234567890",
        evidence: [{ sourceLabel: "导入测试", summary: "含敏感明文" }],
      }),
      "utf8",
    );
    await assert.rejects(() => ops.importProposalFile(secretFile), /敏感信息拦截/);

    // 2. 通道 2 只读扫描跨项目 overrides.md
    const scan = await ops.scanOverrides(repoDir);
    assert.equal(scan.scannedCount, 2);
    assert.equal(scan.skippedProjects.length, 1);
    assert.equal(scan.createdCount, 1);
    assert.equal(await readFile(path.join(projA, ".agent-rules/overrides.md"), "utf8"), ovrAContent);
    assert.equal(await readFile(path.join(projB, ".agent-rules/overrides.md"), "utf8"), ovrBContent);

    // 3. 通道 3 官方文档巡检：1 成功 + 1 失败 → 部分失败保留成功结果 → 支持单独重试失败源
    await ops.saveWatchSources([
      {
        schemaVersion: 1,
        id: "apple-hig",
        name: "Apple HIG",
        url: "https://developer.apple.com/visionos",
        targetRulepack: "ui-design",
        targetPath: "rulepacks/ui-design/其他规则/07-XR空间界面规范.md",
        anchorHeading: "## 2. 视距、视野角与物理可读性参数",
        keywords: ["60pt"],
        enabled: true,
      },
      {
        schemaVersion: 1,
        id: "flaky-source",
        name: "波动官方源",
        url: "https://flaky.example.com/docs",
        targetRulepack: "ui-design",
        targetPath: "rulepacks/ui-design/其他规则/07-XR空间界面规范.md",
        anchorHeading: "## 2. 视距、视野角与物理可读性参数",
        keywords: ["64pt"],
        enabled: true,
      },
    ]);

    const firstWatch = await ops.watchDocs({ workspaceRoot: repoDir });
    assert.equal(firstWatch.succeededCount, 1);
    assert.equal(firstWatch.failedCount, 1);
    assert.equal(firstWatch.createdCount, 1);
    assert.ok(progressEvents.length >= 2);

    const retryWatch = await ops.watchDocs({ sourceIds: ["flaky-source"], workspaceRoot: repoDir });
    assert.equal(retryWatch.succeededCount, 1);
    assert.equal(retryWatch.failedCount, 0);
    assert.equal(retryWatch.createdCount, 1);

    // 4. 通道 3 取消巡检验证
    await ops.saveWatchSources([
      {
        schemaVersion: 1,
        id: "slow-source",
        name: "慢速源",
        url: "https://slow.example.com/docs",
        targetRulepack: "ui-design",
        targetPath: "rulepacks/ui-design/其他规则/07-XR空间界面规范.md",
        keywords: ["visionOS"],
        enabled: true,
      },
    ]);
    const watchPromise = ops.watchDocs({ workspaceRoot: repoDir });
    setTimeout(() => ops.cancelWatch(), 25);
    const cancelledWatch = await watchPromise;
    assert.equal(cancelledWatch.cancelled, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("桌面端 EvolutionOperations：人工 Diff 审批原子写入、校验失败回滚、只读源阻断与补丁导出", async () => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "zhishu-desktop-evo-write-")));
  try {
    const { repoDir, ruleFile } = await setupRuleRepo(root);
    const registry = new ProjectRegistry(path.join(root, "projects.json"));
    const sourceManager = new SourceManager(path.join(root, "sources"));
    const ops = new EvolutionOperations(path.join(root, "evolution"), {
      registry,
      sourceManager,
      defaultWorkspaceRoot: async () => repoDir,
    });

    const originalText = await readFile(ruleFile, "utf8");
    const originalDigest = sha256(originalText);

    const validFile = path.join(root, "valid-proposal.json");
    await writeFile(
      validFile,
      JSON.stringify({
        channel: "session-capture",
        targetKind: "rule",
        operation: "add-item",
        title: "补充 MR 透视背景对比度条款",
        targetRulepack: "ui-design",
        targetPath: "rulepacks/ui-design/其他规则/07-XR空间界面规范.md",
        anchorHeading: "## 2. 视距、视野角与物理可读性参数",
        afterSnippet: "- MR 透视模式下文字容器需提供不低于 4.5:1 的背板对比度。",
        evidence: [{ sourceLabel: "实机验收", summary: "透视浅色墙面下文字对比度不足" }],
      }),
      "utf8",
    );
    const imported = await ops.importProposalFile(validFile, repoDir);
    assert.equal(imported.outcome, "created");
    const proposal = imported.proposal;
    assert.ok(proposal);

    // 1. 只读源拦截
    const roPreview = await ops.preview(proposal.id, {
      id: "zhishu-official",
      name: "智枢官方源",
      readonly: true,
    });
    assert.ok(roPreview.conflicts.some((item) => item.includes("READONLY_SOURCE")));
    await assert.rejects(() => ops.apply(roPreview.token), /阻塞冲突/);

    // 2. 导出补丁（允许导出，拒绝静默覆盖）
    const outPatch = path.join(root, "mr-contrast.patch");
    await ops.exportPatch(proposal.id, outPatch, repoDir);
    assert.match(await readFile(outPatch, "utf8"), /4\.5:1/);
    await assert.rejects(() => ops.exportPatch(proposal.id, outPatch, repoDir), /拒绝静默覆盖/);

    // 3. 编辑补丁注入失效相对链接 → 写入后门禁拦截并完整回滚
    const badPreview = await ops.preview(
      proposal.id,
      { id: "__workspace__", name: "本地工作区", root: repoDir, readonly: false },
      { afterSnippet: "- 详见 [失效链接](./missing-spec.md)。" },
    );
    assert.deepEqual(badPreview.conflicts, []);
    await assert.rejects(() => ops.apply(badPreview.token), /已完整回滚目标文件/);
    assert.equal(sha256(await readFile(ruleFile, "utf8")), originalDigest);

    // 4. 正常预览 + 确认写入 → 原子落盘并标记 approved
    const okPreview = await ops.preview(proposal.id, {
      id: "__workspace__",
      name: "本地工作区",
      root: repoDir,
      readonly: false,
    });
    assert.deepEqual(okPreview.conflicts, []);
    assert.equal(sha256(await readFile(ruleFile, "utf8")), originalDigest);

    const applied = await ops.apply(okPreview.token);
    assert.equal(applied.proposal.status, "approved");
    assert.equal(applied.list.counts.badge, 0);
    assert.equal(applied.list.counts.processedTab, 1);
    assert.match(await readFile(ruleFile, "utf8"), /4\.5:1/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
