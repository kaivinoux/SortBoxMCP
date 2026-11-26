import { Capacitor } from "@capacitor/core";
import React, { useCallback, useEffect, useState } from "react";
import { Cpu, Layers, ListFilter, MailPlus, Settings2, Sparkles } from "lucide-react";
import type {
  AppSettings,
  AuditStats,
  ExecutionHistoryEntry,
  FolderInfo,
  MailAccount,
  McpActivityEvent,
  PlanApplyProgressEvent,
  SenderGroup,
  SenderQueryOptions,
  SortPlan,
  SortRule,
  SyncProgressEvent,
} from "../shared/types.js";
import { AddAccountModal } from "./components/AddAccountModal.js";
import { AiExportView } from "./components/AiExportView.js";
import { ManageAccountsModal } from "./components/ManageAccountsModal.js";
import { McpSettingsView } from "./components/McpSettingsView.js";
import { PlanView } from "./components/PlanView.js";
import { TriageView } from "./components/TriageView.js";

type TabId = "triage" | "plan" | "ai" | "mcp";

const INITIAL_SETTINGS: AppSettings = {
  mcpEnabled: false,
  mcpPort: 3847,
  mcpRequireUiConfirmation: true,
  waveBatchSize: 100,
  waveDelayMs: 250,
  aiProvider: "none",
  aiEndpoint: "http://127.0.0.1:11434",
  aiModel: "qwen2.5:7b",
  microsoftClientId: "",
};

