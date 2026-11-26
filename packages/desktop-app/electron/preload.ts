import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("zhishu", {
  listUserAssets: () => ipcRenderer.invoke("assets:list"),
  inspectLegacyAssets: () => ipcRenderer.invoke("assets:inspect-legacy"),
  adoptLegacyAssets: (keys?: string[]) => ipcRenderer.invoke("assets:adopt-legacy", keys),
  previewUserAsset: (action: string, key: string, ide: string, id?: string) => ipcRenderer.invoke("assets:preview", action, key, ide, id),
  applyUserAsset: (token: string) => ipcRenderer.invoke("assets:apply", token),
  inspectTools: () => ipcRenderer.invoke("tools:inspect"),
  listMcpCatalog: () => ipcRenderer.invoke("mcp:catalog"),
  saveCustomMcp: (definition: unknown) => ipcRenderer.invoke("mcp:save-custom", definition),
  removeCustomMcp: (id: string) => ipcRenderer.invoke("mcp:remove-custom", id),
  listInstalledMcps: () => ipcRenderer.invoke("mcp:list"),
  previewMcp: (action: string, serverId: string, toolId: string, envValues?: Record<string, string>) =>
    ipcRenderer.invoke("mcp:preview", action, serverId, toolId, envValues),
  applyMcp: (token: string) => ipcRenderer.invoke("mcp:apply", token),
  listSources: () => ipcRenderer.invoke("sources:list"),
  chooseSourceDir: () => ipcRenderer.invoke("sources:choose-dir"),
  addSource: (input: unknown) => ipcRenderer.invoke("sources:add", input),
  removeSource: (id: string) => ipcRenderer.invoke("sources:remove", id),
  testSource: (input: unknown) => ipcRenderer.invoke("sources:test", input),
  syncSource: (id: string) => ipcRenderer.invoke("sources:sync", id),
  listEvolutionProposals: () => ipcRenderer.invoke("evolution:list"),
  getEvolutionWatchSources: () => ipcRenderer.invoke("evolution:watch-sources"),
  saveEvolutionWatchSources: (sources: unknown) => ipcRenderer.invoke("evolution:save-watch-sources", sources),
  scanEvolutionOverrides: (workspaceRoot?: string) => ipcRenderer.invoke("evolution:scan-overrides", workspaceRoot),
  watchEvolutionDocs: (options?: unknown) => ipcRenderer.invoke("evolution:watch-docs", options),
  cancelEvolutionWatch: () => ipcRenderer.invoke("evolution:cancel-watch"),
  importEvolutionProposal: (workspaceRoot?: string) => ipcRenderer.invoke("evolution:import-proposal", workspaceRoot),
  recheckEvolutionProposal: (proposalId: string, targetSource: unknown) =>
    ipcRenderer.invoke("evolution:recheck", proposalId, targetSource),
  previewEvolutionProposal: (proposalId: string, targetSource: unknown, editedPatch?: unknown) =>
    ipcRenderer.invoke("evolution:preview", proposalId, targetSource, editedPatch),
  applyEvolutionProposal: (token: string) => ipcRenderer.invoke("evolution:apply", token),
  rejectEvolutionProposal: (proposalId: string, reason?: string) =>
    ipcRenderer.invoke("evolution:reject", proposalId, reason),
  exportEvolutionPatch: (proposalId: string, targetSourceRoot?: string) =>
    ipcRenderer.invoke("evolution:export-patch", proposalId, targetSourceRoot),
  onEvolutionWatchProgress: (listener: (progress: unknown) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, progress: unknown) => listener(progress);
    ipcRenderer.on("evolution:watch-progress", handler);
    return () => ipcRenderer.removeListener("evolution:watch-progress", handler);
  },
  listPluginImports: () => ipcRenderer.invoke("plugins:list"),
  readPluginSkill: (key: string, skillSlug: string) => ipcRenderer.invoke("plugins:read-skill", key, skillSlug),
  inspectPluginSource: () => ipcRenderer.invoke("plugins:inspect"),
  importPluginSource: () => ipcRenderer.invoke("plugins:import"),
  exportTraeWorkSkill: (key: string) => ipcRenderer.invoke("plugins:export-traework", key),
  chooseProject: () => ipcRenderer.invoke("project:choose"),
  listProjects: () => ipcRenderer.invoke("project:list"),
  selectProject: (root: string) => ipcRenderer.invoke("project:select", root),
  forgetProject: (root: string) => ipcRenderer.invoke("project:forget", root),
  inspectProject: () => ipcRenderer.invoke("project:inspect"),
  recoverProject: (root?: string) => ipcRenderer.invoke("project:recover", root),
  getDefaultWorkspaceSource: () => ipcRenderer.invoke("rules:default-workspace-source"),
  chooseWorkspaceSource: () => ipcRenderer.invoke("rules:choose-workspace-source"),
  inspectWorkspaceSource: (sourcePath: string) => ipcRenderer.invoke("rules:inspect-workspace-source", sourcePath),
  previewInstall: (stackOrRequest: unknown, platforms?: string[]) => ipcRenderer.invoke("rules:preview-install", stackOrRequest, platforms),
  applyInstall: () => ipcRenderer.invoke("rules:apply-install"),
  checkUpdate: (platforms?: string[], rulepacks?: string[]) => ipcRenderer.invoke("rules:check-update", platforms, rulepacks),
  previewUpdate: () => ipcRenderer.invoke("rules:preview-update"),
  applyUpdate: () => ipcRenderer.invoke("rules:apply-update"),
  previewUninstall: () => ipcRenderer.invoke("rules:preview-uninstall"),
  applyUninstall: () => ipcRenderer.invoke("rules:apply-uninstall"),
  clearPreview: () => ipcRenderer.invoke("rules:clear-preview"),
  getSoftwareUpdate: () => ipcRenderer.invoke("software-update:state"),
  checkSoftwareUpdate: () => ipcRenderer.invoke("software-update:check"),
  downloadSoftwareUpdate: () => ipcRenderer.invoke("software-update:download"),
  installSoftwareUpdate: () => ipcRenderer.invoke("software-update:install"),
  openSoftwareDownload: () => ipcRenderer.invoke("software-update:open-download"),
  onSoftwareUpdate: (listener: (state: unknown) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, state: unknown) => listener(state);
    ipcRenderer.on("software-update:state", handler);
    return () => ipcRenderer.removeListener("software-update:state", handler);
  },
});
