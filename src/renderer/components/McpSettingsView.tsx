import React, { useEffect, useState } from "react";
import { Check, Copy, Cpu, Shield, Trash2 } from "lucide-react";
import type {
  AppSettings,
  MailAccount,
  McpActivityEvent,
} from "../../shared/types.js";

interface McpSettingsViewProps {
  accounts: MailAccount[];
  settings: AppSettings;
  mcpStatus: { running: boolean; port: number | null; url: string | null };
  mcpActivity: McpActivityEvent[];
  onSaveSettings: (partial: Partial<AppSettings>) => Promise<void>;
  onDeleteAccount: (accountId: string) => Promise<void>;
}

export function McpSettingsView({
  accounts,
  settings,
  mcpStatus,
  mcpActivity,
  onSaveSettings,
  onDeleteAccount,
}: McpSettingsViewProps) {
  const [stdioInfo, setStdioInfo] = useState<{
    executable: string;
    args: string[];
    env?: Record<string, string>;
  } | null>(null);
  const [copiedMode, setCopiedMode] = useState<"http" | "stdio" | null>(null);

  useEffect(() => {
    window.sortbox.mcp.getStdioCommand().then(setStdioInfo).catch(() => {});
  }, []);

  const httpSnippet = JSON.stringify(
    {
      mcpServers: {
        "sortbox-mail": {
          url: `http://127.0.0.1:${settings.mcpPort}/mcp`,
        },
      },
    },
    null,
    2,
  );

  const stdioSnippet = JSON.stringify(
    {
      mcpServers: {
        "sortbox-mail": {
          command:
            stdioInfo?.executable || "IA For EveryOne — SortBox E-Mail.exe",
          args: stdioInfo?.args || ["resources/app.asar/dist-electron/main/mcp/stdioBridge.js"],
          env: stdioInfo?.env || { ELECTRON_RUN_AS_NODE: "1" },
        },
      },
    },
    null,
    2,
  );

  async function copySnippet(kind: "http" | "stdio", text: string) {
    await navigator.clipboard.writeText(text);
    setCopiedMode(kind);
    setTimeout(() => setCopiedMode(null), 2000);
  }

  return (
    <div className="space-y-4">
      {/* MCP Server Controls */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-800">
          <div>
            <h2 className="text-sm font-semibold flex items-center gap-2">
              <Cpu className="w-4 h-4 text-sky-400" />
              Serveur MCP Local (Antigravity, Claude Desktop, Cursor)
            </h2>
            <p className="text-xs text-slate-400">
              Optionnel — permet à ton agent IA de consulter le cache SQLite et de pousser des plans dans « Plan & Dry-Run ».
            </p>
          </div>

          <label className="flex items-center gap-2 text-xs font-semibold cursor-pointer px-3 py-2 rounded-lg bg-slate-950 border border-slate-700">
            <input
              type="checkbox"
              checked={settings.mcpEnabled}
              onChange={(e) => onSaveSettings({ mcpEnabled: e.target.checked })}
              className="accent-sky-500"
            />
            Serveur MCP HTTP {mcpStatus.running ? `actif (${mcpStatus.url})` : "désactivé"}
          </label>
        </div>

        <label className="flex items-center gap-2.5 p-3 rounded-lg bg-slate-950 border border-emerald-900/60 text-xs text-emerald-200 cursor-pointer">
          <Shield className="w-4 h-4 text-emerald-400 shrink-0" />
          <input
            type="checkbox"
            checked={settings.mcpRequireUiConfirmation}
            onChange={(e) =>
              onSaveSettings({ mcpRequireUiConfirmation: e.target.checked })
            }
            className="accent-emerald-500"
          />
          <span>
            <strong>Verrou de sécurité (recommandé) :</strong> toujours exiger ma validation manuelle dans l&apos;app Windows avant d&apos;exécuter un déplacement proposé par une IA.
          </span>
        </label>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold">Config Streamable HTTP (app ouverte)</span>
              <button
                type="button"
                onClick={() => copySnippet("http", httpSnippet)}
                className="text-sky-400 hover:underline flex items-center gap-1 cursor-pointer"
              >
                {copiedMode === "http" ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                {copiedMode === "http" ? "Copié" : "Copier"}
              </button>
            </div>
            <pre className="text-xs font-mono text-slate-300 overflow-x-auto">{httpSnippet}</pre>
          </div>

          <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold">Config Stdio (mode headless)</span>
              <button
                type="button"
                onClick={() => copySnippet("stdio", stdioSnippet)}
                className="text-sky-400 hover:underline flex items-center gap-1 cursor-pointer"
              >
                {copiedMode === "stdio" ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                {copiedMode === "stdio" ? "Copié" : "Copier"}
              </button>
            </div>
            <pre className="text-xs font-mono text-slate-300 overflow-x-auto">{stdioSnippet}</pre>
          </div>
        </div>
      </div>

      {/* Wave Tuning, Accounts, and Activity Log */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3 text-xs">
          <h3 className="font-semibold uppercase tracking-wider text-slate-400">
            Paramètres IMAP & Comptes connectés ({accounts.length})
          </h3>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-slate-400 mb-1">Taille d&apos;une vague (UIDs)</label>
              <input
                type="number"
                min={10}
                max={250}
                value={settings.waveBatchSize}
                onChange={(e) =>
                  onSaveSettings({ waveBatchSize: Number(e.target.value) || 100 })
                }
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 outline-none"
              />
            </div>
            <div>
              <label className="block text-slate-400 mb-1">Pause entre vagues (ms)</label>
              <input
                type="number"
                min={0}
                max={5000}
                value={settings.waveDelayMs}
                onChange={(e) =>
                  onSaveSettings({ waveDelayMs: Number(e.target.value) || 0 })
                }
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 outline-none"
              />
            </div>
          </div>

          <div className="space-y-2 pt-2">
            {accounts.map((acc) => (
              <div
                key={acc.id}
                className="p-2.5 rounded-lg bg-slate-950 border border-slate-800 flex items-center justify-between gap-2"
              >
                <div>
                  <div className="font-medium text-slate-100">{acc.email}</div>
                  <div className="text-slate-500">
                    {acc.imapHost}:{acc.imapPort} • {acc.authMode}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => onDeleteAccount(acc.id)}
                  className="text-slate-500 hover:text-rose-400 p-1 cursor-pointer"
                  title="Supprimer ce compte"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3 text-xs">
          <h3 className="font-semibold uppercase tracking-wider text-slate-400">
            Journal d&apos;activité MCP en direct
          </h3>
          {mcpActivity.length === 0 ? (
            <p className="text-slate-500">
              Aucun appel MCP enregistré pendant cette session.
            </p>
          ) : (
            <div className="space-y-2 max-h-60 overflow-y-auto">
              {mcpActivity.map((ev) => (
                <div
                  key={ev.id}
                  className="p-2.5 rounded-lg bg-slate-950 border border-slate-800 flex items-center justify-between gap-2"
                >
                  <div>
                    <span className="font-mono text-sky-400">{ev.toolName}</span>
                    <span className="text-slate-300 ml-2">{ev.summary}</span>
                  </div>
                  <span
                    className={`px-2 py-0.5 rounded text-[11px] ${
                      ev.status === "ok"
                        ? "bg-emerald-950 text-emerald-300"
                        : ev.status === "pending_ui"
                          ? "bg-amber-950 text-amber-300"
                          : "bg-rose-950 text-rose-300"
                    }`}
                  >
                    {ev.status}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
