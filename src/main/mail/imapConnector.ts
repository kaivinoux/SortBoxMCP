import { ImapFlow, type ListResponse } from "imapflow";
import {
  isArchiveDestination,
  isJunkDestination,
  isTrashDestination,
} from "../../shared/folders.js";
import {
  extractUnsubscribeFromRawMessage,
  parseListUnsubscribeFromHeaderBlock,
  type ParsedUnsubscribeInfo,
} from "../../shared/unsubscribeUtils.js";
import type {
  EmailHeaderRecord,
  FolderInfo,
  MailAccount,
  SyncProgressEvent,
} from "../../shared/types.js";
import type { AppDatabase } from "../db/database.js";
import { refreshMicrosoftToken } from "../credentials/microsoftOAuth.js";
import type { SecretPayload, SecretVault } from "../credentials/vault.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface FolderResolutionCandidate {
  path: string;
  delimiter?: string;
  specialUse?: string | null;
  flags?: Set<string> | string[];
}

function hasImapFlag(candidate: FolderResolutionCandidate, flag: string): boolean {
  if (candidate.specialUse?.toLowerCase() === flag.toLowerCase()) return true;
  if (!candidate.flags) return false;
  if (candidate.flags instanceof Set) {
    for (const f of candidate.flags) {
      if (f.toLowerCase() === flag.toLowerCase()) return true;
    }
    return false;
  }
  return candidate.flags.some((f) => f.toLowerCase() === flag.toLowerCase());
}

export function resolveFolderTarget(params: {
  destFolder: string;
  listedFolders: FolderResolutionCandidate[];
  isGmail?: boolean;
  namespacePrefix?: string;
}): { existingPath: string | null; createPath: string | string[] } {
  const { destFolder, listedFolders, namespacePrefix } = params;
  const isGmail =
    params.isGmail ||
    listedFolders.some((f) => f.path.toLowerCase().startsWith("[gmail]"));

  const findBySpecialOrNames = (
    specialFlag: string,
    fallbackNames: string[],
  ): string | null => {
    const bySpecial = listedFolders.find((f) => hasImapFlag(f, specialFlag));
    if (bySpecial) return bySpecial.path;
    for (const candidateName of fallbackNames) {
      const found = listedFolders.find(
        (f) => f.path.toLowerCase() === candidateName,
      );
      if (found) return found.path;
    }
    return null;
  };

  if (isTrashDestination(destFolder)) {
    const trash = findBySpecialOrNames("\\Trash", [
      "[gmail]/corbeille",
      "[gmail]/trash",
      "corbeille",
      "trash",
      "deleted",
      "deleted items",
      "deleted messages",
      "éléments supprimés",
      "inbox/trash",
      "inbox.trash",
      "inbox/corbeille",
      "inbox.corbeille",
    ]);
    if (trash) return { existingPath: trash, createPath: trash };
    return { existingPath: null, createPath: "Trash" };
  }

  if (isJunkDestination(destFolder)) {
    const junk = findBySpecialOrNames("\\Junk", [
      "[gmail]/spam",
      "spam",
      "junk",
      "junk email",
      "courrier indésirable",
      "inbox/spam",
      "inbox.spam",
      "inbox/junk",
      "inbox.junk",
    ]);
    if (junk) return { existingPath: junk, createPath: junk };
    return { existingPath: null, createPath: "Spam" };
  }

  if (isArchiveDestination(destFolder)) {
    const archive = findBySpecialOrNames("\\Archive", [
      "[gmail]/tous les messages",
      "[gmail]/all mail",
      "archive",
      "archives",
      "inbox/archive",
      "inbox.archive",
    ]);
    if (archive) return { existingPath: archive, createPath: archive };
    return { existingPath: null, createPath: "Archives" };
  }

  // Exact match
  const exact = listedFolders.find(
    (f) => f.path.toLowerCase() === destFolder.trim().toLowerCase(),
  );
  if (exact) {
    return { existingPath: exact.path, createPath: exact.path };
  }

  // Check whether system folders live under INBOX/ or INBOX.
  const systemInboxRooted = listedFolders.some(
    (f) =>
      (hasImapFlag(f, "\\Trash") ||
        hasImapFlag(f, "\\Sent") ||
        hasImapFlag(f, "\\Drafts")) &&
      (f.path.toUpperCase().startsWith("INBOX/") ||
        f.path.toUpperCase().startsWith("INBOX.")),
  );
  const nsInboxRooted = Boolean(
    namespacePrefix?.toUpperCase().startsWith("INBOX"),
  );
  const isInboxRooted = !isGmail && (nsInboxRooted || systemInboxRooted);

  let segments = destFolder
    .split(/[./]/)
    .map((s) => s.trim())
    .filter(Boolean);

  if (!segments.length) {
    segments = ["SortBox"];
  }

  if (segments[0].toUpperCase() === "INBOX" && !isInboxRooted) {
    segments = segments.slice(1);
    if (!segments.length) segments = ["SortBox"];
  }

  // Also check if stripped name already exists (e.g., "Factures" when "INBOX/Factures" was requested on Gmail)
  const strippedJoined = segments.join("/");
  const strippedMatch = listedFolders.find(
    (f) => f.path.toLowerCase() === strippedJoined.toLowerCase(),
  );
  if (strippedMatch) {
    return { existingPath: strippedMatch.path, createPath: strippedMatch.path };
  }

  if (isInboxRooted) {
    if (nsInboxRooted) {
      // ImapFlow prepends namespacePrefix automatically when mailboxCreate receives segments
      const withoutInbox =
        segments[0].toUpperCase() === "INBOX" ? segments.slice(1) : segments;
      return {
        existingPath: null,
        createPath: withoutInbox.length ? withoutInbox : segments,
      };
    }
    const withInbox =
      segments[0].toUpperCase() === "INBOX" ? segments : ["INBOX", ...segments];
    return { existingPath: null, createPath: withInbox };
  }

  const sampleDelimiter =
    listedFolders.find((f) => f.delimiter)?.delimiter || "/";
  if (segments.length === 1 && sampleDelimiter === "/") {
    return { existingPath: null, createPath: segments[0] };
  }
  return { existingPath: null, createPath: segments };
}

