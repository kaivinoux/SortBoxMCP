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
import type {
  FolderInfo,
  MailAccount,
  SenderGroup,
  SenderQueryOptions,
  SyncProgressEvent,
  UnsubscribeResult,
} from "../../shared/types.js";

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

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}

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
    destFolder === "__custom__" ? customDest.trim() || "A_Trier" : destFolder;

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
      if (res.status === "one_click_sent") {
        setUnsubFeedback({
          kind: "ok",
          text: `${label} : ${res.message}`,
        });
      } else if (res.status === "opened_browser" || res.status === "opened_mailto") {
        setUnsubFeedback({
          kind: "info",
          text: `${label} : ${res.message}`,
        });
      } else {
        setUnsubFeedback({
          kind: "warn",
          text: `${label} : ${res.message}`,
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
      const autoCount = results.filter(
        (r) => r.result.status === "one_click_sent",
      ).length;
      const manualCount = results.filter(
        (r) =>
          r.result.status === "opened_browser" ||
          r.result.status === "opened_mailto",
      ).length;
      const noneCount = results.length - autoCount - manualCount;
      setUnsubFeedback({
        kind: autoCount > 0 ? "ok" : "info",
        text: `Lot terminé : ${autoCount} désinscription(s) 1-clic envoyée(s), ${manualCount} à ouvrir ci-dessous, ${noneCount} sans lien détecté.`,
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
          o.result.status === "one_click_sent" ||
          o.result.status === "opened_browser" ||
          o.result.status === "opened_mailto",
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
            Tri par Expéditeur / Domaine (100 % sans IA)
          </h2>
          <p className="text-xs text-slate-400">
            Synchronise les en-têtes en lecture seule puis regroupe tes mails par expéditeur.
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
            <option value={500}>500 derniers mails</option>
            <option value={1000}>1 000 derniers mails</option>
            <option value={3000}>3 000 derniers mails</option>
            <option value={0}>Toute la boîte (illimité)</option>
          </select>

          <button
            type="button"
            disabled={syncing || !accounts.length}
            onClick={handleRunSync}
            className="text-xs px-3.5 py-2 rounded-lg bg-sky-500 hover:bg-sky-400 text-slate-950 font-semibold flex items-center gap-1.5 cursor-pointer disabled:opacity-40"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${syncing ? "animate-spin" : ""}`} />
            {syncing ? "Audit en cours..." : "Auditer (lecture seule)"}
          </button>
        </div>
      </div>

      {syncProgress && syncProgress.status !== "done" && (
        <div className="bg-slate-900 border border-sky-800/70 rounded-xl p-3 space-y-1.5 text-xs">
          <div className="flex justify-between">
            <span className="text-sky-300">
              {syncProgress.message || `Synchronisation ${syncProgress.folderPath}...`}
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
                placeholder="Recherche FTS5 (expéditeur, objet)..."
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
              <option value="all">Tous les expéditeurs</option>
              <option value="newsletter">Newsletters (List-Unsubscribe)</option>
              <option value="known">Reconnus (dictionnaire FR)</option>
              <option value="unknown">À classer (inconnus)</option>
              <option value="unread">Avec non-lus</option>
              <option value="large">Volumineux (&gt; 5 Mo)</option>
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
              <option value="sender">Grouper par adresse exacte</option>
              <option value="domain">Grouper par domaine</option>
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
              Newsletters
            </button>

            <button
              type="button"
              onClick={handleApplySuggestions}
              className="text-xs px-3 py-2 rounded-lg border border-emerald-700/70 bg-emerald-950/40 text-emerald-300 hover:bg-emerald-900/40 cursor-pointer"
            >
              Pré-trier via dictionnaire intégré
            </button>
          </div>
        </div>

        {/* Bulk Action Bar */}
        <div className="flex flex-wrap items-center justify-between gap-2 p-3 rounded-lg bg-slate-950 border border-slate-800">
          <span className="text-xs text-slate-300 tabular-nums">
            {selectedItems.length} sélectionné(s) •{" "}
            <strong className="text-white">{selectedEmailCount} mails</strong>
          </span>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={!selectedItems.length || batchUnsubRunning}
              onClick={handleUnsubscribeSelected}
              className="text-xs px-3 py-1.5 rounded-lg border border-amber-600/80 bg-amber-950/50 hover:bg-amber-900/60 text-amber-200 font-semibold flex items-center gap-1.5 cursor-pointer disabled:opacity-40"
            >
              <BellOff className={`w-3.5 h-3.5 ${batchUnsubRunning ? "animate-pulse" : ""}`} />
              {batchUnsubRunning ? "Désinscription..." : "Se désinscrire (sélection)"}
            </button>

            <select
              value={destFolder}
              onChange={(e) => setDestFolder(e.target.value)}
              className="text-xs bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 outline-none"
            >
              {destinationChoices.map((d) => (
                <option key={d} value={d}>
                  {formatDestinationLabel(d)}
                </option>
              ))}
              <option value="__custom__">+ Autre dossier...</option>
            </select>

            {destFolder === "__custom__" && (
              <input
                type="text"
                value={customDest}
                onChange={(e) => setCustomDest(e.target.value)}
                placeholder="MonDossier"
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
              Ajouter au plan Dry-Run
            </button>
          </div>
        </div>

        {/* Unsubscribe feedback & batch follow-up */}
        {unsubFeedback && (
          <div
            className={`p-3 rounded-lg border text-xs flex items-center justify-between gap-2 ${
              unsubFeedback.kind === "ok"
                ? "bg-emerald-950/40 border-emerald-700/80 text-emerald-200"
                : unsubFeedback.kind === "info"
                  ? "bg-sky-950/40 border-sky-700/80 text-sky-200"
                  : "bg-amber-950/40 border-amber-700/80 text-amber-200"
            }`}
          >
            <span>{unsubFeedback.text}</span>
            <button
              type="button"
              onClick={() => setUnsubFeedback(null)}
              className="underline cursor-pointer shrink-0"
            >
              Fermer
            </button>
          </div>
        )}

        {batchOutcomes.length > 0 && (
          <div className="p-3 rounded-lg bg-slate-950 border border-amber-700/60 space-y-2.5 text-xs">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <strong className="text-amber-200">
                Suivi de désinscription ({batchOutcomes.length} newsletter(s))
              </strong>
              <div className="flex items-center gap-2">
                {batchOutcomes.some(
                  (o) =>
                    o.result.status === "one_click_sent" ||
                    o.result.status === "opened_browser" ||
                    o.result.status === "opened_mailto",
                ) && (
                  <button
                    type="button"
                    onClick={handleTrashBatchUnsubscribed}
                    className="px-2.5 py-1 rounded bg-rose-600/90 hover:bg-rose-500 text-white font-semibold inline-flex items-center gap-1 cursor-pointer"
                  >
                    <Trash2 className="w-3 h-3" />
                    Nettoyer leurs mails (Corbeille Dry-Run)
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setBatchOutcomes([])}
                  className="text-slate-400 hover:text-slate-200 underline cursor-pointer"
                >
                  Fermer
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
                    {o.result.status === "one_click_sent" || o.handledManually ? (
                      <span className="text-emerald-300 inline-flex items-center gap-1 shrink-0 font-semibold">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        Désinscrit
                      </span>
                    ) : needsManualLink ? (
                      <button
                        type="button"
                        onClick={() => handleOpenBatchLink(idx)}
                        className="px-2.5 py-1 rounded bg-sky-500 hover:bg-sky-400 text-slate-950 font-semibold inline-flex items-center gap-1 cursor-pointer shrink-0"
                      >
                        {o.result.status === "opened_mailto" ? (
                          <Mail className="w-3 h-3" />
                        ) : (
                          <ExternalLink className="w-3 h-3" />
                        )}
                        {o.result.status === "opened_mailto"
                          ? "Ouvrir l'e-mail"
                          : "Ouvrir le lien"}
                      </button>
                    ) : (
                      <span className="text-slate-500 shrink-0">Aucun lien</span>
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
                <th className="py-2 pr-3">Expéditeur / Exemples</th>
                <th className="py-2 pr-3">Catégorie locale</th>
                <th className="py-2 pr-3 text-right">Mails</th>
                <th className="py-2 pr-3 text-right">Non lus</th>
                <th className="py-2 pr-3 text-right">Poids</th>
                <th className="py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/80">
              {senderGroups.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-slate-500">
                    Aucun mail indexé pour ce filtre. Clique sur « Auditer (lecture seule) » pour analyser ta boîte.
                  </td>
                </tr>
              ) : (
                senderGroups.map((g) => {
                  const key = rowKey(g);
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
                          {g.unsubscribedAt ? (
                            <span
                              title={`Désinscrit le ${new Date(g.unsubscribedAt).toLocaleString("fr-FR")}`}
                              className="px-1.5 py-0.5 text-[10px] rounded-full bg-emerald-950/70 border border-emerald-700/80 text-emerald-300 inline-flex items-center gap-0.5 shrink-0"
                            >
                              <CheckCircle2 className="w-2.5 h-2.5" />
                              Désinscrit
                            </span>
                          ) : g.unsubscribeOneClick ? (
                            <span className="px-1.5 py-0.5 text-[10px] rounded-full bg-indigo-950/70 border border-indigo-700/80 text-indigo-300 shrink-0">
                              1-clic auto
                            </span>
                          ) : g.hasUnsubscribe ? (
                            <span className="px-1.5 py-0.5 text-[10px] rounded-full bg-amber-950/60 border border-amber-700/70 text-amber-300 shrink-0">
                              Newsletter
                            </span>
                          ) : null}
                        </div>
                        <div className="text-slate-400 truncate">
                          {g.sampleSubjects[0] || "(Sans objet)"}
                        </div>
                      </td>
                      <td className="py-2.5 pr-3">
                        {g.suggestedCategory ? (
                          <span className="px-2 py-0.5 rounded-full bg-slate-800 border border-slate-700 text-sky-300">
                            {g.suggestedCategory}
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
                        {formatBytes(g.totalSizeBytes)}
                      </td>
                      <td className="py-2.5 text-right">
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            type="button"
                            disabled={unsubBusyKey === key}
                            title={
                              g.unsubscribedAt
                                ? "Relancer ou vérifier la désinscription"
                                : g.hasUnsubscribe
                                  ? "Se désinscrire de cette newsletter"
                                  : "Chercher un lien de désinscription dans le dernier mail"
                            }
                            onClick={() => handleUnsubscribeOne(g)}
                            className={`px-2 py-1 rounded border inline-flex items-center gap-1 cursor-pointer disabled:opacity-50 ${
                              g.unsubscribedAt
                                ? "border-emerald-800/70 bg-emerald-950/40 text-emerald-300 hover:bg-emerald-900/40"
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
                              ? "..."
                              : g.unsubscribedAt
                                ? "Désinscrit"
                                : g.hasUnsubscribe
                                  ? "Se désinscrire"
                                  : "Désinscrire ?"}
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
                            Corbeille
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
