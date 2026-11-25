import { describe, expect, it } from "vitest";
import { resolveFolderTarget } from "../src/main/mail/imapConnector.js";
import { SPECIAL_JUNK, SPECIAL_TRASH } from "../src/shared/folders.js";

describe("resolveFolderTarget", () => {
  it("routes trash aliases to French Gmail [Gmail]/Corbeille", () => {
    const gmailFolders = [
      { path: "INBOX", delimiter: "/", specialUse: null },
      { path: "[Gmail]/Messages envoyés", delimiter: "/", specialUse: "\\Sent" },
      { path: "[Gmail]/Spam", delimiter: "/", specialUse: "\\Junk" },
      { path: "[Gmail]/Corbeille", delimiter: "/", specialUse: "\\Trash" },
      { path: "INBOX/TRASH", delimiter: "/", specialUse: null },
      { path: "maya", delimiter: "/", specialUse: null },
    ];

    expect(
      resolveFolderTarget({
        destFolder: SPECIAL_TRASH,
        listedFolders: gmailFolders,
        isGmail: true,
      }).existingPath,
    ).toBe("[Gmail]/Corbeille");

    expect(
      resolveFolderTarget({
        destFolder: "INBOX/TRASH",
        listedFolders: gmailFolders,
        isGmail: true,
      }).existingPath,
    ).toBe("[Gmail]/Corbeille");

    expect(
      resolveFolderTarget({
        destFolder: SPECIAL_JUNK,
        listedFolders: gmailFolders,
        isGmail: true,
      }).existingPath,
    ).toBe("[Gmail]/Spam");
  });

  it("creates top-level labels on Gmail even if INBOX/ prefix was given", () => {
    const gmailFolders = [
      { path: "INBOX", delimiter: "/", specialUse: null },
      { path: "[Gmail]/Corbeille", delimiter: "/", specialUse: "\\Trash" },
      { path: "INBOX/TRASH", delimiter: "/", specialUse: null },
    ];

    const res = resolveFolderTarget({
      destFolder: "INBOX/Factures",
      listedFolders: gmailFolders,
      isGmail: true,
    });
    expect(res.existingPath).toBeNull();
    expect(res.createPath).toBe("Factures");
  });

  it("routes trash to INBOX/TRASH on Orange when marked as Trash or named INBOX/TRASH", () => {
    const orangeFolders = [
      { path: "INBOX", delimiter: "/", specialUse: null },
      { path: "INBOX/OUTBOX", delimiter: "/", specialUse: "\\Sent" },
      { path: "INBOX/TRASH", delimiter: "/", specialUse: "\\Trash" },
    ];

    expect(
      resolveFolderTarget({
        destFolder: SPECIAL_TRASH,
        listedFolders: orangeFolders,
      }).existingPath,
    ).toBe("INBOX/TRASH");

    const createFactures = resolveFolderTarget({
      destFolder: "Factures",
      listedFolders: orangeFolders,
    });
    expect(createFactures.createPath).toEqual(["INBOX", "Factures"]);
  });

  it("handles Outlook Deleted and Dovecot INBOX. namespace", () => {
    const outlookFolders = [
      { path: "INBOX", delimiter: "/" },
      { path: "Deleted", delimiter: "/", specialUse: "\\Trash" },
    ];
    expect(
      resolveFolderTarget({
        destFolder: SPECIAL_TRASH,
        listedFolders: outlookFolders,
      }).existingPath,
    ).toBe("Deleted");

    const dovecotNs = [{ path: "INBOX.Trash", delimiter: ".", specialUse: "\\Trash" }];
    expect(
      resolveFolderTarget({
        destFolder: "INBOX/Factures",
        listedFolders: dovecotNs,
        namespacePrefix: "INBOX.",
      }).createPath,
    ).toEqual(["Factures"]);
  });
});
