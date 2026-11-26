import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstat, mkdtemp, mkdir, readFile, readdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const {
  downloadVerifiedInstaller,
  isTrustedDownloadUrl,
  parseSha256Sums,
  prepareMacReplaceHelper,
  resolveMacAppTarget,
  verifyInstallerBeforeLaunch,
} = require("../build/desktop-updater.cjs");

const sha256Hex = (data) => createHash("sha256").update(data).digest("hex");

function makeRelease(version, installerName, payload, opts = {}) {
  const hex = opts.digestHex ?? sha256Hex(payload);
  return {
    version,
    tag: `desktop-v${version}`,
    installerName,
    pageUrl: `https://github.com/yadan177/ZhiShu/releases/tag/desktop-v${version}`,
    downloadUrl: `https://github.com/yadan177/ZhiShu/releases/download/desktop-v${version}/${installerName}`,
    ...(opts.withChecksumUrl !== false
      ? { checksumUrl: `https://github.com/yadan177/ZhiShu/releases/download/desktop-v${version}/SHA256SUMS.txt` }
      : {}),
    ...(opts.withAssetDigest !== false ? { assetDigest: `sha256:${hex}` } : {}),
    expectedSize: payload.byteLength,
  };
}

test("SHA256SUMS 解析与受信任下载域名规则严格生效", () => {
  const hash = "a".repeat(64);
  const content = [
    "# comment",
    `${hash}  ZhiShu-Desktop-2.1.2-macOS-arm64.dmg`,
    `${"b".repeat(64)} *ZhiShu-Desktop-2.1.2-Windows-x64.exe`,
  ].join("\n");
  assert.equal(parseSha256Sums(content, "ZhiShu-Desktop-2.1.2-macOS-arm64.dmg"), hash);
  assert.equal(parseSha256Sums(content, "ZhiShu-Desktop-2.1.2-Windows-x64.exe"), "b".repeat(64));
  assert.equal(parseSha256Sums(content, "../escape.dmg"), undefined);

  assert.equal(
    isTrustedDownloadUrl("https://github.com/yadan177/ZhiShu/releases/download/desktop-v2.1.2/ZhiShu-Desktop-2.1.2-macOS-arm64.dmg", true),
    true,
  );
  assert.equal(
    isTrustedDownloadUrl("http://github.com/yadan177/ZhiShu/releases/download/desktop-v2.1.2/ZhiShu-Desktop-2.1.2-macOS-arm64.dmg", true),
    false,
  );
  assert.equal(
    isTrustedDownloadUrl("https://github.com/other/repo/releases/download/desktop-v2.1.2/a.dmg", true),
    false,
  );
  assert.equal(isTrustedDownloadUrl("https://objects.githubusercontent.com/github-production-release-asset/123", false), true);
  assert.equal(isTrustedDownloadUrl("https://evil.example/fake.dmg", false), false);
});

