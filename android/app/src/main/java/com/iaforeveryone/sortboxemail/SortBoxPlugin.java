package com.iaforeveryone.sortboxemail;

import android.content.Intent;
import android.net.Uri;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONArray;
import org.json.JSONObject;

@CapacitorPlugin(name = "SortBoxNative")
public class SortBoxPlugin extends Plugin {
    private static final String AI_SECRET_KEY = "__sortbox_builtin_ai_key__";

    private AndroidMailDatabase db;
    private AndroidVault vault;
    private AndroidImapEngine imap;
    private ExecutorService executor;

    @Override
    public void load() {
        this.db = new AndroidMailDatabase(getContext());
        this.vault = new AndroidVault(getContext());
        this.imap = new AndroidImapEngine();
        this.executor = Executors.newCachedThreadPool();
    }

    private JSObject withCredentialStatus(JSObject acc) {
        if (acc == null) return null;
        try {
            acc.put("hasCredentials", vault.getSecret(acc.getString("id")) != null);
        } catch (Exception e) {
            acc.put("hasCredentials", false);
        }
        return acc;
    }

    @PluginMethod
    public void accountsList(PluginCall call) {
        executor.execute(() -> {
            JSArray raw = db.listAccounts();
            JSArray enriched = new JSArray();
            for (int i = 0; i < raw.length(); i++) {
                try {
                    enriched.put(withCredentialStatus(JSObject.fromJSONObject(raw.getJSONObject(i))));
                } catch (Exception ignored) {}
            }
            JSObject res = new JSObject();
            res.put("items", enriched);
            call.resolve(res);
        });
    }

    @PluginMethod
    public void accountsTest(PluginCall call) {
        executor.execute(() -> {
            try {
                String accountId = call.getString("accountId", "");
                String email = call.getString("email", "").trim().toLowerCase();
                String imapHost = call.getString("imapHost", "").trim();
                int imapPort = call.getInt("imapPort", 993);
                boolean imapSecure = Boolean.TRUE.equals(call.getBoolean("imapSecure", true));
                String secret = call.getString("secret", "");
                String authMode = call.getString("authMode", "imap_password");

                if ((secret == null || secret.isEmpty()) && accountId != null && !accountId.isEmpty()) {
                    JSObject savedAcc = db.getAccount(accountId);
                    if (savedAcc == null) {
                        call.reject("Compte introuvable.");
                        return;
                    }
                    if (email.isEmpty()) email = savedAcc.getString("email");
                    if (imapHost.isEmpty()) imapHost = savedAcc.getString("imapHost");
                    secret = resolveAccessSecret(savedAcc);
                    authMode = savedAcc.getString("authMode");
                }

                JSObject res = imap.testConnection(
                    imapHost, imapPort, imapSecure, email, secret, !"imap_password".equals(authMode)
                );
                call.resolve(res);
            } catch (Exception e) {
                call.reject(e.getMessage() != null ? e.getMessage() : e.toString(), e);
            }
        });
    }

    @PluginMethod
    public void accountsAdd(PluginCall call) {
        executor.execute(() -> {
            String id = UUID.randomUUID().toString();
            try {
                String email = call.getString("email", "").trim().toLowerCase();
                String label = call.getString("label", email);
                if (label == null || label.trim().isEmpty()) label = email;
                String provider = call.getString("provider", "custom");
                String authMode = call.getString("authMode", "imap_password");
                String imapHost = call.getString("imapHost", "").trim();
                int imapPort = call.getInt("imapPort", 993);
                boolean imapSecure = Boolean.TRUE.equals(call.getBoolean("imapSecure", true));
                String secret = call.getString("secret", "");

                JSObject existing = db.getAccountByEmail(email);
                JSObject acc;
                if (existing != null) {
                    String existingId = existing.getString("id");
                    acc = db.updateAccount(existingId, label, provider, authMode, imapHost, imapPort, imapSecure);
                    if (secret != null && !secret.isEmpty()) {
                        JSONObject sec = new JSONObject();
                        sec.put("password", secret);
                        vault.setSecret(existingId, sec);
                    }
                } else {
                    acc = db.createAccount(id, label, email, provider, authMode, imapHost, imapPort, imapSecure);
                    if (secret != null && !secret.isEmpty()) {
                        JSONObject sec = new JSONObject();
                        sec.put("password", secret);
                        vault.setSecret(id, sec);
                    }
                }
                call.resolve(withCredentialStatus(acc));
            } catch (Exception e) {
                if (db.getAccount(id) != null) db.deleteAccount(id);
                call.reject(e.getMessage() != null ? e.getMessage() : e.toString(), e);
            }
        });
    }

    private String optStr(JSObject data, String key, String fallback) {
        if (data != null && data.has(key) && !data.isNull(key)) {
            String val = data.optString(key, fallback);
            return val != null ? val : fallback;
        }
        return fallback;
    }

