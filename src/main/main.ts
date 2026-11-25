import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, ipcMain, safeStorage, shell } from "electron";
import { detectProviderFromEmail } from "../shared/providers.js";
import type {
  AddAccountInput,
  AppSettings,
  McpActivityEvent,
  SenderGroup,
  SenderQueryOptions,
  SortMoveItem,
} from "../shared/types.js";
import { runMicrosoftPkceLogin } from "./credentials/microsoftOAuth.js";
import { SecretVault, type EncryptionProvider } from "./credentials/vault.js";
import { AppDatabase } from "./db/database.js";
import { ImapConnector } from "./mail/imapConnector.js";
import { McpHttpBridge, startMcpStdioServer } from "./mcp/mcpServer.js";
import { generateSortSpecWithBuiltinAi } from "./triage/aiClient.js";
import { PlanEngine } from "./triage/planEngine.js";
import {
  buildZeroConfigPrompt,
  parseImportedSortPlanJson,
} from "./triage/promptExporter.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isStdioMcpMode = process.argv.includes("--mcp-stdio");

if (isStdioMcpMode) {
  // Never allow stray console logs to corrupt JSON-RPC on stdout in stdio MCP mode
  console.log = (...args: unknown[]) => console.error(...args);
}

const AI_SECRET_KEY = "__sortbox_builtin_ai_key__";

const safeStorageCrypto: EncryptionProvider = {
  isAvailable: () => safeStorage.isEncryptionAvailable(),
  encrypt: (plainText: string) =>
    safeStorage.encryptString(plainText).toString("base64"),
  decrypt: (encoded: string) =>
    safeStorage.decryptString(Buffer.from(encoded, "base64")),
};

let mainWindow: BrowserWindow | null = null;
const mcpActivityLog: McpActivityEvent[] = [];

function migrateLegacyUserData(userDataDir: string): void {
  const newDb = path.join(userDataDir, "sortbox.sqlite");
  if (fs.existsSync(newDb)) return;

  const appDataDir = app.getPath("appData");
  for (const legacyName of ["SortBox MCP", "sortbox-mcp"]) {
    const legacyDir = path.join(appDataDir, legacyName);
    const legacyDb = path.join(legacyDir, "sortbox.sqlite");
    if (!fs.existsSync(legacyDb)) continue;

    fs.mkdirSync(userDataDir, { recursive: true });
    for (const file of [
      "sortbox.sqlite",
      "sortbox.sqlite-wal",
      "sortbox.sqlite-shm",
      "vault.json",
    ]) {
      const src = path.join(legacyDir, file);
      const dst = path.join(userDataDir, file);
      if (fs.existsSync(src) && !fs.existsSync(dst)) {
        fs.copyFileSync(src, dst);
      }
    }
    break;
  }
}

function createServices() {
  const userDataDir = app.getPath("userData");
  migrateLegacyUserData(userDataDir);
  const db = new AppDatabase(path.join(userDataDir, "sortbox.sqlite"));
  const vault = new SecretVault(
    path.join(userDataDir, "vault.json"),
    safeStorageCrypto,
  );
  const connector = new ImapConnector(db, vault);
  const planEngine = new PlanEngine(db, connector);
  return { db, vault, connector, planEngine };
}

function sendToUi(channel: string, payload: unknown): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

function pushMcpActivity(ev: McpActivityEvent): void {
  mcpActivityLog.unshift(ev);
  if (mcpActivityLog.length > 50) mcpActivityLog.length = 50;
  sendToUi("mcp:activity", ev);
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1260,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    title: "IA For EveryOne — SortBox E-Mail",
    backgroundColor: "#020617",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.setMenuBarVisibility(false);

  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) {
    mainWindow.loadURL(devUrl);
  } else {
    mainWindow.loadFile(path.join(__dirname, "../../dist/index.html"));
  }
}

