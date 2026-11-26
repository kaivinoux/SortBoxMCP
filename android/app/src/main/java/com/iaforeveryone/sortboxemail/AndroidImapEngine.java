package com.iaforeveryone.sortboxemail;

import android.content.ContentValues;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.sun.mail.imap.IMAPFolder;
import com.sun.mail.imap.IMAPStore;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.Date;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Properties;
import java.util.Set;
import java.util.TimeZone;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import javax.mail.Address;
import javax.mail.FetchProfile;
import javax.mail.Flags;
import javax.mail.Folder;
import javax.mail.Message;
import javax.mail.MessagingException;
import javax.mail.Multipart;
import javax.mail.Part;
import javax.mail.Session;
import javax.mail.Store;
import javax.mail.UIDFolder;
import javax.mail.internet.InternetAddress;
import javax.mail.search.FromStringTerm;
import javax.mail.search.HeaderTerm;

public class AndroidImapEngine {
    public interface SyncProgressListener {
        void onProgress(JSObject event);
    }

    private static final Set<String> TRASH_ALIASES = new HashSet<>(Arrays.asList(
        "__trash__", "trash", "corbeille", "inbox/trash", "inbox.trash",
        "inbox/corbeille", "inbox.corbeille", "[gmail]/trash", "[gmail]/corbeille",
        "deleted", "deleted items", "deleted messages", "éléments supprimés", "elements supprimes"
    ));

    private static final Set<String> JUNK_ALIASES = new HashSet<>(Arrays.asList(
        "__junk__", "spam", "junk", "junk e-mail", "junk email",
        "inbox/spam", "inbox.spam", "inbox/junk", "inbox.junk",
        "[gmail]/spam", "courrier indésirable", "courrier indesirable", "indesirables", "indésirables"
    ));

    private static final Set<String> ARCHIVE_ALIASES = new HashSet<>(Arrays.asList(
        "__archive__", "archive", "archives", "inbox/archive", "inbox.archive",
        "inbox/archives", "inbox.archives", "[gmail]/tous les messages", "[gmail]/all mail"
    ));

    private static final Pattern UNSUB_BRACKET_PATTERN = Pattern.compile("<([^>]+)>");
    private static final Pattern ANCHOR_PATTERN = Pattern.compile(
        "<a\\b[^>]*\\bhref\\s*=\\s*[\"']([^\"']+)[\"'][^>]*>([\\s\\S]*?)</a>",
        Pattern.CASE_INSENSITIVE
    );
    private static final Pattern BARE_URL_PATTERN = Pattern.compile(
        "(https?://[^\\s<>\"')]+)",
        Pattern.CASE_INSENSITIVE
    );
    private static final Pattern UNSUB_KEYWORDS = Pattern.compile(
        "d[eé]sabonn|d[eé]sinscri|unsubscribe|opt[-_]?out|stop\\s+receiving|ne\\s+plus\\s+recevoir|pr[eé]f[eé]rences|manage\\s+preferences",
        Pattern.CASE_INSENSITIVE
    );
    private static final Pattern UNSUB_URL_HINT = Pattern.compile(
        "unsub|opt[-_]?out|desabonn|desinscri|remove|preferences|list-manage",
        Pattern.CASE_INSENSITIVE
    );

    public static class UnsubscribeInfo {
        public boolean hasUnsubscribe;
        public String unsubscribeUrl;
        public String unsubscribeMailto;
        public boolean unsubscribeOneClick;
        public boolean fromBody;
    }

    public static String sanitizeHttpUrl(String raw) {
        if (raw == null) return null;
        String cleaned = raw.replace("&amp;", "&").replace("&AMP;", "&").trim();
        if (cleaned.isEmpty()) return null;
        try {
            URL u = new URL(cleaned);
            String proto = u.getProtocol().toLowerCase(Locale.US);
            if (!"https".equals(proto) && !"http".equals(proto)) return null;
            return u.toString();
        } catch (Exception e) {
            return null;
        }
    }

    public static String sanitizeMailto(String raw) {
        if (raw == null) return null;
        String cleaned = raw.replaceAll("[\\r\\n\\0]", "").trim();
        if (cleaned.length() <= 7 || !cleaned.regionMatches(true, 0, "mailto:", 0, 7)) return null;
        String target = cleaned.substring(7);
        if (!target.contains("@") || target.length() > 500) return null;
        return "mailto:" + target;
    }

    public static UnsubscribeInfo parseListUnsubscribeHeaders(String unsubRaw, String postRaw) {
        UnsubscribeInfo info = new UnsubscribeInfo();
        String value = unsubRaw == null ? "" : unsubRaw.trim();
        if (value.isEmpty()) return info;
        info.hasUnsubscribe = true;

        List<String> candidates = new ArrayList<>();
        Matcher bm = UNSUB_BRACKET_PATTERN.matcher(value);
        while (bm.find()) {
            candidates.add(bm.group(1).trim());
        }
        if (candidates.isEmpty()) {
            for (String p : value.split(",")) {
                candidates.add(p.trim());
            }
        }
        for (String c : candidates) {
            if (info.unsubscribeUrl == null) {
                String http = sanitizeHttpUrl(c);
                if (http != null) {
                    info.unsubscribeUrl = http;
                    continue;
                }
            }
            if (info.unsubscribeMailto == null) {
                String mailto = sanitizeMailto(c);
                if (mailto != null) {
                    info.unsubscribeMailto = mailto;
                }
            }
        }
        String postVal = postRaw == null ? "" : postRaw.toLowerCase(Locale.US);
        boolean oneClickHeader = postVal.contains("list-unsubscribe=one-click") ||
            Pattern.compile("list-unsubscribe\\s*=\\s*one-click", Pattern.CASE_INSENSITIVE).matcher(postVal).find();
        info.unsubscribeOneClick = info.unsubscribeUrl != null && info.unsubscribeUrl.startsWith("https://") && oneClickHeader;
        return info;
    }

