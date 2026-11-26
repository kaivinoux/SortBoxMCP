import { Capacitor } from "@capacitor/core";
import React, { useEffect, useState } from "react";
import { ExternalLink, KeyRound, Mail, ShieldCheck, X } from "lucide-react";
import type { ProviderPreset } from "../../shared/providers.js";
import type { AuthMode, MailAccount } from "../../shared/types.js";

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
  const [email, setEmail] = useState("");
  const [label, setLabel] = useState("");
  const [preset, setPreset] = useState<ProviderPreset | null>(null);
  const [authMode, setAuthMode] = useState<AuthMode>("imap_password");
  const [imapHost, setImapHost] = useState("");
  const [imapPort, setImapPort] = useState(993);
  const [imapSecure, setImapSecure] = useState(true);
  const [secret, setSecret] = useState("");
  const [msClientId, setMsClientId] = useState(defaultMicrosoftClientId);
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
    setMsClientId(defaultMicrosoftClientId);
  }, [defaultMicrosoftClientId]);

  useEffect(() => {
    if (!open) return;
    setStatusMsg(null);
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
        text: `Connexion IMAP réussie (${res.folderCount} dossiers détectés).`,
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
      const account = await window.sortbox.accounts.microsoftLogin(
        msClientId,
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
                  ? "Reconnecter la boîte mail"
                  : "Modifier le mode de connexion"
                : "Connecter une boîte mail"}
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
                Adresse email
              </label>
              <input
                type="email"
                required
                disabled={isEditing}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="prenom@orange.fr"
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm outline-none focus:border-sky-500 disabled:opacity-60"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">
                Nom affiché (optionnel)
              </label>
              <input
                type="text"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="Boîte Orange Perso"
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm outline-none focus:border-sky-500"
              />
            </div>
          </div>

          {preset && (
            <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-semibold text-sky-300">
                  Fournisseur détecté : {preset.name}
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
                      {preset.secondaryLinkLabel || "Webmail"}
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
                      {preset.guideLinkLabel || "Ouvrir l'aide"}
                      <ExternalLink className="w-3 h-3" />
                    </button>
                  )}
                </div>
              </div>
              <ol className="text-xs text-slate-300 list-decimal list-inside space-y-1">
                {preset.guideSteps.map((step, idx) => (
                  <li key={idx}>{step}</li>
                ))}
              </ol>
            </div>
          )}

          {(preset?.supportedAuths.includes("microsoft_oauth") ||
            preset?.id === "custom" ||
            isEditing) && (
            <div className="space-y-1">
              <div className="text-xs text-slate-400">Méthode de connexion :</div>
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
                  Mot de passe IMAP / d&apos;application
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
                  OAuth2 Microsoft {preset?.id === "microsoft" ? "(recommandé)" : "(M365 / Outlook)"}
                </button>
              </div>
            </div>
          )}

          {authMode === "microsoft_oauth" ? (
            <div className="space-y-3 p-3.5 rounded-xl bg-slate-950 border border-slate-800">
              <div>
                <label className="block text-xs text-slate-400 mb-1">
                  Client ID Azure (App publique, redirection http://127.0.0.1)
                </label>
                <input
                  type="text"
                  value={msClientId}
                  onChange={(e) => setMsClientId(e.target.value)}
                  placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs font-mono outline-none focus:border-sky-500"
                />
              </div>
              <button
                type="button"
                disabled={saving}
                onClick={handleMicrosoftOAuth}
                className="w-full py-2.5 rounded-lg bg-sky-500 hover:bg-sky-400 text-slate-950 font-semibold text-sm transition cursor-pointer disabled:opacity-50"
              >
                {saving
                  ? "Ouverture du navigateur Microsoft..."
                  : "Connecter avec Microsoft (OAuth2)"}
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-slate-400 mb-1 flex items-center gap-1.5">
                  <KeyRound className="w-3.5 h-3.5 text-emerald-400" />
                  Mot de passe d&apos;application ou IMAP (chiffré via{" "}
                  {Capacitor.isNativePlatform() ? "Android Keystore" : "Windows DPAPI"})
                </label>
                <input
                  type="password"
                  required={needsSecretInput}
                  value={secret}
                  onChange={(e) => setSecret(e.target.value)}
                  placeholder={
                    needsSecretInput
                      ? "Mot de passe dédié..."
                      : "Laisser vide pour garder l'actuel, ou saisir un nouveau"
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
                    ? "▼ Masquer les paramètres IMAP"
                    : `▶ Paramètres IMAP (${imapHost || "auto"}:${imapPort} ${imapSecure ? "SSL" : "STARTTLS"})`}
                </button>
              </div>

              {showAdvanced && (
                <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 space-y-2.5">
                  <div className="grid grid-cols-3 gap-2">
                    <div className="col-span-2">
                      <label className="block text-xs text-slate-400 mb-1">
                        Serveur IMAP
                      </label>
                      <input
                        type="text"
                        required
                        value={imapHost}
                        onChange={(e) => setImapHost(e.target.value)}
                        placeholder="imap.orange.fr"
                        className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-slate-400 mb-1">
                        Port
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
                    Connexion SSL/TLS directe (décocher pour STARTTLS sur port 143)
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
              Aucun identifiant stocké en clair
            </span>
            {authMode !== "microsoft_oauth" && (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={testing || !email || !imapHost || (needsSecretInput && !secret)}
                  onClick={handleTest}
                  className="px-3 py-2 rounded-lg border border-slate-700 hover:bg-slate-800 text-xs font-medium cursor-pointer disabled:opacity-40"
                >
                  {testing ? "Test..." : "Tester IMAP"}
                </button>
                <button
                  type="submit"
                  disabled={saving || !email || !imapHost || (needsSecretInput && !secret)}
                  className="px-4 py-2 rounded-lg bg-sky-500 hover:bg-sky-400 text-slate-950 text-xs font-semibold cursor-pointer disabled:opacity-40"
                >
                  {saving
                    ? "Enregistrement..."
                    : isEditing
                      ? "Enregistrer"
                      : "Ajouter le compte"}
                </button>
              </div>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
