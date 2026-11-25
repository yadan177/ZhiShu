import path from "node:path";

/** Antigravity 本机用户配置目录（Skills / Plugins / MCP）。 */
export function antigravityConfigRoot(userHome: string): string {
  return path.join(userHome, ".gemini", "config");
}

export function antigravitySkillRoot(userHome: string): string {
  return path.join(antigravityConfigRoot(userHome), "skills");
}

export function antigravityPluginRoot(userHome: string): string {
  return path.join(antigravityConfigRoot(userHome), "plugins");
}

export function antigravityMcpConfigPath(userHome: string): string {
  return path.join(antigravityConfigRoot(userHome), "mcp_config.json");
}

export function antigravityDelivery(
  source: { kind: string; name: string; version: string },
  files: Map<string, Buffer>,
): { name: string; kind: "skill" | "capability-plugin"; files: Map<string, Buffer> } {
  if (source.kind === "skill") {
    return { name: source.name, kind: "skill", files: new Map(files) };
  }
  return { name: source.name, kind: "capability-plugin", files: new Map(files) };
}