    public static class UnsubscribeCandidate {
        public long uid;
        public UnsubscribeInfo info;
        public String dateIso;
    }

    public static class HttpProbeResult {
        public boolean reachable;
        public int statusCode;
        public String finalUrl;
        public String outcome;
        public String reason;
    }

    private static final Pattern ALREADY_UNSUB_RE = Pattern.compile(
        "d[eé]j[aà]\\s+(?:d[eé]sinscri|d[eé]sabonn|retir[eé])|vous\\s+n['’][eê]tes\\s+(?:plus|pas)\\s+abonn[eé]|already\\s+(?:unsubscribed|opted\\s*out|removed)|you\\s+are\\s+no\\s+longer\\s+subscribed|ne\\s+recevez\\s+d[eé]j[aà]\\s+plus",
        Pattern.CASE_INSENSITIVE
    );
    private static final Pattern EXPIRED_PAGE_RE = Pattern.compile(
        "lien\\s+(?:a\\s+|est\\s+)?expir[eé]|link\\s+(?:has\\s+|is\\s+)?expired|token\\s+(?:invalide|expir[eé]|introuvable|not\\s+found)|invalid\\s+(?:or\\s+expired\\s+)?(?:link|token)|page\\s+(?:introuvable|n['’]existe\\s+plus|n['’]existe\\s+pas|not\\s+found)|error\\s*404|\\b404\\s+not\\s+found\\b",
        Pattern.CASE_INSENSITIVE
    );
    private static final Pattern HAS_FORM_PROMPT_RE = Pattern.compile(
        "<form\\b|<input[^>]+type\\s*=\\s*[\"']?(?:submit|checkbox|radio|email)|confirmer\\s+(?:votre|la)\\s+d[eé]s|veuillez\\s+confirmer|cliquez\\s+(?:ici\\s+)?pour\\s+(?:vous\\s+d[eé]s|confirmer)|confirm\\s+(?:your\\s+)?unsub|click\\s+(?:below\\s+)?to\\s+(?:confirm|unsubscribe)|g[eé]rer\\s+(?:vos|mes)\\s+pr[eé]f[eé]rences|update\\s+(?:your\\s+)?preferences",
        Pattern.CASE_INSENSITIVE
    );
    private static final Pattern CONFIRMED_UNSUB_RE = Pattern.compile(
        "vous\\s+[eê]tes\\s+(?:maintenant\\s+|bien\\s+|officiellement\\s+)?d[eé]s(?:inscri|abonn)|votre\\s+d[eé]s(?:inscription|abonnement)\\s+(?:a\\s+[eé]t[eé]\\s+|est\\s+)?(?:confirm[eé]|enregistr[eé]|prise?\\s+en\\s+compte|effectu[eé]|valid[eé])|vous\\s+ne\\s+recevrez\\s+plus|successfully\\s+unsubscribed|you\\s+have\\s+been\\s+unsubscribed|unsubscribed\\s+successfully|opt[- ]?out\\s+(?:confirmed|complete|successful)",
        Pattern.CASE_INSENSITIVE
    );

    public static HttpProbeResult probeHttp(String urlStr, String method) {
        HttpProbeResult res = new HttpProbeResult();
        res.finalUrl = urlStr;
        if (urlStr == null || (!urlStr.startsWith("https://") && !urlStr.startsWith("http://"))) {
            res.outcome = "error";
            res.reason = "URL invalide";
            return res;
        }
        String currentUrl = urlStr;
        String activeMethod = "POST".equals(method) ? "POST" : "GET";
        for (int hop = 0; hop < 6; hop++) {
            HttpURLConnection conn = null;
            try {
                URL url = new URL(currentUrl);
                conn = (HttpURLConnection) url.openConnection();
                conn.setRequestMethod(activeMethod);
                conn.setConnectTimeout(10_000);
                conn.setReadTimeout(10_000);
                conn.setInstanceFollowRedirects(false);
                conn.setRequestProperty("User-Agent", "Mozilla/5.0 (Linux; Android 14) SortBoxEmail/0.2");
                conn.setRequestProperty("Accept", "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8");
                if ("POST".equals(activeMethod)) {
                    conn.setDoOutput(true);
                    conn.setRequestProperty("Content-Type", "application/x-www-form-urlencoded");
                    byte[] payload = "List-Unsubscribe=One-Click".getBytes(StandardCharsets.UTF_8);
                    conn.setRequestProperty("Content-Length", String.valueOf(payload.length));
                    try (OutputStream os = conn.getOutputStream()) {
                        os.write(payload);
                    }
                }
                int code = conn.getResponseCode();
                if (code == 301 || code == 302 || code == 303 || code == 307 || code == 308) {
                    String loc = conn.getHeaderField("Location");
                    if (loc != null && !loc.trim().isEmpty()) {
                        URL next = new URL(url, loc.trim());
                        String nextProto = next.getProtocol().toLowerCase(Locale.US);
                        if ("https".equals(nextProto) || "http".equals(nextProto)) {
                            currentUrl = next.toString();
                            if (code == 301 || code == 302 || code == 303) {
                                activeMethod = "GET";
                            }
                            continue;
                        }
                    }
                }

                res.reachable = true;
                res.statusCode = code;
                res.finalUrl = currentUrl;
                String body = readLimitedBody(code >= 400 ? conn.getErrorStream() : conn.getInputStream(), 128 * 1024);
                classifyHttpResponse(res, code, body);
                return res;
            } catch (Exception e) {
                res.reachable = false;
                res.outcome = "expired";
                res.reason = e.getMessage() != null && e.getMessage().toLowerCase(Locale.US).contains("unable to resolve host")
                    ? "Domaine injoignable ou expiré"
                    : (e.getMessage() != null ? e.getMessage() : "Connexion impossible");
                return res;
            } finally {
                if (conn != null) conn.disconnect();
            }
        }
        res.outcome = "error";
        res.reason = "Trop de redirections HTTP.";
        return res;
    }

