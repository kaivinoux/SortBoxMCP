import { describe, expect, it } from "vitest";
import { formatDestinationLabel, SPECIAL_ARCHIVE, SPECIAL_JUNK, SPECIAL_TRASH } from "../src/shared/folders.js";
import {
  DEFAULT_LANGUAGE,
  SUPPORTED_LANGUAGES,
  formatBytesLocalized,
  getMessages,
  localizeCategory,
  normalizeLanguage,
} from "../src/shared/i18n.js";
import { PROVIDER_PRESETS } from "../src/shared/providers.js";

describe("i18n multi-language support", () => {
  it("uses English as the default language and exposes 6 ordered languages", () => {
    expect(DEFAULT_LANGUAGE).toBe("en");
    expect(SUPPORTED_LANGUAGES.map((l) => l.code)).toEqual([
      "en",
      "fr",
      "es",
      "pt",
      "it",
      "de",
    ]);
    expect(normalizeLanguage("fr-FR")).toBe("fr");
    expect(normalizeLanguage("ES")).toBe("es");
    expect(normalizeLanguage("unknown")).toBe("en");
  });

  it("provides complete provider guides and localized folders/categories for all 6 languages", () => {
    const providerIds = Object.keys(PROVIDER_PRESETS) as Array<keyof typeof PROVIDER_PRESETS>;
    for (const { code } of SUPPORTED_LANGUAGES) {
      const bundle = getMessages(code);
      expect(bundle.header.addMailboxBtn.length).toBeGreaterThan(2);
      expect(bundle.triage.title.length).toBeGreaterThan(5);
      expect(formatDestinationLabel(SPECIAL_TRASH, code)).not.toBe(SPECIAL_TRASH);
      expect(formatDestinationLabel(SPECIAL_JUNK, code)).not.toBe(SPECIAL_JUNK);
      expect(formatDestinationLabel(SPECIAL_ARCHIVE, code)).not.toBe(SPECIAL_ARCHIVE);
      expect(localizeCategory("Administratif", code)).toBeTruthy();
      expect(formatBytesLocalized(2048, code)).toContain("2 ");
      for (const pid of providerIds) {
        expect(bundle.providers[pid].guideTitle.length).toBeGreaterThan(2);
        expect(bundle.providers[pid].guideSteps.length).toBeGreaterThan(0);
      }
    }
  });
});
