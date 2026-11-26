import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { FEISHU_MCP_PRESET, McpConfigEngine, maskSecretValue } from "./mcp.js";

test("maskSecretValue 严格脱敏密钥并只保留末尾 4 位", () => {
  assert.equal(maskSecretValue("secret-value-3f9a"), "••••3f9a");
  assert.equal(maskSecretValue("1234"), "••••");
  assert.equal(maskSecretValue("ab"), "••••");
  assert.equal(maskSecretValue(""), "");
});

test("McpConfigEngine 在 Antigravity JSON 与 Codex TOML 中完成脱敏预览、保留用户配置、漂移阻断与卸载", async () => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "zhishu-mcp-core-")));
  try {
    const agyConfig = path.join(root, ".gemini", "config", "mcp_config.json");
    const codexConfig = path.join(root, ".codex", "config.toml");
    await mkdir(path.dirname(agyConfig), { recursive: true });
    await mkdir(path.dirname(codexConfig), { recursive: true });
    await writeFile(agyConfig, JSON.stringify({ mcpServers: { existing: { command: "echo" } } }, null, 2));
    await writeFile(codexConfig, 'model = "gpt-5"\n');

    const engine = new McpConfigEngine(path.join(root, "receipts"), {
      antigravity: agyConfig,
      codex: codexConfig,
    });
    const secret = "cli_secret_value_3f9a";

    for (const toolId of ["antigravity", "codex"] as const) {
      const preview = await engine.preview("install", toolId, FEISHU_MCP_PRESET, {
        FEISHU_APP_ID: "cli_123456",
        FEISHU_APP_SECRET: secret,
      });
      assert.deepEqual(preview.conflicts, []);
      assert.ok(!preview.maskedAfter.includes(secret), `${toolId} 预览严禁泄露明文密钥`);
      assert.match(preview.maskedAfter, /••••3f9a/);

      const receipt = await engine.apply(preview.token);
      assert.equal(receipt?.id, "feishu-mcp");
      const receiptText = await readFile(path.join(root, "receipts", `${toolId}--feishu-mcp.json`), "utf8");
      assert.ok(!receiptText.includes(secret), "安装回执严禁持久化明文密钥");

      const written = await readFile(toolId === "antigravity" ? agyConfig : codexConfig, "utf8");
      assert.ok(written.includes(secret));
      if (toolId === "antigravity") {
        assert.match(written, /"existing"/);
      } else {
        assert.match(written, /model = "gpt-5"/);
      }

      // 人为篡改配置触发漂移阻断
      await writeFile(toolId === "antigravity" ? agyConfig : codexConfig, `${written}\n`);
      if (toolId === "codex") {
        const drifted = written.replace("cli_123456", "cli_tampered");
        await writeFile(codexConfig, drifted);
        const driftPreview = await engine.preview("uninstall", "codex", FEISHU_MCP_PRESET);
        assert.match(driftPreview.conflicts.join(" "), /漂移/);
        await assert.rejects(engine.apply(driftPreview.token), /冲突/);
        await writeFile(codexConfig, written);
      }

      const uninstallPreview = await engine.preview("uninstall", toolId, FEISHU_MCP_PRESET);
      assert.deepEqual(uninstallPreview.conflicts, []);
      await engine.apply(uninstallPreview.token);
      const afterUninstall = await readFile(toolId === "antigravity" ? agyConfig : codexConfig, "utf8");
      assert.ok(!afterUninstall.includes("feishu-mcp"));
      if (toolId === "antigravity") assert.match(afterUninstall, /"existing"/);
      else assert.match(afterUninstall, /model = "gpt-5"/);
    }
    assert.deepEqual(await engine.list(), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("McpConfigEngine 拒绝覆盖未知同名配置与符号链接路径", async () => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "zhishu-mcp-guard-")));
  try {
    const agyConfig = path.join(root, ".gemini", "config", "mcp_config.json");
    const codexConfig = path.join(root, ".codex", "config.toml");
    await mkdir(path.dirname(agyConfig), { recursive: true });
    await mkdir(path.dirname(codexConfig), { recursive: true });
    await writeFile(agyConfig, JSON.stringify({ mcpServers: { "feishu-mcp": { command: "custom" } } }));
    await writeFile(codexConfig, '[mcp_servers.feishu-mcp]\ncommand = "custom"\n');

    const engine = new McpConfigEngine(path.join(root, "receipts"), {
      antigravity: agyConfig,
      codex: codexConfig,
    });
    const agyCollision = await engine.preview("install", "antigravity", FEISHU_MCP_PRESET, {
      FEISHU_APP_ID: "cli_1",
      FEISHU_APP_SECRET: "secret_1234",
    });
    assert.match(agyCollision.conflicts.join(" "), /未知 MCP/);
    const codexCollision = await engine.preview("install", "codex", FEISHU_MCP_PRESET, {
      FEISHU_APP_ID: "cli_1",
      FEISHU_APP_SECRET: "secret_1234",
    });
    assert.match(codexCollision.conflicts.join(" "), /未知 MCP/);

    if (process.platform !== "win32") {
      const outside = path.join(root, "outside.json");
      await writeFile(outside, "{}");
      const linked = path.join(root, "linked.json");
      await symlink(outside, linked);
      const linkEngine = new McpConfigEngine(path.join(root, "receipts2"), {
        antigravity: linked,
        codex: codexConfig,
      });
      await assert.rejects(
        linkEngine.preview("install", "antigravity", FEISHU_MCP_PRESET, {
          FEISHU_APP_ID: "cli_1",
          FEISHU_APP_SECRET: "secret_1234",
        }),
        /普通文件/,
      );
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("McpConfigEngine：JSON 键序规范化、HTTP 连字符 Header、自定义 secret 脱敏与冲突覆盖修复", async () => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "zhishu-mcp-p0-")));
  try {
    const agyConfig = path.join(root, ".gemini", "config", "mcp_config.json");
    const codexConfig = path.join(root, ".codex", "config.toml");
    await mkdir(path.dirname(agyConfig), { recursive: true });
    await mkdir(path.dirname(codexConfig), { recursive: true });
    await writeFile(codexConfig, '[mcp_servers."quoted-svc"]\nurl = "https://other.example"\n');

    const httpDef = {
      schemaVersion: 1 as const,
      id: "corp-http-mcp",
      title: "企业 HTTP MCP",
      version: "1.0.0",
      transport: "http" as const,
      url: "https://mcp.corp.example/sse",
      envSchema: [{ key: "X-API-Key", label: "API Key", required: true, secret: true }],
    };

    const engine = new McpConfigEngine(path.join(root, "receipts"), {
      antigravity: agyConfig,
      codex: codexConfig,
    });

    // 1. 支持 HTTP 带连字符 Header，并对 Antigravity / Codex 均严格脱敏
    const secret = "xkey_super_secret_8842";
    const agyInstall = await engine.preview("install", "antigravity", httpDef, { "X-API-Key": secret });
    assert.deepEqual(agyInstall.conflicts, []);
    assert.ok(!agyInstall.maskedAfter.includes(secret));
    await engine.apply(agyInstall.token);

    // 2. 重排 JSON 键序后仍应判定为无漂移
    const rawJson = JSON.parse(await readFile(agyConfig, "utf8"));
    const entry = rawJson.mcpServers["corp-http-mcp"];
    rawJson.mcpServers["corp-http-mcp"] = { headers: entry.headers, serverUrl: entry.serverUrl };
    await writeFile(agyConfig, JSON.stringify(rawJson, null, 2));
    assert.deepEqual((await engine.list())[0]?.issues, []);

    // 3. Codex 安装后再次预览时 maskedBefore 绝不泄露自定义 secret 字段
    const codexInstall = await engine.preview("install", "codex", httpDef, { "X-API-Key": secret });
    assert.deepEqual(codexInstall.conflicts, []);
    await engine.apply(codexInstall.token);
    const codexUpdate = await engine.preview(
      "update",
      "codex",
      httpDef,
      { "X-API-Key": "xkey_next_secret_9911" },
      { allSchemas: new Map([[httpDef.id, httpDef.envSchema]]) },
    );
    assert.ok(!codexUpdate.maskedBefore.includes(secret));
    assert.ok(!codexUpdate.maskedAfter.includes("xkey_next_secret_9911"));

    // 4. 配置文件损坏时 preview 不崩溃且允许 allowConflictOverride 覆盖修复或 forgetReceipt
    await writeFile(agyConfig, "{broken json");
    const brokenPreview = await engine.preview("uninstall", "antigravity", httpDef);
    assert.ok(brokenPreview.conflicts.length > 0);
    await engine.forgetReceipt("antigravity", httpDef.id);
    assert.equal((await engine.list()).filter((r) => r.toolId === "antigravity").length, 0);

    // 5. Codex 漂移后通过 allowConflictOverride 强制覆盖修复
    await writeFile(codexConfig, `${await readFile(codexConfig, "utf8")}\n# drift\n`);
    const forceFix = await engine.preview(
      "update",
      "codex",
      httpDef,
      { "X-API-Key": "xkey_repaired_7711" },
      { allowConflictOverride: true, allSchemas: new Map([[httpDef.id, httpDef.envSchema]]) },
    );
    assert.deepEqual(forceFix.conflicts, []);
    await engine.apply(forceFix.token);
    assert.deepEqual((await engine.list())[0]?.issues, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
