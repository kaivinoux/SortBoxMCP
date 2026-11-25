import crypto from "node:crypto";
import { formatDestinationLabel } from "../../shared/folders.js";
import type {
  ExecutionHistoryEntry,
  PlanApplyProgressEvent,
  SenderGroup,
  SortMoveItem,
  SortPlan,
  SortRule,
} from "../../shared/types.js";
import type { AppDatabase } from "../db/database.js";
import type { ImapConnector } from "../mail/imapConnector.js";
import type { ImportedPlanSpec } from "./promptExporter.js";

export class PlanEngine {
  private readonly db: AppDatabase;
  private readonly connector: ImapConnector;

  constructor(db: AppDatabase, connector: ImapConnector) {
    this.db = db;
    this.connector = connector;
  }

  createPlanFromSenderGroups(params: {
    title?: string;
    source?: SortPlan["source"];
    selections: Array<{
      group: SenderGroup;
      destFolder: string;
      matchBy?: "sender" | "domain";
    }>;
  }): SortPlan {
    const moves: SortMoveItem[] = [];

    for (const sel of params.selections) {
      const matchType = sel.matchBy ?? "sender";
      const matchValue =
        matchType === "domain"
          ? sel.group.domain || sel.group.fromAddr
          : sel.group.fromAddr || sel.group.groupKey;

      const resolved = this.db.getUidsForSenderOrDomain({
        accountId: sel.group.accountId,
        folderPath: sel.group.folderPath,
        matchType,
        matchValue,
      });

      if (!resolved.uids.length) continue;

      moves.push({
        id: crypto.randomUUID(),
        accountId: sel.group.accountId,
        accountEmail: sel.group.accountEmail,
        sourceFolder: sel.group.folderPath,
        destFolder: sel.destFolder.trim(),
        label: matchValue,
        uids: resolved.uids,
        sampleSubjects: resolved.sampleSubjects,
        checked: true,
      });
    }

    const plan: SortPlan = {
      id: crypto.randomUUID(),
      title: params.title?.trim() || "Plan de tri manuel",
      source: params.source ?? "manual",
      createdAt: new Date().toISOString(),
      status: "draft",
      moves,
    };

    this.db.savePlan(plan);
    return plan;
  }

  createPlanFromImportedSpec(params: {
    spec: ImportedPlanSpec;
    accountId: string;
    source?: SortPlan["source"];
  }): SortPlan {
    const account = this.db.getAccount(params.accountId);
    if (!account) {
      throw new Error(`Compte introuvable : ${params.accountId}`);
    }

    const sourceFolder = params.spec.source_folder || "INBOX";
    const moves: SortMoveItem[] = [];

    for (const item of params.spec.moves) {
      const uidSet = new Set<number>(item.uids || []);
      const sampleSubjects: string[] = [];
      const labels: string[] = [];

      for (const sender of item.senders || []) {
        const res = this.db.getUidsForSenderOrDomain({
          accountId: account.id,
          folderPath: sourceFolder,
          matchType: "sender",
          matchValue: sender,
        });
        res.uids.forEach((u) => uidSet.add(u));
        if (sampleSubjects.length < 3) {
          sampleSubjects.push(...res.sampleSubjects);
        }
        labels.push(sender);
      }

      for (const domain of item.domains || []) {
        const res = this.db.getUidsForSenderOrDomain({
          accountId: account.id,
          folderPath: sourceFolder,
          matchType: "domain",
          matchValue: domain,
        });
        res.uids.forEach((u) => uidSet.add(u));
        if (sampleSubjects.length < 3) {
          sampleSubjects.push(...res.sampleSubjects);
        }
        labels.push(domain);
      }

      if (!uidSet.size) continue;

      moves.push({
        id: crypto.randomUUID(),
        accountId: account.id,
        accountEmail: account.email,
        sourceFolder,
        destFolder: item.dest,
        label:
          item.reason ||
          (labels.length ? labels.join(", ") : `${uidSet.size} UIDs ciblés`),
        uids: Array.from(uidSet),
        sampleSubjects: sampleSubjects.slice(0, 3),
        checked: true,
      });
    }

    if (!moves.length) {
      throw new Error(
        "Aucun mail en cache ne correspond aux expéditeurs/domaines de ce plan.",
      );
    }

    const plan: SortPlan = {
      id: crypto.randomUUID(),
      title: params.spec.title || "Plan importé (IA)",
      source: params.source ?? "ai_import",
      createdAt: new Date().toISOString(),
      status: "draft",
      moves,
    };

    this.db.savePlan(plan);
    return plan;
  }

  createPlanFromRules(accountId?: string): SortPlan {
    const rules = this.db.listRules().filter((r) => r.enabled);
    const accounts = accountId && accountId !== "all"
      ? [this.db.getAccount(accountId)].filter((a): a is NonNullable<typeof a> => Boolean(a))
      : this.db.listAccounts();

    const moves: SortMoveItem[] = [];

    for (const acc of accounts) {
      for (const rule of rules) {
        if (rule.accountId !== "all" && rule.accountId !== acc.id) continue;
        const res = this.db.getUidsForSenderOrDomain({
          accountId: acc.id,
          folderPath: rule.sourceFolder || "INBOX",
          matchType: rule.matchType,
          matchValue: rule.matchValue,
        });
        if (!res.uids.length) continue;

        moves.push({
          id: crypto.randomUUID(),
          accountId: acc.id,
          accountEmail: acc.email,
          sourceFolder: rule.sourceFolder || "INBOX",
          destFolder: rule.destFolder,
          label: `Règle : ${rule.name}`,
          uids: res.uids,
          sampleSubjects: res.sampleSubjects,
          checked: true,
        });
      }
    }

    const plan: SortPlan = {
      id: crypto.randomUUID(),
      title: "Tri automatique par règles",
      source: "rule",
      createdAt: new Date().toISOString(),
      status: "draft",
      moves,
    };
    this.db.savePlan(plan);
    return plan;
  }

