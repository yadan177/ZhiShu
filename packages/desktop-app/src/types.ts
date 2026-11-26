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
  sourceDigest?: string;
  destination: string;
  target: { ideId: AssetIde };
  issues: string[];
  recognition: string;
  recognitionNote?: string;
  runtimeVerified: false;
}

export interface LegacyAssetCandidate {
  key: string;
  kind: "legacy-receipt" | "unmanaged-official";
  assetKind: "skill" | "capability-plugin";
  ideId: AssetIde;
  id: string;
  title: string;
  version: string;
  destination: string;
  originLabel: string;
  issues: string[];
}

export interface LegacyAdoptResult {
  adoptedCount: number;
  assets: InstalledAssetRecord[];
  legacy: LegacyAssetCandidate[];
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
  inspectLegacyAssets?(): Promise<LegacyAssetCandidate[]>;
  adoptLegacyAssets?(keys?: string[]): Promise<LegacyAdoptResult>;
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
export type ActiveView = "projects" | "rules" | "assets" | "tools" | "sources" | "evolution";

export type EvolutionChannel = "session-capture" | "overrides-promotion" | "docs-watch";
export type EvolutionTargetKind = "rule" | "skill";
export type EvolutionOperation = "add-item" | "update-item" | "deprecate-item";
export type EvolutionStatus = "pending" | "conflict" | "stale" | "approved" | "rejected" | "archived";

export interface EvolutionEvidence {
  sourceLabel: string;
  summary: string;
  url?: string;
  verifiedAt?: string;
  projectNames?: string[];
}

export interface EvolutionAppliedReceipt {
  sourceId: string;
  sourceName: string;
  targetFilePath: string;
  appliedAt: string;
  beforeDigest: string;
  afterDigest: string;
  validated: boolean;
}

export interface EvolutionProposal {
  schemaVersion: 1;
  id: string;
  channel: EvolutionChannel;
  targetKind: EvolutionTargetKind;
  operation: EvolutionOperation;
  status: EvolutionStatus;
  title: string;
  summary?: string;
  targetRulepack?: string;
  targetPath: string;
  anchorHeading: string;
  beforeSnippet?: string;
  afterSnippet?: string;
  evidence: EvolutionEvidence[];
  fingerprint: string;
  targetBaseDigest?: string;
  createdAt: string;
  updatedAt: string;
  lastCheckedAt?: string;
  rejectionReason?: string;
  conflictMessages?: string[];
  appliedReceipt?: EvolutionAppliedReceipt;
}

export interface EvolutionCounts {
  badge: number;
  pendingTab: number;
  conflictTab: number;
  processedTab: number;
  total: number;
}

export interface EvolutionListResult {
  proposals: EvolutionProposal[];
  counts: EvolutionCounts;
}

export interface WatchSourceConfig {
  schemaVersion: 1;
  id: string;
  name: string;
  url: string;
  targetRulepack: string;
  targetPath: string;
  anchorHeading?: string;
  keywords: string[];
  enabled: boolean;
  lastCheckedAt?: string;
  lastStatus?: "ok" | "error";
  lastMessage?: string;
}

export interface EvolutionTargetSource {
  id: string;
  name: string;
  root?: string;
  readonly?: boolean;
}

export interface SimilarRuleMatch {
  lineNumber: number;
  text: string;
  similarity: number;
}

export interface EvolutionPatchEdit {
  anchorHeading?: string;
  beforeSnippet?: string;
  afterSnippet?: string;
}

export interface EvolutionPreview {
  token: string;
  proposalId: string;
  title: string;
  channel: EvolutionChannel;
  targetKind: EvolutionTargetKind;
  operation: EvolutionOperation;
  targetSource: EvolutionTargetSource;
  targetPath: string;
  targetFilePath: string;
  anchorHeading: string;
  beforeSnippet?: string;
  afterSnippet?: string;
  beforeContent: string;
  afterContent: string;
  beforeDigest: string;
  afterDigest: string;
  lineCountBefore: number;
  lineCountAfter: number;
  lineBudget: number;
  overBudget: boolean;
  similarItems: SimilarRuleMatch[];
  conflicts: string[];
  validationChecks: string[];
}

export interface EvolutionWatchProgress {
  completed: number;
  total: number;
  currentSourceName: string;
}

export interface EvolutionScanSummary {
  scannedCount: number;
  skippedProjects: { root: string; reason: string }[];
  createdCount: number;
  foldedCount: number;
  list: EvolutionListResult;
}

export interface DocsWatchSourceResult {
  sourceId: string;
  sourceName: string;
  url: string;
  status: "ok" | "error" | "cancelled";
  hasDiff: boolean;
  message: string;
}

export interface EvolutionWatchSummary {
  checkedCount: number;
  succeededCount: number;
  failedCount: number;
  cancelled: boolean;
  createdCount: number;
  foldedCount: number;
  results: DocsWatchSourceResult[];
  watchSources: WatchSourceConfig[];
  list: EvolutionListResult;
}

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
  phase:
    | "idle"
    | "checking"
    | "current"
    | "available"
    | "downloading"
    | "verifying"
    | "ready"
    | "installing"
    | "manual"
    | "error";
  currentVersion: string;
  availableVersion?: string;
  percent?: number;
  installMode?: "auto-replace" | "open-installer" | "electron-updater";
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
  listEvolutionProposals(): Promise<EvolutionListResult>;
  getEvolutionWatchSources(): Promise<WatchSourceConfig[]>;
  saveEvolutionWatchSources(sources: WatchSourceConfig[]): Promise<WatchSourceConfig[]>;
  scanEvolutionOverrides(workspaceRoot?: string): Promise<EvolutionScanSummary>;
  watchEvolutionDocs(options?: { sourceIds?: string[]; workspaceRoot?: string }): Promise<EvolutionWatchSummary>;
  cancelEvolutionWatch(): Promise<{ cancelled: boolean }>;
  importEvolutionProposal(
    workspaceRoot?: string,
  ): Promise<{ outcome: "created" | "duplicate" | "previously-rejected"; proposal?: EvolutionProposal; list: EvolutionListResult } | undefined>;
  recheckEvolutionProposal(
    proposalId: string,
    targetSource: EvolutionTargetSource,
  ): Promise<{ proposal: EvolutionProposal; conflicts: string[]; list: EvolutionListResult }>;
  previewEvolutionProposal(
    proposalId: string,
    targetSource: EvolutionTargetSource,
    editedPatch?: EvolutionPatchEdit,
  ): Promise<EvolutionPreview>;
  applyEvolutionProposal(
    token: string,
  ): Promise<{ proposal: EvolutionProposal; receipt: EvolutionAppliedReceipt; list: EvolutionListResult }>;
  rejectEvolutionProposal(
    proposalId: string,
    reason?: string,
  ): Promise<{ proposal: EvolutionProposal; list: EvolutionListResult }>;
  exportEvolutionPatch(
    proposalId: string,
    targetSourceRoot?: string,
  ): Promise<{ path: string; sha256: string } | undefined>;
  onEvolutionWatchProgress(listener: (progress: EvolutionWatchProgress) => void): () => void;
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
  cancelSoftwareDownload?(): Promise<SoftwareUpdateState>;
  installSoftwareUpdate(): Promise<SoftwareUpdateState | void>;
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