    private static String readLimitedBody(InputStream is, int maxBytes) {
        if (is == null) return "";
        try (InputStream in = is; ByteArrayOutputStream baos = new ByteArrayOutputStream()) {
            byte[] buf = new byte[4096];
            int total = 0;
            int n;
            while (total < maxBytes && (n = in.read(buf, 0, Math.min(buf.length, maxBytes - total))) != -1) {
                baos.write(buf, 0, n);
                total += n;
            }
            return baos.toString(StandardCharsets.UTF_8.name());
        } catch (Exception e) {
            return "";
        }
    }

    private static void classifyHttpResponse(HttpProbeResult res, int statusCode, String rawBody) {
        if (statusCode == 404 || statusCode == 410) {
            res.outcome = "expired";
            res.reason = "Lien expiré ou introuvable (HTTP " + statusCode + ").";
            return;
        }
        if (statusCode >= 500) {
            res.outcome = "error";
            res.reason = "Erreur temporaire du serveur expéditeur (HTTP " + statusCode + ").";
            return;
        }
        String cleaned = rawBody
            .replaceAll("(?is)<script[^>]*>[\\s\\S]*?</script>", " ")
            .replaceAll("(?is)<style[^>]*>[\\s\\S]*?</style>", " ");
        String visible = cleaned.replaceAll("<[^>]+>", " ").replaceAll("\\s+", " ").trim();

        if (statusCode == 401 || statusCode == 403 || statusCode == 405 || statusCode == 429) {
            if (EXPIRED_PAGE_RE.matcher(visible).find()) {
                res.outcome = "expired";
                res.reason = "Ce lien semble expiré (HTTP " + statusCode + ").";
            } else {
                res.outcome = "needs_manual";
                res.reason = "Accès protégé (HTTP " + statusCode + ") — ouvre la page dans le navigateur.";
            }
            return;
        }

        if (ALREADY_UNSUB_RE.matcher(visible).find()) {
            res.outcome = "already_unsubscribed";
            res.reason = "Vérifié : le site indique que tu es déjà désinscrit.";
            return;
        }
        if (EXPIRED_PAGE_RE.matcher(visible).find()) {
            res.outcome = "expired";
            res.reason = "La page retournée indique que le lien est expiré ou introuvable.";
            return;
        }
        if (CONFIRMED_UNSUB_RE.matcher(visible).find() && !HAS_FORM_PROMPT_RE.matcher(cleaned).find()) {
            res.outcome = "confirmed";
            res.reason = "Désinscription vérifiée et confirmée par la réponse du site.";
            return;
        }
        res.outcome = "needs_manual";
        res.reason = "Page active vérifiée — confirmation requise dans le navigateur.";
    }

    private static void extractBodyText(Part part, StringBuilder out, int maxChars) {
        if (part == null || out.length() >= maxChars) return;
        try {
            Object content = part.getContent();
            if (content instanceof String) {
                String str = (String) content;
                int remain = maxChars - out.length();
                if (str.length() > remain) str = str.substring(0, remain);
                out.append(str).append("\n");
            } else if (content instanceof Multipart) {
                Multipart mp = (Multipart) content;
                for (int i = 0; i < mp.getCount() && out.length() < maxChars; i++) {
                    extractBodyText(mp.getBodyPart(i), out, maxChars);
                }
            }
        } catch (Exception ignored) {}
    }

