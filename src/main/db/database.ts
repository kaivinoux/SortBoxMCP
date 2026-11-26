import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { classifySenderLocally } from "../../shared/domainCategories.js";
import type {
  AddAccountInput,
  AppSettings,
  AuditStats,
  EmailHeaderRecord,
  ExecutionHistoryEntry,
  FolderInfo,
  MailAccount,
  SenderGroup,
  SenderQueryOptions,
  SortMoveItem,
  SortPlan,
  SortRule,
} from "../../shared/types.js";

export const DEFAULT_SETTINGS: AppSettings = {
  mcpEnabled: false,
  mcpPort: 3847,
  mcpRequireUiConfirmation: true,
  waveBatchSize: 100,
  waveDelayMs: 250,
  aiProvider: "none",
  aiEndpoint: "http://127.0.0.1:11434",
  aiModel: "qwen2.5:7b",
  microsoftClientId: "",
};

export class AppDatabase {
  private readonly db: DatabaseSync;

  constructor(dbPath: string) {
    if (dbPath !== ":memory:") {
      fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    }
    this.db = new DatabaseSync(dbPath);
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec("PRAGMA foreign_keys = ON;");
    this.initSchema();
  }

  close(): void {
    this.db.close();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS accounts (
        id TEXT PRIMARY KEY,
        label TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE,
        provider TEXT NOT NULL,
        auth_mode TEXT NOT NULL,
        imap_host TEXT NOT NULL,
        imap_port INTEGER NOT NULL,
        imap_secure INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        last_sync_at TEXT,
        last_sync_status TEXT NOT NULL DEFAULT 'idle',
        last_sync_error TEXT
      );

      CREATE TABLE IF NOT EXISTS folders (
        account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        raw_path TEXT NOT NULL,
        name TEXT NOT NULL,
        delimiter TEXT NOT NULL,
        special_use TEXT,
        total_messages INTEGER NOT NULL DEFAULT 0,
        unseen_messages INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (account_id, raw_path)
      );

      CREATE TABLE IF NOT EXISTS emails (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        folder_path TEXT NOT NULL,
        uid INTEGER NOT NULL,
        message_id TEXT NOT NULL DEFAULT '',
        from_raw TEXT NOT NULL DEFAULT '',
        from_name TEXT NOT NULL DEFAULT '',
        from_addr TEXT NOT NULL DEFAULT '',
        domain TEXT NOT NULL DEFAULT '',
        to_raw TEXT NOT NULL DEFAULT '',
        subject TEXT NOT NULL DEFAULT '',
        date_iso TEXT NOT NULL DEFAULT '',
        date_ts INTEGER NOT NULL DEFAULT 0,
        size_bytes INTEGER NOT NULL DEFAULT 0,
        seen INTEGER NOT NULL DEFAULT 0,
        flagged INTEGER NOT NULL DEFAULT 0,
        has_unsubscribe INTEGER NOT NULL DEFAULT 0,
        unsubscribe_url TEXT,
        unsubscribe_mailto TEXT,
        unsubscribe_one_click INTEGER NOT NULL DEFAULT 0,
        UNIQUE (account_id, folder_path, uid)
      );

      CREATE INDEX IF NOT EXISTS idx_emails_folder_sender
        ON emails(account_id, folder_path, from_addr);
      CREATE INDEX IF NOT EXISTS idx_emails_folder_domain
        ON emails(account_id, folder_path, domain);
      CREATE INDEX IF NOT EXISTS idx_emails_date
        ON emails(date_ts DESC);

      CREATE VIRTUAL TABLE IF NOT EXISTS emails_fts USING fts5(
        from_raw,
        subject,
        domain,
        content='emails',
        content_rowid='id'
      );

      CREATE TRIGGER IF NOT EXISTS emails_ai AFTER INSERT ON emails BEGIN
        INSERT INTO emails_fts(rowid, from_raw, subject, domain)
        VALUES (new.id, new.from_raw, new.subject, new.domain);
      END;

      CREATE TRIGGER IF NOT EXISTS emails_ad AFTER DELETE ON emails BEGIN
        INSERT INTO emails_fts(emails_fts, rowid, from_raw, subject, domain)
        VALUES ('delete', old.id, old.from_raw, old.subject, old.domain);
      END;

      CREATE TRIGGER IF NOT EXISTS emails_au AFTER UPDATE ON emails BEGIN
        INSERT INTO emails_fts(emails_fts, rowid, from_raw, subject, domain)
        VALUES ('delete', old.id, old.from_raw, old.subject, old.domain);
        INSERT INTO emails_fts(rowid, from_raw, subject, domain)
        VALUES (new.id, new.from_raw, new.subject, new.domain);
      END;

      CREATE TABLE IF NOT EXISTS sort_plans (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        source TEXT NOT NULL,
        created_at TEXT NOT NULL,
        status TEXT NOT NULL,
        moves_json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS sort_rules (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        account_id TEXT NOT NULL,
        match_type TEXT NOT NULL,
        match_value TEXT NOT NULL,
        source_folder TEXT NOT NULL,
        dest_folder TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS execution_history (
        id TEXT PRIMARY KEY,
        plan_id TEXT,
        account_id TEXT NOT NULL,
        account_email TEXT NOT NULL,
        source_folder TEXT NOT NULL,
        dest_folder TEXT NOT NULL,
        moved_uids_json TEXT NOT NULL,
        message_ids_json TEXT NOT NULL,
        count INTEGER NOT NULL,
        executed_at TEXT NOT NULL,
        undone_at TEXT,
        status TEXT NOT NULL,
        error_message TEXT
      );

      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS unsubscribed_senders (
        account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        sender_key TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'confirmed',
        method TEXT NOT NULL,
        target_url TEXT,
        detail TEXT,
        unsubscribed_at TEXT NOT NULL,
        PRIMARY KEY (account_id, sender_key)
      );
    `);

    const cols = this.db.prepare("PRAGMA table_info(emails)").all() as Array<{ name: string }>;
    const colNames = new Set(cols.map((c) => c.name));
    if (!colNames.has("unsubscribe_mailto")) {
      this.db.exec("ALTER TABLE emails ADD COLUMN unsubscribe_mailto TEXT;");
    }
    if (!colNames.has("unsubscribe_one_click")) {
      this.db.exec("ALTER TABLE emails ADD COLUMN unsubscribe_one_click INTEGER NOT NULL DEFAULT 0;");
    }

    const unsubCols = this.db
      .prepare("PRAGMA table_info(unsubscribed_senders)")
      .all() as Array<{ name: string }>;
    const unsubColNames = new Set(unsubCols.map((c) => c.name));
    if (!unsubColNames.has("status")) {
      this.db.exec("ALTER TABLE unsubscribed_senders ADD COLUMN status TEXT NOT NULL DEFAULT 'confirmed';");
    }
    if (!unsubColNames.has("detail")) {
      this.db.exec("ALTER TABLE unsubscribed_senders ADD COLUMN detail TEXT;");
    }
  }

  // --- Accounts ---
  listAccounts(): MailAccount[] {
    const rows = this.db
      .prepare("SELECT * FROM accounts ORDER BY created_at ASC")
      .all() as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      id: String(r.id),
      label: String(r.label),
      email: String(r.email),
      provider: r.provider as MailAccount["provider"],
      authMode: r.auth_mode as MailAccount["authMode"],
      imapHost: String(r.imap_host),
      imapPort: Number(r.imap_port),
      imapSecure: Boolean(r.imap_secure),
      createdAt: String(r.created_at),
      lastSyncAt: r.last_sync_at ? String(r.last_sync_at) : null,
      lastSyncStatus: r.last_sync_status as MailAccount["lastSyncStatus"],
      lastSyncError: r.last_sync_error ? String(r.last_sync_error) : null,
    }));
  }

  getAccount(accountId: string): MailAccount | null {
    return this.listAccounts().find((a) => a.id === accountId) ?? null;
  }

  createAccount(id: string, input: AddAccountInput): MailAccount {
    const now = new Date().toISOString();
    const cleanEmail = input.email.trim().toLowerCase();
    const label = (input.label || cleanEmail).trim();
    this.db
      .prepare(
        `INSERT INTO accounts (
          id, label, email, provider, auth_mode, imap_host, imap_port, imap_secure, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        label,
        cleanEmail,
        input.provider,
        input.authMode,
        input.imapHost.trim(),
        input.imapPort,
        input.imapSecure ? 1 : 0,
        now,
      );
    const created = this.getAccount(id);
    if (!created) throw new Error("Échec de création du compte.");
    return created;
  }

  updateAccountSyncStatus(
    accountId: string,
    status: MailAccount["lastSyncStatus"],
    error: string | null = null,
  ): void {
    const syncAt = status === "ok" ? new Date().toISOString() : undefined;
    if (syncAt) {
      this.db
        .prepare(
          "UPDATE accounts SET last_sync_status = ?, last_sync_error = ?, last_sync_at = ? WHERE id = ?",
        )
        .run(status, error, syncAt, accountId);
    } else {
      this.db
        .prepare(
          "UPDATE accounts SET last_sync_status = ?, last_sync_error = ? WHERE id = ?",
        )
        .run(status, error, accountId);
    }
  }

  deleteAccount(accountId: string): void {
    this.db.prepare("DELETE FROM accounts WHERE id = ?").run(accountId);
  }

  // --- Folders ---
  replaceFolders(accountId: string, folders: FolderInfo[]): void {
    this.db.exec("BEGIN");
    try {
      this.db.prepare("DELETE FROM folders WHERE account_id = ?").run(accountId);
      const stmt = this.db.prepare(`
        INSERT INTO folders (account_id, raw_path, name, delimiter, special_use, total_messages, unseen_messages)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      for (const f of folders) {
        stmt.run(
          accountId,
          f.rawPath,
          f.name,
          f.delimiter,
          f.specialUse,
          f.totalMessages,
          f.unseenMessages,
        );
      }
      this.db.exec("COMMIT");
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
  }

  listFolders(accountId?: string): FolderInfo[] {
    const sql = accountId
      ? "SELECT * FROM folders WHERE account_id = ? ORDER BY name ASC"
      : "SELECT * FROM folders ORDER BY account_id ASC, name ASC";
    const rows = (
      accountId ? this.db.prepare(sql).all(accountId) : this.db.prepare(sql).all()
    ) as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      accountId: String(r.account_id),
      rawPath: String(r.raw_path),
      name: String(r.name),
      delimiter: String(r.delimiter),
      specialUse: r.special_use ? String(r.special_use) : null,
      totalMessages: Number(r.total_messages),
      unseenMessages: Number(r.unseen_messages),
    }));
  }

  // --- Emails ---
  getCachedUids(accountId: string, folderPath: string): Set<number> {
    const rows = this.db
      .prepare("SELECT uid FROM emails WHERE account_id = ? AND folder_path = ?")
      .all(accountId, folderPath) as Array<{ uid: number }>;
    return new Set(rows.map((r) => Number(r.uid)));
  }

  upsertEmails(records: EmailHeaderRecord[]): void {
    if (!records.length) return;
    this.db.exec("BEGIN");
    try {
      const stmt = this.db.prepare(`
        INSERT INTO emails (
          account_id, folder_path, uid, message_id, from_raw, from_name, from_addr,
          domain, to_raw, subject, date_iso, date_ts, size_bytes, seen, flagged,
          has_unsubscribe, unsubscribe_url, unsubscribe_mailto, unsubscribe_one_click
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(account_id, folder_path, uid) DO UPDATE SET
          message_id = excluded.message_id,
          from_raw = excluded.from_raw,
          from_name = excluded.from_name,
          from_addr = excluded.from_addr,
          domain = excluded.domain,
          to_raw = excluded.to_raw,
          subject = excluded.subject,
          date_iso = excluded.date_iso,
          date_ts = excluded.date_ts,
          size_bytes = excluded.size_bytes,
          seen = excluded.seen,
          flagged = excluded.flagged,
          has_unsubscribe = excluded.has_unsubscribe,
          unsubscribe_url = excluded.unsubscribe_url,
          unsubscribe_mailto = excluded.unsubscribe_mailto,
          unsubscribe_one_click = excluded.unsubscribe_one_click
      `);
      for (const m of records) {
        stmt.run(
          m.accountId,
          m.folderPath,
          m.uid,
          m.messageId,
          m.fromRaw,
          m.fromName,
          m.fromAddr,
          m.domain,
          m.toRaw,
          m.subject,
          m.dateIso,
          m.dateTs,
          m.sizeBytes,
          m.seen ? 1 : 0,
          m.flagged ? 1 : 0,
          m.hasUnsubscribe ? 1 : 0,
          m.unsubscribeUrl,
          m.unsubscribeMailto ?? null,
          m.unsubscribeOneClick ? 1 : 0,
        );
      }
      this.db.exec("COMMIT");
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
  }

  removeMovedEmails(accountId: string, sourceFolder: string, uids: number[]): void {
    if (!uids.length) return;
    this.db.exec("BEGIN");
    try {
      const stmt = this.db.prepare(
        "DELETE FROM emails WHERE account_id = ? AND folder_path = ? AND uid = ?",
      );
      for (const uid of uids) {
        stmt.run(accountId, sourceFolder, uid);
      }
      this.db.exec("COMMIT");
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
  }

  getAuditStats(accountId?: string, folderPath?: string): AuditStats {
    const clauses: string[] = [];
    const params: Array<string | number> = [];
    if (accountId && accountId !== "all") {
      clauses.push("account_id = ?");
      params.push(accountId);
    }
    if (folderPath) {
      clauses.push("folder_path = ?");
      params.push(folderPath);
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const row = this.db
      .prepare(
        `SELECT
          COUNT(*) AS total_messages,
          COALESCE(SUM(CASE WHEN seen = 0 THEN 1 ELSE 0 END), 0) AS unread_messages,
          COALESCE(SUM(CASE WHEN has_unsubscribe = 1 THEN 1 ELSE 0 END), 0) AS newsletter_messages,
          COALESCE(SUM(size_bytes), 0) AS total_size_bytes,
          COUNT(DISTINCT COALESCE(NULLIF(from_addr, ''), from_raw)) AS unique_senders
        FROM emails ${where}`,
      )
      .get(...params) as Record<string, unknown>;

    return {
      totalMessages: Number(row.total_messages ?? 0),
      unreadMessages: Number(row.unread_messages ?? 0),
      newsletterMessages: Number(row.newsletter_messages ?? 0),
      totalSizeBytes: Number(row.total_size_bytes ?? 0),
      uniqueSenders: Number(row.unique_senders ?? 0),
    };
  }

  querySenderGroups(opts: SenderQueryOptions = {}): SenderGroup[] {
    const groupByDomain = opts.groupBy === "domain";
    const keyExpr = groupByDomain
      ? "COALESCE(NULLIF(e.domain, ''), e.from_addr, e.from_raw)"
      : "COALESCE(NULLIF(e.from_addr, ''), e.from_raw)";

    const clauses: string[] = [];
    const params: Array<string | number> = [];

    if (opts.accountId && opts.accountId !== "all") {
      clauses.push("e.account_id = ?");
      params.push(opts.accountId);
    }
    if (opts.folderPath) {
      clauses.push("e.folder_path = ?");
      params.push(opts.folderPath);
    }
    if (opts.search && opts.search.trim()) {
      const term = opts.search.trim();
      const ftsQuery = term
        .split(/\s+/)
        .map((w) => `"${w.replace(/"/g, "")}"*`)
        .join(" ");
      clauses.push(
        "e.id IN (SELECT rowid FROM emails_fts WHERE emails_fts MATCH ?)",
      );
      params.push(ftsQuery);
    }

    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const limit = Math.min(Math.max(opts.limit ?? 200, 1), 1000);

    const rows = this.db
      .prepare(
        `SELECT
          ${keyExpr} AS group_key,
          e.account_id,
          a.email AS account_email,
          e.folder_path,
          MAX(e.from_addr) AS from_addr,
          MAX(e.from_name) AS from_name,
          MAX(e.domain) AS domain,
          COUNT(*) AS total_count,
          SUM(CASE WHEN e.seen = 0 THEN 1 ELSE 0 END) AS unread_count,
          SUM(e.size_bytes) AS total_size_bytes,
          MAX(e.has_unsubscribe) AS has_unsubscribe,
          SUBSTR(
            MAX(
              CASE
                WHEN e.unsubscribe_url IS NOT NULL AND e.unsubscribe_url <> '' THEN
                  printf('%016d|%010d|%s', CASE WHEN e.date_ts > 0 THEN e.date_ts ELSE 0 END, e.uid, e.unsubscribe_url)
              END
            ),
            29
          ) AS unsubscribe_url,
          SUBSTR(
            MAX(
              CASE
                WHEN e.unsubscribe_mailto IS NOT NULL AND e.unsubscribe_mailto <> '' THEN
                  printf('%016d|%010d|%s', CASE WHEN e.date_ts > 0 THEN e.date_ts ELSE 0 END, e.uid, e.unsubscribe_mailto)
              END
            ),
            29
          ) AS unsubscribe_mailto,
          SUBSTR(
            MAX(
              CASE
                WHEN e.unsubscribe_url IS NOT NULL AND e.unsubscribe_url <> '' THEN
                  printf('%016d|%010d|%d', CASE WHEN e.date_ts > 0 THEN e.date_ts ELSE 0 END, e.uid, e.unsubscribe_one_click)
              END
            ),
            29,
            1
          ) AS unsubscribe_one_click,
          MAX(e.date_iso) AS latest_date_iso,
          GROUP_CONCAT(DISTINCT e.subject) AS joined_subjects
        FROM emails e
        JOIN accounts a ON a.id = e.account_id
        ${where}
        GROUP BY e.account_id, e.folder_path, ${keyExpr}
        ORDER BY total_count DESC
        LIMIT ?`,
      )
      .all(...params, limit) as Array<Record<string, unknown>>;

    const unsubRows = this.db
      .prepare("SELECT account_id, sender_key, status, detail, unsubscribed_at FROM unsubscribed_senders")
      .all() as Array<Record<string, unknown>>;
    const unsubMap = new Map<
      string,
      { status: "confirmed" | "pending" | "failed"; detail: string | null; unsubscribedAt: string }
    >();
    const rankStatus = (s: string) => (s === "confirmed" ? 3 : s === "pending" ? 2 : 1);
    for (const u of unsubRows) {
      const k = `${String(u.account_id)}::${String(u.sender_key).toLowerCase()}`;
      const stRaw = String(u.status || "confirmed");
      const st: "confirmed" | "pending" | "failed" =
        stRaw === "pending" ? "pending" : stRaw === "failed" ? "failed" : "confirmed";
      unsubMap.set(k, {
        status: st,
        detail: u.detail ? String(u.detail) : null,
        unsubscribedAt: String(u.unsubscribed_at),
      });
    }

    const groups: SenderGroup[] = [];
    for (const r of rows) {
      const accountId = String(r.account_id);
      const fromAddr = String(r.from_addr || "");
      const domain = String(r.domain || "");
      const hasUnsub = Boolean(r.has_unsubscribe);
      const rawJoined = String(r.joined_subjects || "");
      const sampleSubjects = rawJoined
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 3);
      const { category, suggestedFolder } = classifySenderLocally(
        domain,
        hasUnsub,
        sampleSubjects,
      );

      if (opts.filter === "newsletter" && !hasUnsub) continue;
      if (opts.filter === "known" && !category) continue;
      if (opts.filter === "unknown" && category !== null) continue;
      if (opts.filter === "unread" && Number(r.unread_count) === 0) continue;
      if (opts.filter === "large" && Number(r.total_size_bytes) < 5 * 1024 * 1024) {
        continue;
      }

      const byAddr = fromAddr ? unsubMap.get(`${accountId}::${fromAddr.toLowerCase()}`) : undefined;
      const byDomain = domain ? unsubMap.get(`${accountId}::${domain.toLowerCase()}`) : undefined;
      const unsubEntry =
        byAddr && byDomain
          ? rankStatus(byAddr.status) >= rankStatus(byDomain.status)
            ? byAddr
            : byDomain
          : byAddr || byDomain || null;

      groups.push({
        groupKey: String(r.group_key || fromAddr || ""),
        accountId,
        accountEmail: String(r.account_email),
        folderPath: String(r.folder_path),
        fromAddr,
        fromName: String(r.from_name || ""),
        domain,
        totalCount: Number(r.total_count),
        unreadCount: Number(r.unread_count),
        totalSizeBytes: Number(r.total_size_bytes),
        hasUnsubscribe: hasUnsub,
        unsubscribeUrl: r.unsubscribe_url ? String(r.unsubscribe_url) : null,
        unsubscribeMailto: r.unsubscribe_mailto ? String(r.unsubscribe_mailto) : null,
        unsubscribeOneClick: String(r.unsubscribe_one_click || "") === "1",
        unsubscribeStatus: unsubEntry?.status ?? null,
        unsubscribeStatusDetail: unsubEntry?.detail ?? null,
        unsubscribedAt:
          unsubEntry?.status === "confirmed" ? unsubEntry.unsubscribedAt : null,
        latestDateIso: String(r.latest_date_iso || ""),
        sampleSubjects,
        suggestedCategory: category,
        suggestedFolder,
      });
    }

    return groups;
  }

  getUidsForSenderOrDomain(params: {
    accountId: string;
    folderPath: string;
    matchType: "sender" | "domain" | "subject_contains";
    matchValue: string;
  }): { uids: number[]; sampleSubjects: string[]; messageIds: string[] } {
    let sql = "";
    let arg = params.matchValue.trim().toLowerCase();

    if (params.matchType === "sender") {
      sql =
        "SELECT uid, subject, message_id FROM emails WHERE account_id = ? AND folder_path = ? AND LOWER(from_addr) = ? ORDER BY date_ts DESC";
    } else if (params.matchType === "domain") {
      sql =
        "SELECT uid, subject, message_id FROM emails WHERE account_id = ? AND folder_path = ? AND LOWER(domain) = ? ORDER BY date_ts DESC";
    } else {
      sql =
        "SELECT uid, subject, message_id FROM emails WHERE account_id = ? AND folder_path = ? AND LOWER(subject) LIKE ? ORDER BY date_ts DESC";
      arg = `%${arg}%`;
    }

    const rows = this.db
      .prepare(sql)
      .all(params.accountId, params.folderPath, arg) as Array<{
      uid: number;
      subject: string;
      message_id: string;
    }>;

    return {
      uids: rows.map((r) => Number(r.uid)),
      sampleSubjects: rows.slice(0, 3).map((r) => String(r.subject || "(Sans objet)")),
      messageIds: rows.map((r) => String(r.message_id || "")).filter(Boolean),
    };
  }

  getMessageIdsByUids(
    accountId: string,
    folderPath: string,
    uids: number[],
  ): string[] {
    if (!uids.length) return [];
    const placeholders = uids.map(() => "?").join(",");
    const rows = this.db
      .prepare(
        `SELECT message_id FROM emails WHERE account_id = ? AND folder_path = ? AND uid IN (${placeholders})`,
      )
      .all(accountId, folderPath, ...uids) as Array<{ message_id: string }>;
    return rows.map((r) => String(r.message_id || "")).filter(Boolean);
  }

  searchEmailsFts(query: string, accountId?: string, limit = 50): EmailHeaderRecord[] {
    const clean = query
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map((w) => `"${w.replace(/"/g, "")}"*`)
      .join(" ");
    if (!clean) return [];

    const clauses = ["e.id IN (SELECT rowid FROM emails_fts WHERE emails_fts MATCH ?)"];
    const params: Array<string | number> = [clean];
    if (accountId && accountId !== "all") {
      clauses.push("e.account_id = ?");
      params.push(accountId);
    }

    const rows = this.db
      .prepare(
        `SELECT e.* FROM emails e WHERE ${clauses.join(" AND ")} ORDER BY e.date_ts DESC LIMIT ?`,
      )
      .all(...params, limit) as Array<Record<string, unknown>>;

    return rows.map((r) => ({
      id: Number(r.id),
      accountId: String(r.account_id),
      folderPath: String(r.folder_path),
      uid: Number(r.uid),
      messageId: String(r.message_id),
      fromRaw: String(r.from_raw),
      fromName: String(r.from_name),
      fromAddr: String(r.from_addr),
      domain: String(r.domain),
      toRaw: String(r.to_raw),
      subject: String(r.subject),
      dateIso: String(r.date_iso),
      dateTs: Number(r.date_ts),
      sizeBytes: Number(r.size_bytes),
      seen: Boolean(r.seen),
      flagged: Boolean(r.flagged),
      hasUnsubscribe: Boolean(r.has_unsubscribe),
      unsubscribeUrl: r.unsubscribe_url ? String(r.unsubscribe_url) : null,
      unsubscribeMailto: r.unsubscribe_mailto ? String(r.unsubscribe_mailto) : null,
      unsubscribeOneClick: Boolean(r.unsubscribe_one_click),
    }));
  }

  getCandidateEmailsForGroup(params: {
    accountId: string;
    folderPath: string;
    matchType: "sender" | "domain";
    matchValue: string;
    limit?: number;
  }): Array<{
    uid: number;
    hasUnsubscribe: boolean;
    unsubscribeUrl: string | null;
    unsubscribeMailto: string | null;
    unsubscribeOneClick: boolean;
    dateIso: string;
  }> {
    const arg = params.matchValue.trim().toLowerCase();
    const col = params.matchType === "domain" ? "LOWER(domain)" : "LOWER(from_addr)";
    const limit = Math.min(Math.max(params.limit ?? 6, 1), 15);
    const rows = this.db
      .prepare(
        `SELECT uid, has_unsubscribe, unsubscribe_url, unsubscribe_mailto, unsubscribe_one_click, date_iso
         FROM emails
         WHERE account_id = ? AND folder_path = ? AND ${col} = ?
         ORDER BY date_ts DESC, uid DESC
         LIMIT ?`,
      )
      .all(params.accountId, params.folderPath, arg, limit) as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      uid: Number(row.uid),
      hasUnsubscribe: Boolean(row.has_unsubscribe),
      unsubscribeUrl: row.unsubscribe_url ? String(row.unsubscribe_url) : null,
      unsubscribeMailto: row.unsubscribe_mailto ? String(row.unsubscribe_mailto) : null,
      unsubscribeOneClick: Boolean(row.unsubscribe_one_click),
      dateIso: String(row.date_iso || ""),
    }));
  }

  updateEmailUnsubscribeInfo(params: {
    accountId: string;
    folderPath: string;
    uid: number;
    hasUnsubscribe: boolean;
    unsubscribeUrl: string | null;
    unsubscribeMailto: string | null;
    unsubscribeOneClick: boolean;
  }): void {
    this.db
      .prepare(
        `UPDATE emails
         SET has_unsubscribe = ?,
             unsubscribe_url = ?,
             unsubscribe_mailto = ?,
             unsubscribe_one_click = ?
         WHERE account_id = ? AND folder_path = ? AND uid = ?`,
      )
      .run(
        params.hasUnsubscribe ? 1 : 0,
        params.unsubscribeUrl,
        params.unsubscribeMailto,
        params.unsubscribeOneClick ? 1 : 0,
        params.accountId,
        params.folderPath,
        params.uid,
      );
  }

  saveUnsubscribeStatus(params: {
    accountId: string;
    senderKey: string;
    status: "confirmed" | "pending" | "failed";
    method: string;
    targetUrl: string | null;
    detail?: string | null;
  }): string {
    const now = new Date().toISOString();
    const normKey = params.senderKey.trim().toLowerCase();
    this.db
      .prepare(
        `INSERT INTO unsubscribed_senders (account_id, sender_key, status, method, target_url, detail, unsubscribed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(account_id, sender_key) DO UPDATE SET
           status = excluded.status,
           method = excluded.method,
           target_url = excluded.target_url,
           detail = excluded.detail,
           unsubscribed_at = excluded.unsubscribed_at`,
      )
      .run(
        params.accountId,
        normKey,
        params.status,
        params.method,
        params.targetUrl,
        params.detail ?? null,
        now,
      );
    return now;
  }

  markSenderUnsubscribed(
    accountId: string,
    senderKey: string,
    method: string,
    targetUrl: string | null,
    detail?: string | null,
  ): string {
    return this.saveUnsubscribeStatus({
      accountId,
      senderKey,
      status: "confirmed",
      method,
      targetUrl,
      detail,
    });
  }

  // --- Sort Plans ---
  savePlan(plan: SortPlan): void {
    this.db
      .prepare(
        `INSERT INTO sort_plans (id, title, source, created_at, status, moves_json)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           title = excluded.title,
           status = excluded.status,
           moves_json = excluded.moves_json`,
      )
      .run(
        plan.id,
        plan.title,
        plan.source,
        plan.createdAt,
        plan.status,
        JSON.stringify(plan.moves),
      );
  }

  listPlans(): SortPlan[] {
    const rows = this.db
      .prepare("SELECT * FROM sort_plans ORDER BY created_at DESC")
      .all() as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      id: String(r.id),
      title: String(r.title),
      source: r.source as SortPlan["source"],
      createdAt: String(r.created_at),
      status: r.status as SortPlan["status"],
      moves: JSON.parse(String(r.moves_json)) as SortMoveItem[],
    }));
  }

  getPlan(planId: string): SortPlan | null {
    return this.listPlans().find((p) => p.id === planId) ?? null;
  }

  deletePlan(planId: string): void {
    this.db.prepare("DELETE FROM sort_plans WHERE id = ?").run(planId);
  }

  // --- Rules ---
  saveRule(rule: SortRule): void {
    this.db
      .prepare(
        `INSERT INTO sort_rules (id, name, account_id, match_type, match_value, source_folder, dest_folder, enabled, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name,
           dest_folder = excluded.dest_folder,
           enabled = excluded.enabled`,
      )
      .run(
        rule.id,
        rule.name,
        rule.accountId,
        rule.matchType,
        rule.matchValue,
        rule.sourceFolder,
        rule.destFolder,
        rule.enabled ? 1 : 0,
        rule.createdAt,
      );
  }

  listRules(): SortRule[] {
    const rows = this.db
      .prepare("SELECT * FROM sort_rules ORDER BY created_at DESC")
      .all() as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      id: String(r.id),
      name: String(r.name),
      accountId: String(r.account_id),
      matchType: r.match_type as SortRule["matchType"],
      matchValue: String(r.match_value),
      sourceFolder: String(r.source_folder),
      destFolder: String(r.dest_folder),
      enabled: Boolean(r.enabled),
      createdAt: String(r.created_at),
    }));
  }

  deleteRule(ruleId: string): void {
    this.db.prepare("DELETE FROM sort_rules WHERE id = ?").run(ruleId);
  }

  // --- History / Undo ---
  addHistoryEntry(entry: ExecutionHistoryEntry): void {
    this.db
      .prepare(
        `INSERT INTO execution_history (
          id, plan_id, account_id, account_email, source_folder, dest_folder,
          moved_uids_json, message_ids_json, count, executed_at, undone_at, status, error_message
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        entry.id,
        entry.planId,
        entry.accountId,
        entry.accountEmail,
        entry.sourceFolder,
        entry.destFolder,
        JSON.stringify(entry.movedUids),
        JSON.stringify(entry.messageIds),
        entry.count,
        entry.executedAt,
        entry.undoneAt,
        entry.status,
        entry.errorMessage,
      );
  }

  markHistoryUndone(historyId: string): void {
    this.db
      .prepare(
        "UPDATE execution_history SET status = 'undone', undone_at = ? WHERE id = ?",
      )
      .run(new Date().toISOString(), historyId);
  }

  listHistory(limit = 50): ExecutionHistoryEntry[] {
    const rows = this.db
      .prepare("SELECT * FROM execution_history ORDER BY executed_at DESC LIMIT ?")
      .all(limit) as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      id: String(r.id),
      planId: r.plan_id ? String(r.plan_id) : null,
      accountId: String(r.account_id),
      accountEmail: String(r.account_email),
      sourceFolder: String(r.source_folder),
      destFolder: String(r.dest_folder),
      movedUids: JSON.parse(String(r.moved_uids_json)) as number[],
      messageIds: JSON.parse(String(r.message_ids_json)) as string[],
      count: Number(r.count),
      executedAt: String(r.executed_at),
      undoneAt: r.undone_at ? String(r.undone_at) : null,
      status: r.status as ExecutionHistoryEntry["status"],
      errorMessage: r.error_message ? String(r.error_message) : null,
    }));
  }

  // --- Settings ---
  getSettings(): AppSettings {
    const rows = this.db.prepare("SELECT key, value FROM settings").all() as Array<{
      key: string;
      value: string;
    }>;
    const raw: Record<string, unknown> = {};
    for (const r of rows) {
      try {
        raw[r.key] = JSON.parse(r.value);
      } catch {
        raw[r.key] = r.value;
      }
    }
    return { ...DEFAULT_SETTINGS, ...(raw as Partial<AppSettings>) };
  }

  saveSettings(partial: Partial<AppSettings>): AppSettings {
    const merged = { ...this.getSettings(), ...partial };
    const stmt = this.db.prepare(
      `INSERT INTO settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    );
    this.db.exec("BEGIN");
    try {
      for (const [k, v] of Object.entries(merged)) {
        stmt.run(k, JSON.stringify(v));
      }
      this.db.exec("COMMIT");
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
    return merged;
  }
}
