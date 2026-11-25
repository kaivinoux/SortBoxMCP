import { SPECIAL_TRASH } from "../../shared/folders.js";
import type { SenderGroup } from "../../shared/types.js";

export interface ImportedPlanMoveSpec {
  dest: string;
  domains?: string[];
  senders?: string[];
  uids?: number[];
  reason?: string;
}

export interface ImportedPlanSpec {
  title?: string;
  source_folder?: string;
  moves: ImportedPlanMoveSpec[];
}

function redactSubjectSnippet(subject: string): string {
  // Strip long digit sequences (order numbers, account refs) & inline emails for privacy when pasting to web AI
  return subject
    .replace(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi, "[email]")
    .replace(/\b\d{5,}\b/g, "[num]")
    .slice(0, 75);
}

export function buildZeroConfigPrompt(
  groups: SenderGroup[],
  existingFolders: string[] = [],
  options: { maxSenders?: number; onlyUnknown?: boolean } = {},
): string {
  const maxSenders = options.maxSenders ?? 120;
  const filtered = (options.onlyUnknown
    ? groups.filter((g) => !g.suggestedCategory)
    : groups
  ).slice(0, maxSenders);

  const folderHint = existingFolders.length
    ? existingFolders.slice(0, 25).join(", ")
    : `${SPECIAL_TRASH} (Corbeille), Administratif, Banques, Factures, Achats, Pro, Newsletters`;

  const lines = filtered.map((g) => {
    const sample = g.sampleSubjects[0]
      ? redactSubjectSnippet(g.sampleSubjects[0])
      : "(sans objet)";
    return `- sender="${g.fromAddr || g.groupKey}" domain="${g.domain}" count=${g.totalCount} unread=${g.unreadCount} unsub=${g.hasUnsubscribe} ex="${sample}"`;
  });

  return [
    "Tu es un assistant de tri email. Classe les expéditeurs ci-dessous dans des dossiers IMAP.",
    `Dossiers suggérés / existants : ${folderHint}`,
    "Règles strictes :",
    "1. Réponds UNIQUEMENT par un objet JSON valide (sans texte autour).",
    `2. Pour supprimer / mettre à la corbeille, utilise dest="${SPECIAL_TRASH}". En cas de doute sur un expéditeur personnel ou important, NE le mets PAS à la corbeille.`,
    `3. Format attendu : {"title":"Tri IA","moves":[{"dest":"${SPECIAL_TRASH}","senders":["..."],"domains":["..."],"reason":"..."}]}`,
    "",
    `Expéditeurs à classer (${lines.length}) :`,
    ...lines,
  ].join("\n");
}

function extractJsonBlock(rawText: string): string {
  const trimmed = rawText.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced && fenced[1]) {
    return fenced[1].trim();
  }
  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1);
  }
  return trimmed;
}

export function sanitizeFolderPath(dest: string): string {
  const clean = dest.trim().replace(/\\/g, "/").replace(/\/{2,}/g, "/");
  if (!clean || clean.includes("..")) {
    throw new Error(`Nom de dossier cible invalide : "${dest}"`);
  }
  return clean;
}

export function parseImportedSortPlanJson(rawText: string): ImportedPlanSpec {
  const jsonText = extractJsonBlock(rawText);
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (err) {
    throw new Error(
      `Impossible de lire le JSON du plan : ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Le plan JSON doit être un objet contenant un tableau 'moves'.");
  }

  const obj = parsed as Record<string, unknown>;
  if (!Array.isArray(obj.moves) || obj.moves.length === 0) {
    throw new Error("Le plan JSON doit contenir au moins un élément dans 'moves'.");
  }

  const moves: ImportedPlanMoveSpec[] = [];
  for (const item of obj.moves) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    if (typeof rec.dest !== "string" || !rec.dest.trim()) {
      throw new Error("Chaque mouvement dans 'moves' doit avoir un champ 'dest' valide.");
    }

    const domains = Array.isArray(rec.domains)
      ? rec.domains.filter((x): x is string => typeof x === "string" && x.trim().length > 0).map((s) => s.trim().toLowerCase())
      : [];
    const senders = Array.isArray(rec.senders)
      ? rec.senders.filter((x): x is string => typeof x === "string" && x.trim().length > 0).map((s) => s.trim().toLowerCase())
      : [];
    const uids = Array.isArray(rec.uids)
      ? rec.uids.map((x) => Number(x)).filter((n) => Number.isInteger(n) && n > 0)
      : [];

    if (!domains.length && !senders.length && !uids.length) {
      continue;
    }

    moves.push({
      dest: sanitizeFolderPath(rec.dest),
      domains: domains.length ? domains : undefined,
      senders: senders.length ? senders : undefined,
      uids: uids.length ? uids : undefined,
      reason: typeof rec.reason === "string" ? rec.reason.trim() : undefined,
    });
  }

  if (!moves.length) {
    throw new Error(
      "Aucun mouvement exploitable trouvé (chaque entrée doit cibler 'senders', 'domains' ou 'uids').",
    );
  }

  return {
    title: typeof obj.title === "string" && obj.title.trim() ? obj.title.trim() : "Plan importé (IA)",
    source_folder: typeof obj.source_folder === "string" && obj.source_folder.trim()
      ? obj.source_folder.trim()
      : "INBOX",
    moves,
  };
}
