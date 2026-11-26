import type { AuthMode, ProviderId } from "./types.js";

export interface ProviderPreset {
  id: ProviderId;
  name: string;
  domains: string[];
  imapHost: string;
  imapPort: number;
  imapSecure: boolean;
  recommendedAuth: AuthMode;
  supportedAuths: AuthMode[];
  guideTitle: string;
  guideSteps: string[];
  guideUrl?: string;
  guideLinkLabel?: string;
  secondaryUrl?: string;
  secondaryLinkLabel?: string;
}

export const PROVIDER_PRESETS: Record<ProviderId, ProviderPreset> = {
  orange: {
    id: "orange",
    name: "Orange / Wanadoo",
    domains: ["orange.fr", "wanadoo.fr"],
    imapHost: "imap.orange.fr",
    imapPort: 993,
    imapSecure: true,
    recommendedAuth: "imap_password",
    supportedAuths: ["imap_password"],
    guideTitle: "Connexion Orange Mail (IMAP)",
    guideSteps: [
      "Clique sur « Ouvrir les paramètres IMAP Orange » ci-dessus (connecte-toi à ta boîte mail Orange si besoin).",
      "Active l'accès IMAP/POP et génère un mot de passe d'application dédié directement dans cette section.",
      "Colle ce mot de passe ci-dessous pour connecter ta boîte Orange.",
    ],
    guideUrl: "https://web01.mail.orange.fr/appsuite/#!!&app=io.ox/settings&folder=virtual/settings/popImap",
    guideLinkLabel: "Ouvrir les paramètres IMAP Orange",
    secondaryUrl: "https://messagerie.orange.fr",
    secondaryLinkLabel: "Webmail Orange",
  },
  gmail: {
    id: "gmail",
    name: "Gmail (Google)",
    domains: ["gmail.com", "googlemail.com"],
    imapHost: "imap.gmail.com",
    imapPort: 993,
    imapSecure: true,
    recommendedAuth: "imap_password",
    supportedAuths: ["imap_password", "gmail_oauth_byo"],
    guideTitle: "Connexion Gmail sans audit Google",
    guideSteps: [
      "Active la validation en 2 étapes sur ton compte Google si ce n'est pas déjà fait.",
      "Ouvre la page « Mots de passe des applications » ci-contre.",
      "Crée un mot de passe pour « SortBox E-Mail » et colle le code à 16 caractères ci-dessous.",
    ],
    guideUrl: "https://myaccount.google.com/apppasswords",
    guideLinkLabel: "Créer un mot de passe d'application",
    secondaryUrl: "https://myaccount.google.com/security",
    secondaryLinkLabel: "Sécurité Google",
  },
  microsoft: {
    id: "microsoft",
    name: "Outlook / Hotmail / Live / M365",
    domains: ["outlook.com", "outlook.fr", "hotmail.com", "hotmail.fr", "live.fr", "live.com", "msn.com"],
    imapHost: "outlook.office365.com",
    imapPort: 993,
    imapSecure: true,
    recommendedAuth: "microsoft_oauth",
    supportedAuths: ["microsoft_oauth", "imap_password"],
    guideTitle: "Connexion Microsoft OAuth2 (1 clic)",
    guideSteps: [
      "Clique sur « Connecter avec Microsoft » (OAuth2 recommandé pour Outlook / Hotmail / Live).",
      "Si tu passes par le mode mot de passe IMAP, génère un mot de passe d'application depuis les options de sécurité avancées Microsoft.",
    ],
    guideUrl: "https://account.live.com/proofs/manage",
    guideLinkLabel: "Sécurité Microsoft (mots de passe d'app)",
    secondaryUrl: "https://account.microsoft.com/security",
    secondaryLinkLabel: "Compte Microsoft",
  },
  free: {
    id: "free",
    name: "Free (Zimbra)",
    domains: ["free.fr"],
    imapHost: "imap.free.fr",
    imapPort: 993,
    imapSecure: true,
    recommendedAuth: "imap_password",
    supportedAuths: ["imap_password"],
    guideTitle: "Connexion Free Mail",
    guideSteps: [
      "Utilise ton adresse @free.fr et le mot de passe spécifique de ta boîte mail Free.",
      "Pour créer ou réinitialiser ce mot de passe, ouvre ton Espace Abonné Free.",
    ],
    guideUrl: "https://moncompte.free.fr",
    guideLinkLabel: "Ouvrir l'Espace Abonné Free",
    secondaryUrl: "https://webmail.free.fr",
    secondaryLinkLabel: "Webmail Free",
  },
  sfr: {
    id: "sfr",
    name: "SFR / Neuf",
    domains: ["sfr.fr", "neuf.fr", "cegetel.net", "club-internet.fr"],
    imapHost: "imap.sfr.fr",
    imapPort: 993,
    imapSecure: true,
    recommendedAuth: "imap_password",
    supportedAuths: ["imap_password"],
    guideTitle: "Connexion SFR Mail",
    guideSteps: [
      "Saisis ton adresse SFR et ton mot de passe de messagerie habituel (IMAP activé par défaut).",
      "En cas de doute sur ton mot de passe, teste d'abord la connexion sur la messagerie SFR.",
    ],
    guideUrl: "https://messagerie.sfr.fr",
    guideLinkLabel: "Ouvrir la messagerie SFR",
    secondaryUrl: "https://www.sfr.fr/mon-espace-client",
    secondaryLinkLabel: "Espace client SFR",
  },
  laposte: {
    id: "laposte",
    name: "La Poste",
    domains: ["laposte.net"],
    imapHost: "imap.laposte.net",
    imapPort: 993,
    imapSecure: true,
    recommendedAuth: "imap_password",
    supportedAuths: ["imap_password"],
    guideTitle: "Connexion LaPoste.net",
    guideSteps: [
      "Connecte-toi sur LaPoste.net pour vérifier que la boîte n'est plus temporaire et que le mot de passe fonctionne.",
      "Serveur configuré : imap.laposte.net (port 993 SSL/TLS).",
    ],
    guideUrl: "https://www.laposte.net",
    guideLinkLabel: "Ouvrir LaPoste.net",
  },
  ovh: {
    id: "ovh",
    name: "OVH / Pro IMAP",
    domains: ["ovh.net", "ovh.fr"],
    imapHost: "ssl0.ovh.net",
    imapPort: 993,
    imapSecure: true,
    recommendedAuth: "imap_password",
    supportedAuths: ["imap_password"],
    guideTitle: "Connexion OVH Mail",
    guideSteps: [
      "Serveur par défaut OVH : ssl0.ovh.net (port 993 SSL).",
      "Pour gérer ou modifier le mot de passe d'une boîte, ouvre l'Espace client OVHcloud > Web Cloud > E-mails.",
    ],
    guideUrl: "https://www.ovh.com/manager/",
    guideLinkLabel: "Ouvrir l'Espace client OVHcloud",
    secondaryUrl: "https://www.ovhcloud.com/fr/webmail/",
    secondaryLinkLabel: "Webmail OVH",
  },
  icloud: {
    id: "icloud",
    name: "iCloud Mail (Apple)",
    domains: ["icloud.com", "me.com", "mac.com"],
    imapHost: "imap.mail.me.com",
    imapPort: 993,
    imapSecure: true,
    recommendedAuth: "imap_password",
    supportedAuths: ["imap_password"],
    guideTitle: "Connexion iCloud Mail",
    guideSteps: [
      "Connecte-toi sur ton compte Apple > Connexion et sécurité.",
      "Clique sur « Mots de passe pour application » et génère un code pour SortBox E-Mail.",
      "Apple exige obligatoirement un mot de passe spécifique d'application (pas le mot de passe principal).",
    ],
    guideUrl: "https://account.apple.com/",
    guideLinkLabel: "Ouvrir le compte Apple",
  },
  yahoo: {
    id: "yahoo",
    name: "Yahoo Mail",
    domains: ["yahoo.com", "yahoo.fr", "ymail.com"],
    imapHost: "imap.mail.yahoo.com",
    imapPort: 993,
    imapSecure: true,
    recommendedAuth: "imap_password",
    supportedAuths: ["imap_password"],
    guideTitle: "Connexion Yahoo Mail",
    guideSteps: [
      "Ouvre la page Sécurité du compte Yahoo ci-contre.",
      "Descends sur « Générer un mot de passe d'application » puis colle ce code ci-dessous.",
    ],
    guideUrl: "https://login.yahoo.com/account/security",
    guideLinkLabel: "Ouvrir la sécurité Yahoo",
  },
  custom: {
    id: "custom",
    name: "IMAP Personnalisé (Domaine Pro, Ionos, Infomaniak...)",
    domains: [],
    imapHost: "",
    imapPort: 993,
    imapSecure: true,
    recommendedAuth: "imap_password",
    supportedAuths: ["imap_password"],
    guideTitle: "Connexion IMAP générique",
    guideSteps: [
      "Indique le serveur IMAP fourni par ton hébergeur (ex: mail.infomaniak.com, imap.ionos.fr).",
      "Port standard sécurisé : 993 (SSL/TLS).",
    ],
  },
};

