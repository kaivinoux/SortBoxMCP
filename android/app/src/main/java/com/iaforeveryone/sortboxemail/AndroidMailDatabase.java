package com.iaforeveryone.sortboxemail;

import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.TimeZone;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

public class AndroidMailDatabase extends SQLiteOpenHelper {
    private static final String DB_NAME = "sortbox_mobile.sqlite";
    private static final int DB_VERSION = 3;

    public AndroidMailDatabase(Context context) {
        super(context, DB_NAME, null, DB_VERSION);
    }

    public static String nowIso() {
        SimpleDateFormat sdf = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US);
        sdf.setTimeZone(TimeZone.getTimeZone("UTC"));
        return sdf.format(new Date());
    }

    @Override
    public void onConfigure(SQLiteDatabase db) {
        super.onConfigure(db);
        db.setForeignKeyConstraintsEnabled(true);
    }

    @Override
    public void onCreate(SQLiteDatabase db) {
        db.execSQL(
            "CREATE TABLE IF NOT EXISTS accounts (" +
            "id TEXT PRIMARY KEY, label TEXT NOT NULL, email TEXT NOT NULL UNIQUE, " +
            "provider TEXT NOT NULL, auth_mode TEXT NOT NULL, imap_host TEXT NOT NULL, " +
            "imap_port INTEGER NOT NULL, imap_secure INTEGER NOT NULL, created_at TEXT NOT NULL, " +
            "last_sync_at TEXT, last_sync_status TEXT NOT NULL DEFAULT 'idle', last_sync_error TEXT)"
        );
        db.execSQL(
            "CREATE TABLE IF NOT EXISTS folders (" +
            "account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE, " +
            "raw_path TEXT NOT NULL, name TEXT NOT NULL, delimiter TEXT NOT NULL, " +
            "special_use TEXT, total_messages INTEGER NOT NULL DEFAULT 0, unseen_messages INTEGER NOT NULL DEFAULT 0, " +
            "PRIMARY KEY (account_id, raw_path))"
        );
        db.execSQL(
            "CREATE TABLE IF NOT EXISTS emails (" +
            "id INTEGER PRIMARY KEY AUTOINCREMENT, " +
            "account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE, " +
            "folder_path TEXT NOT NULL, uid INTEGER NOT NULL, message_id TEXT NOT NULL DEFAULT '', " +
            "from_raw TEXT NOT NULL DEFAULT '', from_name TEXT NOT NULL DEFAULT '', " +
            "from_addr TEXT NOT NULL DEFAULT '', domain TEXT NOT NULL DEFAULT '', " +
            "to_raw TEXT NOT NULL DEFAULT '', subject TEXT NOT NULL DEFAULT '', " +
            "date_iso TEXT NOT NULL DEFAULT '', date_ts INTEGER NOT NULL DEFAULT 0, " +
            "size_bytes INTEGER NOT NULL DEFAULT 0, seen INTEGER NOT NULL DEFAULT 0, " +
            "flagged INTEGER NOT NULL DEFAULT 0, has_unsubscribe INTEGER NOT NULL DEFAULT 0, " +
            "unsubscribe_url TEXT, unsubscribe_mailto TEXT, unsubscribe_one_click INTEGER NOT NULL DEFAULT 0, " +
            "UNIQUE (account_id, folder_path, uid))"
        );
        db.execSQL("CREATE INDEX IF NOT EXISTS idx_emails_sender ON emails(account_id, folder_path, from_addr)");
        db.execSQL("CREATE INDEX IF NOT EXISTS idx_emails_domain ON emails(account_id, folder_path, domain)");
        db.execSQL("CREATE INDEX IF NOT EXISTS idx_emails_date ON emails(date_ts DESC)");
        db.execSQL(
            "CREATE TABLE IF NOT EXISTS sort_plans (" +
            "id TEXT PRIMARY KEY, title TEXT NOT NULL, source TEXT NOT NULL, " +
            "created_at TEXT NOT NULL, status TEXT NOT NULL, moves_json TEXT NOT NULL)"
        );
        db.execSQL(
            "CREATE TABLE IF NOT EXISTS sort_rules (" +
            "id TEXT PRIMARY KEY, name TEXT NOT NULL, account_id TEXT NOT NULL, " +
            "match_type TEXT NOT NULL, match_value TEXT NOT NULL, source_folder TEXT NOT NULL, " +
            "dest_folder TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL)"
        );
        db.execSQL(
            "CREATE TABLE IF NOT EXISTS execution_history (" +
            "id TEXT PRIMARY KEY, plan_id TEXT, account_id TEXT NOT NULL, " +
            "account_email TEXT NOT NULL, source_folder TEXT NOT NULL, dest_folder TEXT NOT NULL, " +
            "moved_uids_json TEXT NOT NULL, message_ids_json TEXT NOT NULL, count INTEGER NOT NULL, " +
            "executed_at TEXT NOT NULL, undone_at TEXT, status TEXT NOT NULL, error_message TEXT)"
        );
        db.execSQL("CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
        db.execSQL(
            "CREATE TABLE IF NOT EXISTS unsubscribed_senders (" +
            "account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE, " +
            "sender_key TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'confirmed', " +
            "method TEXT NOT NULL, target_url TEXT, detail TEXT, " +
            "unsubscribed_at TEXT NOT NULL, PRIMARY KEY (account_id, sender_key))"
        );
    }

    @Override
    public void onUpgrade(SQLiteDatabase db, int oldVersion, int newVersion) {
        Set<String> cols = new HashSet<>();
        try (Cursor c = db.rawQuery("PRAGMA table_info(emails)", null)) {
            int nameIdx = c.getColumnIndex("name");
            while (c.moveToNext() && nameIdx >= 0) {
                cols.add(c.getString(nameIdx));
            }
        }
        if (!cols.contains("unsubscribe_mailto")) {
            db.execSQL("ALTER TABLE emails ADD COLUMN unsubscribe_mailto TEXT");
        }
        if (!cols.contains("unsubscribe_one_click")) {
            db.execSQL("ALTER TABLE emails ADD COLUMN unsubscribe_one_click INTEGER NOT NULL DEFAULT 0");
        }
        db.execSQL(
            "CREATE TABLE IF NOT EXISTS unsubscribed_senders (" +
            "account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE, " +
            "sender_key TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'confirmed', " +
            "method TEXT NOT NULL, target_url TEXT, detail TEXT, " +
            "unsubscribed_at TEXT NOT NULL, PRIMARY KEY (account_id, sender_key))"
        );
        Set<String> unsubCols = new HashSet<>();
        try (Cursor c = db.rawQuery("PRAGMA table_info(unsubscribed_senders)", null)) {
            int nameIdx = c.getColumnIndex("name");
            while (c.moveToNext() && nameIdx >= 0) {
                unsubCols.add(c.getString(nameIdx));
            }
        }
        if (!unsubCols.contains("status")) {
            db.execSQL("ALTER TABLE unsubscribed_senders ADD COLUMN status TEXT NOT NULL DEFAULT 'confirmed'");
        }
        if (!unsubCols.contains("detail")) {
            db.execSQL("ALTER TABLE unsubscribed_senders ADD COLUMN detail TEXT");
        }
    }

    public synchronized JSArray listAccounts() {
        JSArray arr = new JSArray();
        SQLiteDatabase db = getReadableDatabase();
        try (Cursor c = db.rawQuery("SELECT * FROM accounts ORDER BY created_at ASC", null)) {
            while (c.moveToNext()) {
                arr.put(cursorToAccount(c));
            }
        }
        return arr;
    }

    public synchronized JSObject getAccount(String id) {
        SQLiteDatabase db = getReadableDatabase();
        try (Cursor c = db.rawQuery("SELECT * FROM accounts WHERE id = ?", new String[] { id })) {
            if (c.moveToFirst()) return cursorToAccount(c);
        }
        return null;
    }

    private JSObject cursorToAccount(Cursor c) {
        JSObject obj = new JSObject();
        obj.put("id", c.getString(c.getColumnIndexOrThrow("id")));
        obj.put("label", c.getString(c.getColumnIndexOrThrow("label")));
        obj.put("email", c.getString(c.getColumnIndexOrThrow("email")));
        obj.put("provider", c.getString(c.getColumnIndexOrThrow("provider")));
        obj.put("authMode", c.getString(c.getColumnIndexOrThrow("auth_mode")));
        obj.put("imapHost", c.getString(c.getColumnIndexOrThrow("imap_host")));
        obj.put("imapPort", c.getInt(c.getColumnIndexOrThrow("imap_port")));
        obj.put("imapSecure", c.getInt(c.getColumnIndexOrThrow("imap_secure")) != 0);
        obj.put("createdAt", c.getString(c.getColumnIndexOrThrow("created_at")));
        int syncAtIdx = c.getColumnIndexOrThrow("last_sync_at");
        obj.put("lastSyncAt", c.isNull(syncAtIdx) ? JSONObject.NULL : c.getString(syncAtIdx));
        obj.put("lastSyncStatus", c.getString(c.getColumnIndexOrThrow("last_sync_status")));
        int syncErrIdx = c.getColumnIndexOrThrow("last_sync_error");
        obj.put("lastSyncError", c.isNull(syncErrIdx) ? JSONObject.NULL : c.getString(syncErrIdx));
        return obj;
    }

    public synchronized JSObject createAccount(
        String id,
        String label,
        String email,
        String provider,
        String authMode,
        String imapHost,
        int imapPort,
        boolean imapSecure
    ) {
        SQLiteDatabase db = getWritableDatabase();
        ContentValues cv = new ContentValues();
        cv.put("id", id);
        cv.put("label", label);
        cv.put("email", email.trim().toLowerCase(Locale.US));
        cv.put("provider", provider);
        cv.put("auth_mode", authMode);
        cv.put("imap_host", imapHost.trim());
        cv.put("imap_port", imapPort);
        cv.put("imap_secure", imapSecure ? 1 : 0);
        cv.put("created_at", nowIso());
        db.insertOrThrow("accounts", null, cv);
        return getAccount(id);
    }

    public synchronized void updateAccountSyncStatus(String accountId, String status, String error) {
        SQLiteDatabase db = getWritableDatabase();
        ContentValues cv = new ContentValues();
        cv.put("last_sync_status", status);
        if (error == null) cv.putNull("last_sync_error");
        else cv.put("last_sync_error", error);
        if ("ok".equals(status)) cv.put("last_sync_at", nowIso());
        db.update("accounts", cv, "id = ?", new String[] { accountId });
    }

    public synchronized void deleteAccount(String accountId) {
        getWritableDatabase().delete("accounts", "id = ?", new String[] { accountId });
    }

    public synchronized void replaceFolders(String accountId, List<JSObject> folders) {
        SQLiteDatabase db = getWritableDatabase();
        db.beginTransaction();
        try {
            db.delete("folders", "account_id = ?", new String[] { accountId });
            for (JSObject f : folders) {
                ContentValues cv = new ContentValues();
                cv.put("account_id", accountId);
                cv.put("raw_path", f.getString("rawPath", ""));
                cv.put("name", f.getString("name", ""));
                cv.put("delimiter", f.getString("delimiter", "/"));
                String su = f.optString("specialUse", "");
                if (su.isEmpty() || "null".equals(su)) cv.putNull("special_use");
                else cv.put("special_use", su);
                cv.put("total_messages", f.optInt("totalMessages", 0));
                cv.put("unseen_messages", f.optInt("unseenMessages", 0));
                db.insert("folders", null, cv);
            }
            db.setTransactionSuccessful();
        } finally {
            db.endTransaction();
        }
    }

    public synchronized JSArray listFolders(String accountId) {
        JSArray arr = new JSArray();
        SQLiteDatabase db = getReadableDatabase();
        String sql = (accountId != null && !accountId.isEmpty() && !"all".equals(accountId))
            ? "SELECT * FROM folders WHERE account_id = ? ORDER BY name ASC"
            : "SELECT * FROM folders ORDER BY account_id ASC, name ASC";
        String[] args = (accountId != null && !accountId.isEmpty() && !"all".equals(accountId))
            ? new String[] { accountId }
            : null;
        try (Cursor c = db.rawQuery(sql, args)) {
            while (c.moveToNext()) {
                JSObject obj = new JSObject();
                obj.put("accountId", c.getString(c.getColumnIndexOrThrow("account_id")));
                obj.put("rawPath", c.getString(c.getColumnIndexOrThrow("raw_path")));
                obj.put("name", c.getString(c.getColumnIndexOrThrow("name")));
                obj.put("delimiter", c.getString(c.getColumnIndexOrThrow("delimiter")));
                int suIdx = c.getColumnIndexOrThrow("special_use");
                obj.put("specialUse", c.isNull(suIdx) ? JSONObject.NULL : c.getString(suIdx));
                obj.put("totalMessages", c.getInt(c.getColumnIndexOrThrow("total_messages")));
                obj.put("unseenMessages", c.getInt(c.getColumnIndexOrThrow("unseen_messages")));
                arr.put(obj);
            }
        }
        return arr;
    }

    public synchronized Set<Long> getCachedUids(String accountId, String folderPath) {
        Set<Long> set = new HashSet<>();
        SQLiteDatabase db = getReadableDatabase();
        try (Cursor c = db.rawQuery(
            "SELECT uid FROM emails WHERE account_id = ? AND folder_path = ?",
            new String[] { accountId, folderPath }
        )) {
            while (c.moveToNext()) {
                set.add(c.getLong(0));
            }
        }
        return set;
    }

    public synchronized void upsertEmails(List<ContentValues> rows) {
        if (rows.isEmpty()) return;
        SQLiteDatabase db = getWritableDatabase();
        db.beginTransaction();
        try {
            for (ContentValues cv : rows) {
                db.insertWithOnConflict("emails", null, cv, SQLiteDatabase.CONFLICT_REPLACE);
            }
            db.setTransactionSuccessful();
        } finally {
            db.endTransaction();
        }
    }

    public synchronized void removeMovedEmails(String accountId, String folderPath, List<Long> uids) {
        if (uids.isEmpty()) return;
        SQLiteDatabase db = getWritableDatabase();
        db.beginTransaction();
        try {
            for (Long uid : uids) {
                db.delete(
                    "emails",
                    "account_id = ? AND folder_path = ? AND uid = ?",
                    new String[] { accountId, folderPath, String.valueOf(uid) }
                );
            }
            db.setTransactionSuccessful();
        } finally {
            db.endTransaction();
        }
    }

    public synchronized JSObject getAuditStats(String accountId, String folderPath) {
        List<String> clauses = new ArrayList<>();
        List<String> args = new ArrayList<>();
        if (accountId != null && !accountId.isEmpty() && !"all".equals(accountId)) {
            clauses.add("account_id = ?");
            args.add(accountId);
        }
        if (folderPath != null && !folderPath.isEmpty()) {
            clauses.add("folder_path = ?");
            args.add(folderPath);
        }
        String where = clauses.isEmpty() ? "" : "WHERE " + String.join(" AND ", clauses);
        String sql =
            "SELECT COUNT(*) AS total_messages, " +
            "COALESCE(SUM(CASE WHEN seen = 0 THEN 1 ELSE 0 END), 0) AS unread_messages, " +
            "COALESCE(SUM(CASE WHEN has_unsubscribe = 1 THEN 1 ELSE 0 END), 0) AS newsletter_messages, " +
            "COALESCE(SUM(size_bytes), 0) AS total_size_bytes, " +
            "COUNT(DISTINCT COALESCE(NULLIF(from_addr, ''), from_raw)) AS unique_senders " +
            "FROM emails " + where;

        JSObject obj = new JSObject();
        try (Cursor c = getReadableDatabase().rawQuery(sql, args.toArray(new String[0]))) {
            if (c.moveToFirst()) {
                obj.put("totalMessages", c.getInt(0));
                obj.put("unreadMessages", c.getInt(1));
                obj.put("newsletterMessages", c.getInt(2));
                obj.put("totalSizeBytes", c.getLong(3));
                obj.put("uniqueSenders", c.getInt(4));
            }
        }
        return obj;
    }

    public synchronized JSArray querySenderGroups(
        String accountId,
        String folderPath,
        String search,
        boolean groupByDomain,
        int limit
    ) {
        String keyExpr = groupByDomain
            ? "COALESCE(NULLIF(e.domain, ''), e.from_addr, e.from_raw)"
            : "COALESCE(NULLIF(e.from_addr, ''), e.from_raw)";

        List<String> clauses = new ArrayList<>();
        List<String> args = new ArrayList<>();

        if (accountId != null && !accountId.isEmpty() && !"all".equals(accountId)) {
            clauses.add("e.account_id = ?");
            args.add(accountId);
        }
        if (folderPath != null && !folderPath.isEmpty()) {
            clauses.add("e.folder_path = ?");
            args.add(folderPath);
        }
        if (search != null && !search.trim().isEmpty()) {
            String like = "%" + search.trim().toLowerCase(Locale.US) + "%";
            clauses.add("(LOWER(e.from_raw) LIKE ? OR LOWER(e.subject) LIKE ? OR LOWER(e.domain) LIKE ?)");
            args.add(like);
            args.add(like);
            args.add(like);
        }

        String where = clauses.isEmpty() ? "" : "WHERE " + String.join(" AND ", clauses);
        int safeLimit = Math.min(Math.max(limit > 0 ? limit : 200, 1), 1000);
        args.add(String.valueOf(safeLimit));

        String sql =
            "SELECT " + keyExpr + " AS group_key, e.account_id, a.email AS account_email, e.folder_path, " +
            "MAX(e.from_addr) AS from_addr, MAX(e.from_name) AS from_name, MAX(e.domain) AS domain, " +
            "COUNT(*) AS total_count, SUM(CASE WHEN e.seen = 0 THEN 1 ELSE 0 END) AS unread_count, " +
            "SUM(e.size_bytes) AS total_size_bytes, MAX(e.has_unsubscribe) AS has_unsubscribe, " +
            "SUBSTR(MAX(CASE WHEN e.unsubscribe_url IS NOT NULL AND e.unsubscribe_url <> '' THEN printf('%016d|%010d|%s', CASE WHEN e.date_ts > 0 THEN e.date_ts ELSE 0 END, e.uid, e.unsubscribe_url) END), 29) AS unsubscribe_url, " +
            "SUBSTR(MAX(CASE WHEN e.unsubscribe_mailto IS NOT NULL AND e.unsubscribe_mailto <> '' THEN printf('%016d|%010d|%s', CASE WHEN e.date_ts > 0 THEN e.date_ts ELSE 0 END, e.uid, e.unsubscribe_mailto) END), 29) AS unsubscribe_mailto, " +
            "SUBSTR(MAX(CASE WHEN e.unsubscribe_url IS NOT NULL AND e.unsubscribe_url <> '' THEN printf('%016d|%010d|%d', CASE WHEN e.date_ts > 0 THEN e.date_ts ELSE 0 END, e.uid, e.unsubscribe_one_click) END), 29, 1) AS unsubscribe_one_click, " +
            "MAX(e.date_iso) AS latest_date_iso, GROUP_CONCAT(DISTINCT e.subject) AS joined_subjects " +
            "FROM emails e JOIN accounts a ON a.id = e.account_id " + where +
            " GROUP BY e.account_id, e.folder_path, " + keyExpr +
            " ORDER BY total_count DESC LIMIT ?";

        java.util.Map<String, String[]> unsubMap = new java.util.HashMap<>();
        try (Cursor uc = getReadableDatabase().rawQuery(
            "SELECT account_id, sender_key, status, detail, unsubscribed_at FROM unsubscribed_senders", null
        )) {
            while (uc.moveToNext()) {
                String k = nonNull(uc.getString(0)) + "::" + nonNull(uc.getString(1)).toLowerCase(Locale.US);
                unsubMap.put(k, new String[] {
                    nonNull(uc.getString(2)),
                    uc.isNull(3) ? null : uc.getString(3),
                    nonNull(uc.getString(4))
                });
            }
        }

        JSArray arr = new JSArray();
        try (Cursor c = getReadableDatabase().rawQuery(sql, args.toArray(new String[0]))) {
            while (c.moveToNext()) {
                String accId = nonNull(c.getString(1));
                String fromAddr = nonNull(c.getString(4));
                String domain = nonNull(c.getString(6));
                JSObject row = new JSObject();
                row.put("groupKey", nonNull(c.getString(0)));
                row.put("accountId", accId);
                row.put("accountEmail", nonNull(c.getString(2)));
                row.put("folderPath", nonNull(c.getString(3)));
                row.put("fromAddr", fromAddr);
                row.put("fromName", nonNull(c.getString(5)));
                row.put("domain", domain);
                row.put("totalCount", c.getInt(7));
                row.put("unreadCount", c.getInt(8));
                row.put("totalSizeBytes", c.getLong(9));
                row.put("hasUnsubscribe", c.getInt(10) != 0);
                row.put("unsubscribeUrl", c.isNull(11) || c.getString(11).isEmpty() ? JSONObject.NULL : c.getString(11));
                row.put("unsubscribeMailto", c.isNull(12) || c.getString(12).isEmpty() ? JSONObject.NULL : c.getString(12));
                row.put("unsubscribeOneClick", "1".equals(c.getString(13)));

                String[] byAddr = !fromAddr.isEmpty() ? unsubMap.get(accId + "::" + fromAddr.toLowerCase(Locale.US)) : null;
                String[] byDom = !domain.isEmpty() ? unsubMap.get(accId + "::" + domain.toLowerCase(Locale.US)) : null;
                String[] chosen = pickHigherUnsub(byAddr, byDom);
                String st = chosen != null ? chosen[0] : null;
                row.put("unsubscribeStatus", st == null ? JSONObject.NULL : st);
                row.put("unsubscribeStatusDetail", chosen != null && chosen[1] != null ? chosen[1] : JSONObject.NULL);
                row.put("unsubscribedAt", "confirmed".equals(st) && chosen != null ? chosen[2] : JSONObject.NULL);
                row.put("latestDateIso", nonNull(c.getString(14)));

                JSArray samples = new JSArray();
                String joined = nonNull(c.getString(15));
                if (!joined.isEmpty()) {
                    String[] parts = joined.split(",");
                    for (int i = 0; i < parts.length && samples.length() < 3; i++) {
                        String p = parts[i].trim();
                        if (!p.isEmpty()) samples.put(p);
                    }
                }
                row.put("sampleSubjects", samples);
                arr.put(row);
            }
        }
        return arr;
    }

    private int rankStatus(String s) {
        if ("confirmed".equals(s)) return 3;
        if ("pending".equals(s)) return 2;
        if ("failed".equals(s)) return 1;
        return 0;
    }

    private String[] pickHigherUnsub(String[] a, String[] b) {
        if (a == null) return b;
        if (b == null) return a;
        return rankStatus(a[0]) >= rankStatus(b[0]) ? a : b;
    }

    public static class LatestUnsubCache {
        public long uid;
        public boolean hasUnsubscribe;
        public String unsubscribeUrl;
        public String unsubscribeMailto;
        public boolean unsubscribeOneClick;
        public String dateIso;
    }

    public synchronized List<LatestUnsubCache> getCandidateEmailsForGroup(
        String accountId,
        String folderPath,
        String matchType,
        String matchValue,
        int limit
    ) {
        String arg = matchValue == null ? "" : matchValue.trim().toLowerCase(Locale.US);
        String col = "domain".equals(matchType) ? "LOWER(domain)" : "LOWER(from_addr)";
        int safeLim = Math.min(Math.max(limit > 0 ? limit : 6, 1), 15);
        String sql =
            "SELECT uid, has_unsubscribe, unsubscribe_url, unsubscribe_mailto, unsubscribe_one_click, date_iso " +
            "FROM emails WHERE account_id = ? AND folder_path = ? AND " + col + " = ? " +
            "ORDER BY date_ts DESC, uid DESC LIMIT ?";
        List<LatestUnsubCache> out = new ArrayList<>();
        try (Cursor c = getReadableDatabase().rawQuery(sql, new String[] { accountId, folderPath, arg, String.valueOf(safeLim) })) {
            while (c.moveToNext()) {
                LatestUnsubCache cache = new LatestUnsubCache();
                cache.uid = c.getLong(0);
                cache.hasUnsubscribe = c.getInt(1) != 0;
                cache.unsubscribeUrl = c.isNull(2) ? null : c.getString(2);
                cache.unsubscribeMailto = c.isNull(3) ? null : c.getString(3);
                cache.unsubscribeOneClick = c.getInt(4) != 0;
                cache.dateIso = nonNull(c.getString(5));
                out.add(cache);
            }
        }
        return out;
    }

    public synchronized void updateEmailUnsubscribeInfo(
        String accountId,
        String folderPath,
        long uid,
        boolean hasUnsubscribe,
        String unsubscribeUrl,
        String unsubscribeMailto,
        boolean unsubscribeOneClick
    ) {
        ContentValues cv = new ContentValues();
        cv.put("has_unsubscribe", hasUnsubscribe ? 1 : 0);
        if (unsubscribeUrl != null) cv.put("unsubscribe_url", unsubscribeUrl);
        else cv.putNull("unsubscribe_url");
        if (unsubscribeMailto != null) cv.put("unsubscribe_mailto", unsubscribeMailto);
        else cv.putNull("unsubscribe_mailto");
        cv.put("unsubscribe_one_click", unsubscribeOneClick ? 1 : 0);
        getWritableDatabase().update(
            "emails",
            cv,
            "account_id = ? AND folder_path = ? AND uid = ?",
            new String[] { accountId, folderPath, String.valueOf(uid) }
        );
    }

    public synchronized String saveUnsubscribeStatus(
        String accountId,
        String senderKey,
        String status,
        String method,
        String targetUrl,
        String detail
    ) {
        String now = nowIso();
        String normKey = senderKey == null ? "" : senderKey.trim().toLowerCase(Locale.US);
        ContentValues cv = new ContentValues();
        cv.put("account_id", accountId);
        cv.put("sender_key", normKey);
        cv.put("status", status == null || status.isEmpty() ? "confirmed" : status);
        cv.put("method", method == null ? "manual" : method);
        if (targetUrl != null) cv.put("target_url", targetUrl);
        else cv.putNull("target_url");
        if (detail != null) cv.put("detail", detail);
        else cv.putNull("detail");
        cv.put("unsubscribed_at", now);
        getWritableDatabase().insertWithOnConflict("unsubscribed_senders", null, cv, SQLiteDatabase.CONFLICT_REPLACE);
        return now;
    }

    public synchronized List<Long> getUidsForMatch(
        String accountId,
        String folderPath,
        String matchType,
        String matchValue,
        List<String> outSamples
    ) {
        String arg = matchValue == null ? "" : matchValue.trim().toLowerCase(Locale.US);
        String sql;
        if ("domain".equals(matchType)) {
            sql = "SELECT uid, subject FROM emails WHERE account_id = ? AND folder_path = ? AND LOWER(domain) = ? ORDER BY date_ts DESC";
        } else if ("subject_contains".equals(matchType)) {
            sql = "SELECT uid, subject FROM emails WHERE account_id = ? AND folder_path = ? AND LOWER(subject) LIKE ? ORDER BY date_ts DESC";
            arg = "%" + arg + "%";
        } else {
            sql = "SELECT uid, subject FROM emails WHERE account_id = ? AND folder_path = ? AND LOWER(from_addr) = ? ORDER BY date_ts DESC";
        }

        List<Long> uids = new ArrayList<>();
        try (Cursor c = getReadableDatabase().rawQuery(sql, new String[] { accountId, folderPath, arg })) {
            while (c.moveToNext()) {
                uids.add(c.getLong(0));
                if (outSamples != null && outSamples.size() < 3) {
                    outSamples.add(nonNull(c.getString(1)));
                }
            }
        }
        return uids;
    }

    public synchronized List<String> getMessageIdsByUids(String accountId, String folderPath, List<Long> uids) {
        List<String> ids = new ArrayList<>();
        if (uids.isEmpty()) return ids;
        SQLiteDatabase db = getReadableDatabase();
        for (int i = 0; i < uids.size(); i += 100) {
            List<Long> slice = uids.subList(i, Math.min(uids.size(), i + 100));
            StringBuilder ph = new StringBuilder();
            String[] args = new String[2 + slice.size()];
            args[0] = accountId;
            args[1] = folderPath;
            for (int j = 0; j < slice.size(); j++) {
                if (j > 0) ph.append(",");
                ph.append("?");
                args[2 + j] = String.valueOf(slice.get(j));
            }
            try (Cursor c = db.rawQuery(
                "SELECT message_id FROM emails WHERE account_id = ? AND folder_path = ? AND uid IN (" + ph + ")",
                args
            )) {
                while (c.moveToNext()) {
                    String m = nonNull(c.getString(0));
                    if (!m.isEmpty()) ids.add(m);
                }
            }
        }
        return ids;
    }

    public synchronized void savePlan(JSObject plan) {
        ContentValues cv = new ContentValues();
        cv.put("id", plan.getString("id", ""));
        cv.put("title", plan.getString("title", "Plan de tri"));
        cv.put("source", plan.getString("source", "manual"));
        cv.put("created_at", plan.getString("createdAt", nowIso()));
        cv.put("status", plan.getString("status", "draft"));
        JSONArray moves = plan.optJSONArray("moves");
        cv.put("moves_json", moves != null ? moves.toString() : "[]");
        getWritableDatabase().insertWithOnConflict("sort_plans", null, cv, SQLiteDatabase.CONFLICT_REPLACE);
    }

    public synchronized JSArray listPlans() {
        JSArray arr = new JSArray();
        try (Cursor c = getReadableDatabase().rawQuery("SELECT * FROM sort_plans ORDER BY created_at DESC", null)) {
            while (c.moveToNext()) {
                JSObject p = new JSObject();
                p.put("id", c.getString(c.getColumnIndexOrThrow("id")));
                p.put("title", c.getString(c.getColumnIndexOrThrow("title")));
                p.put("source", c.getString(c.getColumnIndexOrThrow("source")));
                p.put("createdAt", c.getString(c.getColumnIndexOrThrow("created_at")));
                p.put("status", c.getString(c.getColumnIndexOrThrow("status")));
                try {
                    p.put("moves", new JSArray(c.getString(c.getColumnIndexOrThrow("moves_json"))));
                } catch (JSONException e) {
                    p.put("moves", new JSArray());
                }
                arr.put(p);
            }
        }
        return arr;
    }

    public synchronized JSObject getPlan(String planId) {
        try (Cursor c = getReadableDatabase().rawQuery("SELECT * FROM sort_plans WHERE id = ?", new String[] { planId })) {
            if (c.moveToFirst()) {
                JSObject p = new JSObject();
                p.put("id", c.getString(c.getColumnIndexOrThrow("id")));
                p.put("title", c.getString(c.getColumnIndexOrThrow("title")));
                p.put("source", c.getString(c.getColumnIndexOrThrow("source")));
                p.put("createdAt", c.getString(c.getColumnIndexOrThrow("created_at")));
                p.put("status", c.getString(c.getColumnIndexOrThrow("status")));
                try {
                    p.put("moves", new JSArray(c.getString(c.getColumnIndexOrThrow("moves_json"))));
                } catch (JSONException e) {
                    p.put("moves", new JSArray());
                }
                return p;
            }
        }
        return null;
    }

    public synchronized void deletePlan(String planId) {
        getWritableDatabase().delete("sort_plans", "id = ?", new String[] { planId });
    }

    public synchronized void saveRule(JSObject rule) {
        ContentValues cv = new ContentValues();
        cv.put("id", rule.getString("id", ""));
        cv.put("name", rule.getString("name", ""));
        cv.put("account_id", rule.getString("accountId", "all"));
        cv.put("match_type", rule.getString("matchType", "sender"));
        cv.put("match_value", rule.getString("matchValue", ""));
        cv.put("source_folder", rule.getString("sourceFolder", "INBOX"));
        cv.put("dest_folder", rule.getString("destFolder", ""));
        cv.put("enabled", rule.optBoolean("enabled", true) ? 1 : 0);
        cv.put("created_at", rule.getString("createdAt", nowIso()));
        getWritableDatabase().insertWithOnConflict("sort_rules", null, cv, SQLiteDatabase.CONFLICT_REPLACE);
    }

    public synchronized JSArray listRules() {
        JSArray arr = new JSArray();
        try (Cursor c = getReadableDatabase().rawQuery("SELECT * FROM sort_rules ORDER BY created_at DESC", null)) {
            while (c.moveToNext()) {
                JSObject r = new JSObject();
                r.put("id", c.getString(c.getColumnIndexOrThrow("id")));
                r.put("name", c.getString(c.getColumnIndexOrThrow("name")));
                r.put("accountId", c.getString(c.getColumnIndexOrThrow("account_id")));
                r.put("matchType", c.getString(c.getColumnIndexOrThrow("match_type")));
                r.put("matchValue", c.getString(c.getColumnIndexOrThrow("match_value")));
                r.put("sourceFolder", c.getString(c.getColumnIndexOrThrow("source_folder")));
                r.put("destFolder", c.getString(c.getColumnIndexOrThrow("dest_folder")));
                r.put("enabled", c.getInt(c.getColumnIndexOrThrow("enabled")) != 0);
                r.put("createdAt", c.getString(c.getColumnIndexOrThrow("created_at")));
                arr.put(r);
            }
        }
        return arr;
    }

    public synchronized void deleteRule(String ruleId) {
        getWritableDatabase().delete("sort_rules", "id = ?", new String[] { ruleId });
    }

    public synchronized void addHistoryEntry(JSObject entry) {
        ContentValues cv = new ContentValues();
        cv.put("id", entry.getString("id", ""));
        String planId = entry.optString("planId", "");
        if (planId.isEmpty() || "null".equals(planId)) cv.putNull("plan_id");
        else cv.put("plan_id", planId);
        cv.put("account_id", entry.getString("accountId", ""));
        cv.put("account_email", entry.getString("accountEmail", ""));
        cv.put("source_folder", entry.getString("sourceFolder", "INBOX"));
        cv.put("dest_folder", entry.getString("destFolder", ""));
        JSONArray uids = entry.optJSONArray("movedUids");
        cv.put("moved_uids_json", uids != null ? uids.toString() : "[]");
        JSONArray msgIds = entry.optJSONArray("messageIds");
        cv.put("message_ids_json", msgIds != null ? msgIds.toString() : "[]");
        cv.put("count", entry.optInt("count", 0));
        cv.put("executed_at", entry.getString("executedAt", nowIso()));
        cv.putNull("undone_at");
        cv.put("status", entry.getString("status", "ok"));
        String errMsg = entry.optString("errorMessage", "");
        if (errMsg.isEmpty() || "null".equals(errMsg)) cv.putNull("error_message");
        else cv.put("error_message", errMsg);
        getWritableDatabase().insert("execution_history", null, cv);
    }

    public synchronized void markHistoryUndone(String historyId) {
        ContentValues cv = new ContentValues();
        cv.put("status", "undone");
        cv.put("undone_at", nowIso());
        getWritableDatabase().update("execution_history", cv, "id = ?", new String[] { historyId });
    }

    public synchronized JSArray listHistory(int limit) {
        JSArray arr = new JSArray();
        try (Cursor c = getReadableDatabase().rawQuery(
            "SELECT * FROM execution_history ORDER BY executed_at DESC LIMIT ?",
            new String[] { String.valueOf(limit) }
        )) {
            while (c.moveToNext()) {
                JSObject h = new JSObject();
                h.put("id", c.getString(c.getColumnIndexOrThrow("id")));
                int pidIdx = c.getColumnIndexOrThrow("plan_id");
                h.put("planId", c.isNull(pidIdx) ? JSONObject.NULL : c.getString(pidIdx));
                h.put("accountId", c.getString(c.getColumnIndexOrThrow("account_id")));
                h.put("accountEmail", c.getString(c.getColumnIndexOrThrow("account_email")));
                h.put("sourceFolder", c.getString(c.getColumnIndexOrThrow("source_folder")));
                h.put("destFolder", c.getString(c.getColumnIndexOrThrow("dest_folder")));
                try {
                    h.put("movedUids", new JSArray(c.getString(c.getColumnIndexOrThrow("moved_uids_json"))));
                } catch (JSONException e) {
                    h.put("movedUids", new JSArray());
                }
                try {
                    h.put("messageIds", new JSArray(c.getString(c.getColumnIndexOrThrow("message_ids_json"))));
                } catch (JSONException e) {
                    h.put("messageIds", new JSArray());
                }
                h.put("count", c.getInt(c.getColumnIndexOrThrow("count")));
                h.put("executedAt", c.getString(c.getColumnIndexOrThrow("executed_at")));
                int undIdx = c.getColumnIndexOrThrow("undone_at");
                h.put("undoneAt", c.isNull(undIdx) ? JSONObject.NULL : c.getString(undIdx));
                h.put("status", c.getString(c.getColumnIndexOrThrow("status")));
                int errIdx = c.getColumnIndexOrThrow("error_message");
                h.put("errorMessage", c.isNull(errIdx) ? JSONObject.NULL : c.getString(errIdx));
                arr.put(h);
            }
        }
        return arr;
    }

    public synchronized JSObject getSettings() {
        JSObject obj = new JSObject();
        obj.put("mcpEnabled", false);
        obj.put("mcpPort", 3847);
        obj.put("mcpRequireUiConfirmation", true);
        obj.put("waveBatchSize", 100);
        obj.put("waveDelayMs", 250);
        obj.put("aiProvider", "none");
        obj.put("aiEndpoint", "http://127.0.0.1:11434");
        obj.put("aiModel", "qwen2.5:7b");
        obj.put("microsoftClientId", "");

        try (Cursor c = getReadableDatabase().rawQuery("SELECT key, value FROM settings", null)) {
            while (c.moveToNext()) {
                String k = c.getString(0);
                String v = c.getString(1);
                if ("mcpPort".equals(k) || "waveBatchSize".equals(k) || "waveDelayMs".equals(k)) {
                    obj.put(k, Integer.parseInt(v));
                } else if ("mcpEnabled".equals(k) || "mcpRequireUiConfirmation".equals(k)) {
                    obj.put(k, Boolean.parseBoolean(v));
                } else {
                    obj.put(k, v);
                }
            }
        } catch (Exception ignored) {}
        return obj;
    }

    public synchronized JSObject saveSettings(JSObject partial) {
        JSObject merged = getSettings();
        java.util.Iterator<String> keys = partial.keys();
        while (keys.hasNext()) {
            String k = keys.next();
            try {
                merged.put(k, partial.get(k));
            } catch (JSONException ignored) {}
        }

        SQLiteDatabase db = getWritableDatabase();
        db.beginTransaction();
        try {
            java.util.Iterator<String> mKeys = merged.keys();
            while (mKeys.hasNext()) {
                String k = mKeys.next();
                ContentValues cv = new ContentValues();
                cv.put("key", k);
                cv.put("value", String.valueOf(merged.opt(k)));
                db.insertWithOnConflict("settings", null, cv, SQLiteDatabase.CONFLICT_REPLACE);
            }
            db.setTransactionSuccessful();
        } finally {
            db.endTransaction();
        }
        return merged;
    }

    private String nonNull(String s) {
        return s == null ? "" : s;
    }
}
