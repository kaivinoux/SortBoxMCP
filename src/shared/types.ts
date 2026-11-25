export type ProviderId =
  | "orange"
  | "gmail"
  | "microsoft"
  | "free"
  | "sfr"
  | "laposte"
  | "ovh"
  | "icloud"
  | "yahoo"
  | "custom";

export type AuthMode = "imap_password" | "microsoft_oauth" | "gmail_oauth_byo";

export interface MailAccount {
  id: string;
  label: string;
  email: string;
  provider: ProviderId;
  authMode: AuthMode;
  imapHost: string;
  imapPort: number;
  imapSecure: boolean;
  createdAt: string;
  lastSyncAt: string | null;
  lastSyncStatus: "idle" | "syncing" | "ok" | "error";
  lastSyncError: string | null;
}

export interface AddAccountInput {
  label?: string;
  email: string;
  provider: ProviderId;
  authMode: AuthMode;
  imapHost: string;
  imapPort: number;
  imapSecure: boolean;
  secret?: string; // App password or IMAP password
}

export interface FolderInfo {
  accountId: string;
  rawPath: string;
  name: string;
  delimiter: string;
  specialUse: string | null;
  totalMessages: number;
  unseenMessages: number;
}

export interface EmailHeaderRecord {
  id?: number;
  accountId: string;
  folderPath: string;
  uid: number;
  messageId: string;
  fromRaw: string;
  fromName: string;
  fromAddr: string;
  domain: string;
  toRaw: string;
  subject: string;
  dateIso: string;
  dateTs: number;
  sizeBytes: number;
  seen: boolean;
  flagged: boolean;
  hasUnsubscribe: boolean;
  unsubscribeUrl: string | null;
}

export interface SenderGroup {
  groupKey: string;
  accountId: string;
  accountEmail: string;
  folderPath: string;
  fromAddr: string;
  fromName: string;
  domain: string;
  totalCount: number;
  unreadCount: number;
  totalSizeBytes: number;
  hasUnsubscribe: boolean;
  unsubscribeUrl: string | null;
  latestDateIso: string;
  sampleSubjects: string[];
  suggestedCategory: string | null;
  suggestedFolder: string | null;
}

export interface SortMoveItem {
  id: string;
  accountId: string;
  accountEmail: string;
  sourceFolder: string;
  destFolder: string;
  label: string;
  uids: number[];
  sampleSubjects: string[];
  checked: boolean;
}

export interface SortPlan {
  id: string;
  title: string;
  source: "manual" | "rule" | "ai_import" | "ai_builtin" | "mcp";
  createdAt: string;
  status: "draft" | "applied" | "partial";
  moves: SortMoveItem[];
}

export interface SortRule {
  id: string;
  name: string;
  accountId: string | "all";
  matchType: "domain" | "sender" | "subject_contains";
  matchValue: string;
  sourceFolder: string;
  destFolder: string;
  enabled: boolean;
  createdAt: string;
}

export interface ExecutionHistoryEntry {
  id: string;
  planId: string | null;
  accountId: string;
  accountEmail: string;
  sourceFolder: string;
  destFolder: string;
  movedUids: number[];
  messageIds: string[];
  count: number;
  executedAt: string;
  undoneAt: string | null;
  status: "ok" | "error" | "undone";
  errorMessage: string | null;
}

export interface AuditStats {
  totalMessages: number;
  unreadMessages: number;
  newsletterMessages: number;
  totalSizeBytes: number;
  uniqueSenders: number;
}

export interface SyncProgressEvent {
  accountId: string;
  folderPath: string;
  fetched: number;
  total: number;
  status: "connecting" | "syncing" | "done" | "error";
  message?: string;
}

export interface PlanApplyProgressEvent {
  planId: string;
  moveId: string;
  destFolder: string;
  processed: number;
  total: number;
  status: "running" | "done" | "error";
  message?: string;
}

export interface McpActivityEvent {
  id: string;
  timestamp: string;
  toolName: string;
  summary: string;
  status: "ok" | "blocked" | "pending_ui" | "error";
}

export interface AppSettings {
  mcpEnabled: boolean;
  mcpPort: number;
  mcpRequireUiConfirmation: boolean;
  waveBatchSize: number;
  waveDelayMs: number;
  aiProvider: "none" | "ollama" | "gemini" | "openai_compat";
  aiEndpoint: string;
  aiModel: string;
  microsoftClientId: string;
}

export interface SenderQueryOptions {
  accountId?: string;
  folderPath?: string;
  search?: string;
  filter?: "all" | "newsletter" | "known" | "unknown" | "unread" | "large";
  groupBy?: "sender" | "domain";
  limit?: number;
}
