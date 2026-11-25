import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { AppDatabase } from "../db/database.js";
import type { ImapConnector } from "../mail/imapConnector.js";
import { PlanEngine } from "../triage/planEngine.js";
import { startMcpStdioServer } from "./mcpServer.js";

function findRuntimeInfo(): {
  port?: number;
  mcpEnabled?: boolean;
  dbPath: string;
} {
  const appData =
    process.env.APPDATA ||
    path.join(process.env.USERPROFILE || process.cwd(), "AppData", "Roaming");

  const candidates = [
    path.join(appData, "IA For EveryOne — SortBox E-Mail"),
    path.join(appData, "ia-for-everyone-sortbox-email"),
    path.join(appData, "SortBox MCP"),
    path.join(appData, "sortbox-mcp"),
  ];

  for (const dir of candidates) {
    const runtimePath = path.join(dir, "runtime.json");
    if (fs.existsSync(runtimePath)) {
      try {
        const data = JSON.parse(fs.readFileSync(runtimePath, "utf8")) as {
          port?: number;
          mcpEnabled?: boolean;
          dbPath?: string;
        };
        if (data.dbPath) {
          return {
            port: data.port,
            mcpEnabled: data.mcpEnabled,
            dbPath: data.dbPath,
          };
        }
      } catch {
        // Ignore malformed runtime.json
      }
    }
    const dbCandidate = path.join(dir, "sortbox.sqlite");
    if (fs.existsSync(dbCandidate)) {
      return { dbPath: dbCandidate };
    }
  }

  return {
    dbPath: path.join(appData, "IA For EveryOne — SortBox E-Mail", "sortbox.sqlite"),
  };
}

async function isHttpMcpReachable(port: number): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "__ping__",
        method: "tools/list",
        params: {},
      }),
      signal: AbortSignal.timeout(800),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function proxyStdioToHttp(port: number): Promise<void> {
  const rl = readline.createInterface({
    input: process.stdin,
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      continue;
    }

    const res = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: trimmed,
    });

    // Notifications (no id) do not expect a response
    if (!("id" in msg) || msg.id === undefined || msg.id === null) {
      continue;
    }

    const bodyText = await res.text();
    const contentType = res.headers.get("content-type") || "";
    if (contentType.includes("text/event-stream")) {
      for (const evtLine of bodyText.split(/\r?\n/)) {
        if (evtLine.startsWith("data: ")) {
          const jsonLine = evtLine.slice(6).trim();
          if (jsonLine) process.stdout.write(`${jsonLine}\n`);
        }
      }
    } else if (bodyText.trim()) {
      process.stdout.write(`${bodyText.trim()}\n`);
    }
  }
}

async function main(): Promise<void> {
  console.log = (...args: unknown[]) => console.error(...args);
  const info = findRuntimeInfo();

  if (info.mcpEnabled && info.port && (await isHttpMcpReachable(info.port))) {
    await proxyStdioToHttp(info.port);
    return;
  }

  // Fallback: direct local SQLite MCP server (read/search/propose_sort_plan work even when GUI is closed)
  const db = new AppDatabase(info.dbPath);
  const unavailableConnector = {
    moveUidsInWaves: async () => {
      throw new Error(
        "Ouvre l'application SortBox MCP (et active le serveur MCP HTTP) pour exécuter des déplacements IMAP sécurisés.",
      );
    },
    undoMove: async () => {
      throw new Error("Ouvre l'application SortBox MCP pour annuler un lot.");
    },
  } as unknown as ImapConnector;

  const planEngine = new PlanEngine(db, unavailableConnector);
  await startMcpStdioServer({
    db,
    connector: unavailableConnector,
    planEngine,
  });
}

main().catch((err) => {
  console.error("SortBox stdio MCP error:", err);
  process.exit(1);
});