    private static UnsubscribeInfo extractFromBody(String body) {
        UnsubscribeInfo info = new UnsubscribeInfo();
        if (body == null || body.isEmpty()) return info;

        String bestUrl = null;
        int bestScore = -1;
        String mailtoFallback = null;

        Matcher am = ANCHOR_PATTERN.matcher(body);
        while (am.find()) {
            String rawHref = am.group(1);
            String anchorText = am.group(2).replaceAll("<[^>]+>", " ").replaceAll("\\s+", " ").trim();
            int start = am.start();
            String context = body.substring(Math.max(0, start - 120), Math.min(body.length(), start + 220))
                .replaceAll("<[^>]+>", " ").replaceAll("\\s+", " ").trim();

            String mailto = sanitizeMailto(rawHref);
            if (mailto != null && mailtoFallback == null &&
                (UNSUB_KEYWORDS.matcher(anchorText).find() || UNSUB_KEYWORDS.matcher(context).find())) {
                mailtoFallback = mailto;
                continue;
            }
            String url = sanitizeHttpUrl(rawHref);
            if (url == null) continue;

            int score = 0;
            if (UNSUB_KEYWORDS.matcher(anchorText).find()) score += 10;
            if (UNSUB_URL_HINT.matcher(url).find()) score += 6;
            if (UNSUB_KEYWORDS.matcher(context).find()) score += 3;
            if (url.startsWith("https://")) score += 1;

            if (score >= 6 && score > bestScore) {
                bestScore = score;
                bestUrl = url;
            }
        }

        if (bestUrl == null) {
            Matcher bm = BARE_URL_PATTERN.matcher(body);
            while (bm.find()) {
                int start = bm.start();
                String context = body.substring(Math.max(0, start - 120), Math.min(body.length(), start + 80));
                String url = sanitizeHttpUrl(bm.group(1));
                if (url == null) continue;
                if (UNSUB_KEYWORDS.matcher(context).find() || UNSUB_URL_HINT.matcher(url).find()) {
                    bestUrl = url;
                    break;
                }
            }
        }

        info.unsubscribeUrl = bestUrl;
        info.unsubscribeMailto = mailtoFallback;
        info.hasUnsubscribe = bestUrl != null || mailtoFallback != null;
        info.fromBody = info.hasUnsubscribe;
        return info;
    }

    private IMAPStore openStore(
        String host,
        int port,
        boolean secure,
        String email,
        String secret,
        boolean isOAuth
    ) throws MessagingException {
        Properties props = new Properties();
        String proto = secure ? "imaps" : "imap";
        props.put("mail.store.protocol", proto);
        props.put("mail." + proto + ".host", host);
        props.put("mail." + proto + ".port", String.valueOf(port));
        props.put("mail." + proto + ".connectiontimeout", "20000");
        props.put("mail." + proto + ".timeout", "35000");
        props.put("mail." + proto + ".ssl.enable", String.valueOf(secure));
        if (!secure) {
            props.put("mail.imap.starttls.enable", "true");
        }
        if (isOAuth) {
            props.put("mail." + proto + ".auth.mechanisms", "XOAUTH2");
        }
        Session session = Session.getInstance(props);
        Store store = session.getStore(proto);
        store.connect(host, port, email, secret);
        return (IMAPStore) store;
    }

    public JSObject testConnection(
        String host,
        int port,
        boolean secure,
        String email,
        String secret,
        boolean isOAuth
    ) throws Exception {
        IMAPStore store = openStore(host, port, secure, email, secret, isOAuth);
        try {
            Folder[] list = store.getDefaultFolder().list("*");
            JSArray folders = new JSArray();
            for (Folder f : list) {
                folders.put(f.getFullName());
            }
            JSObject res = new JSObject();
            res.put("ok", true);
            res.put("folderCount", list.length);
            res.put("folders", folders);
            return res;
        } finally {
            try { store.close(); } catch (Exception ignored) {}
        }
    }

    private String findSpecialAttr(IMAPFolder f) {
        try {
            String[] attrs = f.getAttributes();
            if (attrs == null) return null;
            for (String a : attrs) {
                if ("\\Trash".equalsIgnoreCase(a)) return "\\Trash";
                if ("\\Junk".equalsIgnoreCase(a)) return "\\Junk";
                if ("\\Sent".equalsIgnoreCase(a)) return "\\Sent";
                if ("\\Drafts".equalsIgnoreCase(a)) return "\\Drafts";
                if ("\\Archive".equalsIgnoreCase(a)) return "\\Archive";
                if ("\\All".equalsIgnoreCase(a)) return "\\All";
            }
        } catch (Exception ignored) {}
        return null;
    }

    private boolean isNoselect(IMAPFolder f) {
        try {
            String[] attrs = f.getAttributes();
            if (attrs == null) return false;
            for (String a : attrs) {
                if ("\\Noselect".equalsIgnoreCase(a)) return true;
            }
        } catch (Exception ignored) {}
        return false;
    }

