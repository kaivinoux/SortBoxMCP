import { DEFAULT_LANGUAGE, getMessages, type AppLanguage } from "./i18n.js";

export const SPECIAL_TRASH = "__TRASH__";
export const SPECIAL_JUNK = "__JUNK__";
export const SPECIAL_ARCHIVE = "__ARCHIVE__";

const TRASH_ALIASES = new Set([
  "__trash__",
  "trash",
  "corbeille",
  "inbox/trash",
  "inbox.trash",
  "inbox/corbeille",
  "inbox.corbeille",
  "[gmail]/trash",
  "[gmail]/corbeille",
  "deleted",
  "deleted items",
  "deleted messages",
  "éléments supprimés",
  "elements supprimes",
]);

const JUNK_ALIASES = new Set([
  "__junk__",
  "spam",
  "junk",
  "junk e-mail",
  "junk email",
  "inbox/spam",
  "inbox.spam",
  "inbox/junk",
  "inbox.junk",
  "[gmail]/spam",
  "courrier indésirable",
  "courrier indesirable",
  "indesirables",
  "indésirables",
]);

const ARCHIVE_ALIASES = new Set([
  "__archive__",
  "archive",
  "archives",
  "inbox/archive",
  "inbox.archive",
  "inbox/archives",
  "inbox.archives",
  "[gmail]/tous les messages",
  "[gmail]/all mail",
]);

export function isTrashDestination(dest: string): boolean {
  return TRASH_ALIASES.has(dest.trim().toLowerCase());
}

export function isJunkDestination(dest: string): boolean {
  return JUNK_ALIASES.has(dest.trim().toLowerCase());
}

export function isArchiveDestination(dest: string): boolean {
  return ARCHIVE_ALIASES.has(dest.trim().toLowerCase());
}

export function formatDestinationLabel(
  dest: string,
  lang: AppLanguage = DEFAULT_LANGUAGE,
): string {
  const { destinations } = getMessages(lang);
  if (dest === SPECIAL_TRASH) return destinations.trashSystem;
  if (dest === SPECIAL_JUNK) return destinations.junkSystem;
  if (dest === SPECIAL_ARCHIVE) return destinations.archiveSystem;
  return destinations.customMap[dest] ?? dest;
}