    @PluginMethod
    public void accountsUpdate(PluginCall call) {
        executor.execute(() -> {
            try {
                String id = call.getString("id", "");
                JSObject existing = db.getAccount(id);
                if (existing == null) {
                    call.reject("Compte introuvable.");
                    return;
                }
                JSObject data = call.getData();
                String label = optStr(data, "label", existing.getString("label"));
                String provider = optStr(data, "provider", existing.getString("provider"));
                String authMode = optStr(data, "authMode", existing.getString("authMode"));
                String imapHost = optStr(data, "imapHost", existing.getString("imapHost"));
                int imapPort = (data != null && data.has("imapPort") && !data.isNull("imapPort"))
                    ? data.optInt("imapPort", existing.getInt("imapPort"))
                    : existing.getInt("imapPort");
                boolean imapSecure = (data != null && data.has("imapSecure") && !data.isNull("imapSecure"))
                    ? data.optBoolean("imapSecure", existing.getBoolean("imapSecure"))
                    : existing.getBoolean("imapSecure");

                JSObject updated = db.updateAccount(id, label, provider, authMode, imapHost, imapPort, imapSecure);
                boolean clearSecret = Boolean.TRUE.equals(call.getBoolean("clearSecret", false));
                String secret = call.getString("secret", "");
                if (clearSecret) {
                    vault.deleteSecret(id);
                } else if (secret != null && !secret.trim().isEmpty()) {
                    JSONObject sec = new JSONObject();
                    sec.put("password", secret);
                    vault.setSecret(id, sec);
                }
                call.resolve(withCredentialStatus(updated));
            } catch (Exception e) {
                call.reject(e.getMessage() != null ? e.getMessage() : e.toString(), e);
            }
        });
    }

    @PluginMethod
    public void accountsDisconnect(PluginCall call) {
        String accountId = call.getString("accountId", "");
        executor.execute(() -> {
            JSObject acc = db.getAccount(accountId);
            if (acc == null) {
                call.reject("Compte introuvable.");
                return;
            }
            vault.deleteSecret(accountId);
            db.updateAccountSyncStatus(accountId, "idle", null);
            call.resolve(withCredentialStatus(db.getAccount(accountId)));
        });
    }

    @PluginMethod
    public void accountsDelete(PluginCall call) {
        String accountId = call.getString("accountId", "");
        executor.execute(() -> {
            vault.deleteSecret(accountId);
            db.deleteAccount(accountId);
            call.resolve();
        });
    }

    private String resolveAccessSecret(JSObject acc) throws Exception {
        String accountId = acc.getString("id");
        JSONObject sec = vault.getSecret(accountId);
        if (sec == null) {
            throw new IllegalStateException("Identifiants manquants dans le coffre Android.");
        }
        String authMode = acc.getString("authMode");
        if ("microsoft_oauth".equals(authMode)) {
            long expiresAt = sec.optLong("expiresAt", 0L);
            String refreshToken = sec.optString("refreshToken", "");
            String clientId = db.getSettings().optString("microsoftClientId", "");
            if (expiresAt > 0 && System.currentTimeMillis() > expiresAt - 120_000L && !refreshToken.isEmpty() && !clientId.isEmpty()) {
                AndroidMicrosoftOAuth.TokenResult refreshed = AndroidMicrosoftOAuth.refreshToken(clientId, refreshToken);
                sec.put("accessToken", refreshed.accessToken);
                if (refreshed.refreshToken != null && !refreshed.refreshToken.isEmpty()) {
                    sec.put("refreshToken", refreshed.refreshToken);
                }
                sec.put("expiresAt", refreshed.expiresAt);
                vault.setSecret(accountId, sec);
            }
            return sec.optString("accessToken", "");
        }
        return sec.optString("password", "");
    }

    @PluginMethod
    public void accountsMicrosoftLogin(PluginCall call) {
        executor.execute(() -> {
            try {
                String clientId = call.getString("clientId", "");
                String loginHint = call.getString("loginHint", "");
                String targetAccountId = call.getString("targetAccountId", "");
                if (clientId == null || clientId.trim().isEmpty()) {
                    clientId = db.getSettings().optString("microsoftClientId", "");
                }
                JSObject targetAcc = (targetAccountId != null && !targetAccountId.isEmpty())
                    ? db.getAccount(targetAccountId) : null;
                if ((loginHint == null || loginHint.trim().isEmpty()) && targetAcc != null) {
                    loginHint = targetAcc.optString("email", "");
                }
                AndroidMicrosoftOAuth.TokenResult tokens = AndroidMicrosoftOAuth.runPkceLogin(getContext(), clientId, loginHint);
                String email = tokens.email != null ? tokens.email : (loginHint != null ? loginHint.trim().toLowerCase() : "");
                if (email.isEmpty()) {
                    call.reject("Impossible de déterminer l'adresse email Microsoft.");
                    return;
                }
                if (!clientId.trim().isEmpty()) {
                    JSObject s = new JSObject();
                    s.put("microsoftClientId", clientId.trim());
                    db.saveSettings(s);
                }

                JSObject existing = targetAcc != null ? targetAcc : db.getAccountByEmail(email);
                JSObject acc;
                String accId;
                if (existing != null) {
                    accId = existing.getString("id");
                    acc = db.updateAccount(
                        accId, existing.optString("label", email),
                        "microsoft", "microsoft_oauth", "outlook.office365.com", 993, true
                    );
                } else {
                    accId = UUID.randomUUID().toString();
                    acc = db.createAccount(
                        accId, email, email, "microsoft", "microsoft_oauth", "outlook.office365.com", 993, true
                    );
                }

                JSONObject sec = new JSONObject();
                sec.put("accessToken", tokens.accessToken);
                sec.put("refreshToken", tokens.refreshToken);
                sec.put("expiresAt", tokens.expiresAt);
                vault.setSecret(accId, sec);
                call.resolve(withCredentialStatus(acc));
            } catch (Exception e) {
                call.reject(e.getMessage() != null ? e.getMessage() : e.toString(), e);
            }
        });
    }

    @PluginMethod
    public void accountsSync(PluginCall call) {
        executor.execute(() -> {
            try {
                String accountId = call.getString("accountId", "");
                String folderPath = call.getString("folderPath", "INBOX");
                int limit = call.getInt("limit", 1000);
                JSObject acc = db.getAccount(accountId);
                if (acc == null) {
                    call.reject("Compte introuvable.");
                    return;
                }
                String secret = resolveAccessSecret(acc);

                JSObject result = imap.syncAccount(db, acc, secret, folderPath, limit, (ev) -> {
                    notifyListeners("syncProgress", ev);
                });
                call.resolve(result);
            } catch (Exception e) {
                call.reject(e.getMessage() != null ? e.getMessage() : e.toString(), e);
            }
        });
    }