export class ImapConnector {
  private readonly db: AppDatabase;
  private readonly vault: SecretVault;

  constructor(db: AppDatabase, vault: SecretVault) {
    this.db = db;
    this.vault = vault;
  }

  private async resolveAuthSecret(account: MailAccount): Promise<SecretPayload> {
    const secret = this.vault.getSecret(account.id);
    if (!secret) {
      throw new Error(
        `Aucun identifiant trouvé dans le coffre pour ${account.email}.`,
      );
    }

    if (account.authMode === "microsoft_oauth") {
      const settings = this.db.getSettings();
      if (
        secret.expiresAt &&
        Date.now() > secret.expiresAt - 120_000 &&
        secret.refreshToken &&
        settings.microsoftClientId
      ) {
        const refreshed = await refreshMicrosoftToken(
          settings.microsoftClientId,
          secret.refreshToken,
        );
        const updated: SecretPayload = {
          ...secret,
          accessToken: refreshed.accessToken,
          refreshToken: refreshed.refreshToken,
          expiresAt: refreshed.expiresAt,
        };
        this.vault.setSecret(account.id, updated);
        return updated;
      }
    }

    return secret;
  }

  private buildClient(
    account: Pick<
      MailAccount,
      "email" | "authMode" | "imapHost" | "imapPort" | "imapSecure"
    >,
    secret: SecretPayload,
  ): ImapFlow {
    const auth =
      account.authMode === "imap_password"
        ? { user: account.email, pass: secret.password || "" }
        : { user: account.email, accessToken: secret.accessToken || "" };

    return new ImapFlow({
      host: account.imapHost,
      port: account.imapPort,
      secure: account.imapSecure,
      auth,
      logger: false,
      disableAutoIdle: true,
    });
  }

