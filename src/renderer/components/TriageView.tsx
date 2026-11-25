import React, { useMemo, useState } from "react";
import {
  ExternalLink,
  FolderPlus,
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
} from "../../shared/types.js";

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
}: TriageViewProps) {
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [destFolder, setDestFolder] = useState(SPECIAL_TRASH);
  const [customDest, setCustomDest] = useState("");
  const [syncFolder, setSyncFolder] = useState("INBOX");
  const [syncLimit, setSyncLimit] = useState(1000);
  const [syncing, setSyncing] = useState(false);

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

          <button
            type="button"
            onClick={handleApplySuggestions}
            className="text-xs px-3 py-2 rounded-lg border border-emerald-700/70 bg-emerald-950/40 text-emerald-300 hover:bg-emerald-900/40 cursor-pointer"
          >
            Pré-trier via dictionnaire intégré
          </button>
        </div>

        {/* Bulk Action Bar */}
        <div className="flex flex-wrap items-center justify-between gap-2 p-3 rounded-lg bg-slate-950 border border-slate-800">
          <span className="text-xs text-slate-300 tabular-nums">
            {selectedItems.length} sélectionné(s) •{" "}
            <strong className="text-white">{selectedEmailCount} mails</strong>
          </span>

          <div className="flex flex-wrap items-center gap-2">
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
                        <div className="font-medium text-slate-100 truncate">
                          {queryOpts.groupBy === "domain"
                            ? g.domain || g.groupKey
                            : g.fromAddr || g.groupKey}
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
                          {g.unsubscribeUrl && (
                            <button
                              type="button"
                              title="Ouvrir le lien de désabonnement"
                              onClick={() =>
                                window.sortbox.app.openExternal(g.unsubscribeUrl!)
                              }
                              className="p-1.5 rounded border border-slate-700 text-slate-300 hover:bg-slate-800 cursor-pointer"
                            >
                              <ExternalLink className="w-3 h-3" />
                            </button>
                          )}
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