    @PluginMethod
    public void foldersList(PluginCall call) {
        String accountId = call.getString("accountId", null);
        executor.execute(() -> {
            JSObject res = new JSObject();
            res.put("items", db.listFolders(accountId));
            call.resolve(res);
        });
    }

    @PluginMethod
    public void emailsStats(PluginCall call) {
        String accountId = call.getString("accountId", null);
        String folderPath = call.getString("folderPath", null);
        executor.execute(() -> call.resolve(db.getAuditStats(accountId, folderPath)));
    }

    @PluginMethod
    public void emailsSenderGroupsRaw(PluginCall call) {
        String accountId = call.getString("accountId", "all");
        String folderPath = call.getString("folderPath", "INBOX");
        String search = call.getString("search", "");
        boolean groupByDomain = "domain".equals(call.getString("groupBy", "sender"));
        int limit = call.getInt("limit", 250);
        executor.execute(() -> {
            JSObject res = new JSObject();
            res.put("items", db.querySenderGroups(accountId, folderPath, search, groupByDomain, limit));
            call.resolve(res);
        });
    }

    @PluginMethod
    public void plansList(PluginCall call) {
        executor.execute(() -> {
            JSObject res = new JSObject();
            res.put("items", db.listPlans());
            call.resolve(res);
        });
    }

    @PluginMethod
    public void plansCreateFromSenders(PluginCall call) {
        executor.execute(() -> {
            try {
                String title = call.getString("title", "Plan de tri mobile");
                JSArray selections = call.getArray("selections");
                JSArray moves = new JSArray();
                if (selections != null) {
                    for (int i = 0; i < selections.length(); i++) {
                        JSONObject sel = selections.getJSONObject(i);
                        JSONObject group = sel.getJSONObject("group");
                        String destFolder = sel.getString("destFolder");
                        String matchBy = sel.optString("matchBy", "sender");
                        String accountId = group.getString("accountId");
                        String accountEmail = group.getString("accountEmail");
                        String folderPath = group.optString("folderPath", "INBOX");
                        String matchValue = "domain".equals(matchBy)
                            ? group.optString("domain", group.optString("fromAddr", ""))
                            : group.optString("fromAddr", group.optString("groupKey", ""));

                        List<String> samples = new ArrayList<>();
                        List<Long> uids = db.getUidsForMatch(accountId, folderPath, matchBy, matchValue, samples);
                        if (uids.isEmpty()) continue;

                        JSObject mv = new JSObject();
                        mv.put("id", UUID.randomUUID().toString());
                        mv.put("accountId", accountId);
                        mv.put("accountEmail", accountEmail);
                        mv.put("sourceFolder", folderPath);
                        mv.put("destFolder", destFolder);
                        mv.put("label", matchValue);
                        JSArray uidArr = new JSArray();
                        for (Long u : uids) uidArr.put(u);
                        mv.put("uids", uidArr);
                        JSArray smpArr = new JSArray();
                        for (String s : samples) smpArr.put(s);
                        mv.put("sampleSubjects", smpArr);
                        mv.put("checked", true);
                        moves.put(mv);
                    }
                }
                JSObject plan = new JSObject();
                plan.put("id", UUID.randomUUID().toString());
                plan.put("title", title);
                plan.put("source", "manual");
                plan.put("createdAt", AndroidMailDatabase.nowIso());
                plan.put("status", "draft");
                plan.put("moves", moves);
                db.savePlan(plan);
                call.resolve(plan);
            } catch (Exception e) {
                call.reject(e.getMessage() != null ? e.getMessage() : e.toString(), e);
            }
        });
    }

    @PluginMethod
    public void plansCreateFromSpec(PluginCall call) {
        executor.execute(() -> {
            try {
                String accountId = call.getString("accountId", "");
                String source = call.getString("source", "ai_import");
                JSObject spec = call.getObject("spec");
                JSObject acc = db.getAccount(accountId);
                if (acc == null || spec == null) {
                    call.reject("Compte ou spécification invalide.");
                    return;
                }
                String sourceFolder = spec.optString("source_folder", "INBOX");
                JSONArray specMoves = spec.optJSONArray("moves");
                JSArray moves = new JSArray();

                if (specMoves != null) {
                    for (int i = 0; i < specMoves.length(); i++) {
                        JSONObject item = specMoves.getJSONObject(i);
                        String dest = item.getString("dest");
                        Set<Long> uidSet = new HashSet<>();
                        List<String> samples = new ArrayList<>();
                        List<String> labels = new ArrayList<>();

                        JSONArray senders = item.optJSONArray("senders");
                        if (senders != null) {
                            for (int j = 0; j < senders.length(); j++) {
                                String s = senders.getString(j);
                                uidSet.addAll(db.getUidsForMatch(accountId, sourceFolder, "sender", s, samples));
                                labels.add(s);
                            }
                        }
                        JSONArray domains = item.optJSONArray("domains");
                        if (domains != null) {
                            for (int j = 0; j < domains.length(); j++) {
                                String d = domains.getString(j);
                                uidSet.addAll(db.getUidsForMatch(accountId, sourceFolder, "domain", d, samples));
                                labels.add(d);
                            }
                        }
                        if (uidSet.isEmpty()) continue;

                        JSObject mv = new JSObject();
                        mv.put("id", UUID.randomUUID().toString());
                        mv.put("accountId", accountId);
                        mv.put("accountEmail", acc.getString("email"));
                        mv.put("sourceFolder", sourceFolder);
                        mv.put("destFolder", dest);
                        mv.put("label", item.optString("reason", String.join(", ", labels)));
                        JSArray uidArr = new JSArray();
                        for (Long u : uidSet) uidArr.put(u);
                        mv.put("uids", uidArr);
                        JSArray smpArr = new JSArray();
                        for (int s = 0; s < Math.min(3, samples.size()); s++) smpArr.put(samples.get(s));
                        mv.put("sampleSubjects", smpArr);
                        mv.put("checked", true);
                        moves.put(mv);
                    }
                }

                if (moves.length() == 0) {
                    call.reject("Aucun mail en cache ne correspond à ce plan.");
                    return;
                }

                JSObject plan = new JSObject();
                plan.put("id", UUID.randomUUID().toString());
                plan.put("title", spec.optString("title", "Plan importé (IA)"));
                plan.put("source", source);
                plan.put("createdAt", AndroidMailDatabase.nowIso());
                plan.put("status", "draft");
                plan.put("moves", moves);
                db.savePlan(plan);
                call.resolve(plan);
            } catch (Exception e) {
                call.reject(e.getMessage() != null ? e.getMessage() : e.toString(), e);
            }
        });
    }

