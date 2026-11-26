import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { compareDesktopVersions, fetchDesktopRelease, matchesUpdateInfo, selectDesktopRelease } = require("../build/desktop-releases.cjs");

function desktop(version, { draft = false, complete = true, platform = "darwin", signedFeed = false, withSums = false, digest } = {}) {
  const dmgName = `ZhiShu-Desktop-${version}-macOS-arm64.dmg`;
  const exeName = `ZhiShu-Desktop-${version}-Windows-x64.exe`;
  return {
    tag_name: `desktop-v${version}`, draft, prerelease: false,
    assets: complete ? platform === "darwin"
      ? [
          { name: dmgName, ...(digest ? { digest } : {}), size: 150000000 },
          ...(withSums ? [{ name: "SHA256SUMS.txt", size: 128 }] : []),
        ]
      : [
          ...(signedFeed ? [{ name: "latest.yml" }] : []),
          { name: exeName, ...(digest ? { digest } : {}), size: 130000000 },
          ...(withSums ? [{ name: "SHA256SUMS.txt", size: 128 }] : []),
        ]
      : [{ name: platform === "darwin" ? `ZhiShu-Desktop-${version}-macOS-arm64.zip` : "latest.yml" }],
  };
}

test("软件版本只从完整的 desktop Release 选取，忽略规则包、草稿和不完整安装包", () => {
  const releases = [
    { tag_name: "v9.0.0", assets: [{ name: "ZhiShu-Desktop-9.0.0-macOS-arm64.dmg" }] },
    desktop("1.4.0", { draft: true }),
    desktop("1.3.0", { complete: false }),
    desktop("1.2.0"), desktop("1.10.0"),
  ];
  assert.equal(selectDesktopRelease(releases, "darwin", "arm64")?.version, "1.10.0");
  assert.equal(selectDesktopRelease(releases, "darwin", "arm64")?.downloadUrl,
    "https://github.com/yadan177/ZhiShu/releases/download/desktop-v1.10.0/ZhiShu-Desktop-1.10.0-macOS-arm64.dmg");
  assert.equal(selectDesktopRelease(releases, "win32", "x64"), undefined);
  assert.equal(selectDesktopRelease(releases, "darwin", "x64"), undefined);
  assert.equal(compareDesktopVersions("1.10.0", "1.2.0"), 1);
  assert.equal(compareDesktopVersions("1.2.0", "1.2.0"), 0);
  assert.throws(() => compareDesktopVersions("1.2", "1.2.0"));
});

test("Windows 无更新清单时手动安装，有清单时仍核验自动更新资产", () => {
  const exe = "ZhiShu-Desktop-1.2.0-Windows-x64.exe";
  assert.equal(matchesUpdateInfo({ version: "1.2.0", files: [{ url: exe }] }, "1.2.0", "win32", "x64"), true);
  assert.equal(matchesUpdateInfo({ version: "1.2.0", files: [{ url: exe }, { url: "https://example.test/other.exe" }] }, "1.2.0", "win32", "x64"), false);
  assert.equal(matchesUpdateInfo({ version: "1.2.0", files: [{ url: exe }] }, "1.2.0", "darwin", "arm64"), false);
  assert.equal(matchesUpdateInfo({ version: "1.3.0", files: [{ url: exe }] }, "1.2.0", "win32", "x64"), false);
  assert.equal(selectDesktopRelease([desktop("1.2.0", { platform: "win32", complete: false })], "win32", "x64"), undefined);
  const manual = selectDesktopRelease([desktop("1.2.0", { platform: "win32" })], "win32", "x64");
  assert.equal(manual?.feedUrl, undefined);
  assert.equal(manual?.downloadUrl, "https://github.com/yadan177/ZhiShu/releases/download/desktop-v1.2.0/ZhiShu-Desktop-1.2.0-Windows-x64.exe");
  const automatic = selectDesktopRelease([desktop("1.2.0", { platform: "win32", signedFeed: true })], "win32", "x64");
  assert.equal(automatic?.feedUrl, "https://github.com/yadan177/ZhiShu/releases/download/desktop-v1.2.0/");
});

test("软件版本检查固定访问公开 GitHub Release 列表，不使用规则包的 latest 接口", async () => {
  let requested = "";
  const release = desktop("1.2.0", { platform: "win32" });
  const selected = await fetchDesktopRelease("win32", "x64", async (url) => {
    requested = url;
    return new Response(JSON.stringify([release]), { status: 200 });
  });
  assert.match(requested, /\/releases\?per_page=100$/);
  assert.equal(selected?.feedUrl, undefined);
  assert.equal(selected?.pageUrl, "https://github.com/yadan177/ZhiShu/releases/tag/desktop-v1.2.0");
  await assert.rejects(fetchDesktopRelease("win32", "x64", async () => new Response("unavailable", { status: 503 })), /HTTP 503/);
});

test("提取 SHA256SUMS.txt 与 GitHub Release 资产 digest 供应用内安全更新校验", () => {
  const hex = "a".repeat(64);
  const rel = selectDesktopRelease(
    [desktop("2.1.2", { platform: "darwin", withSums: true, digest: `sha256:${hex.toUpperCase()}` })],
    "darwin",
    "arm64",
  );
  assert.equal(rel?.installerName, "ZhiShu-Desktop-2.1.2-macOS-arm64.dmg");
  assert.equal(rel?.checksumUrl, "https://github.com/yadan177/ZhiShu/releases/download/desktop-v2.1.2/SHA256SUMS.txt");
  assert.equal(rel?.assetDigest, `sha256:${hex}`);
  assert.equal(rel?.expectedSize, 150000000);
});
