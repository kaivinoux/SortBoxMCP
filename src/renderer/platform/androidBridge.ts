import { Capacitor, registerPlugin } from "@capacitor/core";
import type { SortBoxApi } from "../../main/preload.cjs";
import { generateSortSpecWithBuiltinAi } from "../../shared/aiUtils.js";
import { classifySenderLocally } from "../../shared/domainCategories.js";
import {
  buildZeroConfigPrompt,
  parseImportedSortPlanJson,
} from "../../shared/promptUtils.js";
import { detectProviderFromEmail } from "../../shared/providers.js";
import type {
  AddAccountInput,
  AppSettings,
  AuditStats,
  ExecutionHistoryEntry,
  FolderInfo,
  MailAccount,
  PlanApplyProgressEvent,
  SenderGroup,
  SenderQueryOptions,
  SortMoveItem,
  SortPlan,
  SortRule,
  SyncProgressEvent,
  TestAccountInput,
  UnsubscribeRequest,
  UnsubscribeResult,
  UpdateAccountInput,
} from "../../shared/types.js";

interface SortBoxNativePlugin {
  accountsList(): Promise<{ items: MailAccount[] }>;
  accountsTest(
    input: TestAccountInput,
  ): Promise<{ ok: true; folderCount: number; folders: string[] }>;
  accountsAdd(input: AddAccountInput): Promise<MailAccount>;
  accountsUpdate(input: UpdateAccountInput): Promise<MailAccount>;
  accountsDisconnect(opts: { accountId: string }): Promise<MailAccount>;
  accountsDelete(opts: { accountId: string }): Promise<void>;
  accountsMicrosoftLogin(opts: {
    clientId: string;
    loginHint?: string;
    targetAccountId?: string;
  }): Promise<MailAccount>;
  accountsSync(opts: {
    accountId: string;
    folderPath?: string;
    limit?: number;
  }): Promise<{
    folders: FolderInfo[];
    newlyFetched: number;
    totalInFolder: number;
  }>;
  foldersList(opts: { accountId?: string }): Promise<{ items: FolderInfo[] }>;
  emailsStats(opts: {
    accountId?: string;
    folderPath?: string;
  }): Promise<AuditStats>;
  emailsSenderGroupsRaw(opts: {
    accountId?: string;
    folderPath?: string;
    search?: string;
    groupBy?: string;
    limit?: number;
  }): Promise<{ items: Array<Omit<SenderGroup, "suggestedCategory" | "suggestedFolder">> }>;
  emailsUnsubscribe(opts: {
    req: UnsubscribeRequest;
    openBrowserIfNeeded?: boolean;
  }): Promise<UnsubscribeResult>;
  emailsMarkUnsubscribed(opts: {
    accountId: string;
    senderKey: string;
    status?: "confirmed" | "pending" | "failed";
    method?: string;
    targetUrl?: string | null;
    detail?: string | null;
  }): Promise<{ unsubscribedAt: string }>;
  plansList(): Promise<{ items: SortPlan[] }>;
  plansCreateFromSenders(params: {
    title?: string;
    selections: Array<{
      group: SenderGroup;
      destFolder: string;
      matchBy?: "sender" | "domain";
    }>;
  }): Promise<SortPlan>;
  plansCreateFromSpec(params: {
    accountId: string;
    source: string;
    spec: unknown;
  }): Promise<SortPlan>;
  plansCreateFromRules(opts: { accountId?: string }): Promise<SortPlan>;
  plansToggleMove(opts: {
    planId: string;
    moveId: string;
    checked: boolean;
  }): Promise<SortPlan | null>;
  plansRemoveMove(opts: {
    planId: string;
    moveId: string;
  }): Promise<SortPlan | null>;
  plansDelete(opts: { planId: string }): Promise<void>;
  plansApply(opts: {
    planId: string;
  }): Promise<{ plan: SortPlan; historyEntries: ExecutionHistoryEntry[] }>;
  rulesList(): Promise<{ items: SortRule[] }>;
  rulesSaveMovesAsRules(opts: {
    moves: SortMoveItem[];
  }): Promise<{ items: SortRule[] }>;
  rulesToggle(opts: {
    ruleId: string;
    enabled: boolean;
  }): Promise<{ items: SortRule[] }>;
  rulesDelete(opts: { ruleId: string }): Promise<{ items: SortRule[] }>;
  historyList(): Promise<{ items: ExecutionHistoryEntry[] }>;
  historyUndo(opts: { historyId: string }): Promise<{ restored: number }>;
  aiHasApiKey(): Promise<{ hasKey: boolean }>;
  aiSaveApiKey(opts: { apiKey: string }): Promise<{ saved: boolean }>;
  aiGetApiKey(): Promise<{ apiKey: string }>;
  settingsGet(): Promise<AppSettings>;
  settingsSave(partial: Partial<AppSettings>): Promise<AppSettings>;
  openExternal(opts: { url: string }): Promise<void>;
  addListener(
    eventName: string,
    listenerFunc: (data: never) => void,
  ): Promise<{ remove: () => Promise<void> }>;
}

