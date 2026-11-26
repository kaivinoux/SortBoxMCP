import { describe, expect, it } from "vitest";
import {
  DEFAULT_MICROSOFT_CLIENT_ID,
  PROVIDER_PRESETS,
  detectProviderFromEmail,
  extractCustomMicrosoftClientId,
  resolveMicrosoftClientId,
} from "../src/shared/providers.js";

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

  it("provides direct https guideUrl and label for every built-in provider", () => {
    for (const preset of Object.values(PROVIDER_PRESETS)) {
      if (preset.id === "custom") continue;
      expect(preset.guideUrl).toMatch(/^https:\/\//);
      expect(preset.guideLinkLabel?.length).toBeGreaterThan(3);
    }
  });

  it("resolves built-in Microsoft Client ID while hiding it from UI custom overrides", () => {
    expect(DEFAULT_MICROSOFT_CLIENT_ID).toMatch(/^[0-9a-f-]{36}$/i);
    expect(resolveMicrosoftClientId()).toBe(DEFAULT_MICROSOFT_CLIENT_ID);
    expect(resolveMicrosoftClientId("", "")).toBe(DEFAULT_MICROSOFT_CLIENT_ID);
    expect(resolveMicrosoftClientId("", "custom-saved-id")).toBe("custom-saved-id");
    expect(resolveMicrosoftClientId("explicit-id", "custom-saved-id")).toBe("explicit-id");

    expect(extractCustomMicrosoftClientId("")).toBe("");
    expect(extractCustomMicrosoftClientId(DEFAULT_MICROSOFT_CLIENT_ID)).toBe("");
    expect(extractCustomMicrosoftClientId("custom-tenant-app-id")).toBe(
      "custom-tenant-app-id",
    );
  });
});