  async testConnection(
    account: Pick<
      MailAccount,
      "email" | "authMode" | "imapHost" | "imapPort" | "imapSecure"
    >,
    secret: SecretPayload,
  ): Promise<{ ok: true; folderCount: number; folders: string[] }> {
    const client = this.buildClient(account, secret);
    try {
      await client.connect();
      const list = await client.list();
      return {
        ok: true,
        folderCount: list.length,
        folders: list.map((f) => f.path),
      };
    } finally {
      await client.logout().catch(() => client.close());
    }
  }

  async syncAccount(
    account: MailAccount,
    options: {
      folderPath?: string;
      limit?: number;
      batchSize?: number;
      onProgress?: (ev: SyncProgressEvent) => void;
    } = {},
  ): Promise<{ folders: FolderInfo[]; newlyFetched: number; totalInFolder: number }> {
    const folderPath = options.folderPath || "INBOX";
    const batchSize = Math.max(25, Math.min(options.batchSize ?? 150, 300));
    const emit = (ev: SyncProgressEvent) => options.onProgress?.(ev);

    this.db.updateAccountSyncStatus(account.id, "syncing", null);
    emit({
      accountId: account.id,
      folderPath,
      fetched: 0,
      total: 0,
      status: "connecting",
      message: `Connexion à ${account.imapHost}...`,
    });

    const secret = await this.resolveAuthSecret(account);
    const client = this.buildClient(account, secret);

    try {
      await client.connect();

      const rawList = await client.list({
        statusQuery: { messages: true, unseen: true },
      });
      const folders: FolderInfo[] = rawList
        .filter((f) => !f.flags.has("\\Noselect"))
        .map((f) => ({
          accountId: account.id,
          rawPath: f.path,
          name: f.path,
          delimiter: f.delimiter || "/",
          specialUse: f.specialUse || null,
          totalMessages: Number(f.status?.messages ?? 0),
          unseenMessages: Number(f.status?.unseen ?? 0),
        }));
      this.db.replaceFolders(account.id, folders);

      const lock = await client.getMailboxLock(folderPath, { readOnly: true });
      let totalInFolder = 0;
      let newlyFetched = 0;

      try {
        const allUidsRaw = await client.search({ all: true }, { uid: true });
        let uids = Array.isArray(allUidsRaw) ? [...allUidsRaw] : [];
        uids.sort((a, b) => b - a);
        totalInFolder = uids.length;

        if (options.limit && options.limit > 0) {
          uids = uids.slice(0, options.limit);
        }

        const cachedUids = this.db.getCachedUids(account.id, folderPath);
        const pending = uids.filter((u) => !cachedUids.has(u));

        emit({
          accountId: account.id,
          folderPath,
          fetched: uids.length - pending.length,
          total: uids.length,
          status: "syncing",
          message:
            pending.length > 0
              ? `Récupération de ${pending.length} nouveaux en-têtes...`
              : "Cache déjà à jour.",
        });

        for (let i = 0; i < pending.length; i += batchSize) {
          const batch = pending.slice(i, i + batchSize).sort((a, b) => a - b);
          const records: EmailHeaderRecord[] = [];

          for await (const msg of client.fetch(
            batch,
            {
              uid: true,
              flags: true,
              size: true,
              envelope: true,
              internalDate: true,
              headers: ["list-unsubscribe", "list-unsubscribe-post"],
            },
            { uid: true },
          )) {
            const env = msg.envelope;
            const firstFrom = env?.from?.[0];
            const fromName = (firstFrom?.name || "").trim();
            const fromAddr = (firstFrom?.address || "").trim().toLowerCase();
            const fromRaw = fromName && fromAddr
              ? `${fromName} <${fromAddr}>`
              : fromAddr || fromName || "";
            const atIdx = fromAddr.indexOf("@");
            const domain = atIdx !== -1 ? fromAddr.slice(atIdx + 1) : "";
            const toRaw = (env?.to || [])
              .map((t) => t.address || t.name || "")
              .filter(Boolean)
              .join(", ");
            const dateObj = env?.date
              ? new Date(env.date)
              : msg.internalDate
                ? new Date(msg.internalDate)
                : null;
            const validDate = dateObj && !Number.isNaN(dateObj.getTime());
            const dateIso = validDate ? dateObj.toISOString() : "";
            const dateTs = validDate ? dateObj.getTime() : 0;
            const unsub = parseListUnsubscribeFromHeaderBlock(msg.headers);

            records.push({
              accountId: account.id,
              folderPath,
              uid: msg.uid,
              messageId: (env?.messageId || "").trim(),
              fromRaw,
              fromName,
              fromAddr,
              domain,
              toRaw,
              subject: (env?.subject || "(Sans objet)").trim(),
              dateIso,
              dateTs,
              sizeBytes: Number(msg.size ?? 0),
              seen: Boolean(msg.flags?.has("\\Seen")),
              flagged: Boolean(msg.flags?.has("\\Flagged")),
              hasUnsubscribe: unsub.hasUnsubscribe,
              unsubscribeUrl: unsub.unsubscribeUrl,
              unsubscribeMailto: unsub.unsubscribeMailto,
              unsubscribeOneClick: unsub.unsubscribeOneClick,
            });
          }

          if (records.length) {
            this.db.upsertEmails(records);
            newlyFetched += records.length;
          }

          emit({
            accountId: account.id,
            folderPath,
            fetched: Math.min(
              uids.length,
              uids.length - pending.length + i + batch.length,
            ),
            total: uids.length,
            status: "syncing",
          });
        }
      } finally {
        lock.release();
      }

      this.db.updateAccountSyncStatus(account.id, "ok", null);
      emit({
        accountId: account.id,
        folderPath,
        fetched: totalInFolder,
        total: totalInFolder,
        status: "done",
        message: "Audit terminé.",
      });
      return { folders, newlyFetched, totalInFolder };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.db.updateAccountSyncStatus(account.id, "error", msg);
      emit({
        accountId: account.id,
        folderPath,
        fetched: 0,
        total: 0,
        status: "error",
        message: msg,
      });
      throw err;
    } finally {
      await client.logout().catch(() => client.close());
    }
  }

