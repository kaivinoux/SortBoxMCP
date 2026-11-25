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
      "Ouvre ton espace client Orange (webmail > Paramètres > Sécurité).",
      "Active l'accès IMAP/POP si ce n'est pas déjà fait.",
      "Génère un mot de passe d'application dédié (recommandé) ou utilise ton mot de passe messagerie.",
    ],
    guideUrl: "https://assistance.orange.fr/",
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
      "Active la validation en 2 étapes sur ton compte Google.",
      "Va dans Compte Google > Sécurité > Mots de passe des applications.",
      "Crée un mot de passe pour « SortBox » et colle le code à 16 caractères ci-dessous.",
    ],
    guideUrl: "https://myaccount.google.com/apppasswords",
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
      "Clique sur « Connecter avec Microsoft » pour ouvrir la fenêtre d'autorisation officielle.",
      "Les comptes Microsoft personnels n'acceptent plus le mot de passe classique en IMAP : OAuth2 est recommandé.",
      "Tu peux aussi utiliser un Client ID Azure personnalisé dans les paramètres.",
    ],
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
      "Utilise ton adresse @free.fr et ton mot de passe messagerie Free.",
      "Serveur configuré automatiquement : imap.free.fr (port 993 SSL).",
    ],
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
      "Saisis ton adresse SFR et ton mot de passe habituel.",
      "Vérifie dans les options SFR Mail que l'accès IMAP est activé.",
    ],
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
      "Vérifie dans Webmail La Poste > Paramètres > Accès POP/IMAP que l'IMAP est activé.",
      "Génère un mot de passe d'application si l'authentification renforcée est active.",
    ],
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
      "Si tu es sur OVH Exchange, utilise l'hôte ex*.mail.ovh.net fourni dans ton espace client.",
    ],
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
      "Connecte-toi sur account.apple.com > Connexion et sécurité.",
      "Clique sur « Mots de passe pour application » et génère un code pour SortBox.",
      "Apple exige obligatoirement un mot de passe spécifique d'application (pas le mot de passe principal).",
    ],
    guideUrl: "https://account.apple.com/",
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
      "Va dans Sécurité du compte Yahoo > Générer un mot de passe d'application.",
      "Colle ce mot de passe dédié ci-dessous.",
    ],
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
