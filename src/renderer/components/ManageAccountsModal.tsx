import React from "react";
import { Plus, Settings2, X } from "lucide-react";
import { formatMessage } from "../../shared/i18n.js";
import type { MailAccount } from "../../shared/types.js";
import { AccountList } from "./AccountList.js";
import { useI18n } from "../i18n/I18nContext.js";

interface ManageAccountsModalProps {
  open: boolean;
  accounts: MailAccount[];
  onClose: () => void;
  onAddNew: () => void;
  onEditAccount: (account: MailAccount) => void;
  onDisconnectAccount: (accountId: string) => Promise<void>;
  onDeleteAccount: (accountId: string) => Promise<void>;
  onTestSavedAccount: (
    account: MailAccount,
  ) => Promise<{ ok: true; folderCount: number }>;
}

export function ManageAccountsModal({
  open,
  accounts,
  onClose,
  onAddNew,
  onEditAccount,
  onDisconnectAccount,
  onDeleteAccount,
  onTestSavedAccount,
}: ManageAccountsModalProps) {
  const { t } = useI18n();
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800">
          <div className="flex items-center gap-2.5">
            <Settings2 className="w-5 h-5 text-sky-400" />
            <div>
              <h2 className="text-base font-semibold">
                {formatMessage(t.manageModal.title, { count: accounts.length })}
              </h2>
              <p className="text-xs text-slate-400">
                {t.manageModal.subtitle}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-200 p-1 rounded-lg cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <AccountList
            accounts={accounts}
            onEditAccount={(acc) => {
              onClose();
              onEditAccount(acc);
            }}
            onDisconnectAccount={onDisconnectAccount}
            onDeleteAccount={onDeleteAccount}
            onTestSavedAccount={onTestSavedAccount}
            onAddNew={() => {
              onClose();
              onAddNew();
            }}
          />

          <div className="flex items-center justify-between pt-3 border-t border-slate-800 text-xs">
            <span className="text-slate-400">
              {t.manageModal.disconnectNote}
            </span>
            <button
              type="button"
              onClick={() => {
                onClose();
                onAddNew();
              }}
              className="px-3.5 py-2 rounded-lg bg-sky-500 hover:bg-sky-400 text-slate-950 font-semibold inline-flex items-center gap-1.5 cursor-pointer shrink-0"
            >
              <Plus className="w-3.5 h-3.5" />
              {t.manageModal.addBtn}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
