import { access } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  antigravityConfigRoot,
  antigravityMcpConfigPath,
  antigravityPluginRoot,
  antigravitySkillRoot,
} from "../../../adapters/antigravity/user-assets.ts";
import { codexMcpConfigPath, findCodexCli } from "../../../adapters/codex/user-assets.ts";
import { traeWorkSkillRoot } from "../../../adapters/traework/user-assets.ts";
import type { InstalledUserAsset } from "./asset-operations.ts";
import type { InstalledMcpRecord } from "./mcp-operations.ts";

export type AiToolId = "codex" | "antigravity" | "traework" | "generic";

export interface ToolInspection {
  id: AiToolId;
  name: string;
  available: boolean;
  experimental?: boolean;
  statusLabel: string;
  detail?: string;
  displayPath: string;
  paths: string[];
  capabilities: Array<"rules" | "plugin" | "skill" | "mcp">;
  counts: { plugins: number; skills: number; mcps: number };
}

interface ToolInspectorOptions {
  userHome?: string;
  codexHome?: string;
  findCli?: typeof findCodexCli;
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

export class ToolInspector {
  private readonly userHome: string;
  private readonly codexHome: string;
  private readonly findCli: typeof findCodexCli;

  constructor(options: ToolInspectorOptions = {}) {
    this.userHome = options.userHome ?? os.homedir();
    this.codexHome = options.codexHome ?? process.env.CODEX_HOME ?? path.join(this.userHome, ".codex");
    this.findCli = options.findCli ?? findCodexCli;
  }

  async inspect(
    installedAssets: readonly InstalledUserAsset[] = [],
    installedMcps: readonly InstalledMcpRecord[] = [],
  ): Promise<ToolInspection[]> {
    const sharedSkills = path.join(this.userHome, ".agents", "skills");
    const agyRoot = path.join(this.userHome, ".gemini");
    const agyConfig = antigravityConfigRoot(this.userHome);
    const traeRoot = path.join(this.userHome, ".trae-cn");
    const traeSkills = traeWorkSkillRoot(this.userHome);

    const [
      codexBinary,
      hasCodexHome,
      hasSharedSkills,
      hasAgyConfig,
      hasAgyRoot,
      hasTraeRoot,
      hasTraeApp,
    ] = await Promise.all([
      this.findCli().catch(() => undefined),
      pathExists(this.codexHome),
      pathExists(sharedSkills),
      pathExists(agyConfig),
      pathExists(agyRoot),
      pathExists(traeRoot),
      process.platform === "darwin" ? pathExists("/Applications/TRAE.app") : Promise.resolve(false),
    ]);

    const countFor = (toolId: AiToolId): { plugins: number; skills: number; mcps: number } => ({
      plugins: installedAssets.filter((item) => item.target.ideId === toolId && item.kind === "capability-plugin").length,
      skills: installedAssets.filter((item) => item.target.ideId === toolId && item.kind === "skill").length,
      mcps: installedMcps.filter((item) => item.toolId === toolId).length,
    });

    const codexAvailable = Boolean(codexBinary) || hasCodexHome || hasSharedSkills;
    const agyAvailable = hasAgyConfig || hasAgyRoot;
    const traeAvailable = hasTraeRoot || hasTraeApp;

    const sandboxPrefix = this.userHome !== os.homedir() ? "[沙盒] " : "";
    const shortPath = (target: string): string => {
      const relative = path.relative(this.userHome, target);
      if (relative && !relative.startsWith("..") && !path.isAbsolute(relative)) {
        return `${sandboxPrefix}~/${relative.split(path.sep).join("/")}`;
      }
      return target;
    };

    return [
      {
        id: "codex",
        name: "OpenAI Codex",
        available: codexAvailable,
        statusLabel: codexBinary ? "已就绪" : codexAvailable ? "目录已存在" : "未检测到",
        detail: codexBinary ? `CLI：${codexBinary}` : hasCodexHome ? "未找到 Codex CLI，支持独立 Skill 与 MCP" : undefined,
        displayPath: `${shortPath(sharedSkills)} · ${shortPath(this.codexHome)}`,
        paths: [sharedSkills, codexMcpConfigPath(this.codexHome)],
        capabilities: ["rules", "plugin", "skill", "mcp"],
        counts: countFor("codex"),
      },
      {
        id: "antigravity",
        name: "Antigravity",
        available: agyAvailable,
        statusLabel: agyAvailable ? "已就绪" : "未检测到",
        displayPath: shortPath(agyConfig),
        paths: [antigravitySkillRoot(this.userHome), antigravityPluginRoot(this.userHome), antigravityMcpConfigPath(this.userHome)],
        capabilities: ["rules", "plugin", "skill", "mcp"],
        counts: countFor("antigravity"),
      },
      {
        id: "traework",
        name: "TRAE / TraeWork",
        available: traeAvailable,
        experimental: true,
        statusLabel: traeAvailable ? "实验支持" : "未检测到",
        displayPath: shortPath(traeSkills),
        paths: [traeSkills],
        capabilities: ["rules", "skill"],
        counts: countFor("traework"),
      },
      {
        id: "generic",
        name: "通用标准目录",
        available: true,
        statusLabel: hasSharedSkills ? "已就绪" : "可初始化",
        displayPath: shortPath(sharedSkills),
        paths: [sharedSkills],
        capabilities: ["rules", "skill"],
        counts: countFor("generic"),
      },
    ];
  }
}
