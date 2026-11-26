export interface ParsedUnsubscribeInfo {
  hasUnsubscribe: boolean;
  unsubscribeUrl: string | null;
  unsubscribeMailto: string | null;
  unsubscribeOneClick: boolean;
}

const UNSUB_KEYWORDS_RE =
  /d[ée]sabonn|d[ée]sinscri|unsubscribe|opt[-_]?out|stop\s+receiving|ne\s+plus\s+recevoir|g[ée]rer\s+(?:vos|mes)\s+pr[ée]f[ée]rences|manage\s+preferences/i;

const UNSUB_URL_HINT_RE =
  /unsub|opt[-_]?out|desabonn|desinscri|remove|preferences|list-manage/i;

/**
 * Validates that a string is a safe HTTP or HTTPS URL.
 */
export function sanitizeUnsubscribeHttpUrl(raw: string): string | null {
  const cleaned = raw.replace(/&amp;/gi, "&").trim();
  if (!cleaned) return null;
  try {
    const parsed = new URL(cleaned);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

/**
 * Validates that a string is a safe mailto: URI without header-injection control chars.
 */
export function sanitizeUnsubscribeMailto(raw: string): string | null {
  const cleaned = raw.replace(/[\r\n\0]/g, "").trim();
  if (!/^mailto:/i.test(cleaned)) return null;
  const target = cleaned.slice(7);
  if (!target.includes("@") || target.length > 500) return null;
  return `mailto:${target}`;
}

/**
 * Extracts folded header value from a raw RFC 5322 header block.
 */
function extractFoldedHeader(headerText: string, headerName: string): string | null {
  const escaped = headerName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`^${escaped}:\\s*([^\\r\\n]+(?:\\r?\\n[ \\t]+[^\\r\\n]+)*)`, "im");
  const match = headerText.match(re);
  if (!match) return null;
  return match[1].replace(/\r?\n[ \t]+/g, " ").trim();
}

/**
 * Parses List-Unsubscribe and List-Unsubscribe-Post (RFC 2369 / RFC 8058).
 */
export function parseListUnsubscribeHeaderValues(
  listUnsubscribeRaw?: string | null,
  listUnsubscribePostRaw?: string | null,
): ParsedUnsubscribeInfo {
  const value = (listUnsubscribeRaw || "").trim();
  if (!value) {
    return {
      hasUnsubscribe: false,
      unsubscribeUrl: null,
      unsubscribeMailto: null,
      unsubscribeOneClick: false,
    };
  }

  let httpUrl: string | null = null;
  let mailtoUrl: string | null = null;

  const bracketMatches = Array.from(value.matchAll(/<([^>]+)>/g));
  const candidates = bracketMatches.length
    ? bracketMatches.map((m) => m[1].trim())
    : value.split(",").map((part) => part.trim());

  for (const candidate of candidates) {
    if (!httpUrl) {
      const validHttp = sanitizeUnsubscribeHttpUrl(candidate);
      if (validHttp) {
        httpUrl = validHttp;
        continue;
      }
    }
    if (!mailtoUrl) {
      const validMailto = sanitizeUnsubscribeMailto(candidate);
      if (validMailto) {
        mailtoUrl = validMailto;
      }
    }
  }

  const postVal = (listUnsubscribePostRaw || "").trim();
  const isOneClickPost = /list-unsubscribe\s*=\s*one-click/i.test(postVal);
  // RFC 8058 requires HTTPS for One-Click POST.
  const unsubscribeOneClick = Boolean(
    httpUrl && httpUrl.startsWith("https://") && isOneClickPost,
  );

  return {
    hasUnsubscribe: Boolean(value),
    unsubscribeUrl: httpUrl,
    unsubscribeMailto: mailtoUrl,
    unsubscribeOneClick,
  };
}

/**
 * Parses List-Unsubscribe headers directly from raw RFC 5322 header bytes or text.
 */
export function parseListUnsubscribeFromHeaderBlock(
  rawHeaders?: string | Buffer | null,
): ParsedUnsubscribeInfo {
  if (!rawHeaders) {
    return parseListUnsubscribeHeaderValues(null, null);
  }
  const text = typeof rawHeaders === "string" ? rawHeaders : rawHeaders.toString("utf8");
  const unsub = extractFoldedHeader(text, "List-Unsubscribe");
  const unsubPost = extractFoldedHeader(text, "List-Unsubscribe-Post");
  return parseListUnsubscribeHeaderValues(unsub, unsubPost);
}

function decodeQuotedPrintable(input: string): string {
  const unfolded = input.replace(/=\r?\n/g, "");
  return unfolded.replace(/(?:=[0-9A-Fa-f]{2})+/g, (seq) => {
    try {
      return decodeURIComponent(seq.replace(/=/g, "%"));
    } catch {
      return seq.replace(/=([0-9A-Fa-f]{2})/g, (_m, hex) =>
        String.fromCharCode(Number.parseInt(hex, 16)),
      );
    }
  });
}

function decodeBodyIfQuotedPrintable(headerPart: string, rawBody: string): string {
  if (/content-transfer-encoding:\s*quoted-printable/i.test(headerPart)) {
    return decodeQuotedPrintable(rawBody);
  }
  if (!/content-transfer-encoding:\s*quoted-printable/i.test(rawBody)) {
    return rawBody;
  }
  return rawBody.replace(
    /(content-transfer-encoding:\s*quoted-printable[^\r\n]*\r?\n(?:[^\r\n]+\r?\n)*?\r?\n)([\s\S]*?)(?=\r?\n--|\s*$)/gi,
    (_m, partHdr, partBody) => `${partHdr}${decodeQuotedPrintable(partBody)}`,
  );
}

function stripHtmlTags(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Fallback scanner for newsletters that omit List-Unsubscribe headers and only
 * include an unsubscribe hyperlink in the email HTML/text body.
 */
export function extractUnsubscribeFromRawMessage(rawSource: string): ParsedUnsubscribeInfo {
  const headerSplitIdx = rawSource.search(/\r?\n\r?\n/);
  const headerPart = headerSplitIdx === -1 ? rawSource : rawSource.slice(0, headerSplitIdx);
  const parsedHeader = parseListUnsubscribeFromHeaderBlock(headerPart);
  if (parsedHeader.unsubscribeUrl || parsedHeader.unsubscribeMailto) {
    return parsedHeader;
  }

  const rawBody = headerSplitIdx === -1 ? "" : rawSource.slice(headerSplitIdx);
  const body = decodeBodyIfQuotedPrintable(headerPart, rawBody);

  let bestUrl: string | null = null;
  let bestScore = -1;
  let mailtoFallback: string | null = null;

  const anchorRe = /<a\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = anchorRe.exec(body)) !== null) {
    const rawHref = match[1];
    const anchorText = stripHtmlTags(match[2]);
    const idx = match.index;
    const context = stripHtmlTags(body.slice(Math.max(0, idx - 120), Math.min(body.length, idx + 220)));

    const mailto = sanitizeUnsubscribeMailto(rawHref);
    if (mailto && !mailtoFallback && (UNSUB_KEYWORDS_RE.test(anchorText) || UNSUB_KEYWORDS_RE.test(context))) {
      mailtoFallback = mailto;
      continue;
    }

    const url = sanitizeUnsubscribeHttpUrl(rawHref);
    if (!url) continue;

    let score = 0;
    if (UNSUB_KEYWORDS_RE.test(anchorText)) score += 10;
    if (UNSUB_URL_HINT_RE.test(url)) score += 6;
    if (UNSUB_KEYWORDS_RE.test(context)) score += 3;
    if (url.startsWith("https://")) score += 1;

    if (score >= 6 && score > bestScore) {
      bestScore = score;
      bestUrl = url;
    }
  }

  if (!bestUrl) {
    // Plain-text email fallback: look for bare URLs near unsubscribe wording
    const bareRe = /(https?:\/\/[^\s<>"')]+)/gi;
    while ((match = bareRe.exec(body)) !== null) {
      const idx = match.index;
      const context = body.slice(Math.max(0, idx - 120), Math.min(body.length, idx + 80));
      const url = sanitizeUnsubscribeHttpUrl(match[1]);
      if (!url) continue;
      if (UNSUB_KEYWORDS_RE.test(context) || UNSUB_URL_HINT_RE.test(url)) {
        bestUrl = url;
        break;
      }
    }
  }

  return {
    hasUnsubscribe: parsedHeader.hasUnsubscribe || Boolean(bestUrl || mailtoFallback),
    unsubscribeUrl: bestUrl,
    unsubscribeMailto: mailtoFallback,
    unsubscribeOneClick: false,
  };
}
