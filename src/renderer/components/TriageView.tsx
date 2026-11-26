import React, { useMemo, useState } from "react";
import {
  BellOff,
  CheckCircle2,
  ExternalLink,
  FolderPlus,
  Mail,
  RefreshCw,
  Search,
  Trash2,
} from "lucide-react";
import {
  SPECIAL_ARCHIVE,
  SPECIAL_JUNK,
  SPECIAL_TRASH,
  formatDestinationLabel,
} from "../../shared/folders.js";
import {
  formatBytesLocalized,
  formatMessage,
  localizeCategory,
} from "../../shared/i18n.js";
import type {
  FolderInfo,
  MailAccount,
  SenderGroup,
  SenderQueryOptions,
  SyncProgressEvent,
  UnsubscribeResult,
} from "../../shared/types.js";
import { useI18n } from "../i18n/I18nContext.js";

interface BatchUnsubOutcome {
  group: SenderGroup;
  result: UnsubscribeResult;
  handledManually?: boolean;
}

interface TriageViewProps {
  accounts: MailAccount[];
  activeAccountId: string;
  folders: FolderInfo[];
  senderGroups: SenderGroup[];
  syncProgress: SyncProgressEvent | null;
  queryOpts: SenderQueryOptions;
  onChangeQueryOpts: (next: SenderQueryOptions) => void;
  onSyncAccount: (accountId: string, folderPath: string, limit: number) => Promise<void>;
  onCreatePlan: (
    selections: Array<{
      group: SenderGroup;
      destFolder: string;
      matchBy: "sender" | "domain";
    }>,
  ) => Promise<void>;
  onUnsubscribeSender: (group: SenderGroup) => Promise<UnsubscribeResult>;
  onUnsubscribeBatch: (
    groups: SenderGroup[],
  ) => Promise<Array<{ group: SenderGroup; result: UnsubscribeResult }>>;
  onMarkUnsubscribedManual: (
    group: SenderGroup,
    method: string,
    targetUrl: string | null,
  ) => Promise<void>;
}

const DEFAULT_DESTINATIONS = [
  SPECIAL_TRASH,
  SPECIAL_ARCHIVE,
  SPECIAL_JUNK,
  "Administratif",
  "Banques",
  "Factures",
  "Achats",
  "Emploi",
  "Newsletters",
  "Social",
  "Pro",
];

