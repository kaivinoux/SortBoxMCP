import { contextBridge, ipcRenderer } from "electron";
import type {
  AddAccountInput,
  AppSettings,
  McpActivityEvent,
  PlanApplyProgressEvent,
  SenderGroup,
  SenderQueryOptions,
  SortMoveItem,
  SortPlan,
  SyncProgressEvent,
} from "../shared/types.js";

const api = {
  accounts: {
    list: () => ipcRenderer.invoke("accounts:list"),
    detectProvider: (email: string) =>
      ipcRenderer.invoke("accounts:detectProvider", email),
    test: (input: AddAccountInput) => ipcRenderer.invoke("accounts:test", input),
    add: (input: AddAccountInput) => ipcRenderer.invoke("accounts:add", input),
    delete: (accountId: string) => ipcRenderer.invoke("accounts:delete", accountId),
    microsoftLogin: (clientId: string, loginHint?: string) =>
      ipcRenderer.invoke("accounts:microsoftLogin", clientId, loginHint),
    sync: (accountId: string, folderPath?: string, limit?: number) =>
      ipcRenderer.invoke("accounts:sync", accountId, folderPath, limit),
  },
  folders: {
    list: (accountId?: string) => ipcRenderer.invoke("folders:list", accountId),
  },
  emails: {
    stats: (accountId?: string, folderPath?: string) =>
      ipcRenderer.invoke("emails:stats", accountId, folderPath),
    senderGroups: (opts: SenderQueryOptions) =>
      ipcRenderer.invoke("emails:senderGroups", opts),
    search: (query: string, accountId?: string) =>
      ipcRenderer.invoke("emails:search", query, accountId),
  },
  plans: {
    list: () => ipcRenderer.invoke("plans:list"),
    createFromSenders: (params: {
      title?: string;
      selections: Array<{
        group: SenderGroup;
        destFolder: string;
        matchBy?: "sender" | "domain";
      }>;
    }) => ipcRenderer.invoke("plans:createFromSenders", params),
    createFromRules: (accountId?: string) =>
      ipcRenderer.invoke("plans:createFromRules", accountId),
    importJson: (accountId: string, rawJson: string) =>
      ipcRenderer.invoke("plans:importJson", accountId, rawJson),
    toggleMove: (planId: string, moveId: string, checked: boolean) =>
      ipcRenderer.invoke("plans:toggleMove", planId, moveId, checked),
    removeMove: (planId: string, moveId: string) =>
      ipcRenderer.invoke("plans:removeMove", planId, moveId),
    delete: (planId: string) => ipcRenderer.invoke("plans:delete", planId),
    apply: (planId: string) => ipcRenderer.invoke("plans:apply", planId),
  },
  rules: {
    list: () => ipcRenderer.invoke("rules:list"),
    saveMovesAsRules: (moves: SortMoveItem[]) =>
      ipcRenderer.invoke("rules:saveMovesAsRules", moves),
    toggle: (ruleId: string, enabled: boolean) =>
      ipcRenderer.invoke("rules:toggle", ruleId, enabled),
    delete: (ruleId: string) => ipcRenderer.invoke("rules:delete", ruleId),
  },
  history: {
    list: () => ipcRenderer.invoke("history:list"),
    undo: (historyId: string) => ipcRenderer.invoke("history:undo", historyId),
  },
  ai: {
    buildPrompt: (opts: {
      accountId?: string;
      folderPath?: string;
      onlyUnknown?: boolean;
    }) => ipcRenderer.invoke("ai:buildPrompt", opts),
    runBuiltin: (accountId: string, folderPath?: string) =>
      ipcRenderer.invoke("ai:runBuiltin", accountId, folderPath),
    hasApiKey: () => ipcRenderer.invoke("ai:hasApiKey"),
    saveApiKey: (apiKey: string) => ipcRenderer.invoke("ai:saveApiKey", apiKey),
  },
  settings: {
    get: () => ipcRenderer.invoke("settings:get"),
    save: (partial: Partial<AppSettings>) =>
      ipcRenderer.invoke("settings:save", partial),
  },
  mcp: {
    status: () => ipcRenderer.invoke("mcp:status"),
    activity: () => ipcRenderer.invoke("mcp:activity"),
    getStdioCommand: () => ipcRenderer.invoke("mcp:getStdioCommand"),
  },
  app: {
    openExternal: (url: string) => ipcRenderer.invoke("app:openExternal", url),
  },
  events: {
    onSyncProgress: (cb: (ev: SyncProgressEvent) => void) => {
      const listener = (_: unknown, ev: SyncProgressEvent) => cb(ev);
      ipcRenderer.on("sync:progress", listener);
      return () => ipcRenderer.removeListener("sync:progress", listener);
    },
    onPlanProgress: (cb: (ev: PlanApplyProgressEvent) => void) => {
      const listener = (_: unknown, ev: PlanApplyProgressEvent) => cb(ev);
      ipcRenderer.on("plan:progress", listener);
      return () => ipcRenderer.removeListener("plan:progress", listener);
    },
    onMcpActivity: (cb: (ev: McpActivityEvent) => void) => {
      const listener = (_: unknown, ev: McpActivityEvent) => cb(ev);
      ipcRenderer.on("mcp:activity", listener);
      return () => ipcRenderer.removeListener("mcp:activity", listener);
    },
    onPlanUpdated: (cb: (plan: SortPlan) => void) => {
      const listener = (_: unknown, plan: SortPlan) => cb(plan);
      ipcRenderer.on("plans:updated", listener);
      return () => ipcRenderer.removeListener("plans:updated", listener);
    },
  },
};

contextBridge.exposeInMainWorld("sortbox", api);
export type SortBoxApi = typeof api;