test("应用内下载支持受信任 CDN 重定向、双向 SHA-256 校验、缓存复用与旧包清理", async () => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "zhishu-updater-ok-")));
  try {
    const cacheDir = path.join(root, "software-updates");
    await mkdir(cacheDir, { recursive: true });
    // 预置旧版安装包，验证成功下载新版后自动清理
    await writeFile(path.join(cacheDir, "ZhiShu-Desktop-2.1.0-macOS-arm64.dmg"), "stale-old-dmg");

    const payload = Buffer.from("fake-dmg-binary-payload-".repeat(2048));
    const hex = sha256Hex(payload);
    const release = makeRelease("2.1.2", "ZhiShu-Desktop-2.1.2-macOS-arm64.dmg", payload);
    const sumsText = `${hex}  ${release.installerName}\n`;

    let downloadHits = 0;
    const progresses = [];
    let verifiedCalled = false;

    const fetcher = async (url) => {
      if (url === release.checksumUrl) {
        return new Response(sumsText, { status: 200 });
      }
      if (url === release.downloadUrl) {
        downloadHits++;
        return new Response(null, {
          status: 302,
          headers: { location: "https://objects.githubusercontent.com/zhishu/2.1.2.dmg" },
        });
      }
      if (url === "https://objects.githubusercontent.com/zhishu/2.1.2.dmg") {
        const half = Math.floor(payload.byteLength / 2);
        const stream = new ReadableStream({
          start(controller) {
            controller.enqueue(payload.subarray(0, half));
            controller.enqueue(payload.subarray(half));
            controller.close();
          },
        });
        return new Response(stream, {
          status: 200,
          headers: { "content-length": String(payload.byteLength) },
        });
      }
      throw new Error(`Unexpected URL: ${url}`);
    };

    const first = await downloadVerifiedInstaller({
      release,
      cacheDir,
      fetcher,
      onProgress: (p) => progresses.push(p),
      onVerifying: () => {
        verifiedCalled = true;
      },
    });
    assert.equal(first.cached, false);
    assert.equal(first.sha256, hex);
    assert.equal(first.size, payload.byteLength);
    assert.equal(verifiedCalled, true);
    assert.ok(progresses.includes(100));
    assert.deepEqual(await readdir(cacheDir), [release.installerName]);
    assert.equal(downloadHits, 1);

    // 二次调用复用已校验缓存，不再重复发起网络下载
    const second = await downloadVerifiedInstaller({ release, cacheDir, fetcher });
    assert.equal(second.cached, true);
    assert.equal(second.filePath, first.filePath);
    assert.equal(downloadHits, 1);

    // 启动前 TOCTOU 复核：完整通过，篡改后立拦截
    await verifyInstallerBeforeLaunch(first.filePath, hex);
    await writeFile(first.filePath, "tampered-after-download");
    await assert.rejects(() => verifyInstallerBeforeLaunch(first.filePath, hex), /内容发生变化/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("拦截 SHA-256 篡改、清单与 API 摘要冲突、恶意重定向、超限体积与取消下载", async () => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "zhishu-updater-fail-")));
  try {
    const cacheDir = path.join(root, "cache");
    const goodPayload = Buffer.from("expected-binary-content");
    const badPayload = Buffer.from("tampered-binary-content");

    // 1. 实际下载内容与 SHA-256 不匹配：拒绝且不残留 .part
    const release1 = makeRelease("2.1.2", "ZhiShu-Desktop-2.1.2-Windows-x64.exe", goodPayload);
    await assert.rejects(
      () =>
        downloadVerifiedInstaller({
          release: release1,
          cacheDir,
          fetcher: async (url) => {
            if (url === release1.checksumUrl) return new Response(`${sha256Hex(goodPayload)}  ${release1.installerName}\n`);
            return new Response(badPayload, { status: 200 });
          },
        }),
      /SHA-256 校验失败/,
    );
    assert.deepEqual(await readdir(cacheDir), []);

    // 2. SHA256SUMS.txt 与 GitHub API digest 冲突：拒绝下载
    await assert.rejects(
      () =>
        downloadVerifiedInstaller({
          release: release1,
          cacheDir,
          fetcher: async (url) => {
            if (url === release1.checksumUrl) return new Response(`${"f".repeat(64)}  ${release1.installerName}\n`);
            throw new Error("should not download");
          },
        }),
      /校验摘要与发布清单不一致/,
    );

    // 3. 恶意重定向到非受信任域名：立即拦截
    await assert.rejects(
      () =>
        downloadVerifiedInstaller({
          release: release1,
          cacheDir,
          fetcher: async (url) => {
            if (url === release1.checksumUrl) return new Response(`${sha256Hex(goodPayload)}  ${release1.installerName}\n`);
            return new Response(null, { status: 302, headers: { location: "https://evil.example/payload.exe" } });
          },
        }),
      /不受信任的域名/,
    );

    // 4. 超过安全体积上限：拦截并清理 .part
    await assert.rejects(
      () =>
        downloadVerifiedInstaller({
          release: release1,
          cacheDir,
          maxBytes: 8,
          fetcher: async (url) => {
            if (url === release1.checksumUrl) return new Response(`${sha256Hex(goodPayload)}  ${release1.installerName}\n`);
            return new Response(goodPayload, { status: 200 });
          },
        }),
      /超过安全上限/,
    );
    assert.deepEqual(await readdir(cacheDir), []);

    // 5. 缓存目录为符号链接（非 Windows）时拒绝写入
    if (process.platform !== "win32") {
      const outside = path.join(root, "outside");
      await mkdir(outside);
      const linkedCache = path.join(root, "linked-cache");
      await symlink(outside, linkedCache);
      await assert.rejects(
        () => downloadVerifiedInstaller({ release: release1, cacheDir: linkedCache, fetcher: async () => new Response("") }),
        /符号链接/,
      );
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("macOS 目标应用目录安全判定与原子替换辅助脚本生成", { skip: process.platform === "win32" }, async () => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "zhishu-mac-target-")));
  try {
    const fakeHome = path.join(root, "home");
    const appDir = path.join(fakeHome, "Applications/智枢.app");
    await mkdir(path.join(appDir, "Contents/MacOS"), { recursive: true });
    const execPath = path.join(appDir, "Contents/MacOS/智枢");

    // 1. 用户 ~/Applications 下的真实可写 .app 支持自动替换
    const ok = await resolveMacAppTarget(execPath, fakeHome);
    assert.deepEqual(ok, { appPath: appDir, canAutoReplace: true });

    // 2. AppTranslocation 路径禁止自动替换（回退打开 DMG）
    const translocated = await resolveMacAppTarget(
      "/private/var/folders/xx/T/AppTranslocation/ABC/d/智枢.app/Contents/MacOS/智枢",
      fakeHome,
    );
    assert.equal(translocated?.canAutoReplace, false);

    // 3. Downloads 等非标准目录禁止自动替换
    const downloads = await resolveMacAppTarget(path.join(fakeHome, "Downloads/智枢.app/Contents/MacOS/智枢"), fakeHome);
    assert.equal(downloads?.canAutoReplace, false);

    // 4. 辅助替换脚本复核 DMG 摘要后以 0o700 落盘并通过位置参数传参（无命令注入）
    const cacheDir = path.join(root, "updates");
    await mkdir(cacheDir, { recursive: true });
    const dmgPath = path.join(cacheDir, "ZhiShu-Desktop-2.1.2-macOS-arm64.dmg");
    const dmgBytes = Buffer.from("verified-dmg-bytes");
    await writeFile(dmgPath, dmgBytes);
    const helper = await prepareMacReplaceHelper({
      cacheDir,
      dmgPath,
      expectedSha256: sha256Hex(dmgBytes),
      targetAppPath: appDir,
      currentPid: 99999,
    });
    assert.equal(helper.command, "/bin/sh");
    assert.equal(helper.args[1], "99999");
    assert.equal(helper.args[2], dmgPath);
    assert.equal(helper.args[3], appDir);
    assert.equal((await lstat(helper.scriptPath)).mode & 0o777, 0o700);
    const scriptText = await readFile(helper.scriptPath, "utf8");
    assert.match(scriptText, /hdiutil attach/);
    assert.match(scriptText, /ditto "\$SRC_APP" "\$STAGING"/);
    assert.match(scriptText, /mv "\$BACKUP" "\$TARGET_APP"/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
