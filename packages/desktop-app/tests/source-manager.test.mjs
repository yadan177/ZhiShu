import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cp, mkdtemp, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { SourceManager } = require("../build/source-manager.cjs");
const repoRoot = path.resolve(import.meta.dirname, "../../..");

test("Stage 3：企业源置顶、个人源本地扫描、凭据隔离与官方源只读保护", async () => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "zhishu-sources-")));
  try {
    const manager = new SourceManager(path.join(root, "state"));
    const initial = await manager.list();
    assert.equal(initial.length, 1);
    assert.equal(initial[0].id, "zhishu-official");
    assert.equal(initial[0].readonly, true);

    await assert.rejects(manager.remove("zhishu-official"), /不可移除/);

    const secret = "ghp_enterprise_secret_9a2f";
    await manager.add({
      id: "personal-local",
      name: "本地开发源",
      tier: "personal",
      access: "local",
      location: repoRoot,
    });
    const afterEnterprise = await manager.add({
      id: "corp-xr",
      name: "企业 XR 规范源",
      tier: "enterprise",
      access: "local",
      location: repoRoot,
      requiredRulepacks: ["common", "xr-common"],
      token: secret,
    });

    assert.deepEqual(
      afterEnterprise.map((item) => item.tier),
      ["enterprise", "personal", "official"],
    );
    assert.equal(afterEnterprise[0].availableRulepacks.length, 20);
    assert.equal(afterEnterprise[0].hasLocalToken, true);
    assert.equal(afterEnterprise[0].maskedToken, "••••9a2f");

    const sourcesText = await readFile(path.join(root, "state", "sources.json"), "utf8");
    assert.ok(!sourcesText.includes(secret), "sources.json 严禁落盘明文凭据");

    const testResult = await manager.testConnection({ access: "local", location: repoRoot });
    assert.equal(testResult.ok, true);
    assert.equal(testResult.packCount, 20);

    const remaining = await manager.remove("corp-xr");
    assert.equal(remaining.length, 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Stage 3：私有 Git 源连接测试、浅克隆同步与规则包清单校验", async () => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "zhishu-git-source-")));
  try {
    const bareRepo = path.join(root, "enterprise.git");
    const seedRepo = path.join(root, "seed");
    await mkdir(bareRepo);
    await mkdir(seedRepo);
    execFileSync("git", ["init", "--bare", bareRepo], { stdio: "ignore" });
    execFileSync("git", ["init", "-b", "main", seedRepo], { stdio: "ignore" });
    execFileSync("git", ["-C", seedRepo, "config", "user.email", "test@zhishu.local"], { stdio: "ignore" });
    execFileSync("git", ["-C", seedRepo, "config", "user.name", "ZhiShu Test"], { stdio: "ignore" });
    await cp(path.join(repoRoot, "rulepacks", "common"), path.join(seedRepo, "rulepacks", "common"), { recursive: true });
    await cp(path.join(repoRoot, "rulepacks", "xr-common"), path.join(seedRepo, "rulepacks", "xr-common"), { recursive: true });
    await writeFile(path.join(seedRepo, "README.md"), "# Enterprise Rules\n");
    execFileSync("git", ["-C", seedRepo, "add", "."], { stdio: "ignore" });
    execFileSync("git", ["-C", seedRepo, "commit", "-m", "init enterprise rules"], { stdio: "ignore" });
    execFileSync("git", ["-C", seedRepo, "remote", "add", "origin", bareRepo], { stdio: "ignore" });
    execFileSync("git", ["-C", seedRepo, "push", "-u", "origin", "main"], { stdio: "ignore" });

    const manager = new SourceManager(path.join(root, "state"));
    const conn = await manager.testConnection({ access: "git", location: bareRepo, branch: "main" });
    assert.equal(conn.ok, true);

    await manager.add({
      id: "corp-git",
      name: "企业 Git 源",
      tier: "enterprise",
      access: "git",
      location: bareRepo,
      branch: "main",
      requiredRulepacks: ["common", "xr-common"],
    });
    const synced = await manager.sync("corp-git");
    const corp = synced.sources.find((item) => item.id === "corp-git");
    assert.ok(corp?.localCheckoutPath);
    assert.deepEqual(corp.availableRulepacks.sort(), ["common", "xr-common"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
