export type AssetIde = "codex" | "antigravity" | "traework" | "generic";
export type McpToolId = "antigravity" | "codex";

export interface McpEnvField {
  key: string;
  label: string;
  required?: boolean;
  secret?: boolean;
  placeholder?: string;
}

export interface McpServerDefinition {
  schemaVersion: 1;
  id: string;
  title: string;
  version: string;
  transport: "stdio" | "http";
  command?: string;
  args?: string[];
  url?: string;
  envSchema: McpEnvField[];
  preset?: boolean;
}

export interface InstalledMcpRecord {
  schemaVersion: 1;
  id: string;
  title: string;
  version: string;
  toolId: McpToolId;
  targetPath: string;
  transport: "stdio" | "http";
  installedAt: string;
  managedEntryDigest: string;
  envKeys: string[];
  secretKeys: string[];
  issues: string[];
}

export interface McpPreview {
  token: string;
  action: "install" | "update" | "uninstall";
  toolId: McpToolId;
  id: string;
  title: string;
  version: string;
  targetPath: string;
  maskedBefore: string;
  maskedAfter: string;
  conflicts: string[];
}

export interface ToolInspection {
  id: AssetIde;
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

export interface InstalledAssetRecord {
  id: string;
  title: string;
  kind: string;
  version: string;
  sourceKey: string;
  destination: string;
  target: { ideId: AssetIde };
  issues: string[];
  recognition: string;
  recognitionNote?: string;
  runtimeVerified: false;
}

export interface UserAssetPlan {
  token: string;
  action: "install" | "update" | "uninstall";
  ideId: string;
  title: string;
  version: string;
  destination: string;
  conflicts: string[];
  retainedPaths: string[];
  changes: { path: string; action: string; before?: string; after?: string }[];
}

export interface AssetsApi {
  listPluginImports(): Promise<PluginSource[]>;
  readPluginSkill?(key: string, skillSlug: string): Promise<{ slug: string; title: string; content: string }>;
  inspectPluginSource(): Promise<PluginSource | undefined>;
  importPluginSource(): Promise<PluginSource>;
  exportTraeWorkSkill(key: string): Promise<{ path: string; sha256?: string } | undefined>;
  listUserAssets(): Promise<InstalledAssetRecord[]>;
  previewUserAsset(action: UserAssetPlan["action"], key: string, ide: AssetIde, id?: string): Promise<UserAssetPlan>;
  applyUserAsset(token: string): Promise<InstalledAssetRecord[]>;
  inspectTools(): Promise<ToolInspection[]>;
  listMcpCatalog(): Promise<McpServerDefinition[]>;
  saveCustomMcp(definition: McpServerDefinition): Promise<McpServerDefinition[]>;
  removeCustomMcp(id: string): Promise<McpServerDefinition[]>;
  listInstalledMcps(): Promise<InstalledMcpRecord[]>;
  previewMcp(
    action: "install" | "update" | "uninstall",
    serverId: string,
    toolId: McpToolId,
    envValues?: Record<string, string>,
  ): Promise<McpPreview>;
  applyMcp(token: string): Promise<InstalledMcpRecord[]>;
}

export type PlatformChoice = "codex" | "antigravity" | "trae" | "qoder" | "cursor" | "workbuddy";
export type RuleMode = "install" | "update" | "uninstall";
export type ActiveView = "projects" | "rules" | "assets" | "tools" | "sources";

export type RuleSourceChoice =
  | { type: "github"; repository?: string }
  | { type: "workspace"; path: string };

export interface InstallRequest {
  rulepacks: string[];
  targets: PlatformChoice[];
  source?: RuleSourceChoice;
}

export interface DetectionEvidence {
  path: string;
  reason: string;
}

export interface DetectedStack {
  id: string;
  confidence: "high" | "medium";
  evidence: DetectionEvidence[];
}

export interface DetectionResult {
  root: string;
  stacks: DetectedStack[];
}

export interface RulePackManifest {
  id: string;
  version: string;
  status: "scaffolded" | "ready" | "deprecated";
  kind: "development" | "documentation" | "common";
  entry: string | null;
  dependencies: string[];
  rules: string[];
}

export interface WorkspaceSourceInfo {
  root: string;
  packs: RulePackManifest[];
}

export interface Change {
  path: string;
  action: "add" | "modify" | "remove";
  before?: string;
  after?: string;
}

export interface Issue {
  code: string;
  message: string;
}

export interface ProjectStatus {
  root: string;
  installed: boolean;
  valid: boolean;
  rulepacks: string[];
  targets: PlatformChoice[];
  version?: string;
  sourceType?: "github" | "workspace";
  sourceLabel?: string;
  overridesPath?: string;
  overridesExists?: boolean;
  interruptedTransactions: string[];
  detection: DetectionResult;
  recommendedRulepacks: string[];
  issues: Issue[];
}

export interface RegisteredProject {
  root: string;
  addedAt: string;
  status?: ProjectStatus;
  error?: string;
}

export interface UpdateCheck {
  root: string;
  currentVersion: string;
  latestVersion: string;
  available: boolean;
  targetsChanged: boolean;
  rulepacksChanged?: boolean;
}

export interface Preview {
  kind: RuleMode;
  root: string;
  changes: Change[];
  retainedPaths: string[];
  conflicts: Issue[];
  version?: string;
  targets: PlatformChoice[];
  rulepacks?: string[];
  sourceType?: "github" | "workspace";
}

export interface SoftwareUpdateState {
  phase: "idle" | "checking" | "current" | "available" | "downloading" | "ready" | "manual" | "error";
  currentVersion: string;
  availableVersion?: string;
  percent?: number;
  message?: string;
}

export interface PluginSource {
  kind: "skill" | "capability-plugin";
  key: string;
  name: string;
  version: string;
  title: string;
  author: string;
  license: string;
  sourceRoot: string;
  skills: string[];
  files: { path: string; bytes: number; sha256: string }[];
  sourceDigest: string;
  runtimeDependencies: string[];
  delivery: "traework-skill" | "unsupported";
  preset?: boolean;
  description?: string;
  ruleCategories?: string[];
  skillTitles?: Record<string, string>;
}

export type SourceTier = "enterprise" | "personal" | "official";
export type SourceAccessKind = "local" | "git" | "github-release";

export interface AssetSourceRecord {
  schemaVersion: 1;
  id: string;
  name: string;
  tier: SourceTier;
  access: SourceAccessKind;
  location: string;
  branch?: string;
  readonly?: boolean;
  requiredRulepacks: string[];
  hasLocalToken?: boolean;
  maskedToken?: string;
  lastSyncedAt?: string;
  localCheckoutPath?: string;
  availableRulepacks?: string[];
}

export interface AddSourceInput {
  id: string;
  name: string;
  tier: "enterprise" | "personal";
  access: "local" | "git";
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

export type DesktopApi = AssetsApi & {
  listSources(): Promise<AssetSourceRecord[]>;
  chooseSourceDir(): Promise<string | undefined>;
  addSource(input: AddSourceInput): Promise<AssetSourceRecord[]>;
  removeSource(id: string): Promise<AssetSourceRecord[]>;
  testSource(input: TestSourceInput): Promise<SourceTestResult>;
  syncSource(id: string): Promise<{ sources: AssetSourceRecord[]; message: string }>;
  chooseProject(): Promise<ProjectStatus | undefined>;
  listProjects(): Promise<RegisteredProject[]>;
  selectProject(root: string): Promise<ProjectStatus>;
  forgetProject(root: string): Promise<void>;
  inspectProject(): Promise<ProjectStatus>;
  recoverProject(root?: string): Promise<{ status: ProjectStatus; recoveredPath?: string }>;
  getDefaultWorkspaceSource(): Promise<WorkspaceSourceInfo | undefined>;
  chooseWorkspaceSource(): Promise<WorkspaceSourceInfo | undefined>;
  inspectWorkspaceSource(sourcePath: string): Promise<WorkspaceSourceInfo>;
  previewInstall(request: InstallRequest): Promise<Preview>;
  applyInstall(): Promise<ProjectStatus>;
  checkUpdate(platforms?: PlatformChoice[], rulepacks?: string[]): Promise<UpdateCheck>;
  previewUpdate(): Promise<Preview>;
  applyUpdate(): Promise<ProjectStatus>;
  previewUninstall(): Promise<Preview>;
  applyUninstall(): Promise<ProjectStatus>;
  clearPreview(): Promise<void>;
  getSoftwareUpdate(): Promise<SoftwareUpdateState>;
  checkSoftwareUpdate(): Promise<SoftwareUpdateState>;
  downloadSoftwareUpdate(): Promise<SoftwareUpdateState>;
  installSoftwareUpdate(): Promise<void>;
  openSoftwareDownload(): Promise<void>;
  onSoftwareUpdate(listener: (state: SoftwareUpdateState) => void): () => void;
};

declare global {
  interface Window {
    zhishu?: DesktopApi;
  }
}

export function formatErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message.replace(/^Error invoking remote method '[^']+': Error: /, "");
  }
  return String(error);
}
