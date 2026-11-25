import React, { useCallback, useEffect, useState } from "react";
import { Cpu, Layers, ListFilter, MailPlus, Sparkles } from "lucide-react";
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

  const pendingMoveCount = plans.reduce(
    (sum, p) => sum + p.moves.filter((m) => m.checked).length,
    0,
  );

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-4 lg:p-6">
      <div className="max-w-7xl mx-auto space-y-4">
        {/* Top Header */}
        <header className="bg-slate-900 border border-slate-800 rounded-2xl px-5 py-4 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-sky-500 text-slate-950 font-bold flex items-center justify-center text-sm">
              SB
            </div>
            <div>
              <h1 className="text-base font-semibold tracking-tight">
                SortBox MCP
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
                  {a.label} ({a.email})
                </option>
              ))}
            </select>

            <button
              type="button"
              onClick={() => setAddModalOpen(true)}
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
                Bienvenue dans SortBox MCP !
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
          {/* Sidebar */}
          <aside className="lg:col-span-3 space-y-4">
            <nav className="bg-slate-900 border border-slate-800 rounded-2xl p-2 space-y-1 text-xs font-medium">
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
            <section className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                Audit SQLite Local
              </h2>
              <div className="grid grid-cols-2 gap-2 text-xs">
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
                <div className="p-2.5 rounded-xl bg-slate-950 border border-slate-800">
                  <div className="text-slate-400">Newsletters</div>
                  <div className="text-base font-semibold tabular-nums mt-0.5">
                    {stats.newsletterMessages.toLocaleString("fr-FR")}
                  </div>
                </div>
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
                onSaveSettings={async (partial) => {
                  const updated = await window.sortbox.settings.save(partial);
                  setSettings(updated);
                  const st = await window.sortbox.mcp.status();
                  setMcpStatus(st);
                }}
                onDeleteAccount={async (accountId) => {
                  await window.sortbox.accounts.delete(accountId);
                  if (activeAccountId === accountId) {
                    setActiveAccountId("all");
                  }
                  await refreshData();
                }}
              />
            )}
          </main>
        </div>
      </div>

      <AddAccountModal
        open={addModalOpen}
        defaultMicrosoftClientId={settings.microsoftClientId}
        onClose={() => setAddModalOpen(false)}
        onAccountAdded={async (account) => {
          setActiveAccountId(account.id);
          setQueryOpts((prev) => ({ ...prev, accountId: account.id }));
          await refreshData({ ...queryOpts, accountId: account.id });
        }}
      />
    </div>
  );
}
