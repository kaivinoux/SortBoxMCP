# IA For EveryOne — SortBox E-Mail (Windows)

Application de bureau Windows **100 % locale** pour connecter n'importe quelle boîte mail (*Orange, Gmail, Outlook / M365, Free, SFR, La Poste, OVH, iCloud, Yahoo, IMAP*), nettoyer et trier ses messages en toute sécurité **sans aucune IA requise**, tout en offrant un mode **IA Copier-Coller / Ollama / API** et un **serveur MCP intégré**.

## Téléchargement rapide (Windows)

Télécharge la dernière version depuis la page [Releases](https://github.com/kaivinoux/SortBoxMCP/releases), extrais le dossier (ou lance l'installeur Windows) et démarre `IA For EveryOne — SortBox E-Mail.exe`.

> **Signature de code :** Free code signing provided by [SignPath.io](https://signpath.io/), certificate by [SignPath Foundation](https://signpath.org/). *(Intégration en cours d'activation — voir [SIGNING.md](SIGNING.md) ; tant que la signature n'est pas encore active sur une release, Windows Defender SmartScreen ou Smart App Control peuvent bloquer l'exécutable).*

## Fonctionnalités

1. **Multi-boîtes & Chiffrement Windows DPAPI** :
   - Auto-détection IMAP par domaine avec guides pas-à-pas pour mots de passe d'application (Orange, Gmail, iCloud, Yahoo, Free, OVH...).
   - Connexion OAuth2 PKCE locale pour Microsoft (Outlook / Hotmail / M365).
   - Mots de passe et tokens chiffrés via `electron.safeStorage` (DPAPI Windows).
2. **Tri 100 % sans IA (Niveau 1)** :
   - Audit IMAP en lecture seule avec reprise incrémentale stockée dans SQLite + recherche plein texte `FTS5`.
   - Vue regroupée par expéditeur ou domaine, détection `List-Unsubscribe`, et dictionnaire local de catégories (*Administratif, Banques, Factures, Achats, Emploi, Social, Santé*).
   - Aperçu **Dry-Run** avant tout déplacement, exécution par vagues configurables, règles réutilisables et **Undo** (annulation).
3. **Assistant IA sans agent externe (Niveau 2)** :
   - Export/import **Copier-Coller gratuit** pour ChatGPT / Gemini / Claude Web (avec masquage d'emails/numéros dans les objets).
   - Support optionnel d'**Ollama** (local) ou clé API perso (Gemini / OpenAI-compatible).
4. **Serveur MCP local (Niveau 3)** :
   - Transport Streamable HTTP (`http://127.0.0.1:3847/mcp`) et mode `--mcp-stdio`.
   - Outils : `list_accounts`, `list_folders`, `audit_summary`, `search_emails`, `propose_sort_plan`, `apply_sort_plan` (bloqué par défaut derrière validation visuelle UI).

## Commandes de développement & packaging Windows

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
```

> Note : la cible `zip` produit `release/v0.1.3/win-unpacked/IA For EveryOne — SortBox E-Mail.exe` et `release/v0.1.3/IA-For-EveryOne-SortBox-Email-0.1.3-win.zip` sans déclencher le blocage Windows sur les binaires temporaires NSIS non signés. Pour générer un `Setup.exe` NSIS (notamment avec certificat de signature), lance `.\node_modules\.bin\electron-builder.cmd --win nsis`.

## Code Signing Policy

Free code signing provided by [SignPath.io](https://signpath.io/), certificate by [SignPath Foundation](https://signpath.org/).

- **Maintainers & Approvers:** Only the repository owner (`kaivinoux`) can trigger release tags and approve signing requests.
- **Build Integrity:** Release binaries are built exclusively via GitHub Actions ([release.yml](.github/workflows/release.yml)) directly from tagged commits on `main`. See [SIGNING.md](SIGNING.md).

## Privacy Policy

- **100 % Local Execution:** `IA For EveryOne — SortBox E-Mail` runs locally on your Windows device. No telemetry, analytics, or user email data is ever sent to the developer or any third-party backend operated by the project.
- **Credential Security:** Mail passwords and OAuth tokens are encrypted locally using Windows DPAPI (`electron.safeStorage`) and never leave your machine except to authenticate directly with the email provider you configured.
- **Optional AI Features:** AI prompts are only sent if you explicitly choose to copy-paste an anonymized sender summary or configure your own local Ollama instance or personal API key.