async function boot(): Promise<void> {
  if (!isStdioMcpMode) {
    const gotLock = app.requestSingleInstanceLock();
    if (!gotLock) {
      app.quit();
      return;
    }
    app.on("second-instance", () => {
      if (mainWindow) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.focus();
      }
    });
  }

  await app.whenReady();
  const { db, vault, connector, planEngine } = createServices();

  if (isStdioMcpMode) {
    await startMcpStdioServer({ db, connector, planEngine });
    return;
  }

  const mcpHttp = new McpHttpBridge({
    db,
    connector,
    planEngine,
    onActivity: pushMcpActivity,
    onPlanUpdated: (plan) => sendToUi("plans:updated", plan),
  });

  const userDataDir = app.getPath("userData");
  const dbPath = path.join(userDataDir, "sortbox.sqlite");

  function writeRuntimeInfo(mcpEnabled: boolean, port: number) {
    try {
      fs.mkdirSync(userDataDir, { recursive: true });
      fs.writeFileSync(
        path.join(userDataDir, "runtime.json"),
        JSON.stringify({ mcpEnabled, port, dbPath }, null, 2),
        "utf8",
      );
    } catch {
      // Best-effort runtime discovery file
    }
  }

  const initialSettings = db.getSettings();
  if (initialSettings.mcpEnabled) {
    mcpHttp
      .start(initialSettings.mcpPort)
      .then(() => writeRuntimeInfo(true, mcpHttp.getPort() ?? initialSettings.mcpPort))
      .catch((err) => {
        console.error("Failed to start MCP HTTP server:", err);
      });
  } else {
    writeRuntimeInfo(false, initialSettings.mcpPort);
  }

  // --- IPC: Accounts ---
  ipcMain.handle("accounts:list", () => db.listAccounts());

  ipcMain.handle("accounts:detectProvider", (_e, email: string) =>
    detectProviderFromEmail(email),
  );

  ipcMain.handle("accounts:test", async (_e, input: AddAccountInput) => {
    return connector.testConnection(
      {
        email: input.email.trim().toLowerCase(),
        authMode: input.authMode,
        imapHost: input.imapHost.trim(),
        imapPort: input.imapPort,
        imapSecure: input.imapSecure,
      },
      { password: input.secret || "" },
    );
  });

  ipcMain.handle("accounts:add", async (_e, input: AddAccountInput) => {
    const id = crypto.randomUUID();
    const account = db.createAccount(id, input);
    try {
      if (input.secret) {
        vault.setSecret(id, { password: input.secret });
      }
      return account;
    } catch (err) {
      db.deleteAccount(id);
      throw err;
    }
  });

  ipcMain.handle("accounts:microsoftLogin", async (_e, clientId: string, loginHint?: string) => {
    const effectiveClientId = (clientId || db.getSettings().microsoftClientId).trim();
    const tokens = await runMicrosoftPkceLogin({
      clientId: effectiveClientId,
      loginHint,
      openExternal: (url) => shell.openExternal(url),
    });
    const email = (tokens.email || loginHint || "").trim().toLowerCase();
    if (!email) {
      throw new Error("Impossible de déterminer l'adresse email Microsoft.");
    }
    if (effectiveClientId) {
      db.saveSettings({ microsoftClientId: effectiveClientId });
    }
    const existing = db.listAccounts().find((a) => a.email === email);
    const accountId = existing?.id || crypto.randomUUID();
    const account =
      existing ||
      db.createAccount(accountId, {
        email,
        label: email,
        provider: "microsoft",
        authMode: "microsoft_oauth",
        imapHost: "outlook.office365.com",
        imapPort: 993,
        imapSecure: true,
      });
    vault.setSecret(account.id, {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: tokens.expiresAt,
    });
    return account;
  });

  ipcMain.handle("accounts:delete", (_e, accountId: string) => {
    vault.deleteSecret(accountId);
    db.deleteAccount(accountId);
  });

  ipcMain.handle(
    "accounts:sync",
    async (_e, accountId: string, folderPath?: string, limit?: number) => {
      const account = db.getAccount(accountId);
      if (!account) throw new Error("Compte introuvable.");
      return connector.syncAccount(account, {
        folderPath: folderPath || "INBOX",
        limit,
        onProgress: (ev) => sendToUi("sync:progress", ev),
      });
    },
  );

  // --- IPC: Folders & Emails ---
  ipcMain.handle("folders:list", (_e, accountId?: string) =>
    db.listFolders(accountId),
  );

  ipcMain.handle("emails:stats", (_e, accountId?: string, folderPath?: string) =>
    db.getAuditStats(accountId, folderPath),
  );

  ipcMain.handle("emails:senderGroups", (_e, opts: SenderQueryOptions) =>
    db.querySenderGroups(opts),
  );

  ipcMain.handle("emails:search", (_e, query: string, accountId?: string) =>
    db.searchEmailsFts(query, accountId, 100),
  );

  // --- IPC: Plans ---
  ipcMain.handle("plans:list", () => db.listPlans());

  ipcMain.handle(
    "plans:createFromSenders",
    (
      _e,
      params: {
        title?: string;
        selections: Array<{
          group: SenderGroup;
          destFolder: string;
          matchBy?: "sender" | "domain";
        }>;
      },
    ) => planEngine.createPlanFromSenderGroups(params),
  );

  ipcMain.handle("plans:createFromRules", (_e, accountId?: string) =>
    planEngine.createPlanFromRules(accountId),
  );

  ipcMain.handle(
    "plans:importJson",
    (_e, accountId: string, rawJson: string) => {
      const spec = parseImportedSortPlanJson(rawJson);
      return planEngine.createPlanFromImportedSpec({
        spec,
        accountId,
        source: "ai_import",
      });
    },
  );

  ipcMain.handle(
    "plans:toggleMove",
    (_e, planId: string, moveId: string, checked: boolean) => {
      const plan = db.getPlan(planId);
      if (!plan) return null;
      plan.moves = plan.moves.map((m) =>
        m.id === moveId ? { ...m, checked } : m,
      );
      db.savePlan(plan);
      return plan;
    },
  );

  ipcMain.handle("plans:removeMove", (_e, planId: string, moveId: string) => {
    const plan = db.getPlan(planId);
    if (!plan) return null;
    plan.moves = plan.moves.filter((m) => m.id !== moveId);
    db.savePlan(plan);
    return plan;
  });

  ipcMain.handle("plans:delete", (_e, planId: string) => {
    db.deletePlan(planId);
  });

  ipcMain.handle("plans:apply", async (_e, planId: string) => {
    return planEngine.applyPlan(planId, (ev) => sendToUi("plan:progress", ev));
  });

  // --- IPC: Rules & History ---
  ipcMain.handle("rules:list", () => db.listRules());
  ipcMain.handle("rules:saveMovesAsRules", (_e, moves: SortMoveItem[]) =>
    planEngine.saveMovesAsRules(moves),
  );
  ipcMain.handle("rules:toggle", (_e, ruleId: string, enabled: boolean) => {
    const rule = db.listRules().find((r) => r.id === ruleId);
    if (rule) {
      db.saveRule({ ...rule, enabled });
    }
    return db.listRules();
  });
  ipcMain.handle("rules:delete", (_e, ruleId: string) => {
    db.deleteRule(ruleId);
    return db.listRules();
  });

  ipcMain.handle("history:list", () => db.listHistory(50));
  ipcMain.handle("history:undo", (_e, historyId: string) =>
    planEngine.undoHistoryEntry(historyId),
  );

  // --- IPC: AI & Zero-config Export ---
  ipcMain.handle(
    "ai:buildPrompt",
    (
      _e,
      opts: { accountId?: string; folderPath?: string; onlyUnknown?: boolean },
    ) => {
      const groups = db.querySenderGroups({
        accountId: opts.accountId,
        folderPath: opts.folderPath,
        limit: 150,
      });
      const folders = db
        .listFolders(opts.accountId === "all" ? undefined : opts.accountId)
        .map((f) => f.name);
      return buildZeroConfigPrompt(groups, folders, {
        onlyUnknown: opts.onlyUnknown ?? true,
      });
    },
  );

  ipcMain.handle(
    "ai:runBuiltin",
    async (_e, accountId: string, folderPath?: string) => {
      const settings = db.getSettings();
      const apiSecret = vault.getSecret(AI_SECRET_KEY);
      const groups = db.querySenderGroups({
        accountId,
        folderPath,
        limit: 120,
      });
      const folders = db.listFolders(accountId).map((f) => f.name);
      const spec = await generateSortSpecWithBuiltinAi({
        settings,
        apiKey: apiSecret?.aiApiKey,
        senderGroups: groups,
        existingFolders: folders,
      });
      return planEngine.createPlanFromImportedSpec({
        spec,
        accountId,
        source: "ai_builtin",
      });
    },
  );

  ipcMain.handle("ai:hasApiKey", () => vault.hasSecret(AI_SECRET_KEY));
  ipcMain.handle("ai:saveApiKey", (_e, apiKey: string) => {
    if (!apiKey.trim()) {
      vault.deleteSecret(AI_SECRET_KEY);
      return false;
    }
    vault.setSecret(AI_SECRET_KEY, { aiApiKey: apiKey.trim() });
    return true;
  });

  // --- IPC: Settings & MCP ---
  ipcMain.handle("settings:get", () => db.getSettings());
  ipcMain.handle("settings:save", async (_e, partial: Partial<AppSettings>) => {
    const updated = db.saveSettings(partial);
    if (updated.mcpEnabled) {
      await mcpHttp.start(updated.mcpPort);
      writeRuntimeInfo(true, mcpHttp.getPort() ?? updated.mcpPort);
    } else {
      await mcpHttp.stop();
      writeRuntimeInfo(false, updated.mcpPort);
    }
    return updated;
  });

  ipcMain.handle("mcp:status", () => ({
    running: mcpHttp.isRunning(),
    port: mcpHttp.getPort(),
    url: mcpHttp.isRunning()
      ? `http://127.0.0.1:${mcpHttp.getPort()}/mcp`
      : null,
  }));

  ipcMain.handle("mcp:activity", () => [...mcpActivityLog]);

  ipcMain.handle("mcp:getStdioCommand", () => ({
    executable: process.execPath,
    args: [path.join(__dirname, "mcp", "stdioBridge.js")],
    env: { ELECTRON_RUN_AS_NODE: "1" },
  }));

  ipcMain.handle("app:openExternal", async (_e, url: string) => {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      throw new Error("Protocole URL non autorisé.");
    }
    await shell.openExternal(parsed.toString());
  });

  createWindow();

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
      mcpHttp.stop().finally(() => {
        db.close();
        app.quit();
      });
    }
  });
}

boot().catch((err) => {
  console.error("SortBox fatal boot error:", err);
  app.exit(1);
});
