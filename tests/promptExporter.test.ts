import { describe, expect, it } from "vitest";
import {
  buildZeroConfigPrompt,
  parseImportedSortPlanJson,
} from "../src/main/triage/promptExporter.js";
import type { SenderGroup } from "../src/shared/types.js";

describe("promptExporter", () => {
  it("builds a redacted prompt for unknown senders", () => {
    const groups: SenderGroup[] = [
      {
        groupKey: "known@edf.fr",
        accountId: "a1",
        accountEmail: "u@orange.fr",
        folderPath: "INBOX",
        fromAddr: "known@edf.fr",
        fromName: "EDF",
        domain: "edf.fr",
        totalCount: 5,
        unreadCount: 0,
        totalSizeBytes: 1000,
        hasUnsubscribe: false,
        unsubscribeUrl: null,
        latestDateIso: "",
        sampleSubjects: ["Facture"],
        suggestedCategory: "Factures & Abonnements",
        suggestedFolder: "INBOX/Factures",
      },
      {
        groupKey: "promo@mystore.fr",
        accountId: "a1",
        accountEmail: "u@orange.fr",
        folderPath: "INBOX",
        fromAddr: "promo@mystore.fr",
        fromName: "MyStore",
        domain: "mystore.fr",
        totalCount: 40,
        unreadCount: 38,
        totalSizeBytes: 50000,
        hasUnsubscribe: true,
        unsubscribeUrl: null,
        latestDateIso: "",
        sampleSubjects: ["Commande 987654321 pour client@example.com"],
        suggestedCategory: null,
        suggestedFolder: null,
      },
    ];

    const prompt = buildZeroConfigPrompt(groups, ["INBOX", "INBOX/TRASH"], {
      onlyUnknown: true,
    });
    expect(prompt).not.toContain("edf.fr");
    expect(prompt).toContain("promo@mystore.fr");
    expect(prompt).toContain("[num]");
    expect(prompt).toContain("[email]");
  });

  it("extracts JSON from markdown fences and validates destinations", () => {
    const raw = [
      "Voici le plan proposé :",
      "```json",
      '{"title":"Nettoyage","moves":[{"dest":"INBOX/TRASH","domains":["mystore.fr"]}]}',
      "```",
    ].join("\n");

    const parsed = parseImportedSortPlanJson(raw);
    expect(parsed.title).toBe("Nettoyage");
    expect(parsed.moves[0].dest).toBe("INBOX/TRASH");
    expect(parsed.moves[0].domains).toEqual(["mystore.fr"]);

    expect(() =>
      parseImportedSortPlanJson('{"moves":[{"dest":"../bad","domains":["x.fr"]}]}'),
    ).toThrow();
  });
});
