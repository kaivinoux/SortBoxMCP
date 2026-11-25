import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AppDatabase } from "../src/main/db/database.js";
import type { ImapConnector } from "../src/main/mail/imapConnector.js";
import { McpHttpBridge } from "../src/main/mcp/mcpServer.js";
import { PlanEngine } from "../src/main/triage/planEngine.js";

describe("McpHttpBridge", () => {
  let db: AppDatabase;
  let bridge: McpHttpBridge;

  beforeEach(async () => {
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
        uid: 42,
        messageId: "<m42@news>",
        fromRaw: "News <news@exemple.fr>",
        fromName: "News",
        fromAddr: "news@exemple.fr",
        domain: "exemple.fr",
        toRaw: "user@orange.fr",
        subject: "Edition du jour",
        dateIso: "2026-11-12T10:00:00.000Z",
        dateTs: 1794477600000,
        sizeBytes: 3400,
        seen: false,
        flagged: false,
        hasUnsubscribe: true,
        unsubscribeUrl: null,
      },
    ]);

    const engine = new PlanEngine(db, {} as ImapConnector);
    bridge = new McpHttpBridge({
      db,
      connector: {} as ImapConnector,
      planEngine: engine,
    });
    await bridge.start(0);
  });

  afterEach(async () => {
    await bridge.stop();
    db.close();
  });

  async function mcpCall(method: string, params: Record<string, unknown>, id: number) {
    const port = bridge.getPort();
    const res = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
    });
    expect(res.ok).toBe(true);
    const text = await res.text();
    const dataLine = text
      .split("\n")
      .find((l) => l.startsWith("data: "));
    return JSON.parse(dataLine ? dataLine.slice(6) : text);
  }

  it("proposes a draft sort plan and blocks apply_sort_plan when UI confirmation is required", async () => {
    const listResp = await mcpCall("tools/list", {}, 1);
    const toolNames = listResp.result.tools.map((t: { name: string }) => t.name);
    expect(toolNames).toContain("audit_summary");
    expect(toolNames).toContain("propose_sort_plan");
    expect(toolNames).toContain("apply_sort_plan");

    const propResp = await mcpCall(
      "tools/call",
      {
        name: "propose_sort_plan",
        arguments: {
          accountId: "acc1",
          title: "Plan MCP Test",
          moves: [{ dest: "INBOX/Newsletters", domains: ["exemple.fr"] }],
        },
      },
      2,
    );

    const payload = JSON.parse(propResp.result.content[0].text);
    expect(payload.totalTargetedEmails).toBe(1);
    expect(db.listPlans()).toHaveLength(1);

    const applyResp = await mcpCall(
      "tools/call",
      {
        name: "apply_sort_plan",
        arguments: { planId: payload.planId },
      },
      3,
    );
    expect(applyResp.result.content[0].text).toContain("bloquée par sécurité");
  });
});
