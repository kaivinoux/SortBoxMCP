import { describe, expect, it } from "vitest";
import {
  extractUnsubscribeFromRawMessage,
  parseListUnsubscribeFromHeaderBlock,
  parseListUnsubscribeHeaderValues,
} from "../src/shared/unsubscribeUtils.js";

describe("unsubscribeUtils", () => {
  it("parses RFC 8058 One-Click List-Unsubscribe + Post headers", () => {
    const res = parseListUnsubscribeHeaderValues(
      "<mailto:unsub@shop.fr?subject=stop>, <https://shop.fr/unsub?token=abc>",
      "List-Unsubscribe=One-Click",
    );
    expect(res.hasUnsubscribe).toBe(true);
    expect(res.unsubscribeUrl).toBe("https://shop.fr/unsub?token=abc");
    expect(res.unsubscribeMailto).toBe("mailto:unsub@shop.fr?subject=stop");
    expect(res.unsubscribeOneClick).toBe(true);
  });

  it("extracts mailto-only List-Unsubscribe safely and ignores javascript URLs", () => {
    const res = parseListUnsubscribeHeaderValues(
      "<javascript:alert(1)>, <mailto:quit@asso.fr>",
      null,
    );
    expect(res.hasUnsubscribe).toBe(true);
    expect(res.unsubscribeUrl).toBeNull();
    expect(res.unsubscribeMailto).toBe("mailto:quit@asso.fr");
    expect(res.unsubscribeOneClick).toBe(false);
  });

  it("unfolds multiline List-Unsubscribe headers cleanly", () => {
    const headerBlock = [
      "From: News <news@example.fr>",
      "List-Unsubscribe: <mailto:leave@example.fr>,",
      " <https://example.fr/optout/123>",
      "List-Unsubscribe-Post: List-Unsubscribe=One-Click",
      "",
    ].join("\r\n");

    const parsed = parseListUnsubscribeFromHeaderBlock(headerBlock);
    expect(parsed.unsubscribeUrl).toBe("https://example.fr/optout/123");
    expect(parsed.unsubscribeMailto).toBe("mailto:leave@example.fr");
    expect(parsed.unsubscribeOneClick).toBe(true);
  });

  it("falls back to scanning footer links in French HTML newsletter bodies", () => {
    const rawMsg = [
      "From: Boutique <offres@boutique.fr>",
      "Subject: Offre du jour",
      "Content-Type: text/html; charset=utf-8",
      "",
      "<html><body>",
      '<p>Découvrez nos produits <a href="https://boutique.fr/promo">ici</a>.</p>',
      '<p>Pour ne plus recevoir nos messages, <a href="https://boutique.fr/desabonnement?u=42&amp;c=fr">cliquez pour vous désinscrire</a>.</p>',
      "</body></html>",
    ].join("\r\n");

    const parsed = extractUnsubscribeFromRawMessage(rawMsg);
    expect(parsed.hasUnsubscribe).toBe(true);
    expect(parsed.unsubscribeUrl).toBe("https://boutique.fr/desabonnement?u=42&c=fr");
    expect(parsed.unsubscribeOneClick).toBe(false);
  });

  it("decodes quoted-printable MIME subparts accurately when declared", () => {
    const rawMsg = [
      "From: Mag <news@mag.fr>",
      'Content-Type: multipart/alternative; boundary="bnd1"',
      "",
      "--bnd1",
      "Content-Type: text/html; charset=utf-8",
      "Content-Transfer-Encoding: quoted-printable",
      "",
      '<a href=3D"https://mag.fr/unsub?u=3D42&amp;ok=3D1">Se d=C3=A9sabonner</a>',
      "--bnd1--",
    ].join("\r\n");

    const parsed = extractUnsubscribeFromRawMessage(rawMsg);
    expect(parsed.hasUnsubscribe).toBe(true);
    expect(parsed.unsubscribeUrl).toBe("https://mag.fr/unsub?u=42&ok=1");
  });
});