  private async ensureDestinationFolder(
    client: ImapFlow,
    destFolder: string,
    listedFolders: ListResponse[],
  ): Promise<string> {
    const resolved = resolveFolderTarget({
      destFolder,
      listedFolders,
      isGmail: client.capabilities.has("X-GM-EXT-1"),
      namespacePrefix: client.namespace?.prefix,
    });

    if (resolved.existingPath) {
      return resolved.existingPath;
    }

    const created = await client.mailboxCreate(resolved.createPath);
    return created.path;
  }

  async moveUidsInWaves(params: {
    account: MailAccount;
    sourceFolder: string;
    destFolder: string;
    uids: number[];
    batchSize?: number;
    delayMs?: number;
    onBatchProgress?: (processed: number, total: number) => void;
  }): Promise<{ movedCount: number; destUids: number[]; resolvedDest: string }> {
    const uniqueUids = Array.from(
      new Set(params.uids.filter((u) => Number.isInteger(u) && u > 0)),
    );
    if (!uniqueUids.length) {
      return { movedCount: 0, destUids: [], resolvedDest: params.destFolder };
    }

    const batchSize = Math.max(10, Math.min(params.batchSize ?? 100, 250));
    const delayMs = Math.max(0, params.delayMs ?? 250);
    const secret = await this.resolveAuthSecret(params.account);
    const client = this.buildClient(params.account, secret);

    const destUids: number[] = [];
    let movedCount = 0;
    let resolvedDest = params.destFolder;

    try {
      await client.connect();
      const listed = await client.list();
      resolvedDest = await this.ensureDestinationFolder(
        client,
        params.destFolder,
        listed,
      );

      if (resolvedDest.toLowerCase() === params.sourceFolder.toLowerCase()) {
        return { movedCount: 0, destUids: [], resolvedDest };
      }

      const lock = await client.getMailboxLock(params.sourceFolder, {
        readOnly: false,
      });

      try {
        for (let i = 0; i < uniqueUids.length; i += batchSize) {
          const chunk = uniqueUids.slice(i, i + batchSize);
          const result = await client.messageMove(chunk, resolvedDest, {
            uid: true,
          });
          if (result === false) {
            throw new Error(
              `Le serveur IMAP a refusé le déplacement vers '${resolvedDest}'.`,
            );
          }
          if (result.uidMap) {
            for (const newUid of result.uidMap.values()) {
              destUids.push(newUid);
            }
          }
          movedCount += chunk.length;
          params.onBatchProgress?.(movedCount, uniqueUids.length);

          if (delayMs > 0 && i + batchSize < uniqueUids.length) {
            await sleep(delayMs);
          }
        }
      } finally {
        lock.release();
      }
    } finally {
      await client.logout().catch(() => client.close());
    }

    return { movedCount, destUids, resolvedDest };
  }