    @PluginMethod
    public void plansCreateFromRules(PluginCall call) {
        String accountIdFilter = call.getString("accountId", "all");
        executor.execute(() -> {
            try {
                JSArray rules = db.listRules();
                JSArray accounts = db.listAccounts();
                JSArray moves = new JSArray();

                for (int a = 0; a < accounts.length(); a++) {
                    JSONObject acc = accounts.getJSONObject(a);
                    String accId = acc.getString("id");
                    if (!"all".equals(accountIdFilter) && !accountIdFilter.equals(accId)) continue;

                    for (int r = 0; r < rules.length(); r++) {
                        JSONObject rule = rules.getJSONObject(r);
                        if (!rule.optBoolean("enabled", true)) continue;
                        String rAcc = rule.getString("accountId");
                        if (!"all".equals(rAcc) && !accId.equals(rAcc)) continue;

                        String srcFolder = rule.optString("sourceFolder", "INBOX");
                        List<String> samples = new ArrayList<>();
                        List<Long> uids = db.getUidsForMatch(
                            accId, srcFolder, rule.getString("matchType"), rule.getString("matchValue"), samples
                        );
                        if (uids.isEmpty()) continue;

                        JSObject mv = new JSObject();
                        mv.put("id", UUID.randomUUID().toString());
                        mv.put("accountId", accId);
                        mv.put("accountEmail", acc.getString("email"));
                        mv.put("sourceFolder", srcFolder);
                        mv.put("destFolder", rule.getString("destFolder"));
                        mv.put("label", "Règle : " + rule.getString("name"));
                        JSArray uidArr = new JSArray();
                        for (Long u : uids) uidArr.put(u);
                        mv.put("uids", uidArr);
                        JSArray smpArr = new JSArray();
                        for (String s : samples) smpArr.put(s);
                        mv.put("sampleSubjects", smpArr);
                        mv.put("checked", true);
                        moves.put(mv);
                    }
                }

                JSObject plan = new JSObject();
                plan.put("id", UUID.randomUUID().toString());
                plan.put("title", "Tri automatique par règles");
                plan.put("source", "rule");
                plan.put("createdAt", AndroidMailDatabase.nowIso());
                plan.put("status", "draft");
                plan.put("moves", moves);
                db.savePlan(plan);
                call.resolve(plan);
            } catch (Exception e) {
                call.reject(e.getMessage() != null ? e.getMessage() : e.toString(), e);
            }
        });
    }

    @PluginMethod
    public void plansToggleMove(PluginCall call) {
        String planId = call.getString("planId", "");
        String moveId = call.getString("moveId", "");
        boolean checked = call.getBoolean("checked", true);
        executor.execute(() -> {
            try {
                JSObject plan = db.getPlan(planId);
                if (plan == null) { call.resolve(); return; }
                JSONArray moves = plan.optJSONArray("moves");
                if (moves != null) {
                    for (int i = 0; i < moves.length(); i++) {
                        JSONObject mv = moves.getJSONObject(i);
                        if (moveId.equals(mv.optString("id"))) {
                            mv.put("checked", checked);
                        }
                    }
                }
                db.savePlan(plan);
                call.resolve(plan);
            } catch (Exception e) {
                call.reject(e.getMessage(), e);
            }
        });
    }

    @PluginMethod
    public void plansRemoveMove(PluginCall call) {
        String planId = call.getString("planId", "");
        String moveId = call.getString("moveId", "");
        executor.execute(() -> {
            try {
                JSObject plan = db.getPlan(planId);
                if (plan == null) { call.resolve(); return; }
                JSONArray moves = plan.optJSONArray("moves");
                JSArray nextMoves = new JSArray();
                if (moves != null) {
                    for (int i = 0; i < moves.length(); i++) {
                        JSONObject mv = moves.getJSONObject(i);
                        if (!moveId.equals(mv.optString("id"))) nextMoves.put(mv);
                    }
                }
                plan.put("moves", nextMoves);
                db.savePlan(plan);
                call.resolve(plan);
            } catch (Exception e) {
                call.reject(e.getMessage(), e);
            }
        });
    }

    @PluginMethod
    public void plansDelete(PluginCall call) {
        String planId = call.getString("planId", "");
        executor.execute(() -> {
            db.deletePlan(planId);
            call.resolve();
        });
    }

