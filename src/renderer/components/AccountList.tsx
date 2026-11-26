import React, { useState } from "react";
import {
  CheckCircle2,
  Edit3,
  PlugZap,
  Plus,
  RefreshCw,
  Trash2,
  Unplug,
} from "lucide-react";
import { formatMessage } from "../../shared/i18n.js";
import type { MailAccount } from "../../shared/types.js";
import { useI18n } from "../i18n/I18nContext.js";

interface AccountListProps {
  accounts: MailAccount[];
  onEditAccount: (account: MailAccount) => void;
  onDisconnectAccount: (accountId: string) => Promise<void>;
  onDeleteAccount: (accountId: string) => Promise<void>;
  onTestSavedAccount: (
    account: MailAccount,
  ) => Promise<{ ok: true; folderCount: number }>;
  onAddNew?: () => void;
}

export function AccountList({
  accounts,
  onEditAccount,
  onDisconnectAccount,
  onDeleteAccount,
  onTestSavedAccount,
  onAddNew,
}: AccountListProps) {
  const { t } = useI18n();
  const [testingId, setTestingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<
    Record<string, { ok: boolean; text: string }>
  >({});

  async function handleTest(acc: MailAccount) {
    setTestingId(acc.id);
    try {
      const res = await onTestSavedAccount(acc);
      setTestResults((prev) => ({
        ...prev,
        [acc.id]: {
          ok: true,
          text: formatMessage(t.accountList.testOk, { count: res.folderCount }),
        },
      }));
    } catch (err) {
      setTestResults((prev) => ({
        ...prev,
        [acc.id]: {
          ok: false,
          text: err instanceof Error ? err.message : String(err),
        },
      }));
    } finally {
      setTestingId(null);
    }
  }

  return (
    <div className="space-y-2.5 text-xs">
      {accounts.length === 0 ? (
        <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 text-slate-400 text-center space-y-2">
          <p>{t.accountList.noMailboxes}</p>
          {onAddNew && (
            <button
              type="button"
              onClick={onAddNew}
              className="px-3 py-1.5 rounded-lg bg-sky-500 hover:bg-sky-400 text-slate-950 font-semibold inline-flex items-center gap-1 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              {t.accountList.connectBtn}
            </button>
          )}
        </div>
      ) : (
        accounts.map((acc) => {
          const isConnected = acc.hasCredentials !== false;
          const testOutcome = testResults[acc.id];
          return (
            <div
              key={acc.id}
              className="p-3 rounded-xl bg-slate-950 border border-slate-800 space-y-2"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="font-semibold text-slate-100 truncate">
                      {acc.label && acc.label !== acc.email
                        ? `${acc.label} (${acc.email})`
                        : acc.email}
                    </span>
                    {!isConnected ? (
                      <span className="px-1.5 py-0.5 text-[10px] rounded-full bg-amber-950/70 border border-amber-700/80 text-amber-300">
                        {t.accountList.disconnected}
                      </span>
                    ) : acc.lastSyncStatus === "error" ? (
                      <span className="px-1.5 py-0.5 text-[10px] rounded-full bg-rose-950/70 border border-rose-700/80 text-rose-300">
                        {t.accountList.syncError}
                      </span>
                    ) : (
                      <span className="px-1.5 py-0.5 text-[10px] rounded-full bg-emerald-950/70 border border-emerald-700/80 text-emerald-300 inline-flex items-center gap-0.5">
                        <CheckCircle2 className="w-2.5 h-2.5" />
                        {t.accountList.connected}
                      </span>
                    )}
                  </div>
                  <div className="text-slate-400 mt-0.5">
                    {acc.imapHost}:{acc.imapPort} ({acc.imapSecure ? "SSL/TLS" : "STARTTLS"}) •{" "}
                    {acc.authMode === "microsoft_oauth"
                      ? t.accountList.oauthLabel
                      : t.accountList.imapPassLabel}
                  </div>
                  {acc.lastSyncError && isConnected && (
                    <div className="text-rose-300 mt-1 break-words">
                      {acc.lastSyncError}
                    </div>
                  )}
                  {testOutcome && (
                    <div
                      className={`mt-1 ${
                        testOutcome.ok ? "text-emerald-300" : "text-rose-300"
                      }`}
                    >
                      {testOutcome.text}
                    </div>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                  {isConnected && (
                    <button
                      type="button"
                      disabled={testingId === acc.id}
                      onClick={() => handleTest(acc)}
                      title={t.accountList.testTitle}
                      className="px-2.5 py-1 rounded-lg border border-slate-700 hover:bg-slate-800 text-slate-200 inline-flex items-center gap-1 cursor-pointer disabled:opacity-50"
                    >
                      <RefreshCw
                        className={`w-3 h-3 ${testingId === acc.id ? "animate-spin" : ""}`}
                      />
                      {t.accountList.testBtn}
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => onEditAccount(acc)}
                    title={t.accountList.editTitle}
                    className={`px-2.5 py-1 rounded-lg border inline-flex items-center gap-1 cursor-pointer ${
                      isConnected
                        ? "border-sky-700/80 bg-sky-950/40 hover:bg-sky-900/50 text-sky-200"
                        : "border-sky-500 bg-sky-500 hover:bg-sky-400 text-slate-950 font-semibold"
                    }`}
                  >
                    {isConnected ? (
                      <>
                        <Edit3 className="w-3 h-3" />
                        {t.accountList.editBtn}
                      </>
                    ) : (
                      <>
                        <PlugZap className="w-3 h-3" />
                        {t.accountList.reconnectBtn}
                      </>
                    )}
                  </button>

                  {isConnected && (
                    <button
                      type="button"
                      onClick={() => onDisconnectAccount(acc.id)}
                      title={t.accountList.disconnectTitle}
                      className="px-2.5 py-1 rounded-lg border border-amber-800/80 bg-amber-950/30 hover:bg-amber-900/40 text-amber-200 inline-flex items-center gap-1 cursor-pointer"
                    >
                      <Unplug className="w-3 h-3" />
                      {t.accountList.disconnectBtn}
                    </button>
                  )}

                  {confirmDeleteId === acc.id ? (
                    <div className="inline-flex items-center gap-1">
                      <button
                        type="button"
                        onClick={async () => {
                          await onDeleteAccount(acc.id);
                          setConfirmDeleteId(null);
                        }}
                        className="px-2 py-1 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-semibold cursor-pointer"
                      >
                        {t.accountList.confirmDeleteBtn}
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteId(null)}
                        className="px-2 py-1 rounded-lg border border-slate-700 hover:bg-slate-800 text-slate-300 cursor-pointer"
                      >
                        {t.accountList.cancelDeleteBtn}
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmDeleteId(acc.id)}
                      title={t.accountList.deleteTitle}
                      className="p-1.5 rounded-lg border border-slate-800 text-slate-400 hover:text-rose-400 hover:border-rose-800 cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
