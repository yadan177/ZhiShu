import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import {
  OFFICIAL_SOURCE_ID,
  OFFICIAL_SOURCE_RECORD,
  assertAssetDirectory,
  assertAssetSourceRecord,
  assertValidGitLocation,
  findLatestRelease,
  listAvailableRulePacks,
  maskSecretValue,
  sortSourcesByPriority,
  type AssetSourceRecord,
  type SourceAccessKind,
  type SourceTier,
} from "../../core/src/index.ts";

const execFileAsync = promisify(execFile);

export interface AddSourceInput {
  id: string;
  name: string;
  tier: Exclude<SourceTier, "official">;
  access: Exclude<SourceAccessKind, "github-release">;
  location: string;
  branch?: string;
  requiredRulepacks?: string[];
  token?: string;
}

export interface TestSourceInput {
  id?: string;
  access: SourceAccessKind;
  location: string;
  branch?: string;
  token?: string;
}

export interface SourceTestResult {
  ok: boolean;
  message: string;
  packCount?: number;
  packs?: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await lstat(filePath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function atomicWriteJson(filePath: string, payload: unknown): Promise<void> {
  await assertAssetDirectory(path.dirname(filePath));
  await mkdir(path.dirname(filePath), { recursive: true });
  if (await exists(filePath)) {
    const info = await lstat(filePath);
    if (!info.isFile() || info.isSymbolicLink()) throw new Error(`配置文件不是普通文件：${filePath}`);
  }
  const temporary = `${filePath}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(payload, null, 2)}\n`, { flag: "wx", mode: 0o600 });
    await rename(temporary, filePath);
  } finally {
    await rm(temporary, { force: true });
  }
}

function gitEnvWithOptionalToken(location: string, token?: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    GIT_TERMINAL_PROMPT: "0",
  };
  // 仅对 HTTPS 地址通过环境变量临时注入 Header，绝不落盘至 .git/config 或命令行参数。
  if (token && location.startsWith("https://")) {
    env.GIT_CONFIG_COUNT = "1";
    env.GIT_CONFIG_KEY_0 = "http.extraHeader";
    env.GIT_CONFIG_VALUE_0 = `Authorization: Bearer ${token}`;
  }
  return env;
}

export class SourceManager {
  private readonly sourcesFile: string;
  private readonly secretsFile: string;
  private readonly checkoutsRoot: string;
  private running = false;

  constructor(private readonly stateRoot: string) {
    this.sourcesFile = path.join(stateRoot, "sources.json");
    this.secretsFile = path.join(stateRoot, "source-secrets.json");
    this.checkoutsRoot = path.join(stateRoot, "source-checkouts");
  }

  private async serialized<T>(action: () => Promise<T>): Promise<T> {
    if (this.running) throw new Error("来源管理操作正在进行，请稍候");
    this.running = true;
    try {
      return await action();
    } finally {
      this.running = false;
    }
  }

  private async loadStoredSources(): Promise<AssetSourceRecord[]> {
    await assertAssetDirectory(this.stateRoot);
    if (!(await exists(this.sourcesFile))) return [];
    const info = await lstat(this.sourcesFile);
    if (!info.isFile() || info.isSymbolicLink()) throw new Error("来源注册表文件无效");
    const parsed: unknown = JSON.parse(await readFile(this.sourcesFile, "utf8"));
    if (!isRecord(parsed) || parsed.schemaVersion !== 1 || !Array.isArray(parsed.sources)) {
      throw new Error("来源注册表文件已损坏");
    }
    const items: AssetSourceRecord[] = [];
    for (const item of parsed.sources) {
      assertAssetSourceRecord(item);
      if (item.id !== OFFICIAL_SOURCE_ID) items.push(item);
    }
    return items;
  }

  private async saveStoredSources(sources: AssetSourceRecord[]): Promise<void> {
    await atomicWriteJson(this.sourcesFile, { schemaVersion: 1, sources });
  }