    @PluginMethod
    public void plansApply(PluginCall call) {
        String planId = call.getString("planId", "");
        executor.execute(() -> {
            try {
                JSObject plan = db.getPlan(planId);
                if (plan == null) {
                    call.reject("Plan introuvable.");
                    return;
                }
                JSObject settings = db.getSettings();
                int batchSize = settings.optInt("waveBatchSize", 100);
                int delayMs = settings.optInt("waveDelayMs", 250);
                JSONArray moves = plan.optJSONArray("moves");
                if (moves == null || moves.length() == 0) {
                    call.reject("Aucun lot dans ce plan.");
                    return;
                }

                JSArray remaining = new JSArray();
                JSArray historyEntries = new JSArray();
                boolean anyFailed = false;

                for (int i = 0; i < moves.length(); i++) {
                    JSONObject mv = moves.getJSONObject(i);
                    if (!mv.optBoolean("checked", true)) {
                        remaining.put(mv);
                        continue;
                    }
                    String accountId = mv.getString("accountId");
                    String sourceFolder = mv.getString("sourceFolder");
                    String destFolder = mv.getString("destFolder");
                    JSONArray uidArr = mv.getJSONArray("uids");
                    List<Long> uids = new ArrayList<>();
                    for (int u = 0; u < uidArr.length(); u++) uids.add(uidArr.getLong(u));

                    JSObject acc = db.getAccount(accountId);
                    if (acc == null) {
                        anyFailed = true;
                        continue;
                    }
                    String secret = resolveAccessSecret(acc);

                    List<String> msgIds = db.getMessageIdsByUids(accountId, sourceFolder, uids);

                    JSObject runEv = new JSObject();
                    runEv.put("planId", planId);
                    runEv.put("moveId", mv.getString("id"));
                    runEv.put("destFolder", destFolder);
                    runEv.put("processed", 0);
                    runEv.put("total", uids.size());
                    runEv.put("status", "running");
                    notifyListeners("planProgress", runEv);

                    try {
                        String resolvedDest = imap.moveUidsInWaves(
                            acc, secret, sourceFolder, destFolder, uids, batchSize, delayMs
                        );
                        db.removeMovedEmails(accountId, sourceFolder, uids);

                        JSObject entry = new JSObject();
                        entry.put("id", UUID.randomUUID().toString());
                        entry.put("planId", planId);
                        entry.put("accountId", accountId);
                        entry.put("accountEmail", acc.getString("email"));
                        entry.put("sourceFolder", sourceFolder);
                        entry.put("destFolder", resolvedDest);
                        entry.put("movedUids", new JSArray());
                        JSArray midArr = new JSArray();
                        for (String m : msgIds) midArr.put(m);
                        entry.put("messageIds", midArr);
                        entry.put("count", uids.size());
                        entry.put("executedAt", AndroidMailDatabase.nowIso());
                        entry.put("undoneAt", JSONObject.NULL);
                        entry.put("status", "ok");
                        entry.put("errorMessage", JSONObject.NULL);
                        db.addHistoryEntry(entry);
                        historyEntries.put(entry);

                        JSObject doneEv = new JSObject();
                        doneEv.put("planId", planId);
                        doneEv.put("moveId", mv.getString("id"));
                        doneEv.put("destFolder", resolvedDest);
                        doneEv.put("processed", uids.size());
                        doneEv.put("total", uids.size());
                        doneEv.put("status", "done");
                        notifyListeners("planProgress", doneEv);
                    } catch (Exception moveEx) {
                        anyFailed = true;
                        JSObject entry = new JSObject();
                        entry.put("id", UUID.randomUUID().toString());
                        entry.put("planId", planId);
                        entry.put("accountId", accountId);
                        entry.put("accountEmail", acc.getString("email"));
                        entry.put("sourceFolder", sourceFolder);
                        entry.put("destFolder", destFolder);
                        entry.put("movedUids", new JSArray());
                        entry.put("messageIds", new JSArray());
                        entry.put("count", 0);
                        entry.put("executedAt", AndroidMailDatabase.nowIso());
                        entry.put("undoneAt", JSONObject.NULL);
                        entry.put("status", "error");
                        entry.put("errorMessage", moveEx.getMessage());
                        db.addHistoryEntry(entry);
                        historyEntries.put(entry);
                    }
                }

                plan.put("status", anyFailed ? "partial" : "applied");
                plan.put("moves", remaining);
                db.savePlan(plan);

                JSObject res = new JSObject();
                res.put("plan", plan);
                res.put("historyEntries", historyEntries);
                call.resolve(res);
            } catch (Exception e) {
                call.reject(e.getMessage() != null ? e.getMessage() : e.toString(), e);
            }
        });
    }

    @PluginMethod
    public void rulesList(PluginCall call) {
        executor.execute(() -> {
            JSObject res = new JSObject();
            res.put("items", db.listRules());
            call.resolve(res);
        });
    }

    @PluginMethod
    public void rulesSaveMovesAsRules(PluginCall call) {
        executor.execute(() -> {
            try {
                JSArray moves = call.getArray("moves");
                JSArray created = new JSArray();
                if (moves != null) {
                    for (int i = 0; i < moves.length(); i++) {
                        JSONObject mv = moves.getJSONObject(i);
                        String label = mv.optString("label", "");
                        if (label.isEmpty() || label.startsWith("Règle :")) continue;
                        boolean isSender = label.contains("@");
                        JSObject rule = new JSObject();
                        rule.put("id", UUID.randomUUID().toString());
                        rule.put("name", label + " → " + mv.getString("destFolder"));
                        rule.put("accountId", mv.getString("accountId"));
                        rule.put("matchType", isSender ? "sender" : "domain");
                        rule.put("matchValue", label.split(",")[0].trim());
                        rule.put("sourceFolder", mv.optString("sourceFolder", "INBOX"));
                        rule.put("destFolder", mv.getString("destFolder"));
                        rule.put("enabled", true);
                        rule.put("createdAt", AndroidMailDatabase.nowIso());
                        db.saveRule(rule);
                        created.put(rule);
                    }
                }
                JSObject res = new JSObject();
                res.put("items", created);
                call.resolve(res);
            } catch (Exception e) {
                call.reject(e.getMessage(), e);
            }
        });
    }