export default function App() {
  const [tab, setTab] = useState<TabId>("triage");
  const [accounts, setAccounts] = useState<MailAccount[]>([]);
  const [activeAccountId, setActiveAccountId] = useState<string>("all");
  const [folders, setFolders] = useState<FolderInfo[]>([]);
  const [stats, setStats] = useState<AuditStats>({
    totalMessages: 0,
    unreadMessages: 0,
    newsletterMessages: 0,
    totalSizeBytes: 0,
    uniqueSenders: 0,
  });
  const [queryOpts, setQueryOpts] = useState<SenderQueryOptions>({
    accountId: "all",
    folderPath: "INBOX",
    filter: "all",
    groupBy: "sender",
    limit: 250,
  });
  const [senderGroups, setSenderGroups] = useState<SenderGroup[]>([]);
  const [plans, setPlans] = useState<SortPlan[]>([]);
  const [rules, setRules] = useState<SortRule[]>([]);
  const [history, setHistory] = useState<ExecutionHistoryEntry[]>([]);
  const [settings, setSettings] = useState<AppSettings>(INITIAL_SETTINGS);
  const [mcpStatus, setMcpStatus] = useState<{
    running: boolean;
    port: number | null;
    url: string | null;
  }>({ running: false, port: null, url: null });
  const [mcpActivity, setMcpActivity] = useState<McpActivityEvent[]>([]);
  const [syncProgress, setSyncProgress] = useState<SyncProgressEvent | null>(null);
  const [planProgress, setPlanProgress] = useState<PlanApplyProgressEvent | null>(null);
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [manageAccountsOpen, setManageAccountsOpen] = useState(false);
  const [editingAccount, setEditingAccount] = useState<MailAccount | null>(null);
  const [bannerError, setBannerError] = useState<string | null>(null);

  const refreshData = useCallback(
    async (optsOverride?: SenderQueryOptions) => {
      const effectiveOpts = optsOverride ?? {
        ...queryOpts,
        accountId: activeAccountId,
      };
      const [accs, flds, st, grps, pls, rls, hist, cfg, mcpSt, mcpLog] =
        await Promise.all([
          window.sortbox.accounts.list(),
          window.sortbox.folders.list(
            activeAccountId === "all" ? undefined : activeAccountId,
          ),
          window.sortbox.emails.stats(
            activeAccountId === "all" ? undefined : activeAccountId,
            effectiveOpts.folderPath,
          ),
          window.sortbox.emails.senderGroups(effectiveOpts),
          window.sortbox.plans.list(),
          window.sortbox.rules.list(),
          window.sortbox.history.list(),
          window.sortbox.settings.get(),
          window.sortbox.mcp.status(),
          window.sortbox.mcp.activity(),
        ]);

      setAccounts(accs);
      setFolders(flds);
      setStats(st);
      setSenderGroups(grps);
      setPlans(pls);
      setRules(rls);
      setHistory(hist);
      setSettings(cfg);
      setMcpStatus(mcpSt);
      setMcpActivity(mcpLog);
    },
    [activeAccountId, queryOpts],
  );

  useEffect(() => {
    refreshData().catch((err) =>
      setBannerError(err instanceof Error ? err.message : String(err)),
    );
  }, [refreshData]);

  useEffect(() => {
    const unsubSync = window.sortbox.events.onSyncProgress((ev) => {
      setSyncProgress(ev);
      if (ev.status === "done" || ev.status === "error") {
        refreshData().catch(() => {});
      }
    });
    const unsubPlan = window.sortbox.events.onPlanProgress((ev) => {
      setPlanProgress(ev);
    });
    const unsubMcp = window.sortbox.events.onMcpActivity((ev) => {
      setMcpActivity((prev) => [ev, ...prev].slice(0, 50));
    });
    const unsubPlanUpdated = window.sortbox.events.onPlanUpdated(() => {
      window.sortbox.plans.list().then(setPlans).catch(() => {});
    });
    return () => {
      unsubSync();
      unsubPlan();
      unsubMcp();
      unsubPlanUpdated();
    };
  }, [refreshData]);

  const isMobileNative = Capacitor.isNativePlatform();
  const pendingMoveCount = plans.reduce(
    (sum, p) => sum + p.moves.filter((m) => m.checked).length,
    0,
  );

  function openEditAccount(acc: MailAccount) {
    setEditingAccount(acc);
    setAddModalOpen(true);
  }

  async function handleDisconnectAccount(accountId: string) {
    await window.sortbox.accounts.disconnect(accountId);
    await refreshData();
  }

  async function handleDeleteAccount(accountId: string) {
    await window.sortbox.accounts.delete(accountId);
    if (activeAccountId === accountId) {
      setActiveAccountId("all");
      setQueryOpts((prev) => ({ ...prev, accountId: "all" }));
      await refreshData({ ...queryOpts, accountId: "all" });
    } else {
      await refreshData();
    }
  }

  async function handleTestSavedAccount(acc: MailAccount) {
    return window.sortbox.accounts.test({
      accountId: acc.id,
      email: acc.email,
      provider: acc.provider,
      authMode: acc.authMode,
      imapHost: acc.imapHost,
      imapPort: acc.imapPort,
      imapSecure: acc.imapSecure,
    });
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-3 sm:p-4 lg:p-6 pb-24 lg:pb-6">
      <div className="max-w-7xl mx-auto space-y-4">
        {/* Top Header */}
        <header className="bg-slate-900 border border-slate-800 rounded-2xl px-5 py-4 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <img
              src="./icon.png"
              alt="IA For EveryOne — SortBox E-Mail"
              className="w-11 h-11 rounded-xl shadow-md object-cover shrink-0"
            />
            <div>
              <h1 className="text-base font-semibold tracking-tight">
                IA For EveryOne — SortBox E-Mail
              </h1>
              <p className="text-xs text-slate-400">
                Tri universel multi-boîtes • 100 % local • Sans IA requise • Serveur MCP optionnel
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <select
              value={activeAccountId}
              onChange={(e) => {
                const nextAcc = e.target.value;
                setActiveAccountId(nextAcc);
                setQueryOpts((prev) => ({ ...prev, accountId: nextAcc }));
              }}
              className="text-xs bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 outline-none"
            >
              <option value="all">Toutes les boîtes ({accounts.length})</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label} ({a.email}){a.hasCredentials === false ? " [Déconnecté]" : ""}
                </option>
              ))}
            </select>

            {accounts.length > 0 && (
              <button
                type="button"
                onClick={() => setManageAccountsOpen(true)}
                className="text-xs px-3 py-2 rounded-lg border border-slate-700 bg-slate-950 hover:bg-slate-800 text-slate-200 font-medium flex items-center gap-1.5 cursor-pointer"
              >
                <Settings2 className="w-3.5 h-3.5 text-sky-400" />
                Gérer ({accounts.length})
              </button>
            )}

            <button
              type="button"
              onClick={() => {
                setEditingAccount(null);
                setAddModalOpen(true);
              }}
              className="text-xs px-3.5 py-2 rounded-lg bg-sky-500 hover:bg-sky-400 text-slate-950 font-semibold flex items-center gap-1.5 cursor-pointer"
            >
              <MailPlus className="w-3.5 h-3.5" />
              Ajouter une boîte
            </button>
          </div>
        </header>

        {bannerError && (
          <div className="p-3 rounded-xl bg-rose-950/60 border border-rose-700 text-rose-200 text-xs flex justify-between items-center">
            <span>{bannerError}</span>
            <button
              type="button"
              onClick={() => setBannerError(null)}
              className="underline cursor-pointer"
            >
              Fermer
            </button>
          </div>
        )}

        {/* Onboarding Banner if 0 accounts */}
        {accounts.length === 0 && (
          <div className="bg-slate-900 border border-sky-800/70 rounded-2xl p-6 flex flex-wrap items-center justify-between gap-4">
            <div className="space-y-1">
              <h2 className="text-sm font-semibold text-sky-300">
                Bienvenue dans IA For EveryOne — SortBox E-Mail !
              </h2>
              <p className="text-xs text-slate-300 max-w-2xl">
                Connecte ta première boîte mail (Orange, Gmail, Outlook, Free, OVH, iCloud ou IMAP) pour analyser tes expéditeurs hors-ligne et nettoyer ta boîte en toute sécurité avec aperçu Dry-Run.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setAddModalOpen(true)}
              className="text-xs px-4 py-2.5 rounded-xl bg-sky-500 hover:bg-sky-400 text-slate-950 font-semibold cursor-pointer"
            >
              Connecter ma première boîte mail
            </button>
          </div>
        )}

        {/* Main Body */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          {/* Sidebar (Desktop) */}
          <aside className="lg:col-span-3 space-y-4">
            <nav className="hidden lg:block bg-slate-900 border border-slate-800 rounded-2xl p-2 space-y-1 text-xs font-medium">
              <button
                type="button"
                onClick={() => setTab("triage")}
                className={`w-full px-3 py-2.5 rounded-xl flex items-center justify-between cursor-pointer ${
                  tab === "triage"
                    ? "bg-sky-500 text-slate-950 font-semibold"
                    : "text-slate-300 hover:bg-slate-800"
                }`}
              >
                <span className="flex items-center gap-2">
                  <ListFilter className="w-4 h-4" />
                  1. Tri par Expéditeur
                </span>
                <span className="opacity-75">Sans IA</span>
              </button>

              <button
                type="button"
                onClick={() => setTab("plan")}
                className={`w-full px-3 py-2.5 rounded-xl flex items-center justify-between cursor-pointer ${
                  tab === "plan"
                    ? "bg-sky-500 text-slate-950 font-semibold"
                    : "text-slate-300 hover:bg-slate-800"
                }`}
              >
                <span className="flex items-center gap-2">
                  <Layers className="w-4 h-4" />
                  2. Plan & Dry-Run
                </span>
                {pendingMoveCount > 0 && (
                  <span className="px-1.5 py-0.5 rounded-md bg-emerald-500 text-slate-950 font-bold tabular-nums">
                    {pendingMoveCount}
                  </span>
                )}
              </button>

              <button
                type="button"
                onClick={() => setTab("ai")}
                className={`w-full px-3 py-2.5 rounded-xl flex items-center justify-between cursor-pointer ${
                  tab === "ai"
                    ? "bg-sky-500 text-slate-950 font-semibold"
                    : "text-slate-300 hover:bg-slate-800"
                }`}
              >
                <span className="flex items-center gap-2">
                  <Sparkles className="w-4 h-4" />
                  3. IA & Copier-Coller
                </span>
                <span className="opacity-75">Optionnel</span>
              </button>

              <button
                type="button"
                onClick={() => setTab("mcp")}
                className={`w-full px-3 py-2.5 rounded-xl flex items-center justify-between cursor-pointer ${
                  tab === "mcp"
                    ? "bg-sky-500 text-slate-950 font-semibold"
                    : "text-slate-300 hover:bg-slate-800"
                }`}
              >
                <span className="flex items-center gap-2">
                  <Cpu className="w-4 h-4" />
                  4. MCP & Paramètres
                </span>
                <span
                  className={
                    mcpStatus.running ? "text-emerald-400 font-bold" : "opacity-60"
                  }
                >
                  {mcpStatus.running ? "ON" : "OFF"}
                </span>
              </button>
            </nav>

            {/* Local Cache Stats */}
            <section className="bg-slate-900 border border-slate-800 rounded-2xl p-3 sm:p-4 space-y-2.5">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                Audit SQLite Local
              </h2>
              <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-2 gap-2 text-xs">
                <div className="p-2.5 rounded-xl bg-slate-950 border border-slate-800">
                  <div className="text-slate-400">Indexés</div>
                  <div className="text-base font-semibold tabular-nums mt-0.5">
                    {stats.totalMessages.toLocaleString("fr-FR")}
                  </div>
                </div>
                <div className="p-2.5 rounded-xl bg-slate-950 border border-slate-800">
                  <div className="text-slate-400">Non lus</div>
                  <div className="text-base font-semibold tabular-nums mt-0.5 text-amber-400">
                    {stats.unreadMessages.toLocaleString("fr-FR")}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    const nextFilter =
                      queryOpts.filter === "newsletter" ? "all" : "newsletter";
                    setQueryOpts((prev) => ({ ...prev, filter: nextFilter }));
                    setTab("triage");
                  }}
                  title="Filtrer les newsletters dans Tri"
                  className={`p-2.5 rounded-xl border text-left transition-colors cursor-pointer ${
                    queryOpts.filter === "newsletter"
                      ? "bg-amber-950/50 border-amber-600/80"
                      : "bg-slate-950 border-slate-800 hover:border-slate-700"
                  }`}
                >
                  <div className="text-slate-400">Newsletters</div>
                  <div className="text-base font-semibold tabular-nums mt-0.5 text-amber-300">
                    {stats.newsletterMessages.toLocaleString("fr-FR")}
                  </div>
                </button>
                <div className="p-2.5 rounded-xl bg-slate-950 border border-slate-800">
                  <div className="text-slate-400">Expéditeurs</div>
                  <div className="text-base font-semibold tabular-nums mt-0.5 text-sky-400">
                    {stats.uniqueSenders.toLocaleString("fr-FR")}
                  </div>
                </div>
              </div>
            </section>
          </aside>

          {/* Main Tab Content */}
          <main className="lg:col-span-9">
            {tab === "triage" && (
              <TriageView
                accounts={accounts}
                activeAccountId={activeAccountId}
                folders={folders}
                senderGroups={senderGroups}
                syncProgress={syncProgress}
                queryOpts={queryOpts}
                onChangeQueryOpts={(next) => setQueryOpts(next)}
                onSyncAccount={async (accountId, folderPath, limit) => {
                  try {
                    await window.sortbox.accounts.sync(accountId, folderPath, limit);
                    await refreshData();
                  } catch (err) {
                    setBannerError(err instanceof Error ? err.message : String(err));
                  }
                }}
                onCreatePlan={async (selections) => {
                  try {
                    await window.sortbox.plans.createFromSenders({
                      title: `Tri ${new Date().toLocaleTimeString("fr-FR")}`,
                      selections,
                    });
                    await refreshData();
                    setTab("plan");
                  } catch (err) {
                    setBannerError(err instanceof Error ? err.message : String(err));
                  }
                }}
                onUnsubscribeSender={async (group) => {
                  const res = await window.sortbox.emails.unsubscribe(
                    {
                      accountId: group.accountId,
                      folderPath: group.folderPath,
                      groupKey: group.groupKey,
                      fromAddr: group.fromAddr,
                      domain: group.domain,
                      matchBy: queryOpts.groupBy === "domain" ? "domain" : "sender",
                      unsubscribeUrl: group.unsubscribeUrl,
                      unsubscribeMailto: group.unsubscribeMailto,
                      unsubscribeOneClick: group.unsubscribeOneClick,
                      latestDateIso: group.latestDateIso,
                    },
                    { openBrowserIfNeeded: true },
                  );
                  await refreshData();
                  return res;
                }}
                onUnsubscribeBatch={async (groups) => {
                  const outcomes = [];
                  for (const group of groups) {
                    try {
                      const result = await window.sortbox.emails.unsubscribe(
                        {
                          accountId: group.accountId,
                          folderPath: group.folderPath,
                          groupKey: group.groupKey,
                          fromAddr: group.fromAddr,
                          domain: group.domain,
                          matchBy: queryOpts.groupBy === "domain" ? "domain" : "sender",
                          unsubscribeUrl: group.unsubscribeUrl,
                          unsubscribeMailto: group.unsubscribeMailto,
                          unsubscribeOneClick: group.unsubscribeOneClick,
                          latestDateIso: group.latestDateIso,
                        },
                        { openBrowserIfNeeded: false },
                      );
                      outcomes.push({ group, result });
                    } catch (err) {
                      outcomes.push({
                        group,
                        result: {
                          status: "error" as const,
                          verified: false,
                          method: "none" as const,
                          url: null,
                          message: err instanceof Error ? err.message : String(err),
                          unsubscribedAt: null,
                        },
                      });
                    }
                  }
                  await refreshData();
                  return outcomes;
                }}
                onMarkUnsubscribedManual={async (group, method, targetUrl) => {
                  const senderKey =
                    queryOpts.groupBy === "domain"
                      ? group.domain || group.groupKey
                      : group.fromAddr || group.groupKey;
                  await window.sortbox.emails.markUnsubscribed({
                    accountId: group.accountId,
                    senderKey,
                    status: "confirmed",
                    method,
                    targetUrl,
                    detail: "Confirmé manuellement par l'utilisateur",
                  });
                  await refreshData();
                }}
              />
            )}

            {tab === "plan" && (
              <PlanView
                plans={plans}
                rules={rules}
                history={history}
                planProgress={planProgress}
                onToggleMove={async (planId, moveId, checked) => {
                  await window.sortbox.plans.toggleMove(planId, moveId, checked);
                  await refreshData();
                }}
                onRemoveMove={async (planId, moveId) => {
                  await window.sortbox.plans.removeMove(planId, moveId);
                  await refreshData();
                }}
                onDeletePlan={async (planId) => {
                  await window.sortbox.plans.delete(planId);
                  await refreshData();
                }}
                onApplyPlan={async (planId) => {
                  try {
                    await window.sortbox.plans.apply(planId);
                    await refreshData();
                  } catch (err) {
                    setBannerError(err instanceof Error ? err.message : String(err));
                  }
                }}
                onSaveAsRules={async (plan) => {
                  await window.sortbox.rules.saveMovesAsRules(
                    plan.moves.filter((m) => m.checked),
                  );
                  await refreshData();
                }}
                onRunRules={async () => {
                  await window.sortbox.plans.createFromRules(activeAccountId);
                  await refreshData();
                }}
                onToggleRule={async (ruleId, enabled) => {
                  await window.sortbox.rules.toggle(ruleId, enabled);
                  await refreshData();
                }}
                onDeleteRule={async (ruleId) => {
                  await window.sortbox.rules.delete(ruleId);
                  await refreshData();
                }}
                onUndoHistory={async (historyId) => {
                  try {
                    await window.sortbox.history.undo(historyId);
                    await refreshData();
                  } catch (err) {
                    setBannerError(err instanceof Error ? err.message : String(err));
                  }
                }}
              />
            )}

            {tab === "ai" && (
              <AiExportView
                accounts={accounts}
                activeAccountId={activeAccountId}
                settings={settings}
                onSaveSettings={async (partial) => {
                  const updated = await window.sortbox.settings.save(partial);
                  setSettings(updated);
                }}
                onImportJsonPlan={async (accountId, rawJson) => {
                  await window.sortbox.plans.importJson(accountId, rawJson);
                  await refreshData();
                  setTab("plan");
                }}
                onRunBuiltinAi={async (accountId) => {
                  await window.sortbox.ai.runBuiltin(
                    accountId,
                    queryOpts.folderPath || "INBOX",
                  );
                  await refreshData();
                  setTab("plan");
                }}
              />
            )}

            {tab === "mcp" && (
              <McpSettingsView
                accounts={accounts}
                settings={settings}
                mcpStatus={mcpStatus}
                mcpActivity={mcpActivity}
                isMobileNative={isMobileNative}
                onSaveSettings={async (partial) => {
                  const updated = await window.sortbox.settings.save(partial);
                  setSettings(updated);
                  const st = await window.sortbox.mcp.status();
                  setMcpStatus(st);
                }}
                onEditAccount={openEditAccount}
                onDisconnectAccount={handleDisconnectAccount}
                onDeleteAccount={handleDeleteAccount}
                onTestSavedAccount={handleTestSavedAccount}
                onAddAccount={() => {
                  setEditingAccount(null);
                  setAddModalOpen(true);
                }}
              />
            )}
          </main>
        </div>
      </div>

      <ManageAccountsModal
        open={manageAccountsOpen}
        accounts={accounts}
        onClose={() => setManageAccountsOpen(false)}
        onAddNew={() => {
          setEditingAccount(null);
          setAddModalOpen(true);
        }}
        onEditAccount={openEditAccount}
        onDisconnectAccount={handleDisconnectAccount}
        onDeleteAccount={handleDeleteAccount}
        onTestSavedAccount={handleTestSavedAccount}
      />

      <AddAccountModal
        open={addModalOpen}
        editingAccount={editingAccount}
        defaultMicrosoftClientId={settings.microsoftClientId}
        onClose={() => {
          setAddModalOpen(false);
          setEditingAccount(null);
        }}
        onAccountAdded={async (account) => {
          setActiveAccountId(account.id);
          setQueryOpts((prev) => ({ ...prev, accountId: account.id }));
          await refreshData({ ...queryOpts, accountId: account.id });
        }}
      />

      {/* Mobile Bottom Navigation Bar */}
      <nav className="lg:hidden fixed bottom-0 inset-x-0 z-40 bg-slate-900/95 backdrop-blur-md border-t border-slate-800 grid grid-cols-4 text-[11px] font-medium">
        <button
          type="button"
          onClick={() => setTab("triage")}
          className={`py-2.5 flex flex-col items-center gap-1 cursor-pointer ${
            tab === "triage" ? "text-sky-400 font-semibold" : "text-slate-400"
          }`}
        >
          <ListFilter className="w-4 h-4" />
          <span>Tri</span>
        </button>
        <button
          type="button"
          onClick={() => setTab("plan")}
          className={`py-2.5 flex flex-col items-center gap-1 relative cursor-pointer ${
            tab === "plan" ? "text-sky-400 font-semibold" : "text-slate-400"
          }`}
        >
          <Layers className="w-4 h-4" />
          <span>Plan{pendingMoveCount > 0 ? ` (${pendingMoveCount})` : ""}</span>
        </button>
        <button
          type="button"
          onClick={() => setTab("ai")}
          className={`py-2.5 flex flex-col items-center gap-1 cursor-pointer ${
            tab === "ai" ? "text-sky-400 font-semibold" : "text-slate-400"
          }`}
        >
          <Sparkles className="w-4 h-4" />
          <span>IA</span>
        </button>
        <button
          type="button"
          onClick={() => setTab("mcp")}
          className={`py-2.5 flex flex-col items-center gap-1 cursor-pointer ${
            tab === "mcp" ? "text-sky-400 font-semibold" : "text-slate-400"
          }`}
        >
          <Cpu className="w-4 h-4" />
          <span>{isMobileNative ? "Réglages" : "MCP"}</span>
        </button>
      </nav>
    </div>
  );
}