const SortBoxNative = registerPlugin<SortBoxNativePlugin>("SortBoxNative");

async function queryClassifiedGroups(
  opts: SenderQueryOptions,
): Promise<SenderGroup[]> {
  const { items } = await SortBoxNative.emailsSenderGroupsRaw({
    accountId: opts.accountId ?? "all",
    folderPath: opts.folderPath ?? "INBOX",
    search: opts.search ?? "",
    groupBy: opts.groupBy ?? "sender",
    limit: opts.limit ?? 250,
  });

  const classified: SenderGroup[] = [];
  for (const r of items) {
    const { category, suggestedFolder } = classifySenderLocally(
      r.domain || "",
      r.hasUnsubscribe,
      r.sampleSubjects || [],
    );

    if (opts.filter === "newsletter" && !r.hasUnsubscribe) continue;
    if (opts.filter === "known" && !category) continue;
    if (opts.filter === "unknown" && category !== null) continue;
    if (opts.filter === "unread" && r.unreadCount === 0) continue;
    if (opts.filter === "large" && r.totalSizeBytes < 5 * 1024 * 1024) continue;

    classified.push({
      ...r,
      suggestedCategory: category,
      suggestedFolder,
    });
  }
  return classified;
}

export function createAndroidSortBoxApi(): SortBoxApi {
  return {
    accounts: {
      list: async () => (await SortBoxNative.accountsList()).items,
      detectProvider: async (email: string) => detectProviderFromEmail(email),
      test: (input) => SortBoxNative.accountsTest(input),
      add: (input) => SortBoxNative.accountsAdd(input),
      update: (input) => SortBoxNative.accountsUpdate(input),
      disconnect: (accountId) => SortBoxNative.accountsDisconnect({ accountId }),
      delete: (accountId) => SortBoxNative.accountsDelete({ accountId }),
      microsoftLogin: (clientId, loginHint, targetAccountId) =>
        SortBoxNative.accountsMicrosoftLogin({
          clientId,
          loginHint,
          targetAccountId,
        }),
      sync: (accountId, folderPath, limit) =>
        SortBoxNative.accountsSync({ accountId, folderPath, limit }),
    },
    folders: {
      list: async (accountId) =>
        (await SortBoxNative.foldersList({ accountId })).items,
    },
    emails: {
      stats: (accountId, folderPath) =>
        SortBoxNative.emailsStats({ accountId, folderPath }),
      senderGroups: (opts) => queryClassifiedGroups(opts),
      search: async (query, accountId) => {
        const groups = await queryClassifiedGroups({
          accountId,
          search: query,
          limit: 50,
        });
        return groups.map((g, idx) => ({
          accountId: g.accountId,
          folderPath: g.folderPath,
          uid: idx + 1,
          messageId: "",
          fromRaw: g.fromAddr,
          fromName: g.fromName,
          fromAddr: g.fromAddr,
          domain: g.domain,
          toRaw: g.accountEmail,
          subject: g.sampleSubjects[0] || "",
          dateIso: g.latestDateIso,
          dateTs: 0,
          sizeBytes: g.totalSizeBytes,
          seen: g.unreadCount === 0,
          flagged: false,
          hasUnsubscribe: g.hasUnsubscribe,
          unsubscribeUrl: g.unsubscribeUrl,
          unsubscribeMailto: g.unsubscribeMailto ?? null,
          unsubscribeOneClick: g.unsubscribeOneClick ?? false,
        }));
      },
      unsubscribe: (req, opts) =>
        SortBoxNative.emailsUnsubscribe({
          req,
          openBrowserIfNeeded: opts?.openBrowserIfNeeded ?? true,
        }),
      markUnsubscribed: async (params) =>
        (await SortBoxNative.emailsMarkUnsubscribed(params)).unsubscribedAt,
    },
    plans: {
      list: async () => (await SortBoxNative.plansList()).items,
      createFromSenders: (params) => SortBoxNative.plansCreateFromSenders(params),
      createFromRules: (accountId) =>
        SortBoxNative.plansCreateFromRules({ accountId }),
      importJson: async (accountId, rawJson) => {
        const spec = parseImportedSortPlanJson(rawJson);
        return SortBoxNative.plansCreateFromSpec({
          accountId,
          source: "ai_import",
          spec,
        });
      },
      toggleMove: (planId, moveId, checked) =>
        SortBoxNative.plansToggleMove({ planId, moveId, checked }),
      removeMove: (planId, moveId) =>
        SortBoxNative.plansRemoveMove({ planId, moveId }),
      delete: (planId) => SortBoxNative.plansDelete({ planId }),
      apply: (planId) => SortBoxNative.plansApply({ planId }),
    },
    rules: {
      list: async () => (await SortBoxNative.rulesList()).items,
      saveMovesAsRules: async (moves) =>
        (await SortBoxNative.rulesSaveMovesAsRules({ moves })).items,
      toggle: async (ruleId, enabled) =>
        (await SortBoxNative.rulesToggle({ ruleId, enabled })).items,
      delete: async (ruleId) =>
        (await SortBoxNative.rulesDelete({ ruleId })).items,
    },
    history: {
      list: async () => (await SortBoxNative.historyList()).items,
      undo: async (historyId) =>
        (await SortBoxNative.historyUndo({ historyId })).restored,
    },
    ai: {
      buildPrompt: async (opts) => {
        const groups = await queryClassifiedGroups({
          accountId: opts.accountId,
          folderPath: opts.folderPath,
          limit: 150,
        });
        const folders = (
          await SortBoxNative.foldersList({
            accountId: opts.accountId === "all" ? undefined : opts.accountId,
          })
        ).items.map((f) => f.name);
        return buildZeroConfigPrompt(groups, folders, {
          onlyUnknown: opts.onlyUnknown ?? true,
        });
      },
      runBuiltin: async (accountId, folderPath) => {
        const settings = await SortBoxNative.settingsGet();
        const { apiKey } = await SortBoxNative.aiGetApiKey();
        const groups = await queryClassifiedGroups({
          accountId,
          folderPath,
          limit: 120,
        });
        const folders = (
          await SortBoxNative.foldersList({ accountId })
        ).items.map((f) => f.name);
        const spec = await generateSortSpecWithBuiltinAi({
          settings,
          apiKey,
          senderGroups: groups,
          existingFolders: folders,
        });
        return SortBoxNative.plansCreateFromSpec({
          accountId,
          source: "ai_builtin",
          spec,
        });
      },
      hasApiKey: async () => (await SortBoxNative.aiHasApiKey()).hasKey,
      saveApiKey: async (apiKey) =>
        (await SortBoxNative.aiSaveApiKey({ apiKey })).saved,
    },
    settings: {
      get: () => SortBoxNative.settingsGet(),
      save: (partial) => SortBoxNative.settingsSave(partial),
    },
    mcp: {
      status: async () => ({ running: false, port: null, url: null }),
      activity: async () => [],
      getStdioCommand: async () => ({
        executable: "Available on the Windows desktop app",
        args: [],
      }),
    },
    app: {
      openExternal: (url) => SortBoxNative.openExternal({ url }),
    },
    events: {
      onSyncProgress: (cb) => {
        const handlePromise = SortBoxNative.addListener("syncProgress", (ev) =>
          cb(ev as unknown as SyncProgressEvent),
        );
        return () => {
          handlePromise.then((h) => h.remove()).catch(() => {});
        };
      },
      onPlanProgress: (cb) => {
        const handlePromise = SortBoxNative.addListener("planProgress", (ev) =>
          cb(ev as unknown as PlanApplyProgressEvent),
        );
        return () => {
          handlePromise.then((h) => h.remove()).catch(() => {});
        };
      },
      onMcpActivity: () => () => {},
      onPlanUpdated: () => () => {},
    },
  };
}

export function installPlatformBridge(): boolean {
  const isNativeMobile = Capacitor.isNativePlatform();
  if (!window.sortbox) {
    window.sortbox = createAndroidSortBoxApi();
  }
  return isNativeMobile;
}