    @PluginMethod
    public void rulesToggle(PluginCall call) {
        String ruleId = call.getString("ruleId", "");
        boolean enabled = call.getBoolean("enabled", true);
        executor.execute(() -> {
            try {
                JSArray rules = db.listRules();
                for (int i = 0; i < rules.length(); i++) {
                    JSONObject r = rules.getJSONObject(i);
                    if (ruleId.equals(r.getString("id"))) {
                        JSObject updated = JSObject.fromJSONObject(r);
                        updated.put("enabled", enabled);
                        db.saveRule(updated);
                        break;
                    }
                }
                JSObject res = new JSObject();
                res.put("items", db.listRules());
                call.resolve(res);
            } catch (Exception e) {
                call.reject(e.getMessage(), e);
            }
        });
    }

    @PluginMethod
    public void rulesDelete(PluginCall call) {
        String ruleId = call.getString("ruleId", "");
        executor.execute(() -> {
            db.deleteRule(ruleId);
            JSObject res = new JSObject();
            res.put("items", db.listRules());
            call.resolve(res);
        });
    }

    @PluginMethod
    public void historyList(PluginCall call) {
        executor.execute(() -> {
            JSObject res = new JSObject();
            res.put("items", db.listHistory(50));
            call.resolve(res);
        });
    }

    @PluginMethod
    public void historyUndo(PluginCall call) {
        String historyId = call.getString("historyId", "");
        executor.execute(() -> {
            try {
                JSArray items = db.listHistory(100);
                JSONObject target = null;
                for (int i = 0; i < items.length(); i++) {
                    JSONObject h = items.getJSONObject(i);
                    if (historyId.equals(h.getString("id"))) {
                        target = h;
                        break;
                    }
                }
                if (target == null) {
                    call.reject("Entrée d'historique introuvable.");
                    return;
                }
                String accountId = target.getString("accountId");
                JSObject acc = db.getAccount(accountId);
                if (acc == null) {
                    call.reject("Compte introuvable.");
                    return;
                }
                String secret = resolveAccessSecret(acc);

                JSONArray midArr = target.getJSONArray("messageIds");
                List<String> mids = new ArrayList<>();
                for (int i = 0; i < midArr.length(); i++) mids.add(midArr.getString(i));

                int restored = imap.undoMoveByMessageIds(
                    acc,
                    secret,
                    target.getString("sourceFolder"),
                    target.getString("destFolder"),
                    mids
                );
                db.markHistoryUndone(historyId);
                JSObject res = new JSObject();
                res.put("restored", restored);
                call.resolve(res);
            } catch (Exception e) {
                call.reject(e.getMessage() != null ? e.getMessage() : e.toString(), e);
            }
        });
    }

    @PluginMethod
    public void aiHasApiKey(PluginCall call) {
        executor.execute(() -> {
            JSObject res = new JSObject();
            res.put("hasKey", vault.hasSecret(AI_SECRET_KEY));
            call.resolve(res);
        });
    }

    @PluginMethod
    public void aiSaveApiKey(PluginCall call) {
        String apiKey = call.getString("apiKey", "");
        executor.execute(() -> {
            try {
                boolean saved = false;
                if (apiKey == null || apiKey.trim().isEmpty()) {
                    vault.deleteSecret(AI_SECRET_KEY);
                } else {
                    JSONObject sec = new JSONObject();
                    sec.put("aiApiKey", apiKey.trim());
                    vault.setSecret(AI_SECRET_KEY, sec);
                    saved = true;
                }
                JSObject res = new JSObject();
                res.put("saved", saved);
                call.resolve(res);
            } catch (Exception e) {
                call.reject(e.getMessage(), e);
            }
        });
    }

    @PluginMethod
    public void aiGetApiKey(PluginCall call) {
        executor.execute(() -> {
            try {
                JSONObject sec = vault.getSecret(AI_SECRET_KEY);
                JSObject res = new JSObject();
                res.put("apiKey", sec != null ? sec.optString("aiApiKey", "") : "");
                call.resolve(res);
            } catch (Exception e) {
                call.reject(e.getMessage(), e);
            }
        });
    }

    @PluginMethod
    public void settingsGet(PluginCall call) {
        executor.execute(() -> call.resolve(db.getSettings()));
    }

    @PluginMethod
    public void settingsSave(PluginCall call) {
        JSObject partial = call.getData();
        executor.execute(() -> call.resolve(db.saveSettings(partial)));
    }

