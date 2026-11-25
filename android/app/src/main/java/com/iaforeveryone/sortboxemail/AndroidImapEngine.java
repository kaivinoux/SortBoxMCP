package com.iaforeveryone.sortboxemail;

import android.content.ContentValues;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.sun.mail.imap.IMAPFolder;
import com.sun.mail.imap.IMAPStore;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.Date;
import java.util.HashSet;
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
import javax.mail.Session;
import javax.mail.Store;
import javax.mail.UIDFolder;
import javax.mail.internet.InternetAddress;
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

    private static final Pattern UNSUB_URL_PATTERN = Pattern.compile("<(https?://[^>]+)>", Pattern.CASE_INSENSITIVE);

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

                        boolean hasUnsub = false;
                        String unsubUrl = null;
                        try {
                            String[] unsubs = m.getHeader("List-Unsubscribe");
                            if (unsubs != null && unsubs.length > 0 && unsubs[0] != null && !unsubs[0].trim().isEmpty()) {
                                hasUnsub = true;
                                Matcher matcher = UNSUB_URL_PATTERN.matcher(unsubs[0]);
                                if (matcher.find()) {
                                    unsubUrl = matcher.group(1);
                                }
                            }
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
                        cv.put("has_unsubscribe", hasUnsub ? 1 : 0);
                        if (unsubUrl != null) cv.put("unsubscribe_url", unsubUrl);
                        else cv.putNull("unsubscribe_url");
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
