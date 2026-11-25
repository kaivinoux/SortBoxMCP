import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppDatabase } from "../src/main/db/database.js";
import type { ImapConnector } from "../src/main/mail/imapConnector.js";
import { PlanEngine } from "../src/main/triage/planEngine.js";

describe("PlanEngine", () => {
  let db: AppDatabase;
  let mockConnector: {
    moveUidsInWaves: ReturnType<typeof vi.fn>;
    undoMove: ReturnType<typeof vi.fn>;
  };
  let engine: PlanEngine;

  beforeEach(() => {
    db = new AppDatabase(":memory:");
    db.createAccount("acc1", {
      email: "user@orange.fr",
      label: "Orange",
      provider: "orange",
      authMode: "imap_password",
      imapHost: "imap.orange.fr",
      imapPort: 993,
      imapSecure: true,
    });
    db.upsertEmails([
      {
        accountId: "acc1",
        folderPath: "INBOX",
        uid: 101,
        messageId: "<id101@shop>",
        fromRaw: "Shop <promo@shop.fr>",
        fromName: "Shop",
        fromAddr: "promo@shop.fr",
        domain: "shop.fr",
        toRaw: "user@orange.fr",
        subject: "Promo",
        dateIso: "2026-11-10T10:00:00.000Z",
        dateTs: 1794304800000,
        sizeBytes: 2000,
        seen: false,
        flagged: false,
        hasUnsubscribe: true,
        unsubscribeUrl: null,
      },
    ]);

    mockConnector = {
      moveUidsInWaves: vi.fn(async () => ({
        movedCount: 1,
        destUids: [5001],
        resolvedDest: "INBOX/TRASH",
      })),
      undoMove: vi.fn(async () => 1),
    };
    engine = new PlanEngine(db, mockConnector as unknown as ImapConnector);
  });

  afterEach(() => {
    db.close();
  });

  it("creates, applies, logs history, and undoes a sort plan", async () => {
    const groups = db.querySenderGroups({ accountId: "acc1" });
    const plan = engine.createPlanFromSenderGroups({
      title: "Test plan",
      selections: [{ group: groups[0], destFolder: "INBOX/TRASH" }],
    });

    expect(plan.moves).toHaveLength(1);
    expect(plan.moves[0].uids).toEqual([101]);

    const applied = await engine.applyPlan(plan.id);
    expect(mockConnector.moveUidsInWaves).toHaveBeenCalledTimes(1);
    expect(applied.historyEntries).toHaveLength(1);
    expect(applied.historyEntries[0].status).toBe("ok");
    expect(db.getAuditStats("acc1", "INBOX").totalMessages).toBe(0);

    const restored = await engine.undoHistoryEntry(applied.historyEntries[0].id);
    expect(restored).toBe(1);
    expect(mockConnector.undoMove).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceFolder: "INBOX",
        destFolder: "INBOX/TRASH",
        destUids: [5001],
      }),
    );
    expect(db.listHistory(10)[0].status).toBe("undone");
  });
});
