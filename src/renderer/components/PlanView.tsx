import React, { useMemo, useState } from "react";
import {
  BookmarkPlus,
  CheckCircle2,
  Play,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { formatDestinationLabel } from "../../shared/folders.js";
import { formatMessage } from "../../shared/i18n.js";
import type {
  ExecutionHistoryEntry,
  PlanApplyProgressEvent,
  SortPlan,
  SortRule,
} from "../../shared/types.js";
import { useI18n } from "../i18n/I18nContext.js";

interface PlanViewProps {
  plans: SortPlan[];
  rules: SortRule[];
  history: ExecutionHistoryEntry[];
  planProgress: PlanApplyProgressEvent | null;
  onToggleMove: (planId: string, moveId: string, checked: boolean) => Promise<void>;
  onRemoveMove: (planId: string, moveId: string) => Promise<void>;
  onDeletePlan: (planId: string) => Promise<void>;
  onApplyPlan: (planId: string) => Promise<void>;
  onSaveAsRules: (plan: SortPlan) => Promise<void>;
  onRunRules: () => Promise<void>;
  onToggleRule: (ruleId: string, enabled: boolean) => Promise<void>;
  onDeleteRule: (ruleId: string) => Promise<void>;
  onUndoHistory: (historyId: string) => Promise<void>;
}

export function PlanView({
  plans,
  rules,
  history,
  planProgress,
  onToggleMove,
  onRemoveMove,
  onDeletePlan,
  onApplyPlan,
  onSaveAsRules,
  onRunRules,
  onToggleRule,
  onDeleteRule,
  onUndoHistory,
}: PlanViewProps) {
  const { lang, locale, t } = useI18n();
  const [selectedPlanId, setSelectedPlanId] = useState<string>("");
  const [applying, setApplying] = useState(false);
  const [undoingId, setUndoingId] = useState<string | null>(null);

  const activePlan = useMemo(() => {
    if (!plans.length) return null;
    return plans.find((p) => p.id === selectedPlanId) ?? plans[0];
  }, [plans, selectedPlanId]);

  const checkedCount = useMemo(() => {
    if (!activePlan) return 0;
    return activePlan.moves
      .filter((m) => m.checked)
      .reduce((acc, m) => acc + m.uids.length, 0);
  }, [activePlan]);

  async function handleApply() {
    if (!activePlan || applying) return;
    setApplying(true);
    try {
      await onApplyPlan(activePlan.id);
    } finally {
      setApplying(false);
    }
  }

  async function handleUndo(id: string) {
    setUndoingId(id);
    try {
      await onUndoHistory(id);
    } finally {
      setUndoingId(null);
    }
  }

  return (
    <div className="space-y-4">
      {/* Header + Plan Switcher */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-800">
          <div>
            <h2 className="text-sm font-semibold">
              {t.plan.title}
            </h2>
            <p className="text-xs text-slate-400">
              {t.plan.subtitle}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {plans.length > 1 && (
              <select
                value={activePlan?.id || ""}
                onChange={(e) => setSelectedPlanId(e.target.value)}
                className="text-xs bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-2 outline-none"
              >
                {plans.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.title} ({p.moves.length} {t.plan.lotsLabel} • {p.source})
                  </option>
                ))}
              </select>
            )}

            {activePlan && activePlan.moves.length > 0 && (
              <>
                <button
                  type="button"
                  onClick={() => onSaveAsRules(activePlan)}
                  className="text-xs px-3 py-2 rounded-lg border border-slate-700 hover:bg-slate-800 flex items-center gap-1.5 cursor-pointer"
                >
                  <BookmarkPlus className="w-3.5 h-3.5 text-sky-400" />
                  {t.plan.saveRulesBtn}
                </button>
                <button
                  type="button"
                  disabled={applying || checkedCount === 0}
                  onClick={handleApply}
                  className="text-xs px-3.5 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-semibold flex items-center gap-1.5 cursor-pointer disabled:opacity-40"
                >
                  <Play className="w-3.5 h-3.5" />
                  {applying
                    ? t.plan.applying
                    : formatMessage(t.plan.applyBtn, { count: checkedCount })}
                </button>
              </>
            )}
          </div>
        </div>

        {planProgress && planProgress.status === "running" && (
          <div className="p-3 rounded-lg bg-slate-950 border border-emerald-800/70 space-y-1.5 text-xs">
            <div className="flex justify-between">
              <span className="text-emerald-300">
                {t.plan.movingToPrefix} {formatDestinationLabel(planProgress.destFolder, lang)}...
              </span>
              <span className="font-mono tabular-nums">
                {planProgress.processed} / {planProgress.total}
              </span>
            </div>
            <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-emerald-500 transition-all"
                style={{
                  width: `${
                    planProgress.total
                      ? Math.round(
                          (planProgress.processed / planProgress.total) * 100,
                        )
                      : 0
                  }%`,
                }}
              />
            </div>
          </div>
        )}

        {!activePlan || activePlan.moves.length === 0 ? (
          <div className="p-6 rounded-xl bg-slate-950 border border-slate-800 text-center text-xs text-slate-400 space-y-2">
            <p>
              {t.plan.emptyText}
            </p>
            {activePlan && (
              <button
                type="button"
                onClick={() => onDeletePlan(activePlan.id)}
                className="text-xs text-slate-400 underline cursor-pointer"
              >
                {t.plan.deleteEmptyBtn}
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs text-slate-400 pb-1">
              <span>
                {t.plan.planPrefix} <strong className="text-slate-200">{activePlan.title}</strong> ({activePlan.source})
              </span>
              <button
                type="button"
                onClick={() => onDeletePlan(activePlan.id)}
                className="text-rose-400 hover:underline cursor-pointer"
              >
                {t.plan.deletePlanBtn}
              </button>
            </div>
            {activePlan.moves.map((m) => (
              <div
                key={m.id}
                className="p-3 rounded-xl bg-slate-950 border border-slate-800 flex flex-wrap items-center justify-between gap-3 text-xs"
              >
                <div className="flex items-start gap-2.5">
                  <input
                    type="checkbox"
                    checked={m.checked}
                    onChange={(e) =>
                      onToggleMove(activePlan.id, m.id, e.target.checked)
                    }
                    className="mt-0.5 accent-emerald-500 cursor-pointer"
                  />
                  <div>
                    <div className="font-medium text-slate-100">
                      {m.label}{" "}
                      <span className="text-slate-500 mx-1">→</span>
                      <span className="text-sky-400 font-semibold">
                        {formatDestinationLabel(m.destFolder, lang)}
                      </span>
                      <span className="text-slate-500 ml-2">
                        ({m.accountEmail} • {t.plan.fromPrefix} {m.sourceFolder})
                      </span>
                    </div>
                    {m.sampleSubjects.length > 0 && (
                      <div className="text-slate-400 mt-0.5">
                        {t.plan.examplePrefix} « {m.sampleSubjects[0]} »
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <span className="font-mono tabular-nums font-semibold text-slate-200">
                    {m.uids.length} {t.triage.emailsUnit}
                  </span>
                  <button
                    type="button"
                    onClick={() => onRemoveMove(activePlan.id, m.id)}
                    className="text-slate-500 hover:text-rose-400 cursor-pointer"
                    title={t.plan.removeBatchTitle}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Saved Rules & Undo History */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              {formatMessage(t.plan.savedRulesTitle, { count: rules.length })}
            </h3>
            <button
              type="button"
              disabled={!rules.some((r) => r.enabled)}
              onClick={onRunRules}
              className="text-xs px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-sky-300 cursor-pointer disabled:opacity-40"
            >
              {t.plan.runRulesBtn}
            </button>
          </div>
          {rules.length === 0 ? (
            <p className="text-xs text-slate-500">
              {t.plan.noRules}
            </p>
          ) : (
            <div className="space-y-2 max-h-60 overflow-y-auto">
              {rules.map((r) => (
                <div
                  key={r.id}
                  className="p-2.5 rounded-lg bg-slate-950 border border-slate-800 flex items-center justify-between gap-2 text-xs"
                >
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={r.enabled}
                      onChange={(e) => onToggleRule(r.id, e.target.checked)}
                      className="accent-sky-500"
                    />
                    <span className={r.enabled ? "text-slate-200" : "text-slate-500 line-through"}>
                      {r.name}
                    </span>
                  </label>
                  <button
                    type="button"
                    onClick={() => onDeleteRule(r.id)}
                    className="text-slate-500 hover:text-rose-400 cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
            {t.plan.historyTitle}
          </h3>
          {history.length === 0 ? (
            <p className="text-xs text-slate-500">
              {t.plan.noHistory}
            </p>
          ) : (
            <div className="space-y-2 max-h-60 overflow-y-auto">
              {history.map((h) => (
                <div
                  key={h.id}
                  className="p-2.5 rounded-lg bg-slate-950 border border-slate-800 flex items-center justify-between gap-2 text-xs"
                >
                  <div>
                    <div className="flex items-center gap-1.5 font-medium">
                      <CheckCircle2
                        className={`w-3.5 h-3.5 ${
                          h.status === "ok"
                            ? "text-emerald-400"
                            : h.status === "undone"
                              ? "text-slate-400"
                              : "text-rose-400"
                        }`}
                      />
                      <span>
                        {h.count} {t.triage.emailsUnit} : {h.sourceFolder} →{" "}
                        {formatDestinationLabel(h.destFolder, lang)}
                      </span>
                    </div>
                    <div className="text-slate-500 mt-0.5">
                      {h.accountEmail} •{" "}
                      {h.status === "undone"
                        ? t.plan.undoneLabel
                        : h.errorMessage || new Date(h.executedAt).toLocaleString(locale)}
                    </div>
                  </div>
                  {h.status === "ok" && (
                    <button
                      type="button"
                      disabled={undoingId === h.id}
                      onClick={() => handleUndo(h.id)}
                      className="px-2.5 py-1 rounded border border-slate-700 hover:bg-slate-800 text-slate-200 flex items-center gap-1 cursor-pointer disabled:opacity-40"
                    >
                      <RotateCcw className="w-3 h-3" />
                      {undoingId === h.id ? "..." : t.plan.undoBtn}
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
