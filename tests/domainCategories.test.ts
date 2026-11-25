import { describe, expect, it } from "vitest";
import { classifySenderLocally } from "../src/shared/domainCategories.js";

describe("classifySenderLocally", () => {
  it("classifies French administrative and banking domains offline", () => {
    expect(classifySenderLocally("dgfip.finances.gouv.fr", false)).toEqual({
      category: "Administratif",
      suggestedFolder: "Administratif",
    });
    expect(classifySenderLocally("credit-agricole.fr", false)).toEqual({
      category: "Banques",
      suggestedFolder: "Banques",
    });
    expect(classifySenderLocally("amazon.fr", false)).toEqual({
      category: "Achats & Colis",
      suggestedFolder: "Achats",
    });
  });

  it("routes promotional newsletters to __TRASH__", () => {
    const res = classifySenderLocally("newsletter.shop.example", true, [
      "Ventes flash -50% ce week-end",
    ]);
    expect(res).toEqual({
      category: "Pub / Promo",
      suggestedFolder: "__TRASH__",
    });
  });

  it("leaves unknown non-newsletter senders unclassified", () => {
    expect(classifySenderLocally("ami-perso.org", false, ["On se voit demain ?"])).toEqual({
      category: null,
      suggestedFolder: null,
    });
  });
});
