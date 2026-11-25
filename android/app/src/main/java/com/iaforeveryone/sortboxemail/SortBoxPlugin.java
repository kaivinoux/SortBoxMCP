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

    @PluginMethod
    public void accountsList(PluginCall call) {
        executor.execute(() -> {
            JSObject res = new JSObject();
            res.put("items", db.listAccounts());
            call.resolve(res);
        });
    }

    @PluginMethod
    public void accountsTest(PluginCall call) {
        executor.execute(() -> {
            try {
                String email = call.getString("email", "").trim().toLowerCase();
                String imapHost = call.getString("imapHost", "").trim();
                int imapPort = call.getInt("imapPort", 993);
                boolean imapSecure = call.getBoolean("imapSecure", true);
                String secret = call.getString("secret", "");
                String authMode = call.getString("authMode", "imap_password");
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
                boolean imapSecure = call.getBoolean("imapSecure", true);
                String secret = call.getString("secret", "");

                JSObject acc = db.createAccount(id, label, email, provider, authMode, imapHost, imapPort, imapSecure);
                if (secret != null && !secret.isEmpty()) {
                    JSONObject sec = new JSONObject();
                    sec.put("password", secret);
                    vault.setSecret(id, sec);
                }
                call.resolve(acc);
            } catch (Exception e) {
                db.deleteAccount(id);
                call.reject(e.getMessage() != null ? e.getMessage() : e.toString(), e);
            }
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
                if (clientId == null || clientId.trim().isEmpty()) {
                    clientId = db.getSettings().optString("microsoftClientId", "");
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

                JSObject existing = null;
                JSArray list = db.listAccounts();
                for (int i = 0; i < list.length(); i++) {
                    JSONObject item = list.getJSONObject(i);
                    if (email.equalsIgnoreCase(item.optString("email"))) {
                        existing = JSObject.fromJSONObject(item);
                        break;
                    }
                }
                String accId = existing != null ? existing.getString("id") : UUID.randomUUID().toString();
                JSObject acc = existing != null
                    ? existing
                    : db.createAccount(accId, email, email, "microsoft", "microsoft_oauth", "outlook.office365.com", 993, true);

                JSONObject sec = new JSONObject();
                sec.put("accessToken", tokens.accessToken);
                sec.put("refreshToken", tokens.refreshToken);
                sec.put("expiresAt", tokens.expiresAt);
                vault.setSecret(accId, sec);
                call.resolve(acc);
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

    @PluginMethod
    public void openExternal(PluginCall call) {
        String url = call.getString("url", "");
        if (!url.startsWith("https://") && !url.startsWith("http://")) {
            call.reject("Protocole URL non autorisé.");
            return;
        }
        Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
        getActivity().startActivity(intent);
        call.resolve();
    }
}
