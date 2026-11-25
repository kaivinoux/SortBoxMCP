import crypto from "node:crypto";
import http, { type IncomingMessage, type ServerResponse } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import type { McpActivityEvent, SortPlan } from "../../shared/types.js";
import type { AppDatabase } from "../db/database.js";
import type { ImapConnector } from "../mail/imapConnector.js";
import type { PlanEngine } from "../triage/planEngine.js";
import { parseImportedSortPlanJson } from "../triage/promptExporter.js";

export interface McpRuntimeDeps {
  db: AppDatabase;
  connector: ImapConnector;
  planEngine: PlanEngine;
  onActivity?: (ev: McpActivityEvent) => void;
  onPlanUpdated?: (plan: SortPlan) => void;
}

function recordActivity(
  deps: McpRuntimeDeps,
  toolName: string,
  summary: string,
  status: McpActivityEvent["status"],
): void {
  deps.onActivity?.({
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    toolName,
    summary,
    status,
  });
}

export function createSortBoxMcpServer(deps: McpRuntimeDeps): McpServer {
  const server = new McpServer({
    name: "sortbox-mcp",
    version: "0.1.0",
  });

  server.registerTool(
    "list_accounts",
    {
      title: "Lister les boîtes mail",
      description:
        "Retourne les comptes mail connectés dans SortBox (sans aucun secret ni mot de passe).",
      inputSchema: {},
    },
    async () => {
      const accounts = deps.db.listAccounts();
      recordActivity(deps, "list_accounts", `${accounts.length} compte(s)`, "ok");
      return {
        content: [{ type: "text", text: JSON.stringify(accounts, null, 2) }],
      };
    },
  );

  server.registerTool(
    "list_folders",
    {
      title: "Lister les dossiers IMAP",
      description:
        "Liste les dossiers synchronisés (nombre total et non lus) pour un compte ou tous les comptes.",
      inputSchema: {
        accountId: z.string().optional().describe("ID du compte (optionnel)"),
      },
    },
    async ({ accountId }) => {
      const folders = deps.db.listFolders(accountId);
      recordActivity(deps, "list_folders", `${folders.length} dossier(s)`, "ok");
      return {
        content: [{ type: "text", text: JSON.stringify(folders, null, 2) }],
      };
    },
  );

  server.registerTool(
    "audit_summary",
    {
      title: "Résumé d'audit et top expéditeurs",
      description:
        "Retourne les statistiques globales et les expéditeurs/domaines regroupés depuis le cache SQLite local.",
      inputSchema: {
        accountId: z.string().optional(),
        folderPath: z.string().optional(),
        filter: z
          .enum(["all", "newsletter", "known", "unknown", "unread", "large"])
          .optional(),
        groupBy: z.enum(["sender", "domain"]).optional(),
        limit: z.number().int().min(1).max(300).optional(),
      },
    },
    async ({ accountId, folderPath, filter, groupBy, limit }) => {
      const stats = deps.db.getAuditStats(accountId, folderPath);
      const groups = deps.db.querySenderGroups({
        accountId,
        folderPath,
        filter,
        groupBy,
        limit: limit ?? 80,
      });
      recordActivity(
        deps,
        "audit_summary",
        `${groups.length} groupe(s) retourné(s)`,
        "ok",
      );
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ stats, topSenders: groups }, null, 2),
          },
        ],
      };
    },
  );

  server.registerTool(
    "search_emails",
    {
      title: "Rechercher dans le cache local",
      description:
        "Recherche plein texte FTS5 sur les expéditeurs, domaines et objets déjà indexés localement.",
      inputSchema: {
        query: z.string().min(1),
        accountId: z.string().optional(),
        limit: z.number().int().min(1).max(200).optional(),
      },
    },
    async ({ query, accountId, limit }) => {
      const results = deps.db.searchEmailsFts(query, accountId, limit ?? 50);
      recordActivity(
        deps,
        "search_emails",
        `"${query}" → ${results.length} résultat(s)`,
        "ok",
      );
      return {
        content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
      };
    },
  );

  server.registerTool(
    "propose_sort_plan",
    {
      title: "Proposer un plan de tri (Dry-Run)",
      description:
        "Crée un plan de tri en brouillon visible dans l'interface Windows pour validation humaine avant déplacement.",
      inputSchema: {
        accountId: z.string().min(1),
        title: z.string().optional(),
        sourceFolder: z.string().optional(),
        moves: z
          .array(
            z.object({
              dest: z.string().min(1),
              senders: z.array(z.string()).optional(),
              domains: z.array(z.string()).optional(),
              uids: z.array(z.number().int().positive()).optional(),
              reason: z.string().optional(),
            }),
          )
          .min(1),
      },
    },
    async ({ accountId, title, sourceFolder, moves }) => {
      const spec = parseImportedSortPlanJson(
        JSON.stringify({
          title: title || "Plan proposé via MCP",
          source_folder: sourceFolder || "INBOX",
          moves,
        }),
      );
      const plan = deps.planEngine.createPlanFromImportedSpec({
        spec,
        accountId,
        source: "mcp",
      });
      deps.onPlanUpdated?.(plan);
      const totalMsgs = plan.moves.reduce((acc, m) => acc + m.uids.length, 0);
      recordActivity(
        deps,
        "propose_sort_plan",
        `Plan "${plan.title}" (${totalMsgs} mails) en attente dans l'UI`,
        "pending_ui",
      );
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                planId: plan.id,
                title: plan.title,
                status: plan.status,
                totalTargetedEmails: totalMsgs,
                moves: plan.moves.map((m) => ({
                  destFolder: m.destFolder,
                  label: m.label,
                  count: m.uids.length,
                  sampleSubjects: m.sampleSubjects,
                })),
                note: "Le plan est prêt dans l'onglet 'Plan & Dry-Run' de SortBox pour validation par l'utilisateur.",
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  server.registerTool(
    "apply_sort_plan",
    {
      title: "Appliquer un plan de tri",
      description:
        "Exécute un plan existant si la confirmation manuelle UI est désactivée dans les paramètres, sinon demande validation dans l'app.",
      inputSchema: {
        planId: z.string().min(1),
      },
    },
    async ({ planId }) => {
      const settings = deps.db.getSettings();
      if (settings.mcpRequireUiConfirmation) {
        recordActivity(
          deps,
          "apply_sort_plan",
          `Exécution bloquée (validation UI requise) pour ${planId}`,
          "blocked",
        );
        return {
          content: [
            {
              type: "text",
              text: "Exécution automatique bloquée par sécurité : l'utilisateur doit vérifier l'aperçu Dry-Run et cliquer sur « Appliquer » dans l'application SortBox.",
            },
          ],
        };
      }

      const result = await deps.planEngine.applyPlan(planId);
      deps.onPlanUpdated?.(result.plan);
      recordActivity(
        deps,
        "apply_sort_plan",
        `Plan ${planId} appliqué (${result.historyEntries.length} lot(s))`,
        "ok",
      );
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    },
  );

  return server;
}

export class McpHttpBridge {
  private server: http.Server | null = null;
  private readonly deps: McpRuntimeDeps;
  private currentPort: number | null = null;

  constructor(deps: McpRuntimeDeps) {
    this.deps = deps;
  }

  isRunning(): boolean {
    return this.server !== null;
  }

  getPort(): number | null {
    return this.currentPort;
  }

  async start(port: number): Promise<void> {
    await this.stop();

    const httpServer = http.createServer(
      async (req: IncomingMessage, res: ServerResponse) => {
        const reqUrl = new URL(req.url || "/", "http://127.0.0.1");
        if (reqUrl.pathname !== "/mcp") {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Not found. Use /mcp endpoint." }));
          return;
        }

        try {
          let parsedBody: unknown = undefined;
          if (req.method === "POST") {
            const chunks: Buffer[] = [];
            for await (const chunk of req) {
              chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
            }
            const raw = Buffer.concat(chunks).toString("utf8").trim();
            if (raw) {
              parsedBody = JSON.parse(raw);
            }
          }

          const mcpServer = createSortBoxMcpServer(this.deps);
          const transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: undefined,
          });

          res.on("close", () => {
            transport.close().catch(() => {});
            mcpServer.close().catch(() => {});
          });

          await mcpServer.connect(transport);
          await transport.handleRequest(req, res, parsedBody);
        } catch (err) {
          if (!res.headersSent) {
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(
              JSON.stringify({
                error: err instanceof Error ? err.message : String(err),
              }),
            );
          }
        }
      },
    );

    await new Promise<void>((resolve, reject) => {
      httpServer.once("error", reject);
      httpServer.listen(port, "127.0.0.1", () => {
        httpServer.removeListener("error", reject);
        resolve();
      });
    });

    const addr = httpServer.address();
    this.server = httpServer;
    this.currentPort =
      typeof addr === "object" && addr ? addr.port : port;
  }

  async stop(): Promise<void> {
    if (!this.server) return;
    const srv = this.server;
    this.server = null;
    this.currentPort = null;
    await new Promise<void>((resolve) => srv.close(() => resolve()));
  }
}

export async function startMcpStdioServer(deps: McpRuntimeDeps): Promise<void> {
  const mcpServer = createSortBoxMcpServer(deps);
  const transport = new StdioServerTransport();
  await mcpServer.connect(transport);
}
