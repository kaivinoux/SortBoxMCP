# Privacy Policy — IA For EveryOne — SortBox E-Mail

**Last updated:** November 25, 2026

`IA For EveryOne — SortBox E-Mail` is an open-source, local-first Windows desktop application. **The project and its maintainer do not operate any backend servers and do not collect, store, track, or transmit any user data.**

## 1. Data Stored Locally on Your Computer

All application data stays exclusively inside your local Windows user profile (`%APPDATA%\IA For EveryOne — SortBox E-Mail\`):

- **Encrypted Credentials (`vault.json`):** Mail app passwords, OAuth2 tokens, and optional personal AI API keys are encrypted at rest using Windows DPAPI (`electron.safeStorage`), bound to your Windows user account.
- **Local Email Header Cache (`sortbox.sqlite`):** To provide fast sender grouping and offline search (`FTS5`), the application indexes email headers (`From`, `To`, `Subject`, `Date`, `Size`, flags, and `List-Unsubscribe`) locally. Full email bodies are not downloaded.
- **Runtime Configuration (`runtime.json`):** Stores only the local loopback MCP port (`127.0.0.1`) when you enable the optional MCP server.

You can delete all locally stored data at any time by removing your account in the app or deleting the folder above.

## 2. Network Connections

The application **never sends telemetry, analytics, or crash reports**. Network requests occur solely at your explicit request to:

1. **Your configured email server (IMAP/SMTP over TLS)** to list folders, fetch headers, or apply a sorting plan you approved.
2. **Microsoft OAuth2 (`login.microsoftonline.com`)** if you choose to authenticate an Outlook/Microsoft 365 account via OAuth2 PKCE.
3. **Your optional AI provider** if you explicitly enable built-in AI assistance (e.g., local Ollama on `127.0.0.1`, or Google Gemini / OpenAI-compatible API using your own API key) — only summarized sender domains/subject snippets are sent, never credentials.
4. **Local MCP clients (`127.0.0.1` loopback only)** if you manually enable the local MCP server. It is off by default and never binds to external network interfaces.

## 3. Contact

Because the software is MIT-licensed and open source, all source code can be inspected directly at:
https://github.com/kaivinoux/SortBoxMCP