    private String launchExternalUri(String rawUrl) {
        String mailto = AndroidImapEngine.sanitizeMailto(rawUrl);
        String target = mailto != null ? mailto : AndroidImapEngine.sanitizeHttpUrl(rawUrl);
        if (target == null) {
            return null;
        }
        Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(target));
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getActivity().runOnUiThread(() -> getActivity().startActivity(intent));
        return target;
    }

    @PluginMethod
    public void emailsMarkUnsubscribed(PluginCall call) {
        String accountId = call.getString("accountId", "");
        String senderKey = call.getString("senderKey", "");
        String status = call.getString("status", "confirmed");
        String method = call.getString("method", "manual");
        String targetUrl = call.getString("targetUrl", null);
        String detail = call.getString("detail", null);
        executor.execute(() -> {
            String at = db.saveUnsubscribeStatus(accountId, senderKey, status, method, targetUrl, detail);
            JSObject res = new JSObject();
            res.put("unsubscribedAt", at);
            call.resolve(res);
        });
    }

    private static class CandidateSource {
        long uid;
        String httpUrl;
        String mailtoUrl;
        boolean oneClick;
        boolean fromBody;
        String dateIso;
    }

    @PluginMethod
    public void emailsUnsubscribe(PluginCall call) {
        boolean openBrowserIfNeeded = Boolean.TRUE.equals(call.getBoolean("openBrowserIfNeeded", true));
        JSONObject req = call.getData().optJSONObject("req");
        if (req == null) {
            call.reject("Requête de désinscription invalide.");
            return;
        }
        executor.execute(() -> {
            try {
                String accountId = req.optString("accountId", "");
                String folderPath = req.optString("folderPath", "INBOX");
                String groupKey = req.optString("groupKey", "");
                String fromAddr = req.optString("fromAddr", "");
                String domain = req.optString("domain", "");
                String matchBy = req.optString("matchBy", "sender");
                String matchValue = "domain".equals(matchBy)
                    ? (!domain.isEmpty() ? domain : groupKey)
                    : (!fromAddr.isEmpty() ? fromAddr : groupKey);
                matchValue = matchValue.trim().toLowerCase(java.util.Locale.US);

                List<AndroidMailDatabase.LatestUnsubCache> cachedList =
                    db.getCandidateEmailsForGroup(accountId, folderPath, matchBy, matchValue, 6);
                List<Long> cachedUids = new ArrayList<>();
                Set<Long> cachedUidSet = new HashSet<>();
                for (AndroidMailDatabase.LatestUnsubCache c : cachedList) {
                    cachedUids.add(c.uid);
                    cachedUidSet.add(c.uid);
                }

                List<CandidateSource> candidates = new ArrayList<>();
                Set<String> seenKeys = new HashSet<>();
                String newestDateIso = req.isNull("latestDateIso") ? "" : req.optString("latestDateIso", "");
                if (newestDateIso.isEmpty() && !cachedList.isEmpty()) {
                    newestDateIso = cachedList.get(0).dateIso;
                }

                JSObject acc = db.getAccount(accountId);
                if (acc != null) {
                    try {
                        String secret = resolveAccessSecret(acc);
                        List<AndroidImapEngine.UnsubscribeCandidate> live =
                            imap.findLatestUnsubscribeCandidates(acc, secret, folderPath, matchValue, cachedUids, 5);
                        for (AndroidImapEngine.UnsubscribeCandidate lc : live) {
                            if (newestDateIso.isEmpty() && lc.dateIso != null && !lc.dateIso.isEmpty()) {
                                newestDateIso = lc.dateIso;
                            }
                            if (cachedUidSet.contains(lc.uid)) {
                                db.updateEmailUnsubscribeInfo(
                                    accountId, folderPath, lc.uid, lc.info.hasUnsubscribe,
                                    lc.info.unsubscribeUrl, lc.info.unsubscribeMailto, lc.info.unsubscribeOneClick
                                );
                            }
                            addCandidate(candidates, seenKeys, lc.uid, lc.info.unsubscribeUrl,
                                lc.info.unsubscribeMailto, lc.info.unsubscribeOneClick, lc.info.fromBody, lc.dateIso);
                        }
                    } catch (Exception ignored) {}
                }

                for (AndroidMailDatabase.LatestUnsubCache c : cachedList) {
                    if (newestDateIso.isEmpty() && c.dateIso != null && !c.dateIso.isEmpty()) {
                        newestDateIso = c.dateIso;
                    }
                    addCandidate(candidates, seenKeys, c.uid, c.unsubscribeUrl,
                        c.unsubscribeMailto, c.unsubscribeOneClick, false, c.dateIso);
                }

                String reqHttp = req.isNull("unsubscribeUrl") ? null : req.optString("unsubscribeUrl", null);
                String reqMailto = req.isNull("unsubscribeMailto") ? null : req.optString("unsubscribeMailto", null);
                boolean reqOneClick = req.optBoolean("unsubscribeOneClick", false);
                addCandidate(candidates, seenKeys, 0L, reqHttp, reqMailto, reqOneClick, false, newestDateIso);

                String lastFailureReason = null;
                String lastFailedUrl = null;
                String firstMailtoFallback = null;

                for (CandidateSource cand : candidates) {
                    if (firstMailtoFallback == null && cand.mailtoUrl != null) {
                        firstMailtoFallback = cand.mailtoUrl;
                    }
                    if (cand.httpUrl == null) continue;

                    if (cand.oneClick && cand.httpUrl.startsWith("https://")) {
                        AndroidImapEngine.HttpProbeResult postRes = AndroidImapEngine.probeHttp(cand.httpUrl, "POST");
                        if (postRes.reachable && postRes.statusCode >= 200 && postRes.statusCode < 300) {
                            if ("expired".equals(postRes.outcome)) {
                                lastFailureReason = postRes.reason;
                                lastFailedUrl = cand.httpUrl;
                                continue;
                            }
                            String statusKey = "already_unsubscribed".equals(postRes.outcome)
                                ? "already_unsubscribed" : "one_click_sent";
                            String msg = "already_unsubscribed".equals(postRes.outcome)
                                ? postRes.reason
                                : "Désinscription automatique 1-clic vérifiée (HTTP " + postRes.statusCode + ").";
                            String at = db.saveUnsubscribeStatus(
                                accountId, matchValue, "confirmed", "one_click_post", postRes.finalUrl, msg
                            );
                            call.resolve(buildUnsubRes(statusKey, true, "one_click_post", postRes.finalUrl, msg, at));
                            return;
                        }
                    }

                    AndroidImapEngine.HttpProbeResult getRes = AndroidImapEngine.probeHttp(cand.httpUrl, "GET");
                    if (!getRes.reachable) {
                        lastFailureReason = getRes.reason;
                        lastFailedUrl = cand.httpUrl;
                        continue;
                    }
                    String method = cand.fromBody ? "body_link" : "https";
                    if ("already_unsubscribed".equals(getRes.outcome)) {
                        String at = db.saveUnsubscribeStatus(accountId, matchValue, "confirmed", method, getRes.finalUrl, getRes.reason);
                        call.resolve(buildUnsubRes("already_unsubscribed", true, method, getRes.finalUrl, getRes.reason, at));
                        return;
                    }
                    if ("confirmed".equals(getRes.outcome)) {
                        String at = db.saveUnsubscribeStatus(accountId, matchValue, "confirmed", method, getRes.finalUrl, getRes.reason);
                        call.resolve(buildUnsubRes("confirmed_get", true, method, getRes.finalUrl, getRes.reason, at));
                        return;
                    }
                    if ("needs_manual".equals(getRes.outcome)) {
                        db.saveUnsubscribeStatus(accountId, matchValue, "pending", method, getRes.finalUrl, getRes.reason);
                        if (openBrowserIfNeeded) {
                            launchExternalUri(getRes.finalUrl);
                        }
                        String msg = openBrowserIfNeeded
                            ? "Page active vérifiée et ouverte : valide sur le site puis clique « C'est fait »."
                            : "Page active vérifiée — ouvre le lien pour confirmer.";
                        call.resolve(buildUnsubRes("opened_browser", false, method, getRes.finalUrl, msg, null));
                        return;
                    }
                    lastFailureReason = getRes.reason;
                    lastFailedUrl = cand.httpUrl;
                }

                if (firstMailtoFallback != null) {
                    db.saveUnsubscribeStatus(
                        accountId, matchValue, "pending", "mailto", firstMailtoFallback,
                        "E-mail préparé — confirmation après envoi."
                    );
                    if (openBrowserIfNeeded) {
                        launchExternalUri(firstMailtoFallback);
                    }
                    String msg = openBrowserIfNeeded
                        ? "E-mail préparé : envoie-le puis clique sur « C'est fait »."
                        : "Envoi d'e-mail de désinscription requis.";
                    call.resolve(buildUnsubRes("opened_mailto", false, "mailto", firstMailtoFallback, msg, null));
                    return;
                }

                if (lastFailureReason != null) {
                    String ageHint = "";
                    try {
                        if (newestDateIso != null && !newestDateIso.isEmpty()) {
                            java.text.SimpleDateFormat iso = new java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss", java.util.Locale.US);
                            iso.setTimeZone(java.util.TimeZone.getTimeZone("UTC"));
                            java.util.Date parsedDt = iso.parse(newestDateIso.substring(0, Math.min(19, newestDateIso.length())));
                            if (parsedDt != null) {
                                long days = Math.max(0L, (System.currentTimeMillis() - parsedDt.getTime()) / 86_400_000L);
                                if (days >= 60L) {
                                    ageHint = " (dernier mail reçu il y a " + days + " jours : tu es probablement déjà désinscrit ou la campagne est terminée)";
                                }
                            }
                        }
                    } catch (Exception ignored) {}
                    String fullMsg = "Aucun lien valide trouvé : " + lastFailureReason + ageHint + ".";
                    db.saveUnsubscribeStatus(accountId, matchValue, "failed", "https", lastFailedUrl, fullMsg);
                    call.resolve(buildUnsubRes("expired", false, "https", lastFailedUrl, fullMsg, null));
                    return;
                }

                call.resolve(buildUnsubRes(
                    "not_found", false, "none", null,
                    "Aucun lien de désinscription détecté sur les derniers messages.", null
                ));
            } catch (Exception e) {
                call.reject(e.getMessage() != null ? e.getMessage() : e.toString(), e);
            }
        });
    }

    private void addCandidate(
        List<CandidateSource> list,
        Set<String> seen,
        long uid,
        String rawHttp,
        String rawMailto,
        boolean oneClick,
        boolean fromBody,
        String dateIso
    ) {
        String cleanHttp = AndroidImapEngine.sanitizeHttpUrl(rawHttp);
        String cleanMailto = AndroidImapEngine.sanitizeMailto(rawMailto);
        if (cleanHttp == null && cleanMailto == null) return;
        String key = (cleanHttp == null ? "" : cleanHttp) + "::" + (cleanMailto == null ? "" : cleanMailto) + "::" + (oneClick ? 1 : 0);
        if (seen.contains(key)) return;
        seen.add(key);
        CandidateSource cs = new CandidateSource();
        cs.uid = uid;
        cs.httpUrl = cleanHttp;
        cs.mailtoUrl = cleanMailto;
        cs.oneClick = oneClick;
        cs.fromBody = fromBody;
        cs.dateIso = dateIso;
        list.add(cs);
    }

    private JSObject buildUnsubRes(
        String status,
        boolean verified,
        String method,
        String url,
        String message,
        String unsubscribedAt
    ) {
        JSObject res = new JSObject();
        res.put("status", status);
        res.put("verified", verified);
        res.put("method", method);
        res.put("url", url == null ? JSONObject.NULL : url);
        res.put("message", message);
        res.put("unsubscribedAt", unsubscribedAt == null ? JSONObject.NULL : unsubscribedAt);
        return res;
    }

    @PluginMethod
    public void openExternal(PluginCall call) {
        String launched = launchExternalUri(call.getString("url", ""));
        if (launched == null) {
            call.reject("Protocole URL non autorisé.");
            return;
        }
        call.resolve();
    }
}
