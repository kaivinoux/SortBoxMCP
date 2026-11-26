import { Capacitor } from "@capacitor/core";
import React, { useEffect, useState } from "react";
import { Bot, ClipboardCheck, Copy, Sparkles } from "lucide-react";
import type { AppSettings, MailAccount } from "../../shared/types.js";
import { useI18n } from "../i18n/I18nContext.js";

interface AiExportViewProps {
  accounts: MailAccount[];
  activeAccountId: string;
  settings: AppSettings;
  onSaveSettings: (partial: Partial<AppSettings>) => Promise<void>;
  onImportJsonPlan: (accountId: string, rawJson: string) => Promise<void>;
  onRunBuiltinAi: (accountId: string) => Promise<void>;
}

export function AiExportView({
  accounts,
  activeAccountId,
  settings,
  onSaveSettings,
  onImportJsonPlan,
  onRunBuiltinAi,
}: AiExportViewProps) {
  const { t } = useI18n();
  const [targetAccountId, setTargetAccountId] = useState(
    activeAccountId !== "all" ? activeAccountId : accounts[0]?.id || "",
  );
  const [onlyUnknown, setOnlyUnknown] = useState(true);
  const [promptText, setPromptText] = useState("");
  const [copied, setCopied] = useState(false);
  const [jsonInput, setJsonInput] = useState("");
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [hasApiKey, setHasApiKey] = useState(false);
  const [runningAi, setRunningAi] = useState(false);
  const [feedback, setFeedback] = useState<{
    type: "ok" | "error";
    text: string;
  } | null>(null);

  useEffect(() => {
    if (activeAccountId !== "all") {
      setTargetAccountId(activeAccountId);
    } else if (!targetAccountId && accounts[0]) {
      setTargetAccountId(accounts[0].id);
    }
  }, [activeAccountId, accounts, targetAccountId]);

  useEffect(() => {
    window.sortbox.ai.hasApiKey().then(setHasApiKey).catch(() => {});
  }, []);

  async function handleGeneratePrompt() {
    setFeedback(null);
    const prompt = await window.sortbox.ai.buildPrompt({
      accountId: targetAccountId || "all",
      onlyUnknown,
    });
    setPromptText(prompt);
  }

  async function handleCopy() {
    if (!promptText) return;
    await navigator.clipboard.writeText(promptText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function handleImportJson() {
    if (!targetAccountId) {
      setFeedback({ type: "error", text: t.ai.selectAccountFirst });
      return;
    }
    setFeedback(null);
    try {
      await onImportJsonPlan(targetAccountId, jsonInput);
      setFeedback({
        type: "ok",
        text: t.ai.planLoaded,
      });
    } catch (err) {
      setFeedback({
        type: "error",
        text: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async function handleSaveKey() {
    const saved = await window.sortbox.ai.saveApiKey(apiKeyInput);
    setHasApiKey(saved);
    setApiKeyInput("");
    setFeedback({
      type: "ok",
      text: saved ? t.ai.apiKeySaved : t.ai.apiKeyDeleted,
    });
  }

  async function handleRunBuiltin() {
    if (!targetAccountId) return;
    setRunningAi(true);
    setFeedback(null);
    try {
      await onRunBuiltinAi(targetAccountId);
      setFeedback({
        type: "ok",
        text: t.ai.analysisDone,
      });
    } catch (err) {
      setFeedback({
        type: "error",
        text: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setRunningAi(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">
            {t.ai.title}
          </h2>
          <p className="text-xs text-slate-400">
            {t.ai.subtitle}
          </p>
        </div>

        <select
          value={targetAccountId}
          onChange={(e) => setTargetAccountId(e.target.value)}
          className="text-xs bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-2 outline-none"
        >
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.email}
            </option>
          ))}
        </select>
      </div>

      {feedback && (
        <div
          className={`p-3 rounded-xl text-xs border ${
            feedback.type === "ok"
              ? "bg-emerald-950/40 border-emerald-700 text-emerald-300"
              : "bg-rose-950/40 border-rose-700 text-rose-300"
          }`}
        >
          {feedback.text}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Mode A: Free Copy-Paste */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold flex items-center gap-1.5">
              <Sparkles className="w-4 h-4 text-sky-400" />
              {t.ai.modeATitle}
            </h3>
            <span className="text-xs px-2 py-0.5 rounded bg-slate-800 text-emerald-300">
              {t.ai.modeABadge}
            </span>
          </div>

          <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
            <input
              type="checkbox"
              checked={onlyUnknown}
              onChange={(e) => setOnlyUnknown(e.target.checked)}
              className="accent-sky-500"
            />
            {t.ai.onlyUnknownLabel}
          </label>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleGeneratePrompt}
              className="text-xs px-3 py-1.5 rounded-lg bg-sky-500 hover:bg-sky-400 text-slate-950 font-semibold cursor-pointer"
            >
              {t.ai.generateBtn}
            </button>
            <button
              type="button"
              disabled={!promptText}
              onClick={handleCopy}
              className="text-xs px-3 py-1.5 rounded-lg border border-slate-700 hover:bg-slate-800 flex items-center gap-1.5 cursor-pointer disabled:opacity-40"
            >
              {copied ? (
                <>
                  <ClipboardCheck className="w-3.5 h-3.5 text-emerald-400" />
                  {t.ai.copied}
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  {t.ai.copy}
                </>
              )}
            </button>
          </div>

          <textarea
            readOnly
            rows={7}
            value={promptText}
            placeholder={t.ai.promptPlaceholder}
            className="w-full text-xs font-mono bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-slate-300 outline-none"
          />

          <div className="pt-2 border-t border-slate-800 space-y-2">
            <label className="block text-xs font-medium text-slate-300">
              {t.ai.pasteJsonLabel}
            </label>
            <textarea
              rows={5}
              value={jsonInput}
              onChange={(e) => setJsonInput(e.target.value)}
              placeholder={t.ai.jsonPlaceholder}
              className="w-full text-xs font-mono bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-slate-200 outline-none focus:border-sky-500"
            />
            <button
              type="button"
              disabled={!jsonInput.trim()}
              onClick={handleImportJson}
              className="text-xs px-3.5 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-semibold cursor-pointer disabled:opacity-40"
            >
              {t.ai.loadDryRunBtn}
            </button>
          </div>
        </div>

        {/* Mode B: Built-in Ollama / API */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold flex items-center gap-1.5">
              <Bot className="w-4 h-4 text-violet-400" />
              {t.ai.modeBTitle}
            </h3>
          </div>

          <div className="space-y-3 text-xs">
            <div>
              <label className="block text-slate-400 mb-1">{t.ai.providerLabel}</label>
              <select
                value={settings.aiProvider}
                onChange={(e) =>
                  onSaveSettings({
                    aiProvider: e.target.value as AppSettings["aiProvider"],
                  })
                }
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-2 outline-none"
              >
                <option value="none">{t.ai.providerNone}</option>
                <option value="ollama">{t.ai.providerOllama}</option>
                <option value="gemini">{t.ai.providerGemini}</option>
                <option value="openai_compat">{t.ai.providerOpenAiCompat}</option>
              </select>
            </div>

            {settings.aiProvider !== "none" && (
              <>
                <div>
                  <label className="block text-slate-400 mb-1">{t.ai.modelLabel}</label>
                  <input
                    type="text"
                    value={settings.aiModel}
                    onChange={(e) => onSaveSettings({ aiModel: e.target.value })}
                    placeholder="qwen2.5:7b / gemini-2.5-flash"
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-2 outline-none"
                  />
                </div>

                {(settings.aiProvider === "ollama" ||
                  settings.aiProvider === "openai_compat") && (
                  <div>
                    <label className="block text-slate-400 mb-1">{t.ai.endpointLabel}</label>
                    <input
                      type="text"
                      value={settings.aiEndpoint}
                      onChange={(e) =>
                        onSaveSettings({ aiEndpoint: e.target.value })
                      }
                      placeholder="http://127.0.0.1:11434"
                      className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-2 font-mono outline-none"
                    />
                  </div>
                )}

                {settings.aiProvider !== "ollama" && (
                  <div className="space-y-1.5">
                    <label className="block text-slate-400">
                      {Capacitor.isNativePlatform()
                        ? t.ai.apiKeyLabelAndroid
                        : t.ai.apiKeyLabelDesktop}{" "}
                      • {hasApiKey ? t.ai.keySaved : t.ai.noKey})
                    </label>
                    <div className="flex gap-2">
                      <input
                        type="password"
                        value={apiKeyInput}
                        onChange={(e) => setApiKeyInput(e.target.value)}
                        placeholder={t.ai.keyPlaceholder}
                        className="flex-1 bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-2 outline-none"
                      />
                      <button
                        type="button"
                        onClick={handleSaveKey}
                        className="px-3 py-2 rounded-lg border border-slate-700 hover:bg-slate-800 cursor-pointer"
                      >
                        {t.ai.saveBtn}
                      </button>
                    </div>
                  </div>
                )}

                <button
                  type="button"
                  disabled={runningAi || !targetAccountId}
                  onClick={handleRunBuiltin}
                  className="w-full py-2.5 rounded-lg bg-violet-500 hover:bg-violet-400 text-slate-950 font-semibold cursor-pointer disabled:opacity-40"
                >
                  {runningAi ? t.ai.analyzing : t.ai.runBtn}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