  private async loadSecrets(): Promise<Record<string, string>> {
    await assertAssetDirectory(this.stateRoot);
    if (!(await exists(this.secretsFile))) return {};
    const info = await lstat(this.secretsFile);
    if (!info.isFile() || info.isSymbolicLink()) throw new Error("本机来源凭据文件无效");
    const parsed: unknown = JSON.parse(await readFile(this.secretsFile, "utf8"));
    if (!isRecord(parsed) || parsed.schemaVersion !== 1 || !isRecord(parsed.tokens)) {
      throw new Error("本机来源凭据文件已损坏");
    }
    const result: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed.tokens)) {
      if (typeof v === "string") result[k] = v;
    }
    return result;
  }

  private async saveSecrets(tokens: Record<string, string>): Promise<void> {
    await atomicWriteJson(this.secretsFile, { schemaVersion: 1, tokens });
  }

  async list(): Promise<AssetSourceRecord[]> {
    const stored = await this.loadStoredSources();
    return sortSourcesByPriority([...stored, OFFICIAL_SOURCE_RECORD]);
  }

  async add(input: AddSourceInput): Promise<AssetSourceRecord[]> {
    return this.serialized(async () => {
      if (input.id === OFFICIAL_SOURCE_ID) throw new Error("内置官方源标识不可复用");
      const trimmedToken = input.token?.trim();
      let resolvedLocation = input.location.trim();
      let availableRulepacks: string[] | undefined;
      let lastSyncedAt: string | undefined;

      if (input.access === "local") {
        if (!path.isAbsolute(resolvedLocation)) throw new Error("本地目录来源必须使用绝对路径");
        const info = await lstat(resolvedLocation);
        if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("本地来源必须是普通文件夹");
        resolvedLocation = await realpath(resolvedLocation);
        const packs = await listAvailableRulePacks(resolvedLocation);
        availableRulepacks = packs.map((pack) => pack.id);
        lastSyncedAt = new Date().toISOString();
      }

      const record: AssetSourceRecord = {
        schemaVersion: 1,
        id: input.id.trim(),
        name: input.name.trim(),
        tier: input.tier,
        access: input.access,
        location: resolvedLocation,
        ...(input.access === "git" && input.branch?.trim() ? { branch: input.branch.trim() } : {}),
        requiredRulepacks: input.tier === "enterprise" ? [...new Set(input.requiredRulepacks ?? [])] : [],
        ...(trimmedToken ? { hasLocalToken: true, maskedToken: maskSecretValue(trimmedToken) } : {}),
        ...(lastSyncedAt ? { lastSyncedAt } : {}),
        ...(availableRulepacks ? { availableRulepacks } : {}),
      };
      assertAssetSourceRecord(record);

      const existing = await this.loadStoredSources();
      if (existing.some((item) => item.id === record.id)) {
        throw new Error(`来源标识已存在：${record.id}`);
      }
      await this.saveStoredSources([...existing, record]);
      if (trimmedToken) {
        const secrets = await this.loadSecrets();
        secrets[record.id] = trimmedToken;
        await this.saveSecrets(secrets);
      }
      return this.list();
    });
  }

  async remove(id: string): Promise<AssetSourceRecord[]> {
    return this.serialized(async () => {
      if (id === OFFICIAL_SOURCE_ID) throw new Error("内置智枢官方源不可移除");
      const existing = await this.loadStoredSources();
      const next = existing.filter((item) => item.id !== id);
      if (next.length === existing.length) throw new Error(`未找到来源：${id}`);
      await this.saveStoredSources(next);
      const secrets = await this.loadSecrets();
      if (Object.hasOwn(secrets, id)) {
        delete secrets[id];
        await this.saveSecrets(secrets);
      }
      await rm(path.join(this.checkoutsRoot, id), { recursive: true, force: true });
      return this.list();
    });
  }

  async testConnection(input: TestSourceInput): Promise<SourceTestResult> {
    if (input.access === "github-release") {
      const release = await findLatestRelease(input.location);
      return { ok: true, message: `连接正常 · 最新版本 v${release.version}` };
    }
    if (input.access === "local") {
      if (!path.isAbsolute(input.location)) throw new Error("本地目录来源必须使用绝对路径");
      const info = await lstat(input.location);
      if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("本地来源必须是普通文件夹");
      const resolved = await realpath(input.location);
      const packs = await listAvailableRulePacks(resolved);
      return {
        ok: true,
        message: `目录有效 · 发现 ${packs.length} 个规则包`,
        packCount: packs.length,
        packs: packs.map((pack) => pack.id),
      };
    }
    assertValidGitLocation(input.location);
    let token = input.token?.trim();
    if (!token && input.id) {
      const secrets = await this.loadSecrets();
      token = secrets[input.id];
    }
    const args = ["ls-remote", "--heads", "--", input.location];
    if (input.branch?.trim()) args.push(input.branch.trim());
    const { stdout } = await execFileAsync("git", args, {
      timeout: 15000,
      maxBuffer: 1024 * 1024,
      env: gitEnvWithOptionalToken(input.location, token),
    });
    const refCount = stdout.split("\n").filter((line) => line.trim()).length;
    if (input.branch?.trim() && refCount === 0) {
      throw new Error(`未找到指定分支：${input.branch.trim()}`);
    }
    return {
      ok: true,
      message: input.branch?.trim() ? `Git 连接正常 · 分支 ${input.branch.trim()} 可用` : `Git 连接正常 · 发现 ${refCount} 个分支`,
    };
  }

  async sync(id: string): Promise<{ sources: AssetSourceRecord[]; message: string }> {
    return this.serialized(async () => {
      if (id === OFFICIAL_SOURCE_ID) {
        const release = await findLatestRelease(OFFICIAL_SOURCE_RECORD.location);
        return { sources: await this.list(), message: `官方源已检查 · 最新版本 v${release.version}` };
      }
      const existing = await this.loadStoredSources();
      const index = existing.findIndex((item) => item.id === id);
      const target = existing[index];
      if (index < 0 || !target) throw new Error(`未找到来源：${id}`);

      if (target.access === "local") {
        const packs = await listAvailableRulePacks(target.location);
        existing[index] = {
          ...target,
          lastSyncedAt: new Date().toISOString(),
          availableRulepacks: packs.map((pack) => pack.id),
        };
        await this.saveStoredSources(existing);
        return { sources: await this.list(), message: `本地源已刷新 · ${packs.length} 个规则包` };
      }

      assertValidGitLocation(target.location);
      const secrets = await this.loadSecrets();
      const token = secrets[target.id];
      const env = gitEnvWithOptionalToken(target.location, token);
      await assertAssetDirectory(this.checkoutsRoot);
      await mkdir(this.checkoutsRoot, { recursive: true });
      const checkoutDir = path.join(this.checkoutsRoot, target.id);
      const branch = target.branch?.trim();

      if (await exists(path.join(checkoutDir, ".git"))) {
        const fetchArgs = branch
          ? ["-C", checkoutDir, "fetch", "--depth", "1", "origin", branch]
          : ["-C", checkoutDir, "fetch", "--depth", "1", "origin"];
        await execFileAsync("git", fetchArgs, { timeout: 60000, maxBuffer: 4 * 1024 * 1024, env });
        await execFileAsync("git", ["-C", checkoutDir, "reset", "--hard", "FETCH_HEAD"], {
          timeout: 30000,
          maxBuffer: 2 * 1024 * 1024,
          env,
        });
      } else {
        await rm(checkoutDir, { recursive: true, force: true });
        const cloneArgs = ["clone", "--depth", "1"];
        if (branch) cloneArgs.push("--branch", branch);
        cloneArgs.push("--", target.location, checkoutDir);
        await execFileAsync("git", cloneArgs, { timeout: 60000, maxBuffer: 4 * 1024 * 1024, env });
      }

      const packs = await listAvailableRulePacks(checkoutDir);
      existing[index] = {
        ...target,
        localCheckoutPath: checkoutDir,
        lastSyncedAt: new Date().toISOString(),
        availableRulepacks: packs.map((pack) => pack.id),
      };
      await this.saveStoredSources(existing);
      return { sources: await this.list(), message: `Git 源同步完成 · ${packs.length} 个规则包` };
    });
  }
}
