# IA For EveryOne — SortBox E-Mail (Windows & Android)

**[English](#english)** · **[Français](#français)**

---

## English

A **100% local** application (Windows & Android) to connect any mailbox (*Orange, Gmail, Outlook / M365, Free, SFR, La Poste, OVH, iCloud, Yahoo, IMAP*), clean up and organize your messages safely **with no AI required**, while also providing an optional **Copy-Paste / Ollama / API AI** workflow (plus a **built-in MCP server** on Windows).

### Quick Download (Windows)

Download the latest release from the [Releases](https://github.com/kaivinoux/SortBoxMCP/releases) page, extract the folder (or run the Windows installer), and launch `IA For EveryOne — SortBox E-Mail.exe`.

> **Code Signing:** Free code signing provided by [SignPath.io](https://signpath.io/), certificate by [SignPath Foundation](https://signpath.org/). *(Integration in progress — see [SIGNING.md](SIGNING.md); until signing is active on a release, Windows Defender SmartScreen or Smart App Control may block the executable.)*

### Quick Download (Android `.apk`)

Download `IA-For-EveryOne-SortBox-Email-Android.apk` from the [Releases](https://github.com/kaivinoux/SortBoxMCP/releases) page (`android-v*` tag, e.g. [android-v0.2.0](https://github.com/kaivinoux/SortBoxMCP/releases/tag/android-v0.2.0)) or from the [Android APK](.github/workflows/android.yml) workflow artifacts, then open the `.apk` file on your Android phone (allow installing from unknown sources if Android prompts you).

- **100% local on the phone:** secrets encrypted with **Android Keystore (`AES-256-GCM`)**, local SQLite index on the device, Android cloud backup disabled (`allowBackup=false`).
- **Same sorting workflow:** direct IMAP connection (Orange, Gmail App Password, Free, SFR, La Poste, OVH, iCloud, Yahoo, Outlook OAuth2 if `clientId` is configured), no-AI sender grouping, Dry-Run preview, batched waves, Undo, and Copy-Paste / API AI mode. *(The local MCP server remains exclusive to the Windows desktop version.)*

### Features

1. **Multi-Account & Local Hardware Encryption**:
   - Automatic IMAP domain detection with step-by-step guides for app passwords (Orange, Gmail, iCloud, Yahoo, Free, OVH, etc.).
   - Local OAuth2 PKCE login for Microsoft (Outlook / Hotmail / M365).
   - Passwords and tokens encrypted locally via `electron.safeStorage` (Windows DPAPI) on Windows or **Android Keystore (`AES-256-GCM`)** on Android.
2. **100% No-AI Sorting (Tier 1)**:
   - Read-only IMAP audit with incremental resume stored in local SQLite (`FTS5` full-text search on Windows).
   - Grouped view by sender or domain, `List-Unsubscribe` detection, and built-in local category dictionary (*Administrative, Banks, Invoices, Shopping, Jobs, Social, Health*).
   - **Dry-Run** preview before moving any message, configurable wave execution, reusable rules, and **Undo**.
3. **Optional AI Assistant (Tier 2)**:
   - **Free Copy-Paste** export/import for ChatGPT / Gemini / Claude Web (with email/number redaction in subject lines).
   - Optional local **Ollama** support or personal API key (Gemini / OpenAI-compatible).
4. **Local MCP Server — Windows Only (Tier 3)**:
   - Streamable HTTP transport (`http://127.0.0.1:3847/mcp`) and `--mcp-stdio` mode.
   - Tools: `list_accounts`, `list_folders`, `audit_summary`, `search_emails`, `propose_sort_plan`, `apply_sort_plan` (gated by visual UI approval by default).

### Development & Packaging Commands

> Under Windows PowerShell, use `npm.cmd` if `.ps1` script execution is restricted.

```powershell
# Install dependencies
npm.cmd install

# Run unit & integration tests
npm.cmd test

# Build the Electron backend and React UI
npm.cmd run build

# Run the desktop app locally
npm.cmd start

# Build distributable Windows package (unpacked folder + .zip in release/)
npm.cmd run dist:win

# Build renderer and sync Capacitor Android project
npm.cmd run cap:sync
```

> Note: the `zip` target produces `release/v0.1.3/win-unpacked/IA For EveryOne — SortBox E-Mail.exe` and `release/v0.1.3/IA-For-EveryOne-SortBox-Email-0.1.3-win.zip` without triggering Windows blocks on unsigned NSIS temporary binaries. To generate an NSIS `Setup.exe` (such as with a signing certificate), run `.\node_modules\.bin\electron-builder.cmd --win nsis`.

### Code Signing Policy

Free code signing provided by [SignPath.io](https://signpath.io/), certificate by [SignPath Foundation](https://signpath.org/).

- **Maintainers & Approvers:** Only the repository owner (`kaivinoux`) can trigger release tags and approve signing requests.
- **Build Integrity:** Release binaries are built exclusively via GitHub Actions ([release.yml](.github/workflows/release.yml) for Windows and [android.yml](.github/workflows/android.yml) for Android) directly from commits and tags on `main`. See [SIGNING.md](SIGNING.md).

### Privacy Policy

- **100% Local Execution:** `IA For EveryOne — SortBox E-Mail` runs locally on your Windows or Android device. No telemetry, analytics, or user email data is ever sent to the developer or any third-party backend operated by the project.
- **Credential Security:** Mail passwords and OAuth tokens are encrypted locally using Windows DPAPI (`electron.safeStorage`) on Windows or Android Keystore (`AES-256-GCM`) on Android, and never leave your device except to authenticate directly with the email provider you configured.
- **Optional AI Features:** AI prompts are only sent if you explicitly choose to copy-paste an anonymized sender summary or configure your own local Ollama instance or personal API key.
- **Full Policy:** [PRIVACY.md](PRIVACY.md)

---

## Français

Application **100 % locale** (Windows et téléphone Android) pour connecter n'importe quelle boîte mail (*Orange, Gmail, Outlook / M365, Free, SFR, La Poste, OVH, iCloud, Yahoo, IMAP*), nettoyer et trier ses messages en toute sécurité **sans aucune IA requise**, tout en offrant un mode **IA Copier-Coller / Ollama / API** (et un **serveur MCP intégré** sur Windows).

### Téléchargement rapide (Windows)

Télécharge la dernière version depuis la page [Releases](https://github.com/kaivinoux/SortBoxMCP/releases), extrais le dossier (ou lance l'installeur Windows) et démarre `IA For EveryOne — SortBox E-Mail.exe`.

> **Signature de code :** Free code signing provided by [SignPath.io](https://signpath.io/), certificate by [SignPath Foundation](https://signpath.org/). *(Intégration en cours d'activation — voir [SIGNING.md](SIGNING.md) ; tant que la signature n'est pas encore active sur une release, Windows Defender SmartScreen ou Smart App Control peuvent bloquer l'exécutable).*

### Téléchargement rapide (Android `.apk`)

Télécharge le fichier `IA-For-EveryOne-SortBox-Email-Android.apk` depuis la page [Releases](https://github.com/kaivinoux/SortBoxMCP/releases) (tag `android-v*`, par ex. [android-v0.2.0](https://github.com/kaivinoux/SortBoxMCP/releases/tag/android-v0.2.0)) ou depuis les artefacts du workflow [Android APK](.github/workflows/android.yml), puis ouvre le fichier `.apk` sur ton téléphone Android (autorise l'installation d'applications de source inconnue si Android le demande).

- **100 % local sur le téléphone :** secrets chiffrés via **Android Keystore (`AES-256-GCM`)**, index SQLite local sur l'appareil, sauvegarde cloud Android désactivée (`allowBackup=false`).
- **Mêmes outils de tri :** connexion directe IMAP (Orange, Gmail App Password, Free, SFR, La Poste, OVH, iCloud, Yahoo, Outlook OAuth2 si `clientId` configuré), groupement par expéditeur sans IA, aperçu Dry-Run, exécution par vagues, Undo et mode IA Copier-Coller / API. *(Le serveur MCP local reste spécifique à la version PC Windows.)*

### Fonctionnalités

1. **Multi-boîtes & Chiffrement local matériel** :
   - Auto-détection IMAP par domaine avec guides pas-à-pas pour mots de passe d'application (Orange, Gmail, iCloud, Yahoo, Free, OVH...).
   - Connexion OAuth2 PKCE locale pour Microsoft (Outlook / Hotmail / M365).
   - Mots de passe et tokens chiffrés localement via `electron.safeStorage` (DPAPI Windows) sur PC ou **Android Keystore (`AES-256-GCM`)** sur Android.
2. **Tri 100 % sans IA (Niveau 1)** :
   - Audit IMAP en lecture seule avec reprise incrémentale stockée dans SQLite (et recherche plein texte `FTS5` sur Windows).
   - Vue regroupée par expéditeur ou domaine, détection `List-Unsubscribe`, et dictionnaire local de catégories (*Administratif, Banques, Factures, Achats, Emploi, Social, Santé*).
   - Aperçu **Dry-Run** avant tout déplacement, exécution par vagues configurables, règles réutilisables et **Undo** (annulation).
3. **Assistant IA sans agent externe (Niveau 2)** :
   - Export/import **Copier-Coller gratuit** pour ChatGPT / Gemini / Claude Web (avec masquage d'emails/numéros dans les objets).
   - Support optionnel d'**Ollama** (local) ou clé API perso (Gemini / OpenAI-compatible).
4. **Serveur MCP local — Windows uniquement (Niveau 3)** :
   - Transport Streamable HTTP (`http://127.0.0.1:3847/mcp`) et mode `--mcp-stdio`.
   - Outils : `list_accounts`, `list_folders`, `audit_summary`, `search_emails`, `propose_sort_plan`, `apply_sort_plan` (bloqué par défaut derrière validation visuelle UI).

### Commandes de développement & packaging

> Sous PowerShell Windows, utilise `npm.cmd` si l'exécution de scripts `.ps1` est restreinte.

```powershell
# Installer les dépendances
npm.cmd install

# Lancer les tests unitaires et d'intégration
npm.cmd test

# Compiler le backend Electron et l'interface React
npm.cmd run build

# Lancer l'application en local
npm.cmd start

# Générer le package Windows distribuable (dossier exécutable + archive .zip dans release/)
npm.cmd run dist:win

# Compiler l'interface web et synchroniser le projet Android Capacitor
npm.cmd run cap:sync
```

> Note : la cible `zip` produit `release/v0.1.3/win-unpacked/IA For EveryOne — SortBox E-Mail.exe` et `release/v0.1.3/IA-For-EveryOne-SortBox-Email-0.1.3-win.zip` sans déclencher le blocage Windows sur les binaires temporaires NSIS non signés. Pour générer un `Setup.exe` NSIS (notamment avec certificat de signature), lance `.\node_modules\.bin\electron-builder.cmd --win nsis`.

### Politique de signature de code

Free code signing provided by [SignPath.io](https://signpath.io/), certificate by [SignPath Foundation](https://signpath.org/).

- **Mainteneurs & approbateurs :** seul le propriétaire du dépôt (`kaivinoux`) peut créer des tags de release et approuver les demandes de signature.
- **Intégrité des builds :** les binaires publiés sont compilés exclusivement via GitHub Actions ([release.yml](.github/workflows/release.yml) pour Windows et [android.yml](.github/workflows/android.yml) pour Android) depuis les commits et tags de `main`. Voir [SIGNING.md](SIGNING.md).

### Politique de confidentialité

- **Exécution 100 % locale :** `IA For EveryOne — SortBox E-Mail` tourne localement sur ton PC Windows ou ton téléphone Android. Aucune télémétrie, analytics ou donnée email n'est jamais envoyée au développeur ou à un serveur tiers exploité par le projet.
- **Sécurité des identifiants :** les mots de passe mail et tokens OAuth sont chiffrés localement via Windows DPAPI (`electron.safeStorage`) sur Windows ou Android Keystore (`AES-256-GCM`) sur Android, et ne quittent jamais l'appareil sauf pour s'authentifier directement auprès du fournisseur mail configuré.
- **Fonctions IA optionnelles :** aucun prompt n'est envoyé tant que tu ne copies-colles pas volontairement un résumé anonymisé ou ne configures pas ton propre serveur Ollama local ou ta clé API personnelle.
- **Politique complète :** [PRIVACY.md](PRIVACY.md)