  saveMovesAsRules(moves: SortMoveItem[]): SortRule[] {
    const created: SortRule[] = [];
    for (const m of moves) {
      if (!m.label || m.label.startsWith("Règle :")) continue;
      const isSender = m.label.includes("@");
      const rule: SortRule = {
        id: crypto.randomUUID(),
        name: `${m.label} → ${formatDestinationLabel(m.destFolder)}`,
        accountId: m.accountId,
        matchType: isSender ? "sender" : "domain",
        matchValue: m.label.split(",")[0].trim(),
        sourceFolder: m.sourceFolder,
        destFolder: m.destFolder,
        enabled: true,
        createdAt: new Date().toISOString(),
      };
      this.db.saveRule(rule);
      created.push(rule);
    }
    return created;
  }

  async applyPlan(
    planId: string,
    onProgress?: (ev: PlanApplyProgressEvent) => void,
  ): Promise<{ plan: SortPlan; historyEntries: ExecutionHistoryEntry[] }> {
    const plan = this.db.getPlan(planId);
    if (!plan) {
      throw new Error(`Plan introuvable : ${planId}`);
    }

    const settings = this.db.getSettings();
    const activeMoves = plan.moves.filter((m) => m.checked && m.uids.length > 0);
    if (!activeMoves.length) {
      throw new Error("Aucun lot coché à exécuter dans ce plan.");
    }

    const entries: ExecutionHistoryEntry[] = [];
    let anyFailed = false;

    for (const move of activeMoves) {
      const account = this.db.getAccount(move.accountId);
      if (!account) {
        anyFailed = true;
        continue;
      }

      const msgIds = this.db.getMessageIdsByUids(
        account.id,
        move.sourceFolder,
        move.uids,
      );

      try {
        onProgress?.({
          planId: plan.id,
          moveId: move.id,
          destFolder: move.destFolder,
          processed: 0,
          total: move.uids.length,
          status: "running",
          message: `Déplacement vers ${move.destFolder}...`,
        });

        const result = await this.connector.moveUidsInWaves({
          account,
          sourceFolder: move.sourceFolder,
          destFolder: move.destFolder,
          uids: move.uids,
          batchSize: settings.waveBatchSize,
          delayMs: settings.waveDelayMs,
          onBatchProgress: (processed, total) => {
            onProgress?.({
              planId: plan.id,
              moveId: move.id,
              destFolder: move.destFolder,
              processed,
              total,
              status: "running",
            });
          },
        });

        this.db.removeMovedEmails(account.id, move.sourceFolder, move.uids);

        const entry: ExecutionHistoryEntry = {
          id: crypto.randomUUID(),
          planId: plan.id,
          accountId: account.id,
          accountEmail: account.email,
          sourceFolder: move.sourceFolder,
          destFolder: result.resolvedDest,
          movedUids: result.destUids,
          messageIds: msgIds,
          count: result.movedCount,
          executedAt: new Date().toISOString(),
          undoneAt: null,
          status: "ok",
          errorMessage: null,
        };
        this.db.addHistoryEntry(entry);
        entries.push(entry);

        onProgress?.({
          planId: plan.id,
          moveId: move.id,
          destFolder: result.resolvedDest,
          processed: result.movedCount,
          total: move.uids.length,
          status: "done",
        });
      } catch (err) {
        anyFailed = true;
        const msg = err instanceof Error ? err.message : String(err);
        const entry: ExecutionHistoryEntry = {
          id: crypto.randomUUID(),
          planId: plan.id,
          accountId: account.id,
          accountEmail: account.email,
          sourceFolder: move.sourceFolder,
          destFolder: move.destFolder,
          movedUids: [],
          messageIds: msgIds,
          count: 0,
          executedAt: new Date().toISOString(),
          undoneAt: null,
          status: "error",
          errorMessage: msg,
        };
        this.db.addHistoryEntry(entry);
        entries.push(entry);

        onProgress?.({
          planId: plan.id,
          moveId: move.id,
          destFolder: move.destFolder,
          processed: 0,
          total: move.uids.length,
          status: "error",
          message: msg,
        });
      }
    }

    const updatedPlan: SortPlan = {
      ...plan,
      status: anyFailed ? "partial" : "applied",
      moves: plan.moves.filter((m) => !m.checked),
    };
    this.db.savePlan(updatedPlan);
    return { plan: updatedPlan, historyEntries: entries };
  }

  async undoHistoryEntry(historyId: string): Promise<number> {
    const entry = this.db.listHistory(100).find((h) => h.id === historyId);
    if (!entry) {
      throw new Error("Entrée d'historique introuvable.");
    }
    if (entry.status !== "ok") {
      throw new Error("Ce lot ne peut pas être annulé.");
    }
    const account = this.db.getAccount(entry.accountId);
    if (!account) {
      throw new Error("Compte associé introuvable.");
    }

    const restored = await this.connector.undoMove({
      account,
      sourceFolder: entry.sourceFolder,
      destFolder: entry.destFolder,
      destUids: entry.movedUids,
      messageIds: entry.messageIds,
    });
    this.db.markHistoryUndone(entry.id);
    return restored;
  }
}
