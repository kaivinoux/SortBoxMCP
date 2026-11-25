import { describe, expect, it } from "vitest";
import { detectProviderFromEmail } from "../src/shared/providers.js";

describe("detectProviderFromEmail", () => {
  it("detects Orange and Wanadoo presets", () => {
    const orange = detectProviderFromEmail("alice@orange.fr");
    expect(orange.id).toBe("orange");
    expect(orange.imapHost).toBe("imap.orange.fr");
    expect(orange.imapPort).toBe(993);

    const wanadoo = detectProviderFromEmail("bob@wanadoo.fr");
    expect(wanadoo.id).toBe("orange");
  });

  it("detects Gmail with app-password guide by default", () => {
    const gmail = detectProviderFromEmail("User@Gmail.com");
    expect(gmail.id).toBe("gmail");
    expect(gmail.imapHost).toBe("imap.gmail.com");
    expect(gmail.recommendedAuth).toBe("imap_password");
  });

  it("detects Microsoft accounts with OAuth2 default", () => {
    const outlook = detectProviderFromEmail("jean@outlook.fr");
    expect(outlook.id).toBe("microsoft");
    expect(outlook.recommendedAuth).toBe("microsoft_oauth");
  });

  it("falls back to imap.<domain> for custom domains", () => {
    const custom = detectProviderFromEmail("contact@mon-domaine.fr");
    expect(custom.id).toBe("custom");
    expect(custom.imapHost).toBe("imap.mon-domaine.fr");
  });
});
