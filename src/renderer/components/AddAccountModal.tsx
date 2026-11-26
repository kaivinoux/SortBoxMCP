import { Capacitor } from "@capacitor/core";
import React, { useEffect, useState } from "react";
import { ExternalLink, KeyRound, Mail, ShieldCheck, X } from "lucide-react";
import { formatMessage } from "../../shared/i18n.js";
import {
  extractCustomMicrosoftClientId,
  type ProviderPreset,
} from "../../shared/providers.js";
import type { AuthMode, MailAccount } from "../../shared/types.js";
import { useI18n } from "../i18n/I18nContext.js";

interface AddAccountModalProps {
  open: boolean;
  editingAccount?: MailAccount | null;
  defaultMicrosoftClientId: string;
  onClose: () => void;
  onAccountAdded: (account: MailAccount) => void;
}

export function AddAccountModal({
  open,
  editingAccount = null,
  defaultMicrosoftClientId,
  onClose,
  onAccountAdded,
}: AddAccountModalProps) {
  const { t } = useI18n();
  const [email, setEmail] = useState("");
  const [label, setLabel] = useState("");
  const [preset, setPreset] = useState<ProviderPreset | null>(null);
  const [authMode, setAuthMode] = useState<AuthMode>("imap_password");
  const [imapHost, setImapHost] = useState("");
  const [imapPort, setImapPort] = useState(993);
  const [imapSecure, setImapSecure] = useState(true);
  const [secret, setSecret] = useState("");
  const [msClientId, setMsClientId] = useState(() =>
    extractCustomMicrosoftClientId(defaultMicrosoftClientId),
  );
  const [showMsAdvanced, setShowMsAdvanced] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [statusMsg, setStatusMsg] = useState<{
    type: "ok" | "error";
    text: string;
  } | null>(null);

  const isEditing = Boolean(editingAccount);
  const needsSecretInput = !isEditing || editingAccount?.hasCredentials === false;

  useEffect(() => {
    setMsClientId(extractCustomMicrosoftClientId(defaultMicrosoftClientId));
  }, [defaultMicrosoftClientId]);

  useEffect(() => {
    if (!open) return;
    setStatusMsg(null);
    setShowMsAdvanced(false);
    if (editingAccount) {
      setEmail(editingAccount.email);
      setLabel(editingAccount.label || editingAccount.email);
      setAuthMode(editingAccount.authMode);
      setImapHost(editingAccount.imapHost);
      setImapPort(editingAccount.imapPort);
      setImapSecure(editingAccount.imapSecure);
      setSecret("");
      window.sortbox.accounts
        .detectProvider(editingAccount.email)
        .then(setPreset)
        .catch(() => {});
    } else {
      setEmail("");
      setLabel("");
      setSecret("");
      setPreset(null);
      setAuthMode("imap_password");
      setImapHost("");
      setImapPort(993);
      setImapSecure(true);
      setShowAdvanced(false);
    }
  }, [open, editingAccount]);

  useEffect(() => {
    if (!open || editingAccount) return;
    let active = true;
    if (!email.includes("@")) {
      setPreset(null);
      return;
    }
    window.sortbox.accounts.detectProvider(email).then((detected) => {
      if (!active) return;
      setPreset(detected);
      setAuthMode(detected.recommendedAuth);
      setImapHost(detected.imapHost);
      setImapPort(detected.imapPort);
      setImapSecure(detected.imapSecure);
    });
    return () => {
      active = false;
    };
  }, [email, open, editingAccount]);

  if (!open) return null;

  async function handleTest() {
    setTesting(true);
    setStatusMsg(null);
    try {
      const res = await window.sortbox.accounts.test({
        accountId: editingAccount?.id,
        email,
        label,
        provider: preset?.id ?? editingAccount?.provider ?? "custom",
        authMode,
        imapHost,
        imapPort,
        imapSecure,
        secret,
      });
      setStatusMsg({
        type: "ok",
        text: formatMessage(t.addModal.imapTestOk, { count: res.folderCount }),
      });
    } catch (err) {
      setStatusMsg({
        type: "error",
        text: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setTesting(false);
    }
  }

  async function handleSaveImap(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setStatusMsg(null);
    try {
      const account = editingAccount
        ? await window.sortbox.accounts.update({
            id: editingAccount.id,
            label: label || email,
            provider: preset?.id ?? editingAccount.provider,
            authMode,
            imapHost,
            imapPort,
            imapSecure,
            secret: secret.trim() ? secret : undefined,
          })
        : await window.sortbox.accounts.add({
            email,
            label: label || email,
            provider: preset?.id ?? "custom",
            authMode,
            imapHost,
            imapPort,
            imapSecure,
            secret,
          });
      onAccountAdded(account);
      setEmail("");
      setLabel("");
      setSecret("");
      onClose();
    } catch (err) {
      setStatusMsg({
        type: "error",
        text: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setSaving(false);
    }
  }

  async function handleMicrosoftOAuth() {
    setSaving(true);
    setStatusMsg(null);
    try {
      const customId = msClientId.trim();
      const prevCustomId = extractCustomMicrosoftClientId(
        defaultMicrosoftClientId,
      );
      if (!customId && prevCustomId) {
        await window.sortbox.settings.save({ microsoftClientId: "" });
      }
      const account = await window.sortbox.accounts.microsoftLogin(
        customId,
        email || undefined,
        editingAccount?.id,
      );
      if (editingAccount && label.trim() && label.trim() !== account.label) {
        const renamed = await window.sortbox.accounts.update({
          id: account.id,
          label: label.trim(),
        });
        onAccountAdded(renamed);
      } else {
        onAccountAdded(account);
      }
      onClose();
    } catch (err) {
      setStatusMsg({
        type: "error",
        text: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="w-full max-w-xl max-h-[90vh] overflow-y-auto bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800">
          <div className="flex items-center gap-2.5">
            <Mail className="w-5 h-5 text-sky-400" />
            <h2 className="text-base font-semibold">
              {isEditing
                ? editingAccount?.hasCredentials === false
                  ? t.addModal.titleReconnect
                  : t.addModal.titleEdit
                : t.addModal.titleAdd}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-200 p-1 rounded-lg cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSaveImap} className="p-5 space-y-4 text-sm">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-slate-400 mb-1">
                {t.addModal.emailLabel}
              </label>
              <input
                type="email"
                required
                disabled={isEditing}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={t.addModal.emailPlaceholder}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm outline-none focus:border-sky-500 disabled:opacity-60"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">
                {t.addModal.labelLabel}
              </label>
              <input
                type="text"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder={t.addModal.labelPlaceholder}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm outline-none focus:border-sky-500"
              />
            </div>
          </div>

          {preset && (() => {
            const pCopy = t.providers[preset.id];
            return (
              <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-sky-300">
                    {t.addModal.detectedPrefix} {preset.name}
                  </span>
                  <div className="flex flex-wrap items-center gap-2">
                    {preset.secondaryUrl && (
                      <button
                        type="button"
                        onClick={() =>
                          window.sortbox.app.openExternal(preset.secondaryUrl!)
                        }
                        className="text-xs px-2.5 py-1 rounded-md border border-slate-700 text-slate-300 hover:bg-slate-800 flex items-center gap-1 cursor-pointer"
                      >
                        {pCopy?.secondaryLinkLabel || t.addModal.webmailFallback}
                        <ExternalLink className="w-3 h-3" />
                      </button>
                    )}
                    {preset.guideUrl && (
                      <button
                        type="button"
                        onClick={() =>
                          window.sortbox.app.openExternal(preset.guideUrl!)
                        }
                        className="text-xs px-2.5 py-1 rounded-md bg-sky-500/15 border border-sky-500/40 text-sky-300 hover:bg-sky-500/25 flex items-center gap-1 cursor-pointer"
                      >
                        {pCopy?.guideLinkLabel || t.addModal.helpFallback}
                        <ExternalLink className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                </div>
                <ol className="text-xs text-slate-300 list-decimal list-inside space-y-1">
                  {(pCopy?.guideSteps || preset.guideSteps).map((step, idx) => (
                    <li key={idx}>{step}</li>
                  ))}
                </ol>
              </div>
            );
          })()}

          {(preset?.supportedAuths.includes("microsoft_oauth") ||
            preset?.id === "custom" ||
            isEditing) && (
            <div className="space-y-1">
              <div className="text-xs text-slate-400">{t.addModal.methodLabel}</div>
              <div className="flex flex-wrap gap-2 text-xs">
                <button
                  type="button"
                  onClick={() => setAuthMode("imap_password")}
                  className={`px-3 py-1.5 rounded-lg border cursor-pointer ${
                    authMode !== "microsoft_oauth"
                      ? "bg-sky-500/20 border-sky-500 text-sky-200 font-semibold"
                      : "border-slate-700 text-slate-400 hover:text-slate-200"
                  }`}
                >
                  {t.addModal.methodPassword}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setAuthMode("microsoft_oauth");
                    if (!imapHost || imapHost === "") {
                      setImapHost("outlook.office365.com");
                      setImapPort(993);
                      setImapSecure(true);
                    }
                  }}
                  className={`px-3 py-1.5 rounded-lg border cursor-pointer ${
                    authMode === "microsoft_oauth"
                      ? "bg-sky-500/20 border-sky-500 text-sky-200 font-semibold"
                      : "border-slate-700 text-slate-400 hover:text-slate-200"
                  }`}
                >
                  OAuth2 Microsoft{" "}
                  {preset?.id === "microsoft"
                    ? t.addModal.methodOAuthRecommended
                    : t.addModal.methodOAuthAlt}
                </button>
              </div>
            </div>
          )}

          {authMode === "microsoft_oauth" ? (
            <div className="space-y-3 p-3.5 rounded-xl bg-slate-950 border border-slate-800">
              <p className="text-xs text-slate-300 leading-relaxed">
                {t.addModal.msOAuthTitle}
              </p>
              <button
                type="button"
                disabled={saving}
                onClick={handleMicrosoftOAuth}
                className="w-full py-2.5 rounded-lg bg-sky-500 hover:bg-sky-400 text-slate-950 font-semibold text-sm transition cursor-pointer disabled:opacity-50"
              >
                {saving ? t.addModal.msOpening : t.addModal.msBtn}
              </button>
              <div>
                <button
                  type="button"
                  onClick={() => setShowMsAdvanced((v) => !v)}
                  className="text-[11px] text-slate-400 hover:text-slate-200 cursor-pointer"
                >
                  {showMsAdvanced
                    ? t.addModal.msAdvHide
                    : `${t.addModal.msAdvShow}${msClientId.trim() ? ` ${t.addModal.msAdvActive}` : ""}`}
                </button>
                {showMsAdvanced && (
                  <div className="mt-2">
                    <label className="block text-[11px] text-slate-400 mb-1">
                      {t.addModal.msAdvLabel}
                    </label>
                    <input
                      type="text"
                      value={msClientId}
                      onChange={(e) => setMsClientId(e.target.value)}
                      placeholder={t.addModal.msAdvPlaceholder}
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs font-mono outline-none focus:border-sky-500"
                    />
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-slate-400 mb-1 flex items-center gap-1.5">
                  <KeyRound className="w-3.5 h-3.5 text-emerald-400" />
                  {t.addModal.passLabelPrefix}{" "}
                  {Capacitor.isNativePlatform() ? "Android Keystore" : "Windows DPAPI"})
                </label>
                <input
                  type="password"
                  required={needsSecretInput}
                  value={secret}
                  onChange={(e) => setSecret(e.target.value)}
                  placeholder={
                    needsSecretInput
                      ? t.addModal.passPlaceholderNew
                      : t.addModal.passPlaceholderKeep
                  }
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm outline-none focus:border-sky-500"
                />
              </div>

              <div>
                <button
                  type="button"
                  onClick={() => setShowAdvanced((v) => !v)}
                  className="text-xs text-slate-400 hover:text-slate-200 cursor-pointer"
                >
                  {showAdvanced
                    ? t.addModal.imapHide
                    : `${t.addModal.imapShowPrefix} (${imapHost || "auto"}:${imapPort} ${imapSecure ? "SSL" : "STARTTLS"})`}
                </button>
              </div>

              {showAdvanced && (
                <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 space-y-2.5">
                  <div className="grid grid-cols-3 gap-2">
                    <div className="col-span-2">
                      <label className="block text-xs text-slate-400 mb-1">
                        {t.addModal.imapServerLabel}
                      </label>
                      <input
                        type="text"
                        required
                        value={imapHost}
                        onChange={(e) => setImapHost(e.target.value)}
                        placeholder={t.addModal.imapServerPlaceholder}
                        className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-slate-400 mb-1">
                        {t.addModal.portLabel}
                      </label>
                      <input
                        type="number"
                        required
                        value={imapPort}
                        onChange={(e) => setImapPort(Number(e.target.value))}
                        className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs outline-none"
                      />
                    </div>
                  </div>
                  <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={imapSecure}
                      onChange={(e) => setImapSecure(e.target.checked)}
                      className="accent-sky-500"
                    />
                    {t.addModal.sslCheckboxLabel}
                  </label>
                </div>
              )}
            </div>
          )}

          {statusMsg && (
            <div
              className={`p-3 rounded-lg text-xs border ${
                statusMsg.type === "ok"
                  ? "bg-emerald-950/50 border-emerald-700 text-emerald-300"
                  : "bg-rose-950/50 border-rose-700 text-rose-300"
              }`}
            >
              {statusMsg.text}
            </div>
          )}

          <div className="flex items-center justify-between pt-2 border-t border-slate-800">
            <span className="text-xs text-slate-500 flex items-center gap-1">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
              {t.addModal.securityFooter}
            </span>
            {authMode !== "microsoft_oauth" && (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={testing || !email || !imapHost || (needsSecretInput && !secret)}
                  onClick={handleTest}
                  className="px-3 py-2 rounded-lg border border-slate-700 hover:bg-slate-800 text-xs font-medium cursor-pointer disabled:opacity-40"
                >
                  {testing ? t.addModal.testingBtn : t.addModal.testBtn}
                </button>
                <button
                  type="submit"
                  disabled={saving || !email || !imapHost || (needsSecretInput && !secret)}
                  className="px-4 py-2 rounded-lg bg-sky-500 hover:bg-sky-400 text-slate-950 text-xs font-semibold cursor-pointer disabled:opacity-40"
                >
                  {saving
                    ? t.addModal.savingBtn
                    : isEditing
                      ? t.addModal.saveBtn
                      : t.addModal.addBtn}
                </button>
              </div>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