export function TriageView({
  accounts,
  activeAccountId,
  folders,
  senderGroups,
  syncProgress,
  queryOpts,
  onChangeQueryOpts,
  onSyncAccount,
  onCreatePlan,
  onUnsubscribeSender,
  onUnsubscribeBatch,
  onMarkUnsubscribedManual,
}: TriageViewProps) {
  const { lang, locale, t } = useI18n();
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [destFolder, setDestFolder] = useState(SPECIAL_TRASH);
  const [customDest, setCustomDest] = useState("");
  const [syncFolder, setSyncFolder] = useState("INBOX");
  const [syncLimit, setSyncLimit] = useState(1000);
  const [syncing, setSyncing] = useState(false);
  const [unsubBusyKey, setUnsubBusyKey] = useState<string | null>(null);
  const [batchUnsubRunning, setBatchUnsubRunning] = useState(false);
  const [unsubFeedback, setUnsubFeedback] = useState<{
    kind: "ok" | "info" | "warn";
    text: string;
    pendingGroup?: SenderGroup;
    pendingMethod?: string;
    pendingUrl?: string | null;
  } | null>(null);
  const [batchOutcomes, setBatchOutcomes] = useState<BatchUnsubOutcome[]>([]);

  const uniqueFolderNames = useMemo(() => {
    const names = new Set<string>(["INBOX"]);
    for (const f of folders) names.add(f.name);
    return Array.from(names);
  }, [folders]);

  const destinationChoices = useMemo(() => {
    const customUserFolders = folders
      .filter(
        (f) =>
          f.name.toUpperCase() !== "INBOX" &&
          f.specialUse !== "\\Trash" &&
          f.specialUse !== "\\Junk" &&
          f.specialUse !== "\\Sent" &&
          f.specialUse !== "\\Drafts" &&
          f.specialUse !== "\\All" &&
          !f.name.startsWith("[Gmail]"),
      )
      .map((f) => f.name);
    const seen = new Set<string>();
    const out: string[] = [];
    for (const d of [...DEFAULT_DESTINATIONS, ...customUserFolders]) {
      if (!seen.has(d.toLowerCase())) {
        seen.add(d.toLowerCase());
        out.push(d);
      }
    }
    return out;
  }, [folders]);

  const effectiveDest =
    destFolder === "__custom__"
      ? customDest.trim() || t.triage.defaultCustomFolder
      : destFolder;

  const selectedItems = useMemo(() => {
    return senderGroups.filter((g) =>
      selectedKeys.has(`${g.accountId}::${g.folderPath}::${g.groupKey}`),
    );
  }, [senderGroups, selectedKeys]);

  const selectedEmailCount = useMemo(
    () => selectedItems.reduce((acc, g) => acc + g.totalCount, 0),
    [selectedItems],
  );

  function rowKey(g: SenderGroup): string {
    return `${g.accountId}::${g.folderPath}::${g.groupKey}`;
  }

  function toggleRow(g: SenderGroup) {
    const k = rowKey(g);
    const next = new Set(selectedKeys);
    if (next.has(k)) next.delete(k);
    else next.add(k);
    setSelectedKeys(next);
  }

  function toggleAll(checked: boolean) {
    if (checked) {
      setSelectedKeys(new Set(senderGroups.map(rowKey)));
    } else {
      setSelectedKeys(new Set());
    }
  }

  async function handleRunSync() {
    const targets =
      activeAccountId === "all"
        ? accounts
        : accounts.filter((a) => a.id === activeAccountId);
    if (!targets.length) return;
    setSyncing(true);
    try {
      for (const acc of targets) {
        await onSyncAccount(acc.id, syncFolder, syncLimit);
      }
    } finally {
      setSyncing(false);
    }
  }

  async function handleAddSelectedToPlan() {
    if (!selectedItems.length) return;
    const matchBy = queryOpts.groupBy === "domain" ? "domain" : "sender";
    await onCreatePlan(
      selectedItems.map((group) => ({
        group,
        destFolder: effectiveDest,
        matchBy,
      })),
    );
    setSelectedKeys(new Set());
  }

  async function handleApplySuggestions() {
    const withSuggestions = selectedItems.length
      ? selectedItems.filter((g) => g.suggestedFolder)
      : senderGroups.filter((g) => g.suggestedFolder);
    if (!withSuggestions.length) return;
    const matchBy = queryOpts.groupBy === "domain" ? "domain" : "sender";
    await onCreatePlan(
      withSuggestions.map((group) => ({
        group,
        destFolder: group.suggestedFolder!,
        matchBy,
      })),
    );
    setSelectedKeys(new Set());
  }

  async function handleUnsubscribeOne(group: SenderGroup) {
    const key = rowKey(group);
    setUnsubBusyKey(key);
    setUnsubFeedback(null);
    try {
      const res = await onUnsubscribeSender(group);
      const label =
        queryOpts.groupBy === "domain"
          ? group.domain || group.groupKey
          : group.fromAddr || group.groupKey;
      if (res.verified) {
        setUnsubFeedback({
          kind: "ok",
          text: `${label} : ${res.message}`,
        });
      } else if (res.status === "opened_browser" || res.status === "opened_mailto") {
        setUnsubFeedback({
          kind: "info",
          text: `${label} : ${res.message}`,
          pendingGroup: group,
          pendingMethod: res.method,
          pendingUrl: res.url,
        });
      } else {
        setUnsubFeedback({
          kind: "warn",
          text: `${label} : ${res.message}`,
          pendingGroup: res.status === "expired" ? group : undefined,
          pendingMethod: "manual",
          pendingUrl: res.url,
        });
      }
    } catch (err) {
      setUnsubFeedback({
        kind: "warn",
        text: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setUnsubBusyKey(null);
    }
  }

  async function handleUnsubscribeSelected() {
    if (!selectedItems.length) return;
    setBatchUnsubRunning(true);
    setUnsubFeedback(null);
    try {
      const results = await onUnsubscribeBatch(selectedItems);
      setBatchOutcomes(results);
      const verifiedCount = results.filter((r) => r.result.verified).length;
      const manualCount = results.filter(
        (r) =>
          r.result.status === "opened_browser" ||
          r.result.status === "opened_mailto",
      ).length;
      const expiredCount = results.filter(
        (r) => r.result.status === "expired",
      ).length;
      const noneCount = results.length - verifiedCount - manualCount - expiredCount;
      setUnsubFeedback({
        kind: verifiedCount > 0 ? "ok" : manualCount > 0 ? "info" : "warn",
        text: formatMessage(t.triage.batchVerifySummary, {
          verified: verifiedCount,
          manual: manualCount,
          expired: expiredCount,
          none: noneCount,
        }),
      });
      setSelectedKeys(new Set());
    } finally {
      setBatchUnsubRunning(false);
    }
  }

  async function handleOpenBatchLink(idx: number) {
    const outcome = batchOutcomes[idx];
    if (!outcome?.result.url) return;
    await window.sortbox.app.openExternal(outcome.result.url);
    setBatchOutcomes((prev) =>
      prev.map((item, i) =>
        i === idx
          ? {
              ...item,
              result: {
                ...item.result,
                message: t.triage.batchOpenedHint,
              },
            }
          : item,
      ),
    );
  }

  async function handleConfirmBatchOutcome(idx: number) {
    const outcome = batchOutcomes[idx];
    if (!outcome) return;
    await onMarkUnsubscribedManual(
      outcome.group,
      outcome.result.method,
      outcome.result.url,
    );
    setBatchOutcomes((prev) =>
      prev.map((item, i) =>
        i === idx ? { ...item, handledManually: true } : item,
      ),
    );
  }

  async function handleTrashBatchUnsubscribed() {
    const actionable = batchOutcomes
      .filter(
        (o) =>
          o.result.verified ||
          o.handledManually ||
          o.result.status === "opened_browser" ||
          o.result.status === "opened_mailto" ||
          o.result.status === "expired",
      )
      .map((o) => o.group);
    if (!actionable.length) return;
    const matchBy = queryOpts.groupBy === "domain" ? "domain" : "sender";
    await onCreatePlan(
      actionable.map((group) => ({
        group,
        destFolder: SPECIAL_TRASH,
        matchBy,
      })),
    );
    setBatchOutcomes([]);
  }

  return (
    <div className="space-y-4">
      {/* Sync Controls */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">
            {t.triage.title}
          </h2>
          <p className="text-xs text-slate-400">
            {t.triage.subtitle}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select
            value={syncFolder}
            onChange={(e) => {
              setSyncFolder(e.target.value);
              onChangeQueryOpts({ ...queryOpts, folderPath: e.target.value });
            }}
            className="text-xs bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-2 outline-none"
          >
            {uniqueFolderNames.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>

          <select
            value={syncLimit}
            onChange={(e) => setSyncLimit(Number(e.target.value))}
            className="text-xs bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-2 outline-none"
          >
            <option value={500}>{t.triage.last500}</option>
            <option value={1000}>{t.triage.last1000}</option>
            <option value={3000}>{t.triage.last3000}</option>
            <option value={0}>{t.triage.allEmails}</option>
          </select>

          <button
            type="button"
            disabled={syncing || !accounts.length}
            onClick={handleRunSync}
            className="text-xs px-3.5 py-2 rounded-lg bg-sky-500 hover:bg-sky-400 text-slate-950 font-semibold flex items-center gap-1.5 cursor-pointer disabled:opacity-40"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${syncing ? "animate-spin" : ""}`} />
            {syncing ? t.triage.auditing : t.triage.auditBtn}
          </button>
        </div>
      </div>

      {syncProgress && syncProgress.status !== "done" && (
        <div className="bg-slate-900 border border-sky-800/70 rounded-xl p-3 space-y-1.5 text-xs">
          <div className="flex justify-between">
            <span className="text-sky-300">
              {syncProgress.message || `${t.triage.syncingPrefix} ${syncProgress.folderPath}...`}
            </span>
            <span className="font-mono tabular-nums text-slate-300">
              {syncProgress.fetched} / {syncProgress.total}
            </span>
          </div>
          {syncProgress.total > 0 && (
            <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-sky-500 transition-all"
                style={{
                  width: `${Math.min(
                    100,
                    Math.round((syncProgress.fetched / syncProgress.total) * 100),
                  )}%`,
                }}
              />
            </div>
          )}
        </div>
      )}

      {/* Search & Filters */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-2.5" />
              <input
                type="text"
                value={queryOpts.search || ""}
                onChange={(e) =>
                  onChangeQueryOpts({ ...queryOpts, search: e.target.value })
                }
                placeholder={t.triage.searchPlaceholder}
                className="text-xs bg-slate-950 border border-slate-700 rounded-lg pl-8 pr-3 py-2 w-60 outline-none focus:border-sky-500"
              />
            </div>

            <select
              value={queryOpts.filter || "all"}
              onChange={(e) =>
                onChangeQueryOpts({
                  ...queryOpts,
                  filter: e.target.value as SenderQueryOptions["filter"],
                })
              }
              className="text-xs bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-2 outline-none"
            >
              <option value="all">{t.triage.filterAll}</option>
              <option value="newsletter">{t.triage.filterNewsletter}</option>
              <option value="known">{t.triage.filterKnown}</option>
              <option value="unknown">{t.triage.filterUnknown}</option>
              <option value="unread">{t.triage.filterUnread}</option>
              <option value="large">{t.triage.filterLarge}</option>
            </select>

            <select
              value={queryOpts.groupBy || "sender"}
              onChange={(e) =>
                onChangeQueryOpts({
                  ...queryOpts,
                  groupBy: e.target.value as "sender" | "domain",
                })
              }
              className="text-xs bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-2 outline-none"
            >
              <option value="sender">{t.triage.groupBySender}</option>
              <option value="domain">{t.triage.groupByDomain}</option>
            </select>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() =>
                onChangeQueryOpts({
                  ...queryOpts,
                  filter:
                    queryOpts.filter === "newsletter" ? "all" : "newsletter",
                })
              }
              className={`text-xs px-3 py-2 rounded-lg border inline-flex items-center gap-1.5 cursor-pointer ${
                queryOpts.filter === "newsletter"
                  ? "border-amber-500 bg-amber-500/20 text-amber-200 font-semibold"
                  : "border-slate-700 bg-slate-950 text-slate-300 hover:bg-slate-800"
              }`}
            >
              <BellOff className="w-3.5 h-3.5" />
              {t.triage.newslettersBtn}
            </button>

            <button
              type="button"
              onClick={handleApplySuggestions}
              className="text-xs px-3 py-2 rounded-lg border border-emerald-700/70 bg-emerald-950/40 text-emerald-300 hover:bg-emerald-900/40 cursor-pointer"
            >
              {t.triage.autoSortBtn}
            </button>
          </div>
        </div>

        {/* Bulk Action Bar */}
        <div className="flex flex-wrap items-center justify-between gap-2 p-3 rounded-lg bg-slate-950 border border-slate-800">
          <span className="text-xs text-slate-300 tabular-nums">
            {selectedItems.length} {t.triage.selectedWord} •{" "}
            <strong className="text-white">
              {selectedEmailCount} {t.triage.emailsUnit}
            </strong>
          </span>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={!selectedItems.length || batchUnsubRunning}
              onClick={handleUnsubscribeSelected}
              className="text-xs px-3 py-1.5 rounded-lg border border-amber-600/80 bg-amber-950/50 hover:bg-amber-900/60 text-amber-200 font-semibold flex items-center gap-1.5 cursor-pointer disabled:opacity-40"
            >
              <BellOff className={`w-3.5 h-3.5 ${batchUnsubRunning ? "animate-pulse" : ""}`} />
              {batchUnsubRunning ? t.triage.unsubscribing : t.triage.unsubscribeSelectedBtn}
            </button>

            <select
              value={destFolder}
              onChange={(e) => setDestFolder(e.target.value)}
              className="text-xs bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 outline-none"
            >
              {destinationChoices.map((d) => (
                <option key={d} value={d}>
                  {formatDestinationLabel(d, lang)}
                </option>
              ))}
              <option value="__custom__">{t.triage.customFolderOption}</option>
            </select>

            {destFolder === "__custom__" && (
              <input
                type="text"
                value={customDest}
                onChange={(e) => setCustomDest(e.target.value)}
                placeholder={t.triage.customFolderPlaceholder}
                className="text-xs bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 w-40 outline-none"
              />
            )}

            <button
              type="button"
              disabled={!selectedItems.length}
              onClick={handleAddSelectedToPlan}
              className="text-xs px-3 py-1.5 rounded-lg bg-sky-500 hover:bg-sky-400 text-slate-950 font-semibold flex items-center gap-1.5 cursor-pointer disabled:opacity-40"
            >
              <FolderPlus className="w-3.5 h-3.5" />
              {t.triage.addToPlanBtn}
            </button>
          </div>
        </div>

        {/* Unsubscribe feedback & batch follow-up */}
        {unsubFeedback && (
          <div
            className={`p-3 rounded-lg border text-xs flex flex-wrap items-center justify-between gap-2 ${
              unsubFeedback.kind === "ok"
                ? "bg-emerald-950/40 border-emerald-700/80 text-emerald-200"
                : unsubFeedback.kind === "info"
                  ? "bg-sky-950/40 border-sky-700/80 text-sky-200"
                  : "bg-amber-950/40 border-amber-700/80 text-amber-200"
            }`}
          >
            <span>{unsubFeedback.text}</span>
            <div className="flex items-center gap-2 shrink-0">
              {unsubFeedback.pendingGroup && (
                <>
                  <button
                    type="button"
                    onClick={async () => {
                      const g = unsubFeedback.pendingGroup!;
                      await onMarkUnsubscribedManual(
                        g,
                        unsubFeedback.pendingMethod || "manual",
                        unsubFeedback.pendingUrl ?? null,
                      );
                      setUnsubFeedback({
                        kind: "ok",
                        text: `${g.fromAddr || g.domain || g.groupKey} : ${t.triage.markedDoneFeedback}`,
                      });
                    }}
                    className="px-2.5 py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-white font-semibold inline-flex items-center gap-1 cursor-pointer"
                  >
                    <CheckCircle2 className="w-3 h-3" />
                    {unsubFeedback.kind === "warn" ? t.triage.markHandled : t.triage.markDone}
                  </button>
                  {unsubFeedback.kind === "info" && (
                    <button
                      type="button"
                      onClick={() => handleUnsubscribeOne(unsubFeedback.pendingGroup!)}
                      className="px-2 py-1 rounded border border-sky-600/80 hover:bg-sky-900/40 text-sky-200 cursor-pointer"
                    >
                      {t.triage.recheck}
                    </button>
                  )}
                </>
              )}
              <button
                type="button"
                onClick={() => setUnsubFeedback(null)}
                className="underline cursor-pointer shrink-0"
              >
                {t.triage.close}
              </button>
            </div>
          </div>
        )}

        {batchOutcomes.length > 0 && (
          <div className="p-3 rounded-lg bg-slate-950 border border-amber-700/60 space-y-2.5 text-xs">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <strong className="text-amber-200">
                {formatMessage(t.triage.batchTrackingTitle, { count: batchOutcomes.length })}
              </strong>
              <div className="flex items-center gap-2">
                {batchOutcomes.some(
                  (o) =>
                    o.result.verified ||
                    o.handledManually ||
                    o.result.status === "opened_browser" ||
                    o.result.status === "opened_mailto" ||
                    o.result.status === "expired",
                ) && (
                  <button
                    type="button"
                    onClick={handleTrashBatchUnsubscribed}
                    className="px-2.5 py-1 rounded bg-rose-600/90 hover:bg-rose-500 text-white font-semibold inline-flex items-center gap-1 cursor-pointer"
                  >
                    <Trash2 className="w-3 h-3" />
                    {t.triage.cleanEmailsTrash}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setBatchOutcomes([])}
                  className="text-slate-400 hover:text-slate-200 underline cursor-pointer"
                >
                  {t.triage.close}
                </button>
              </div>
            </div>

            <div className="space-y-1.5 max-h-52 overflow-y-auto">
              {batchOutcomes.map((o, idx) => {
                const label =
                  queryOpts.groupBy === "domain"
                    ? o.group.domain || o.group.groupKey
                    : o.group.fromAddr || o.group.groupKey;
                const needsManualLink =
                  (o.result.status === "opened_browser" ||
                    o.result.status === "opened_mailto") &&
                  o.result.url;
                return (
                  <div
                    key={rowKey(o.group)}
                    className="flex flex-wrap items-center justify-between gap-2 px-2.5 py-1.5 rounded bg-slate-900 border border-slate-800"
                  >
                    <div className="min-w-0">
                      <span className="font-medium text-slate-200">{label}</span>{" "}
                      <span className="text-slate-400">— {o.result.message}</span>
                    </div>
                    {o.result.verified || o.handledManually ? (
                      <span className="text-emerald-300 inline-flex items-center gap-1 shrink-0 font-semibold">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        {t.triage.badgeConfirmed}
                      </span>
                    ) : needsManualLink ? (
                      <div className="inline-flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => handleOpenBatchLink(idx)}
                          className="px-2.5 py-1 rounded bg-sky-500 hover:bg-sky-400 text-slate-950 font-semibold inline-flex items-center gap-1 cursor-pointer"
                        >
                          {o.result.status === "opened_mailto" ? (
                            <Mail className="w-3 h-3" />
                          ) : (
                            <ExternalLink className="w-3 h-3" />
                          )}
                          {o.result.status === "opened_mailto"
                            ? t.triage.openEmail
                            : t.triage.openLink}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleConfirmBatchOutcome(idx)}
                          className="px-2 py-1 rounded border border-emerald-700 bg-emerald-950/50 hover:bg-emerald-900/60 text-emerald-200 font-semibold cursor-pointer"
                        >
                          {t.triage.markDone}
                        </button>
                      </div>
                    ) : o.result.status === "expired" ? (
                      <div className="inline-flex items-center gap-1.5 shrink-0">
                        <span className="text-rose-300">{t.triage.expired404}</span>
                        <button
                          type="button"
                          onClick={() => handleConfirmBatchOutcome(idx)}
                          className="px-2 py-1 rounded border border-slate-700 hover:bg-slate-800 text-slate-300 cursor-pointer"
                        >
                          {t.triage.markHandled}
                        </button>
                      </div>
                    ) : (
                      <span className="text-slate-500 shrink-0">{t.triage.noLink}</span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Senders Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-800 text-slate-400">
                <th className="py-2 pr-2 w-8">
                  <input
                    type="checkbox"
                    checked={
                      senderGroups.length > 0 &&
                      selectedKeys.size === senderGroups.length
                    }
                    onChange={(e) => toggleAll(e.target.checked)}
                    className="accent-sky-500 cursor-pointer"
                  />
                </th>
                <th className="py-2 pr-3">{t.triage.colSender}</th>
                <th className="py-2 pr-3">{t.triage.colCategory}</th>
                <th className="py-2 pr-3 text-right">{t.triage.colEmails}</th>
                <th className="py-2 pr-3 text-right">{t.triage.colUnread}</th>
                <th className="py-2 pr-3 text-right">{t.triage.colSize}</th>
                <th className="py-2 text-right">{t.triage.colActions}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/80">
              {senderGroups.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-slate-500">
                    {t.triage.emptyTable}
                  </td>
                </tr>
              ) : (
                senderGroups.map((g) => {
                  const key = rowKey(g);
                  const categoryLabel = localizeCategory(g.suggestedCategory, lang);
                  return (
                    <tr key={key} className="hover:bg-slate-950/60">
                      <td className="py-2.5 pr-2">
                        <input
                          type="checkbox"
                          checked={selectedKeys.has(key)}
                          onChange={() => toggleRow(g)}
                          className="accent-sky-500 cursor-pointer"
                        />
                      </td>
                      <td className="py-2.5 pr-3 max-w-md">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="font-medium text-slate-100 truncate">
                            {queryOpts.groupBy === "domain"
                              ? g.domain || g.groupKey
                              : g.fromAddr || g.groupKey}
                          </span>
                          {g.unsubscribeStatus === "confirmed" || g.unsubscribedAt ? (
                            <span
                              title={
                                g.unsubscribeStatusDetail ||
                                (g.unsubscribedAt
                                  ? `${t.triage.unsubOnPrefix} ${new Date(g.unsubscribedAt).toLocaleString(locale)}`
                                  : t.triage.badgeUnsubscribedTitle)
                              }
                              className="px-1.5 py-0.5 text-[10px] rounded-full bg-emerald-950/70 border border-emerald-700/80 text-emerald-300 inline-flex items-center gap-0.5 shrink-0"
                            >
                              <CheckCircle2 className="w-2.5 h-2.5" />
                              {t.triage.badgeUnsubscribed}
                            </span>
                          ) : g.unsubscribeStatus === "pending" ? (
                            <span
                              title={g.unsubscribeStatusDetail || t.triage.badgePendingTitle}
                              className="px-1.5 py-0.5 text-[10px] rounded-full bg-sky-950/70 border border-sky-700/80 text-sky-300 shrink-0"
                            >
                              {t.triage.badgePending}
                            </span>
                          ) : g.unsubscribeStatus === "failed" ? (
                            <span
                              title={g.unsubscribeStatusDetail || t.triage.badgeFailedTitle}
                              className="px-1.5 py-0.5 text-[10px] rounded-full bg-rose-950/70 border border-rose-700/80 text-rose-300 shrink-0"
                            >
                              {t.triage.badgeFailed}
                            </span>
                          ) : g.unsubscribeOneClick ? (
                            <span className="px-1.5 py-0.5 text-[10px] rounded-full bg-indigo-950/70 border border-indigo-700/80 text-indigo-300 shrink-0">
                              {t.triage.badgeOneClick}
                            </span>
                          ) : g.hasUnsubscribe ? (
                            <span className="px-1.5 py-0.5 text-[10px] rounded-full bg-amber-950/60 border border-amber-700/70 text-amber-300 shrink-0">
                              {t.triage.badgeNewsletter}
                            </span>
                          ) : null}
                        </div>
                        <div className="text-slate-400 truncate">
                          {g.sampleSubjects[0] || t.triage.noSubject}
                        </div>
                      </td>
                      <td className="py-2.5 pr-3">
                        {categoryLabel ? (
                          <span className="px-2 py-0.5 rounded-full bg-slate-800 border border-slate-700 text-sky-300">
                            {categoryLabel}
                          </span>
                        ) : (
                          <span className="text-slate-500">—</span>
                        )}
                      </td>
                      <td className="py-2.5 pr-3 text-right font-mono tabular-nums font-semibold">
                        {g.totalCount}
                      </td>
                      <td className="py-2.5 pr-3 text-right font-mono tabular-nums text-amber-400">
                        {g.unreadCount}
                      </td>
                      <td className="py-2.5 pr-3 text-right font-mono tabular-nums text-slate-400">
                        {formatBytesLocalized(g.totalSizeBytes, lang)}
                      </td>
                      <td className="py-2.5 text-right">
                        <div className="inline-flex items-center gap-1.5">
                          {g.unsubscribeStatus === "pending" && (
                            <button
                              type="button"
                              title={t.triage.confirmManualTitle}
                              onClick={() =>
                                onMarkUnsubscribedManual(
                                  g,
                                  "manual",
                                  g.unsubscribeUrl ?? null,
                                )
                              }
                              className="px-2 py-1 rounded border border-emerald-700/80 bg-emerald-950/50 text-emerald-200 hover:bg-emerald-900/50 inline-flex items-center gap-1 cursor-pointer"
                            >
                              <CheckCircle2 className="w-3 h-3" />
                              {t.triage.markDone}
                            </button>
                          )}
                          <button
                            type="button"
                            disabled={unsubBusyKey === key}
                            title={
                              g.unsubscribeStatus === "confirmed" || g.unsubscribedAt
                                ? t.triage.unsubTooltipConfirmed
                                : g.unsubscribeStatus === "pending"
                                  ? t.triage.unsubTooltipPending
                                  : g.unsubscribeStatus === "failed"
                                    ? t.triage.unsubTooltipFailed
                                    : g.hasUnsubscribe
                                      ? t.triage.unsubTooltipHas
                                      : t.triage.unsubTooltipFind
                            }
                            onClick={() => handleUnsubscribeOne(g)}
                            className={`px-2 py-1 rounded border inline-flex items-center gap-1 cursor-pointer disabled:opacity-50 ${
                              g.unsubscribeStatus === "confirmed" || g.unsubscribedAt
                                ? "border-emerald-800/70 bg-emerald-950/40 text-emerald-300 hover:bg-emerald-900/40"
                                : g.unsubscribeStatus === "pending"
                                  ? "border-sky-700/80 bg-sky-950/50 text-sky-200 hover:bg-sky-900/50"
                                  : g.unsubscribeStatus === "failed"
                                    ? "border-rose-700/80 bg-rose-950/50 text-rose-200 hover:bg-rose-900/50"
                                    : g.hasUnsubscribe
                                      ? "border-amber-700/80 bg-amber-950/50 text-amber-200 hover:bg-amber-900/60"
                                      : "border-slate-700 bg-slate-900 text-slate-300 hover:bg-slate-800"
                            }`}
                          >
                            <BellOff
                              className={`w-3 h-3 ${
                                unsubBusyKey === key ? "animate-spin" : ""
                              }`}
                            />
                            {unsubBusyKey === key
                              ? t.triage.unsubBusy
                              : g.unsubscribeStatus === "confirmed" || g.unsubscribedAt
                                ? t.triage.unsubVerify
                                : g.unsubscribeStatus === "pending"
                                  ? t.triage.unsubVerify
                                  : g.unsubscribeStatus === "failed"
                                    ? t.triage.unsubRetry
                                    : g.hasUnsubscribe
                                      ? t.triage.unsubAction
                                      : t.triage.unsubMaybe}
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              onCreatePlan([
                                {
                                  group: g,
                                  destFolder: SPECIAL_TRASH,
                                  matchBy:
                                    queryOpts.groupBy === "domain"
                                      ? "domain"
                                      : "sender",
                                },
                              ])
                            }
                            className="px-2 py-1 rounded border border-slate-700 bg-slate-800 hover:bg-rose-950 hover:border-rose-700 text-slate-200 inline-flex items-center gap-1 cursor-pointer"
                          >
                            <Trash2 className="w-3 h-3 text-rose-400" />
                            {t.triage.trashBtn}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