  async fetchLatestUnsubscribeInfo(
    account: MailAccount,
    folderPath: string,
    uid: number,
  ): Promise<ParsedUnsubscribeInfo & { fromBody: boolean }> {
    const secret = await this.resolveAuthSecret(account);
    const client = this.buildClient(account, secret);

    try {
      await client.connect();
      const lock = await client.getMailboxLock(folderPath, { readOnly: true });
      try {
        let headerInfo: ParsedUnsubscribeInfo = {
          hasUnsubscribe: false,
          unsubscribeUrl: null,
          unsubscribeMailto: null,
          unsubscribeOneClick: false,
        };

        for await (const msg of client.fetch(
          [uid],
          {
            uid: true,
            headers: ["list-unsubscribe", "list-unsubscribe-post"],
          },
          { uid: true },
        )) {
          headerInfo = parseListUnsubscribeFromHeaderBlock(msg.headers);
        }

        if (headerInfo.unsubscribeUrl || headerInfo.unsubscribeMailto) {
          return { ...headerInfo, fromBody: false };
        }

        // Fallback: inspect only this single message source for footer unsubscribe links
        for await (const msg of client.fetch(
          [uid],
          { uid: true, source: true },
          { uid: true },
        )) {
          if (msg.source) {
            const raw = msg.source.subarray(0, 512 * 1024).toString("utf8");
            const bodyInfo = extractUnsubscribeFromRawMessage(raw);
            return {
              ...bodyInfo,
              hasUnsubscribe: bodyInfo.hasUnsubscribe || headerInfo.hasUnsubscribe,
              fromBody: Boolean(bodyInfo.unsubscribeUrl || bodyInfo.unsubscribeMailto),
            };
          }
        }

        return { ...headerInfo, fromBody: false };
      } finally {
        lock.release();
      }
    } finally {
      await client.logout().catch(() => client.close());
    }
  }

  async undoMove(params: {
    account: MailAccount;
    sourceFolder: string;
    destFolder: string;
    destUids: number[];
    messageIds: string[];
  }): Promise<number> {
    const secret = await this.resolveAuthSecret(params.account);
    const client = this.buildClient(params.account, secret);

    try {
      await client.connect();
      const lock = await client.getMailboxLock(params.destFolder, {
        readOnly: false,
      });
      try {
        let uidsToRestore = params.destUids.filter(
          (u) => Number.isInteger(u) && u > 0,
        );

        if (!uidsToRestore.length && params.messageIds.length) {
          const found: number[] = [];
          for (const msgId of params.messageIds.slice(0, 200)) {
            const matched = await client.search(
              { header: { "message-id": msgId } },
              { uid: true },
            );
            if (Array.isArray(matched)) {
              found.push(...matched);
            }
          }
          uidsToRestore = Array.from(new Set(found));
        }

        if (!uidsToRestore.length) {
          throw new Error(
            "Impossible de localiser les messages déplacés pour annuler ce lot.",
          );
        }

        for (let i = 0; i < uidsToRestore.length; i += 100) {
          const chunk = uidsToRestore.slice(i, i + 100);
          const res = await client.messageMove(chunk, params.sourceFolder, {
            uid: true,
          });
          if (res === false) {
            throw new Error(
              `Échec lors du retour des messages vers '${params.sourceFolder}'.`,
            );
          }
        }
        return uidsToRestore.length;
      } finally {
        lock.release();
      }
    } finally {
      await client.logout().catch(() => client.close());
    }
  }
}