    public JSObject syncAccount(
        AndroidMailDatabase db,
        JSObject account,
        String secret,
        String folderPath,
        int limit,
        SyncProgressListener listener
    ) throws Exception {
        String accountId = account.getString("id");
        String email = account.getString("email");
        String host = account.getString("imapHost");
        int port = account.getInt("imapPort");
        boolean secure = account.getBoolean("imapSecure");
        boolean isOAuth = !"imap_password".equals(account.getString("authMode"));
        String targetFolder = (folderPath == null || folderPath.isEmpty()) ? "INBOX" : folderPath;

        db.updateAccountSyncStatus(accountId, "syncing", null);
        emitSync(listener, accountId, targetFolder, 0, 0, "connecting", "Connexion à " + host + "...");

        IMAPStore store = null;
        try {
            store = openStore(host, port, secure, email, secret, isOAuth);
            Folder[] allFolders = store.getDefaultFolder().list("*");
            List<JSObject> folderModels = new ArrayList<>();
            JSArray folderJs = new JSArray();

            for (Folder f : allFolders) {
                if (!(f instanceof IMAPFolder)) continue;
                IMAPFolder imapF = (IMAPFolder) f;
                if (isNoselect(imapF)) continue;
                String special = findSpecialAttr(imapF);
                int totalCount = 0;
                int unseenCount = 0;
                try {
                    totalCount = f.getMessageCount();
                    unseenCount = f.getUnreadMessageCount();
                } catch (Exception ignored) {}

                JSObject fm = new JSObject();
                fm.put("accountId", accountId);
                fm.put("rawPath", f.getFullName());
                fm.put("name", f.getFullName());
                fm.put("delimiter", String.valueOf(f.getSeparator()));
                fm.put("specialUse", special == null ? org.json.JSONObject.NULL : special);
                fm.put("totalMessages", totalCount);
                fm.put("unseenMessages", unseenCount);
                folderModels.add(fm);
                folderJs.put(fm);
            }
            db.replaceFolders(accountId, folderModels);

            IMAPFolder target = (IMAPFolder) store.getFolder(targetFolder);
            if (!target.exists()) {
                throw new IllegalStateException("Dossier introuvable : " + targetFolder);
            }
            target.open(Folder.READ_ONLY);

            int totalInFolder = 0;
            int newlyFetched = 0;

            try {
                Message[] allMsgs = target.getMessages();
                totalInFolder = allMsgs.length;
                if (allMsgs.length > 0) {
                    FetchProfile uidFp = new FetchProfile();
                    uidFp.add(UIDFolder.FetchProfileItem.UID);
                    target.fetch(allMsgs, uidFp);
                }

                // Process newest first
                List<Message> ordered = new ArrayList<>(Arrays.asList(allMsgs));
                Collections.reverse(ordered);
                if (limit > 0 && ordered.size() > limit) {
                    ordered = ordered.subList(0, limit);
                }

                Set<Long> cached = db.getCachedUids(accountId, targetFolder);
                List<Message> pending = new ArrayList<>();
                for (Message m : ordered) {
                    long uid = target.getUID(m);
                    if (uid > 0 && !cached.contains(uid)) {
                        pending.add(m);
                    }
                }

                int totalTarget = ordered.size();
                int alreadyDone = totalTarget - pending.size();
                emitSync(
                    listener,
                    accountId,
                    targetFolder,
                    alreadyDone,
                    totalTarget,
                    "syncing",
                    pending.isEmpty() ? "Cache déjà à jour." : "Récupération de " + pending.size() + " en-têtes..."
                );

                FetchProfile headerFp = new FetchProfile();
                headerFp.add(FetchProfile.Item.ENVELOPE);
                headerFp.add(FetchProfile.Item.FLAGS);
                headerFp.add(FetchProfile.Item.SIZE);
                headerFp.add("List-Unsubscribe");
                headerFp.add("List-Unsubscribe-Post");
                headerFp.add("Message-ID");

                SimpleDateFormat isoFmt = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US);
                isoFmt.setTimeZone(TimeZone.getTimeZone("UTC"));

                int batchSize = 120;
                for (int i = 0; i < pending.size(); i += batchSize) {
                    List<Message> batch = pending.subList(i, Math.min(pending.size(), i + batchSize));
                    Message[] batchArr = batch.toArray(new Message[0]);
                    target.fetch(batchArr, headerFp);

                    List<ContentValues> rows = new ArrayList<>();
                    for (Message m : batchArr) {
                        long uid = target.getUID(m);
                        if (uid <= 0) continue;

                        String fromRaw = "";
                        String fromName = "";
                        String fromAddr = "";
                        try {
                            Address[] froms = m.getFrom();
                            if (froms != null && froms.length > 0) {
                                if (froms[0] instanceof InternetAddress) {
                                    InternetAddress ia = (InternetAddress) froms[0];
                                    fromAddr = ia.getAddress() != null ? ia.getAddress().trim().toLowerCase(Locale.US) : "";
                                    fromName = ia.getPersonal() != null ? ia.getPersonal().trim() : "";
                                    fromRaw = !fromName.isEmpty() && !fromAddr.isEmpty()
                                        ? fromName + " <" + fromAddr + ">"
                                        : (!fromAddr.isEmpty() ? fromAddr : fromName);
                                } else {
                                    fromRaw = froms[0].toString();
                                    fromAddr = fromRaw.trim().toLowerCase(Locale.US);
                                }
                            }
                        } catch (Exception ignored) {}

                        int atIdx = fromAddr.indexOf('@');
                        String domain = atIdx >= 0 ? fromAddr.substring(atIdx + 1) : "";
                        String subject = "";
                        try {
                            subject = m.getSubject() != null ? m.getSubject().trim() : "(Sans objet)";
                        } catch (Exception e) {
                            subject = "(Sans objet)";
                        }

                        String messageId = "";
                        try {
                            String[] mids = m.getHeader("Message-ID");
                            if (mids != null && mids.length > 0 && mids[0] != null) {
                                messageId = mids[0].trim();
                            }
                        } catch (Exception ignored) {}

                        UnsubscribeInfo unsub = new UnsubscribeInfo();
                        try {
                            String[] unsubs = m.getHeader("List-Unsubscribe");
                            String[] unsubPosts = m.getHeader("List-Unsubscribe-Post");
                            String unsubVal = (unsubs != null && unsubs.length > 0) ? unsubs[0] : null;
                            String postVal = (unsubPosts != null && unsubPosts.length > 0) ? unsubPosts[0] : null;
                            unsub = parseListUnsubscribeHeaders(unsubVal, postVal);
                        } catch (Exception ignored) {}

                        Date dt = null;
                        try {
                            dt = m.getSentDate() != null ? m.getSentDate() : m.getReceivedDate();
                        } catch (Exception ignored) {}
                        long dateTs = dt != null ? dt.getTime() : 0L;
                        String dateIso = dt != null ? isoFmt.format(dt) : "";

                        boolean seen = false;
                        boolean flagged = false;
                        try {
                            seen = m.isSet(Flags.Flag.SEEN);
                            flagged = m.isSet(Flags.Flag.FLAGGED);
                        } catch (Exception ignored) {}

                        int sizeBytes = 0;
                        try { sizeBytes = Math.max(0, m.getSize()); } catch (Exception ignored) {}

                        ContentValues cv = new ContentValues();
                        cv.put("account_id", accountId);
                        cv.put("folder_path", targetFolder);
                        cv.put("uid", uid);
                        cv.put("message_id", messageId);
                        cv.put("from_raw", fromRaw);
                        cv.put("from_name", fromName);
                        cv.put("from_addr", fromAddr);
                        cv.put("domain", domain);
                        cv.put("to_raw", email);
                        cv.put("subject", subject);
                        cv.put("date_iso", dateIso);
                        cv.put("date_ts", dateTs);
                        cv.put("size_bytes", sizeBytes);
                        cv.put("seen", seen ? 1 : 0);
                        cv.put("flagged", flagged ? 1 : 0);
                        cv.put("has_unsubscribe", unsub.hasUnsubscribe ? 1 : 0);
                        if (unsub.unsubscribeUrl != null) cv.put("unsubscribe_url", unsub.unsubscribeUrl);
                        else cv.putNull("unsubscribe_url");
                        if (unsub.unsubscribeMailto != null) cv.put("unsubscribe_mailto", unsub.unsubscribeMailto);
                        else cv.putNull("unsubscribe_mailto");
                        cv.put("unsubscribe_one_click", unsub.unsubscribeOneClick ? 1 : 0);
                        rows.add(cv);
                    }

                    if (!rows.isEmpty()) {
                        db.upsertEmails(rows);
                        newlyFetched += rows.size();
                    }

                    int progressCount = Math.min(totalTarget, alreadyDone + i + batch.size());
                    emitSync(listener, accountId, targetFolder, progressCount, totalTarget, "syncing", null);
                }
            } finally {
                try { target.close(false); } catch (Exception ignored) {}
            }

            db.updateAccountSyncStatus(accountId, "ok", null);
            emitSync(listener, accountId, targetFolder, totalInFolder, totalInFolder, "done", "Audit terminé.");

            JSObject out = new JSObject();
            out.put("folders", folderJs);
            out.put("newlyFetched", newlyFetched);
            out.put("totalInFolder", totalInFolder);
            return out;
        } catch (Exception e) {
            db.updateAccountSyncStatus(accountId, "error", e.getMessage());
            emitSync(listener, accountId, targetFolder, 0, 0, "error", e.getMessage());
            throw e;
        } finally {
            if (store != null) {
                try { store.close(); } catch (Exception ignored) {}
            }
        }
    }

    private IMAPFolder resolveDestinationFolder(IMAPStore store, String destFolder) throws MessagingException {
        Folder[] listed = store.getDefaultFolder().list("*");
        List<IMAPFolder> imapFolders = new ArrayList<>();
        boolean isGmail = false;
        boolean systemInboxRooted = false;
        char delim = '/';

        for (Folder f : listed) {
            if (f instanceof IMAPFolder) {
                IMAPFolder imf = (IMAPFolder) f;
                imapFolders.add(imf);
                String p = f.getFullName();
                if (p.toLowerCase(Locale.US).startsWith("[gmail]")) isGmail = true;
                String attr = findSpecialAttr(imf);
                if (("\\Trash".equals(attr) || "\\Sent".equals(attr) || "\\Drafts".equals(attr)) &&
                    (p.toUpperCase(Locale.US).startsWith("INBOX/") || p.toUpperCase(Locale.US).startsWith("INBOX."))) {
                    systemInboxRooted = true;
                }
                if (delim == '/' && f.getSeparator() != 0) delim = f.getSeparator();
            }
        }

        String lowerDest = destFolder == null ? "" : destFolder.trim().toLowerCase(Locale.US);
        if (TRASH_ALIASES.contains(lowerDest)) {
            IMAPFolder f = findSpecialOrByNames(imapFolders, "\\Trash", Arrays.asList(
                "[gmail]/corbeille", "[gmail]/trash", "corbeille", "trash", "deleted",
                "deleted items", "deleted messages", "éléments supprimés", "inbox/trash", "inbox.trash"
            ));
            if (f != null) return f;
            return createFolderIfMissing(store, systemInboxRooted ? "INBOX" + delim + "Trash" : "Trash");
        }
        if (JUNK_ALIASES.contains(lowerDest)) {
            IMAPFolder f = findSpecialOrByNames(imapFolders, "\\Junk", Arrays.asList(
                "[gmail]/spam", "spam", "junk", "junk email", "courrier indésirable", "inbox/spam", "inbox.spam"
            ));
            if (f != null) return f;
            return createFolderIfMissing(store, "Spam");
        }
        if (ARCHIVE_ALIASES.contains(lowerDest)) {
            IMAPFolder f = findSpecialOrByNames(imapFolders, "\\Archive", Arrays.asList(
                "[gmail]/tous les messages", "[gmail]/all mail", "archive", "archives", "inbox/archive", "inbox.archive"
            ));
            if (f != null) return f;
            return createFolderIfMissing(store, "Archives");
        }

        for (IMAPFolder f : imapFolders) {
            if (f.getFullName().equalsIgnoreCase(destFolder.trim())) {
                return f;
            }
        }

        String normalized = destFolder.trim();
        if ((isGmail || !systemInboxRooted) &&
            (normalized.toUpperCase(Locale.US).startsWith("INBOX/") || normalized.toUpperCase(Locale.US).startsWith("INBOX."))) {
            normalized = normalized.substring(6);
        } else if (!isGmail && systemInboxRooted &&
            !normalized.toUpperCase(Locale.US).startsWith("INBOX/") &&
            !normalized.toUpperCase(Locale.US).startsWith("INBOX.")) {
            normalized = "INBOX" + delim + normalized;
        }

        for (IMAPFolder f : imapFolders) {
            if (f.getFullName().equalsIgnoreCase(normalized)) {
                return f;
            }
        }

        if (delim != '/') {
            normalized = normalized.replace('/', delim);
        }
        return createFolderIfMissing(store, normalized);
    }

    private IMAPFolder findSpecialOrByNames(
        List<IMAPFolder> folders,
        String specialAttr,
        List<String> fallbackNames
    ) {
        for (IMAPFolder f : folders) {
            if (specialAttr.equals(findSpecialAttr(f))) return f;
        }
        for (String name : fallbackNames) {
            for (IMAPFolder f : folders) {
                if (f.getFullName().equalsIgnoreCase(name)) return f;
            }
        }
        return null;
    }

    private IMAPFolder createFolderIfMissing(IMAPStore store, String fullPath) throws MessagingException {
        IMAPFolder target = (IMAPFolder) store.getFolder(fullPath);
        if (!target.exists()) {
            target.create(Folder.HOLDS_MESSAGES);
            target.setSubscribed(true);
        }
        return target;
    }

    public String moveUidsInWaves(
        JSObject account,
        String secret,
        String sourceFolder,
        String destFolder,
        List<Long> uids,
        int batchSize,
        int delayMs
    ) throws Exception {
        if (uids.isEmpty()) return destFolder;
        String email = account.getString("email");
        String host = account.getString("imapHost");
        int port = account.getInt("imapPort");
        boolean secure = account.getBoolean("imapSecure");
        boolean isOAuth = !"imap_password".equals(account.getString("authMode"));

        IMAPStore store = openStore(host, port, secure, email, secret, isOAuth);
        try {
            IMAPFolder dest = resolveDestinationFolder(store, destFolder);
            String resolvedDest = dest.getFullName();
            if (resolvedDest.equalsIgnoreCase(sourceFolder)) {
                return resolvedDest;
            }

            IMAPFolder src = (IMAPFolder) store.getFolder(sourceFolder);
            src.open(Folder.READ_WRITE);
            try {
                int safeBatch = Math.max(10, Math.min(batchSize > 0 ? batchSize : 100, 200));
                for (int i = 0; i < uids.size(); i += safeBatch) {
                    List<Long> sub = uids.subList(i, Math.min(uids.size(), i + safeBatch));
                    long[] arr = new long[sub.size()];
                    for (int j = 0; j < sub.size(); j++) arr[j] = sub.get(j);
                    Message[] rawMsgs = src.getMessagesByUID(arr);
                    List<Message> valid = new ArrayList<>();
                    for (Message m : rawMsgs) {
                        if (m != null) valid.add(m);
                    }
                    if (!valid.isEmpty()) {
                        Message[] validArr = valid.toArray(new Message[0]);
                        try {
                            src.moveMessages(validArr, dest);
                        } catch (MessagingException moveErr) {
                            src.copyMessages(validArr, dest);
                            src.setFlags(validArr, new Flags(Flags.Flag.DELETED), true);
                            src.expunge();
                        }
                    }
                    if (delayMs > 0 && i + safeBatch < uids.size()) {
                        Thread.sleep(delayMs);
                    }
                }
            } finally {
                try { src.close(true); } catch (Exception ignored) {}
            }
            return resolvedDest;
        } finally {
            try { store.close(); } catch (Exception ignored) {}
        }
    }

    public int undoMoveByMessageIds(
        JSObject account,
        String secret,
        String sourceFolder,
        String destFolder,
        List<String> messageIds
    ) throws Exception {
        if (messageIds.isEmpty()) {
            throw new IllegalStateException("Aucun Message-ID enregistré pour annuler ce lot.");
        }
        String email = account.getString("email");
        String host = account.getString("imapHost");
        int port = account.getInt("imapPort");
        boolean secure = account.getBoolean("imapSecure");
        boolean isOAuth = !"imap_password".equals(account.getString("authMode"));

        IMAPStore store = openStore(host, port, secure, email, secret, isOAuth);
        try {
            IMAPFolder src = (IMAPFolder) store.getFolder(sourceFolder);
            IMAPFolder dest = (IMAPFolder) store.getFolder(destFolder);
            dest.open(Folder.READ_WRITE);
            int restored = 0;
            try {
                List<Message> found = new ArrayList<>();
                int maxLookup = Math.min(messageIds.size(), 150);
                for (int i = 0; i < maxLookup; i++) {
                    Message[] matched = dest.search(new HeaderTerm("Message-ID", messageIds.get(i)));
                    if (matched != null) {
                        found.addAll(Arrays.asList(matched));
                    }
                }
                if (found.isEmpty()) {
                    throw new IllegalStateException("Messages introuvables dans " + destFolder);
                }
                Message[] arr = found.toArray(new Message[0]);
                try {
                    dest.moveMessages(arr, src);
                } catch (MessagingException e) {
                    dest.copyMessages(arr, src);
                    dest.setFlags(arr, new Flags(Flags.Flag.DELETED), true);
                    dest.expunge();
                }
                restored = arr.length;
            } finally {
                try { dest.close(true); } catch (Exception ignored) {}
            }
            return restored;
        } finally {
            try { store.close(); } catch (Exception ignored) {}
        }
    }

    public List<UnsubscribeCandidate> findLatestUnsubscribeCandidates(
        JSObject account,
        String secret,
        String folderPath,
        String matchValue,
        List<Long> cachedUids,
        int limit
    ) throws Exception {
        String email = account.getString("email");
        String host = account.getString("imapHost");
        int port = account.getInt("imapPort");
        boolean secure = account.getBoolean("imapSecure");
        boolean isOAuth = !"imap_password".equals(account.getString("authMode"));
        int maxCandidates = Math.min(Math.max(limit > 0 ? limit : 5, 1), 8);

        IMAPStore store = openStore(host, port, secure, email, secret, isOAuth);
        try {
            IMAPFolder folder = (IMAPFolder) store.getFolder(folderPath);
            folder.open(Folder.READ_ONLY);
            try {
                Set<Long> mergedSet = new LinkedHashSet<>();
                if (matchValue != null && !matchValue.trim().isEmpty()) {
                    try {
                        Message[] matched = folder.search(new FromStringTerm(matchValue.trim()));
                        if (matched != null) {
                            for (Message m : matched) {
                                long uid = folder.getUID(m);
                                if (uid > 0) mergedSet.add(uid);
                            }
                        }
                    } catch (Exception ignored) {}
                }
                if (cachedUids != null) {
                    for (Long u : cachedUids) {
                        if (u != null && u > 0) mergedSet.add(u);
                    }
                }
                List<Long> sorted = new ArrayList<>(mergedSet);
                Collections.sort(sorted, Collections.reverseOrder());
                if (sorted.size() > maxCandidates) {
                    sorted = sorted.subList(0, maxCandidates);
                }

                SimpleDateFormat isoFmt = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US);
                isoFmt.setTimeZone(TimeZone.getTimeZone("UTC"));

                List<UnsubscribeCandidate> out = new ArrayList<>();
                for (Long uid : sorted) {
                    Message msg = folder.getMessageByUID(uid);
                    if (msg == null) continue;

                    Date dt = null;
                    try {
                        dt = msg.getSentDate() != null ? msg.getSentDate() : msg.getReceivedDate();
                    } catch (Exception ignored) {}
                    String dateIso = dt != null ? isoFmt.format(dt) : "";

                    String[] unsubs = msg.getHeader("List-Unsubscribe");
                    String[] unsubPosts = msg.getHeader("List-Unsubscribe-Post");
                    String unsubVal = (unsubs != null && unsubs.length > 0) ? unsubs[0] : null;
                    String postVal = (unsubPosts != null && unsubPosts.length > 0) ? unsubPosts[0] : null;
                    UnsubscribeInfo info = parseListUnsubscribeHeaders(unsubVal, postVal);

                    if (info.unsubscribeUrl == null && info.unsubscribeMailto == null && out.size() < 3) {
                        StringBuilder bodyBuf = new StringBuilder();
                        extractBodyText(msg, bodyBuf, 256 * 1024);
                        UnsubscribeInfo bodyInfo = extractFromBody(bodyBuf.toString());
                        bodyInfo.hasUnsubscribe = bodyInfo.hasUnsubscribe || info.hasUnsubscribe;
                        info = bodyInfo;
                    }

                    if (info.unsubscribeUrl != null || info.unsubscribeMailto != null) {
                        UnsubscribeCandidate cand = new UnsubscribeCandidate();
                        cand.uid = uid;
                        cand.info = info;
                        cand.dateIso = dateIso;
                        out.add(cand);
                    }
                }
                return out;
            } finally {
                try { folder.close(false); } catch (Exception ignored) {}
            }
        } finally {
            try { store.close(); } catch (Exception ignored) {}
        }
    }

    private void emitSync(
        SyncProgressListener listener,
        String accountId,
        String folderPath,
        int fetched,
        int total,
        String status,
        String message
    ) {
        if (listener == null) return;
        JSObject ev = new JSObject();
        ev.put("accountId", accountId);
        ev.put("folderPath", folderPath);
        ev.put("fetched", fetched);
        ev.put("total", total);
        ev.put("status", status);
        if (message != null) ev.put("message", message);
        listener.onProgress(ev);
    }
}
