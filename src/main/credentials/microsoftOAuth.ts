import crypto from "node:crypto";
import http from "node:http";

export interface OAuthTokenResult {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  email?: string;
}

function base64UrlEncode(buf: Buffer): string {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function createPkcePair(): { verifier: string; challenge: string } {
  const verifier = base64UrlEncode(crypto.randomBytes(32));
  const challenge = base64UrlEncode(
    crypto.createHash("sha256").update(verifier).digest(),
  );
  return { verifier, challenge };
}

function decodeJwtEmail(idToken?: string): string | undefined {
  if (!idToken) return undefined;
  const parts = idToken.split(".");
  if (parts.length < 2) return undefined;
  try {
    const payload = JSON.parse(
      Buffer.from(parts[1], "base64url").toString("utf8"),
    ) as Record<string, unknown>;
    const candidate =
      payload.preferred_username ?? payload.email ?? payload.upn;
    return typeof candidate === "string" ? candidate.toLowerCase() : undefined;
  } catch {
    return undefined;
  }
}

export async function runMicrosoftPkceLogin(params: {
  clientId: string;
  loginHint?: string;
  openExternal: (url: string) => Promise<void>;
  timeoutMs?: number;
}): Promise<OAuthTokenResult> {
  const clientId = params.clientId.trim();
  if (!clientId) {
    throw new Error(
      "Client ID Microsoft manquant. Renseigne un Client ID Azure (App publique) dans les paramètres ou l'assistant.",
    );
  }

  const { verifier, challenge } = createPkcePair();
  const state = base64UrlEncode(crypto.randomBytes(16));
  const scopes = [
    "https://outlook.office.com/IMAP.AccessAsUser.All",
    "offline_access",
    "openid",
    "email",
    "profile",
  ].join(" ");

  return new Promise<OAuthTokenResult>((resolve, reject) => {
    let settled = false;
    let timer: NodeJS.Timeout | null = null;

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      server.close();
      fn();
    };

    const server = http.createServer(async (req, res) => {
      try {
        const reqUrl = new URL(req.url || "/", "http://127.0.0.1");
        if (reqUrl.pathname !== "/callback") {
          res.writeHead(404);
          res.end("Not Found");
          return;
        }

        const error = reqUrl.searchParams.get("error");
        const errorDesc = reqUrl.searchParams.get("error_description");
        if (error) {
          res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
          res.end(
            `<h2>Autorisation annulée</h2><p>${errorDesc || error}</p><p>Tu peux fermer cet onglet.</p>`,
          );
          finish(() => reject(new Error(errorDesc || error)));
          return;
        }

        const code = reqUrl.searchParams.get("code");
        const returnedState = reqUrl.searchParams.get("state");
        if (!code || returnedState !== state) {
          res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
          res.end("<h2>Réponse OAuth invalide (state mismatch).</h2>");
          finish(() => reject(new Error("État OAuth2 invalide.")));
          return;
        }

        const addr = server.address();
        const port = typeof addr === "object" && addr ? addr.port : 0;
        const redirectUri = `http://127.0.0.1:${port}/callback`;

        const tokenResp = await fetch(
          "https://login.microsoftonline.com/common/oauth2/v2.0/token",
          {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
              client_id: clientId,
              grant_type: "authorization_code",
              code,
              redirect_uri: redirectUri,
              code_verifier: verifier,
              scope: scopes,
            }),
          },
        );

        const tokenJson = (await tokenResp.json()) as Record<string, unknown>;
        if (!tokenResp.ok || !tokenJson.access_token) {
          const msg = String(
            tokenJson.error_description || tokenJson.error || "Échec token OAuth2",
          );
          res.writeHead(500, { "Content-Type": "text/html; charset=utf-8" });
          res.end(`<h2>Erreur Microsoft OAuth2</h2><p>${msg}</p>`);
          finish(() => reject(new Error(msg)));
          return;
        }

        const expiresInSec = Number(tokenJson.expires_in ?? 3600);
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(
          "<h2>Connexion réussie à SortBox MCP !</h2><p>Tu peux fermer cette fenêtre et revenir dans l'application.</p>",
        );

        finish(() =>
          resolve({
            accessToken: String(tokenJson.access_token),
            refreshToken: String(tokenJson.refresh_token || ""),
            expiresAt: Date.now() + expiresInSec * 1000,
            email: decodeJwtEmail(
              typeof tokenJson.id_token === "string"
                ? tokenJson.id_token
                : undefined,
            ),
          }),
        );
      } catch (err) {
        finish(() => reject(err));
      }
    });

    server.listen(0, "127.0.0.1", async () => {
      try {
        const addr = server.address();
        const port = typeof addr === "object" && addr ? addr.port : 0;
        const redirectUri = `http://127.0.0.1:${port}/callback`;

        const authUrl = new URL(
          "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
        );
        authUrl.searchParams.set("client_id", clientId);
        authUrl.searchParams.set("response_type", "code");
        authUrl.searchParams.set("redirect_uri", redirectUri);
        authUrl.searchParams.set("response_mode", "query");
        authUrl.searchParams.set("scope", scopes);
        authUrl.searchParams.set("state", state);
        authUrl.searchParams.set("code_challenge", challenge);
        authUrl.searchParams.set("code_challenge_method", "S256");
        if (params.loginHint) {
          authUrl.searchParams.set("login_hint", params.loginHint);
        }

        timer = setTimeout(() => {
          finish(() =>
            reject(new Error("Délai d'attente de connexion Microsoft dépassé.")),
          );
        }, params.timeoutMs ?? 180_000);

        await params.openExternal(authUrl.toString());
      } catch (err) {
        finish(() => reject(err));
      }
    });
  });
}

export async function refreshMicrosoftToken(
  clientId: string,
  refreshToken: string,
): Promise<OAuthTokenResult> {
  const resp = await fetch(
    "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        scope:
          "https://outlook.office.com/IMAP.AccessAsUser.All offline_access openid email profile",
      }),
    },
  );
  const data = (await resp.json()) as Record<string, unknown>;
  if (!resp.ok || !data.access_token) {
    throw new Error(
      String(data.error_description || data.error || "Échec refresh token Microsoft"),
    );
  }
  const expiresInSec = Number(data.expires_in ?? 3600);
  return {
    accessToken: String(data.access_token),
    refreshToken: String(data.refresh_token || refreshToken),
    expiresAt: Date.now() + expiresInSec * 1000,
  };
}