export function detectProviderFromEmail(email: string): ProviderPreset {
  const clean = email.trim().toLowerCase();
  const atIdx = clean.lastIndexOf("@");
  if (atIdx === -1) return PROVIDER_PRESETS.custom;
  const domain = clean.slice(atIdx + 1);

  for (const preset of Object.values(PROVIDER_PRESETS)) {
    if (preset.domains.includes(domain)) {
      return preset;
    }
  }

  // Fallback heuristics for common pro hosters
  if (domain.endsWith(".onmicrosoft.com")) {
    return PROVIDER_PRESETS.microsoft;
  }

  return {
    ...PROVIDER_PRESETS.custom,
    imapHost: domain ? `imap.${domain}` : "",
  };
}

export const DEFAULT_MICROSOFT_CLIENT_ID =
  "b038a8f9-be23-4b78-9221-3d60bdf79004";

/**
 * Resolves the effective Microsoft OAuth2 Client ID from an explicit UI override,
 * saved custom setting, or SortBox's built-in public PKCE app registration.
 */
export function resolveMicrosoftClientId(
  overrideClientId?: string | null,
  savedClientId?: string | null,
): string {
  const explicit = (overrideClientId ?? "").trim();
  if (explicit) return explicit;
  const saved = (savedClientId ?? "").trim();
  if (saved) return saved;
  return DEFAULT_MICROSOFT_CLIENT_ID;
}

/**
 * Masks the built-in default Client ID so account UI forms keep it hidden.
 */
export function extractCustomMicrosoftClientId(
  savedClientId?: string | null,
): string {
  const trimmed = (savedClientId ?? "").trim();
  return trimmed && trimmed !== DEFAULT_MICROSOFT_CLIENT_ID ? trimmed : "";
}
