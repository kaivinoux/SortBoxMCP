import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AppDatabase } from "../src/main/db/database.js";

describe("AppDatabase (SQLite + FTS5)", () => {
  let db: AppDatabase;

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
        uid: 10,
        messageId: "<m10@promo>",
        fromRaw: "Promo <promo@boutique.fr>",
        fromName: "Promo",
        fromAddr: "promo@boutique.fr",
        domain: "boutique.fr",
        toRaw: "user@orange.fr",
        subject: "Soldes -60% aujourd'hui",
        dateIso: "2026-11-01T10:00:00.000Z",
        dateTs: 1793527200000,
        sizeBytes: 15000,
        seen: false,
        flagged: false,
        hasUnsubscribe: true,
        unsubscribeUrl: "https://boutique.fr/unsub",
      },
      {
        accountId: "acc1",
        folderPath: "INBOX",
        uid: 11,
        messageId: "<m11@promo>",
        fromRaw: "Promo <promo@boutique.fr>",
        fromName: "Promo",
        fromAddr: "promo@boutique.fr",
        domain: "boutique.fr",
        toRaw: "user@orange.fr",
        subject: "Offre flash",
        dateIso: "2026-11-02T10:00:00.000Z",
        dateTs: 1793613600000,
        sizeBytes: 12000,
        seen: true,
        flagged: false,
        hasUnsubscribe: true,
        unsubscribeUrl: "https://boutique.fr/unsub",
      },
      {
        accountId: "acc1",
        folderPath: "INBOX",
        uid: 12,
        messageId: "<m12@impots>",
        fromRaw: "DGFIP <ne-pas-repondre@dgfip.finances.gouv.fr>",
        fromName: "DGFIP",
        fromAddr: "ne-pas-repondre@dgfip.finances.gouv.fr",
        domain: "dgfip.finances.gouv.fr",
        toRaw: "user@orange.fr",
        subject: "Votre avis d'imposition",
        dateIso: "2026-11-03T10:00:00.000Z",
        dateTs: 1793700000000,
        sizeBytes: 95000,
        seen: false,
        flagged: false,
        hasUnsubscribe: false,
        unsubscribeUrl: null,
      },
    ]);
  });

  afterEach(() => {
    db.close();
  });

  it("computes audit stats and sender groups accurately", () => {
    const stats = db.getAuditStats("acc1", "INBOX");
    expect(stats.totalMessages).toBe(3);
    expect(stats.unreadMessages).toBe(2);
    expect(stats.newsletterMessages).toBe(2);
    expect(stats.uniqueSenders).toBe(2);

    const groups = db.querySenderGroups({ accountId: "acc1", folderPath: "INBOX" });
    expect(groups).toHaveLength(2);
    expect(groups[0].fromAddr).toBe("promo@boutique.fr");
    expect(groups[0].totalCount).toBe(2);
    expect(groups[0].suggestedFolder).toBe("__TRASH__");
    expect(groups[1].suggestedCategory).toBe("Administratif");
  });

  it("supports FTS5 search and keeps index clean on removeMovedEmails", () => {
    const found = db.searchEmailsFts("imposition", "acc1");
    expect(found).toHaveLength(1);
    expect(found[0].uid).toBe(12);

    db.removeMovedEmails("acc1", "INBOX", [12]);
    expect(db.searchEmailsFts("imposition", "acc1")).toHaveLength(0);
  });

  it("tracks unsubscribed senders across sender and domain groupings and picks newest URL", () => {
    db.upsertEmails([
      {
        accountId: "acc1",
        folderPath: "INBOX",
        uid: 99,
        messageId: "<m99@promo>",
        fromRaw: "Promo <promo@boutique.fr>",
        fromName: "Promo",
        fromAddr: "promo@boutique.fr",
        domain: "boutique.fr",
        toRaw: "user@orange.fr",
        subject: "Offre plus récente",
        dateIso: "2026-11-25T10:00:00.000Z",
        dateTs: 1795600800000,
        sizeBytes: 12000,
        seen: false,
        flagged: false,
        hasUnsubscribe: true,
        unsubscribeUrl: "https://boutique.fr/aa-newest-token",
      },
    ]);

    const beforeGroups = db.querySenderGroups({ accountId: "acc1", folderPath: "INBOX" });
    const promoBefore = beforeGroups.find((g) => g.fromAddr === "promo@boutique.fr");
    // Even though "aa-newest-token" < "unsub" lexicographically, it must win because dateTs is newest
    expect(promoBefore?.unsubscribeUrl).toBe("https://boutique.fr/aa-newest-token");

    db.saveUnsubscribeStatus({
      accountId: "acc1",
      senderKey: "dgfip.finances.gouv.fr",
      status: "pending",
      method: "https",
      targetUrl: "https://dgfip.fr/prefs",
      detail: "À confirmer",
    });

    const ts = db.markSenderUnsubscribed(
      "acc1",
      "promo@boutique.fr",
      "one_click_post",
      "https://boutique.fr/aa-newest-token",
    );
    expect(ts).toBeTruthy();

    const groups = db.querySenderGroups({ accountId: "acc1", folderPath: "INBOX" });
    const promo = groups.find((g) => g.fromAddr === "promo@boutique.fr");
    const dgfip = groups.find((g) => g.domain === "dgfip.finances.gouv.fr");
    expect(promo?.unsubscribeStatus).toBe("confirmed");
    expect(promo?.unsubscribedAt).toBe(ts);
    expect(dgfip?.unsubscribeStatus).toBe("pending");
    expect(dgfip?.unsubscribedAt).toBeNull();
  });
});
