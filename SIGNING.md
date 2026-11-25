# Signature Windows gratuite via GitHub + SignPath Foundation

Ce dépôt inclut les workflows [ci.yml](.github/workflows/ci.yml) et [release.yml](.github/workflows/release.yml) prêts pour **SignPath Foundation** (signature numérique gratuite pour projets open source).

## 1. Déposer la demande SignPath Open Source

1. Rends-toi sur **https://signpath.org/open-source** et dépose la demande avec :
   - **Repository URL :** `https://github.com/kaivinoux/SortBoxMCP`
   - **License :** `MIT`
   - **Build system :** GitHub Actions (`windows-latest`)
2. Installe l'application GitHub **SignPath** sur ton dépôt `kaivinoux/SortBoxMCP` lorsque demandé pendant l'onboarding.

## 2. Configurer le projet dans SignPath

Dans le tableau de bord SignPath :
- Crée le projet `sortbox-email` (ou indique ton slug dans la variable GitHub `SIGNPATH_PROJECT_SLUG`).
- Crée une **Artifact Configuration** standard pour archive ZIP contenant un fichier PE (`*.exe`) — le workflow envoie d'abord l'exécutable de l'application puis l'installeur NSIS — puis associe la politique `release-signing`.

## 3. Configurer les Secrets et Variables sur GitHub

Dans ton dépôt GitHub → **Settings → Secrets and variables → Actions** :

- **Secret (`Secrets`):**
  - `SIGNPATH_API_TOKEN` : ton jeton API SignPath
- **Variables (`Variables`):**
  - `SIGNPATH_ORGANIZATION_ID` : l'UUID de ton organisation SignPath
  - `SIGNPATH_PROJECT_SLUG` : `sortbox-email` *(optionnel si identique)*
  - `SIGNPATH_SIGNING_POLICY_SLUG` : `release-signing` *(optionnel si identique)*
  - `SIGNPATH_ENABLED` : `true` *(laisse absent ou `false` tant que SignPath n'est pas encore approuvé)*

## 4. Publier une nouvelle version signée

Crée et pousse un tag de version `v*` :

```powershell
git tag v0.2.0
git push origin v0.2.0
```

GitHub Actions compile automatiquement l'application sur `windows-latest`, fait signer l'exécutable et l'installeur NSIS via SignPath, puis publie les binaires signés dans **GitHub Releases**.
