import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { access, chmod, constants, lstat, mkdir, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { DesktopRelease } from "./desktop-releases.ts";
import { formatGitHubNetworkError } from "./resilient-fetch.ts";

const TRUSTED_RELEASE_PATH_PREFIX = "/yadan177/ZhiShu/releases/download/";
const TRUSTED_REDIRECT_HOSTS = new Set([
  "github.com",
  "objects.githubusercontent.com",
  "release-assets.githubusercontent.com",
  "github-releases.githubusercontent.com",
]);
const MAX_REDIRECTS = 5;
const MAX_CHECKSUM_BYTES = 64 * 1024;
const DEFAULT_MAX_INSTALLER_BYTES = 512 * 1024 * 1024;
const CONNECT_TIMEOUT_MS = 25_000;
const STREAM_IDLE_TIMEOUT_MS = 45_000;
const HEX_64 = /^[a-f0-9]{64}$/i;

function combineSignalWithTimeout(signal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
}

async function readChunkWithIdleTimeout(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  idleMs: number,
  signal?: AbortSignal,
): Promise<ReadableStreamReadResult<Uint8Array>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  try {
    return await Promise.race([
      reader.read(),
      new Promise<never>((_resolve, reject) => {
        if (signal?.aborted) {
          reject(new Error("已取消软件更新下载"));
          return;
        }
        onAbort = () => reject(new Error("已取消软件更新下载"));
        signal?.addEventListener("abort", onAbort, { once: true });
        timer = setTimeout(() => {
          const err = new Error("下载长时间无响应（超时），请检查网络后重试");
          err.name = "TimeoutError";
          reject(err);
        }, idleMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
    if (onAbort) signal?.removeEventListener("abort", onAbort);
  }
}

export interface DownloadedInstaller {
  filePath: string;
  sha256: string;
  size: number;
  cached: boolean;
}

export interface MacAppTarget {
  appPath: string;
  canAutoReplace: boolean;
}

export function normalizeSha256(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  const raw = trimmed.toLowerCase().startsWith("sha256:") ? trimmed.slice(7) : trimmed;
  return HEX_64.test(raw) ? raw.toLowerCase() : undefined;
}

export function parseSha256Sums(content: string, filename: string): string | undefined {
  if (!filename || filename.includes("/") || filename.includes("\\") || filename.includes("\0")) return undefined;
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = /^([a-fA-F0-9]{64})\s+\*?(.+)$/.exec(line);
    if (!match?.[1] || !match[2]) continue;
    const entryName = match[2].trim();
    if (entryName === filename) return match[1].toLowerCase();
  }
  return undefined;
}

export function isTrustedDownloadUrl(rawUrl: string, initialOnly = false): boolean {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:") return false;
  if (initialOnly) {
    return parsed.hostname === "github.com" && parsed.pathname.startsWith(TRUSTED_RELEASE_PATH_PREFIX);
  }
  if (parsed.hostname === "github.com") {
    return parsed.pathname.startsWith(TRUSTED_RELEASE_PATH_PREFIX);
  }
  return TRUSTED_REDIRECT_HOSTS.has(parsed.hostname);
}

async function fetchTrusted(
  initialUrl: string,
  options: { fetcher?: typeof fetch; signal?: AbortSignal; maxRedirects?: number } = {},
): Promise<Response> {
  const fetcher = options.fetcher ?? fetch;
  const maxRedirects = options.maxRedirects ?? MAX_REDIRECTS;
  if (!isTrustedDownloadUrl(initialUrl, true)) {
    throw new Error("软件下载地址不在受信任的 GitHub Release 范围内");
  }
  let currentUrl = initialUrl;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const response = await fetcher(currentUrl, {
      redirect: "manual",
      headers: { "User-Agent": "ZhiShu-Desktop" },
      signal: combineSignalWithTimeout(options.signal, CONNECT_TIMEOUT_MS),
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new Error("下载重定向缺少目标地址");
      const nextUrl = new URL(location, currentUrl).toString();
      if (!isTrustedDownloadUrl(nextUrl, false)) {
        throw new Error("下载重定向指向不受信任的域名，已拦截");
      }
      currentUrl = nextUrl;
      continue;
    }
    if (!response.ok) {
      throw new Error(`下载软件更新失败（HTTP ${response.status}）`);
    }
    return response;
  }
  throw new Error("下载重定向次数过多，已中止");
}

async function assertSafeDirectory(directory: string): Promise<void> {
  if (!path.isAbsolute(directory)) throw new Error("更新缓存目录必须是绝对路径");
  let current = path.parse(directory).root;
  for (const segment of directory.slice(current.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    try {
      const info = await lstat(current);
      if (!info.isDirectory() || info.isSymbolicLink()) {
        throw new Error("更新缓存目录包含符号链接或非目录路径");
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
  }
}

export async function hashFileSha256(filePath: string): Promise<{ sha256: string; size: number }> {
  const info = await lstat(filePath);
  if (!info.isFile() || info.isSymbolicLink()) {
    throw new Error("安装包路径不是普通文件");
  }
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    let size = 0;
    const stream = createReadStream(filePath);
    stream.on("data", (chunk: Buffer | string) => {
      const buf = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
      size += buf.byteLength;
      hash.update(buf);
    });
    stream.on("error", reject);
    stream.on("end", () => resolve({ sha256: hash.digest("hex"), size }));
  });
}

export async function resolveExpectedSha256(
  release: DesktopRelease,
  options: { fetcher?: typeof fetch; signal?: AbortSignal } = {},
): Promise<string> {
  const apiHash = normalizeSha256(release.assetDigest);
  let sumsHash: string | undefined;
  if (release.checksumUrl) {
    const response = await fetchTrusted(release.checksumUrl, options);
    const text = await response.text();
    if (Buffer.byteLength(text, "utf8") > MAX_CHECKSUM_BYTES) {
      throw new Error("校验清单体积异常，已中止更新");
    }
    sumsHash = parseSha256Sums(text, release.installerName);
    if (!sumsHash) {
      throw new Error("校验清单中缺少当前平台安装包的 SHA-256 记录");
    }
  }
  if (apiHash && sumsHash && apiHash !== sumsHash) {
    throw new Error("安装包 SHA-256 校验摘要与发布清单不一致，已拒绝下载");
  }
  const resolved = sumsHash ?? apiHash;
  if (!resolved) {
    throw new Error("当前版本缺少 SHA-256 校验摘要，请改用浏览器手动下载");
  }
  return resolved;
}

function validateInstallerFilename(filename: string): void {
  if (!/^ZhiShu-Desktop-\d+\.\d+\.\d+-(?:macOS-arm64\.dmg|Windows-x64\.exe)$/.test(filename)) {
    throw new Error("安装包文件名格式无效");
  }
}

export async function downloadVerifiedInstaller(options: {
  release: DesktopRelease;
  cacheDir: string;
  fetcher?: typeof fetch;
  onProgress?: (percent: number) => void;
  onVerifying?: () => void;
  signal?: AbortSignal;
  maxBytes?: number;
}): Promise<DownloadedInstaller> {
  const { release, cacheDir, fetcher, onProgress, onVerifying, signal } = options;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_INSTALLER_BYTES;
  validateInstallerFilename(release.installerName);
  await assertSafeDirectory(cacheDir);
  await mkdir(cacheDir, { recursive: true });

  const expectedSha256 = await resolveExpectedSha256(release, { fetcher, signal });
  const targetPath = path.join(cacheDir, release.installerName);

  // 复用已校验完整的本地缓存安装包，避免重复下载。
  try {
    const cached = await hashFileSha256(targetPath);
    if (cached.sha256 === expectedSha256) {
      onProgress?.(100);
      return { filePath: targetPath, sha256: cached.sha256, size: cached.size, cached: true };
    }
    await rm(targetPath, { force: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      await rm(targetPath, { force: true });
    }
  }

  const response = await fetchTrusted(release.downloadUrl, { fetcher, signal });
  const headerLength = Number.parseInt(response.headers.get("content-length") ?? "", 10);
  const totalBytes = Number.isFinite(headerLength) && headerLength > 0 ? headerLength : release.expectedSize ?? 0;
  if (totalBytes > maxBytes) {
    throw new Error("安装包体积超过安全上限，已中止下载");
  }

  const partPath = `${targetPath}.${randomUUID()}.part`;
  const hash = createHash("sha256");
  let receivedBytes = 0;
  let lastReported = -1;
  const report = (percent: number): void => {
    const clamped = Math.max(0, Math.min(99, Math.floor(percent)));
    if (clamped !== lastReported) {
      lastReported = clamped;
      onProgress?.(clamped);
    }
  };

  const out = createWriteStream(partPath, { flags: "wx", mode: 0o600 });
  const streamFinished = new Promise<void>((resolve, reject) => {
    out.once("finish", resolve);
    out.once("error", reject);
  });
  // 防止异常路径未 await streamFinished 时产生未捕获 Rejection。
  streamFinished.catch(() => {});
  const closeWriteStream = (): Promise<void> =>
    new Promise((resolve) => {
      if (out.closed || out.destroyed) {
        resolve();
        return;
      }
      out.once("close", resolve);
      out.destroy();
    });

  try {
    if (response.body) {
      const reader = response.body.getReader();
      let readerActive = true;
      try {
        for (;;) {
          if (signal?.aborted) throw new Error("已取消软件更新下载");
          const { done, value } = await readChunkWithIdleTimeout(reader, STREAM_IDLE_TIMEOUT_MS, signal);
          if (done) {
            readerActive = false;
            break;
          }
          if (!value || value.byteLength === 0) continue;
          receivedBytes += value.byteLength;
          if (receivedBytes > maxBytes) {
            throw new Error("安装包体积超过安全上限，已中止下载");
          }
          hash.update(value);
          if (!out.write(value)) {
            await new Promise<void>((resolve, reject) => {
              const cleanupDrain = () => {
                out.off("drain", onDrain);
                out.off("error", onErr);
                signal?.removeEventListener("abort", onAbort);
              };
              const onDrain = () => { cleanupDrain(); resolve(); };
              const onErr = (err: Error) => { cleanupDrain(); reject(err); };
              const onAbort = () => { cleanupDrain(); reject(new Error("已取消软件更新下载")); };
              out.once("drain", onDrain);
              out.once("error", onErr);
              signal?.addEventListener("abort", onAbort, { once: true });
            });
          }
          if (totalBytes > 0) {
            report((receivedBytes / totalBytes) * 100);
          }
        }
      } finally {
        if (readerActive) {
          await reader.cancel().catch(() => {});
        }
        reader.releaseLock();
      }
    } else {
      const buf = Buffer.from(await response.arrayBuffer());
      receivedBytes = buf.byteLength;
      if (receivedBytes > maxBytes) {
        throw new Error("安装包体积超过安全上限，已中止下载");
      }
      hash.update(buf);
      out.write(buf);
    }

    if (signal?.aborted) throw new Error("已取消软件更新下载");
    out.end();
    await streamFinished;

    onVerifying?.();
    const actualSha256 = hash.digest("hex");
    if (actualSha256 !== expectedSha256) {
      throw new Error("安装包 SHA-256 校验失败，已清理损坏文件");
    }

    await rename(partPath, targetPath);

    // 清理旧版本的缓存安装包、残留 .part 与过期辅助脚本，避免缓存目录持续增长。
    try {
      for (const entry of await readdir(cacheDir)) {
        if (entry === release.installerName) continue;
        if (
          (entry.startsWith("ZhiShu-Desktop-") && (entry.endsWith(".dmg") || entry.endsWith(".exe") || entry.endsWith(".part"))) ||
          (entry.startsWith("apply-mac-update-") && entry.endsWith(".sh"))
        ) {
          await rm(path.join(cacheDir, entry), { force: true });
        }
      }
    } catch {
      // 清理旧缓存失败不影响新版本安装。
    }

    onProgress?.(100);
    return { filePath: targetPath, sha256: actualSha256, size: receivedBytes, cached: false };
  } catch (error) {
    await closeWriteStream();
    await rm(partPath, { force: true }).catch(() => {});
    if (signal?.aborted) throw new Error("已取消软件更新下载");
    throw formatGitHubNetworkError(error);
  }
}

export async function verifyInstallerBeforeLaunch(filePath: string, expectedSha256: string): Promise<void> {
  const expected = normalizeSha256(expectedSha256);
  if (!expected) throw new Error("缺少有效的 SHA-256 校验值");
  const { sha256 } = await hashFileSha256(filePath);
  if (sha256 !== expected) {
    throw new Error("已下载的安装包内容发生变化，拒绝执行，请重新下载");
  }
}

export async function resolveMacAppTarget(execPath: string, userHome: string): Promise<MacAppTarget | undefined> {
  const matched = /^(\/.+?\.app)\/Contents\/MacOS\/[^/]+$/.exec(execPath);
  if (!matched?.[1]) return undefined;
  const appPath = matched[1];
  if (appPath.includes("/AppTranslocation/")) {
    return { appPath, canAutoReplace: false };
  }
  const allowedParents = ["/Applications", path.join(userHome, "Applications")];
  const parentDir = path.dirname(appPath);
  if (!allowedParents.includes(parentDir)) {
    return { appPath, canAutoReplace: false };
  }
  try {
    const info = await lstat(appPath);
    if (!info.isDirectory() || info.isSymbolicLink()) {
      return { appPath, canAutoReplace: false };
    }
    await access(parentDir, constants.W_OK);
    await access(appPath, constants.W_OK);
    return { appPath, canAutoReplace: true };
  } catch {
    return { appPath, canAutoReplace: false };
  }
}

export function buildMacReplaceScript(): string {
  return [
    "#!/bin/sh",
    "set -eu",
    'PID="$1"',
    'DMG="$2"',
    'TARGET_APP="$3"',
    'SELF="$4"',
    'MNT=""',
    'STAGING=""',
    'BACKUP=""',
    "detach_mnt() {",
    '  if [ -n "$MNT" ]; then',
    '    hdiutil detach "$MNT" -quiet >/dev/null 2>&1 || hdiutil detach "$MNT" -force -quiet >/dev/null 2>&1 || true',
    '    rmdir "$MNT" >/dev/null 2>&1 || true',
    '    MNT=""',
    "  fi",
    "}",
    "fallback_open_dmg() {",
    "  detach_mnt",
    '  open "$DMG" >/dev/null 2>&1 || true',
    "  exit 1",
    "}",
    "cleanup() {",
    "  detach_mnt",
    '  if [ -n "$STAGING" ] && [ -e "$STAGING" ]; then rm -rf "$STAGING" >/dev/null 2>&1 || true; fi',
    '  rm -f "$SELF" >/dev/null 2>&1 || true',
    "}",
    "trap cleanup EXIT",
    "i=0",
    'while kill -0 "$PID" 2>/dev/null; do',
    "  i=$((i + 1))",
    '  if [ "$i" -ge 80 ]; then exit 1; fi',
    "  sleep 0.25",
    "done",
    'MNT="$(mktemp -d /tmp/zhishu-update-mnt.XXXXXX)"',
    'if ! hdiutil attach "$DMG" -nobrowse -noautoopen -readonly -mountpoint "$MNT" >/dev/null 2>&1; then',
    "  fallback_open_dmg",
    "fi",
    'SRC_APP="$MNT/智枢.app"',
    'if [ ! -d "$SRC_APP" ] || [ -L "$SRC_APP" ]; then',
    "  fallback_open_dmg",
    "fi",
    'STAGING="${TARGET_APP}.zhishu-next.$$"',
    'BACKUP="${TARGET_APP}.zhishu-prev.$$"',
    'if ! ditto "$SRC_APP" "$STAGING"; then',
    "  fallback_open_dmg",
    "fi",
    'if ! mv "$TARGET_APP" "$BACKUP"; then',
    "  fallback_open_dmg",
    "fi",
    'if ! mv "$STAGING" "$TARGET_APP"; then',
    '  mv "$BACKUP" "$TARGET_APP" >/dev/null 2>&1 || true',
    "  fallback_open_dmg",
    "fi",
    'rm -rf "$BACKUP" >/dev/null 2>&1 || true',
    "detach_mnt",
    'open -n "$TARGET_APP" >/dev/null 2>&1 || open "$TARGET_APP" >/dev/null 2>&1 || true',
    "",
  ].join("\n");
}

export async function prepareMacReplaceHelper(options: {
  cacheDir: string;
  dmgPath: string;
  expectedSha256: string;
  targetAppPath: string;
  currentPid: number;
  skipVerify?: boolean;
}): Promise<{ command: string; args: string[]; scriptPath: string }> {
  await assertSafeDirectory(options.cacheDir);
  if (!options.skipVerify) {
    await verifyInstallerBeforeLaunch(options.dmgPath, options.expectedSha256);
  }
  const scriptPath = path.join(options.cacheDir, `apply-mac-update-${randomUUID()}.sh`);
  await writeFile(scriptPath, buildMacReplaceScript(), { flag: "wx", mode: 0o700 });
  if (process.platform !== "win32") await chmod(scriptPath, 0o700);
  return {
    command: "/bin/sh",
    args: [scriptPath, String(options.currentPid), options.dmgPath, options.targetAppPath, scriptPath],
    scriptPath,
  };
}
