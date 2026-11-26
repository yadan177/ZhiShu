export type DesktopRelease = {
  version: string;
  tag: string;
  installerName: string;
  pageUrl: string;
  downloadUrl: string;
  checksumUrl?: string;
  assetDigest?: string;
  expectedSize?: number;
  feedUrl?: string;
};

type GithubAsset = { name?: unknown; digest?: unknown; size?: unknown };
type GithubRelease = {
  tag_name?: unknown;
  draft?: unknown;
  prerelease?: unknown;
  assets?: unknown;
};

const repository = "yadan177/ZhiShu";
const releaseTag = /^desktop-v(\d+)\.(\d+)\.(\d+)$/;
const sha256DigestPattern = /^sha256:([a-f0-9]{64})$/i;

function parts(version: string): number[] | undefined {
  const matched = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  return matched?.slice(1).map(Number);
}

export function compareDesktopVersions(left: string, right: string): number {
  const a = parts(left);
  const b = parts(right);
  if (!a || !b || [...a, ...b].some((part) => !Number.isSafeInteger(part))) throw new Error("桌面应用版本号无效");
  for (let index = 0; index < 3; index++) {
    if (a[index] !== b[index]) return a[index] > b[index] ? 1 : -1;
  }
  return 0;
}

export function matchesUpdateInfo(info: { version?: unknown; files?: { url?: unknown }[] }, version: string, platform: NodeJS.Platform, arch: string): boolean {
  if (platform !== "win32" || arch !== "x64") return false;
  if (info.version !== version || !Array.isArray(info.files)) return false;
  const expected = `ZhiShu-Desktop-${version}-Windows-x64.exe`;
  const names = info.files.map((file) => file?.url);
  if (!names.includes(expected)) return false;
  return names.every((name) => name === expected);
}

function installerName(version: string, platform: NodeJS.Platform, arch: string): string | undefined {
  if (platform === "darwin" && arch === "arm64") return `ZhiShu-Desktop-${version}-macOS-arm64.dmg`;
  if (platform === "win32" && arch === "x64") return `ZhiShu-Desktop-${version}-Windows-x64.exe`;
  return undefined;
}

export function selectDesktopRelease(data: unknown, platform: NodeJS.Platform, arch: string): DesktopRelease | undefined {
  if (!Array.isArray(data)) throw new Error("软件版本服务返回的数据无效");
  let selected: DesktopRelease | undefined;
  for (const item of data as GithubRelease[]) {
    if (!item || item.draft || item.prerelease || typeof item.tag_name !== "string") continue;
    const matched = releaseTag.exec(item.tag_name);
    if (!matched) continue;
    const version = matched.slice(1).join(".");
    if (!parts(version)?.every(Number.isSafeInteger)) continue;
    const installer = installerName(version, platform, arch);
    if (!installer || !Array.isArray(item.assets)) continue;
    const assetsByName = new Map<string, GithubAsset>();
    for (const asset of item.assets as GithubAsset[]) {
      if (asset && typeof asset.name === "string") assetsByName.set(asset.name, asset);
    }
    const matchedAsset = assetsByName.get(installer);
    if (!matchedAsset) continue;
    if (selected && compareDesktopVersions(version, selected.version) <= 0) continue;
    const tag = item.tag_name;
    const rawDigest = typeof matchedAsset.digest === "string" ? sha256DigestPattern.exec(matchedAsset.digest) : null;
    const expectedSize =
      typeof matchedAsset.size === "number" && Number.isSafeInteger(matchedAsset.size) && matchedAsset.size > 0
        ? matchedAsset.size
        : undefined;
    selected = {
      version,
      tag,
      installerName: installer,
      pageUrl: `https://github.com/${repository}/releases/tag/${tag}`,
      downloadUrl: `https://github.com/${repository}/releases/download/${tag}/${installer}`,
      ...(assetsByName.has("SHA256SUMS.txt")
        ? { checksumUrl: `https://github.com/${repository}/releases/download/${tag}/SHA256SUMS.txt` }
        : {}),
      ...(rawDigest?.[1] ? { assetDigest: `sha256:${rawDigest[1].toLowerCase()}` } : {}),
      ...(expectedSize !== undefined ? { expectedSize } : {}),
      ...(platform === "win32" && assetsByName.has("latest.yml")
        ? { feedUrl: `https://github.com/${repository}/releases/download/${tag}/` }
        : {}),
    };
  }
  return selected;
}

export async function fetchDesktopRelease(platform: NodeJS.Platform, arch: string, fetcher: typeof fetch = fetch): Promise<DesktopRelease | undefined> {
  const response = await fetcher(`https://api.github.com/repos/${repository}/releases?per_page=100`, {
    headers: { Accept: "application/vnd.github+json", "User-Agent": "ZhiShu-Desktop" },
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error(`检查软件版本失败（HTTP ${response.status}）`);
  return selectDesktopRelease(await response.json(), platform, arch);
}
