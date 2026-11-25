import { SPECIAL_TRASH } from "./folders.js";

export interface DomainCategoryRule {
  pattern: RegExp;
  category: string;
  suggestedFolder: string;
}

const DOMAIN_RULES: DomainCategoryRule[] = [
  // Administratif & Service Public FR
  {
    pattern: /(^|\.)(gouv\.fr|ameli\.fr|caf\.fr|urssaf\.fr|ants\.fr|francetravail\.fr|pole-emploi\.fr|lassuranceretraite\.fr|service-public\.fr|agirc-arrco\.fr)$/i,
    category: "Administratif",
    suggestedFolder: "Administratif",
  },
  // Banques & Paiements
  {
    pattern: /(^|\.)(credit-agricole\.fr|bnpparibas\.com|bnpparibas\.net|societegenerale\.fr|sg\.fr|labanquepostale\.fr|boursorama\.com|boursobank\.com|lcl\.fr|cic\.fr|creditmutuel\.fr|caisse-epargne\.fr|banquepopulaire\.fr|revolut\.com|n26\.com|paypal\.fr|paypal\.com|fortuneo\.fr|hello-bank\.fr|lydia-app\.com|sumeria\.eu)$/i,
    category: "Banques",
    suggestedFolder: "Banques",
  },
  // Factures, Energie & Telecoms
  {
    pattern: /(^|\.)(edf\.fr|engie\.fr|totalenergies\.fr|veolia\.fr|orange\.fr|sosh\.fr|sfr\.fr|red-by-sfr\.fr|free\.fr|bouyguestelecom\.fr|bbox\.fr|ovh\.com|ovhcloud\.com)$/i,
    category: "Factures & Abonnements",
    suggestedFolder: "Factures",
  },
  // Achats & Livraisons
  {
    pattern: /(^|\.)(amazon\.fr|amazon\.com|fnac\.com|darty\.com|ldlc\.com|boulanger\.com|cdiscount\.com|decathlon\.fr|vinted\.fr|leboncoin\.fr|laposte\.fr|chronopost\.fr|mondialrelay\.fr|colissimo\.fr|dhl\.com|ups\.com|fedex\.com|aliexpress\.com|ikea\.com)$/i,
    category: "Achats & Colis",
    suggestedFolder: "Achats",
  },
  // Emploi & Carrière
  {
    pattern: /(^|\.)(indeed\.com|indeed\.fr|welcometothejungle\.com|hellowork\.com|apec\.fr|glassdoor\.com|monster\.fr|linkedin\.com|smartrecruiters\.com|workday\.com|greenhouse\.io|lever\.co)$/i,
    category: "Emploi & Pro",
    suggestedFolder: "Emploi",
  },
  // Réseaux sociaux & Streaming
  {
    pattern: /(^|\.)(facebookmail\.com|instagram\.com|x\.com|twitter\.com|tiktok\.com|youtube\.com|twitch\.tv|discord\.com|discordapp\.com|reddit\.com|netflix\.com|spotify\.com|steampowered\.com|epicgames\.com|playstation\.com)$/i,
    category: "Social & Loisirs",
    suggestedFolder: "Social",
  },
  // Santé & Mutuelle
  {
    pattern: /(^|\.)(doctolib\.fr|alan\.com|alan\.eu|harmonie-mutuelle\.fr|mgen\.fr|malakoffhumanis\.com|april\.fr)$/i,
    category: "Santé",
    suggestedFolder: "Sante",
  },
];

export function classifySenderLocally(
  domain: string,
  hasUnsubscribe: boolean,
  subjectSamples: string[] = [],
): { category: string | null; suggestedFolder: string | null } {
  const cleanDomain = domain.trim().toLowerCase();
  for (const rule of DOMAIN_RULES) {
    if (rule.pattern.test(cleanDomain)) {
      return {
        category: rule.category,
        suggestedFolder: rule.suggestedFolder,
      };
    }
  }

  // Fallback heuristics from headers / subjects when domain isn't in dictionary
  if (hasUnsubscribe) {
    const joined = subjectSamples.join(" ").toLowerCase();
    if (/promo|soldes|-\d+%|offre|ventes? flash|nouvelle collection|code promo|black friday/i.test(joined)) {
      return {
        category: "Pub / Promo",
        suggestedFolder: SPECIAL_TRASH,
      };
    }
    return {
      category: "Newsletter",
      suggestedFolder: "Newsletters",
    };
  }

  return { category: null, suggestedFolder: null };
}
