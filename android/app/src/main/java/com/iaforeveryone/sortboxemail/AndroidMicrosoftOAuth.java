package com.iaforeveryone.sortboxemail;

import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.util.Base64;
import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.URL;
import java.net.URLDecoder;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.HashMap;
import java.util.Map;
import javax.net.ssl.HttpsURLConnection;
import org.json.JSONObject;

public class AndroidMicrosoftOAuth {
    public static final String DEFAULT_MICROSOFT_CLIENT_ID =
        "b038a8f9-be23-4b78-9221-3d60bdf79004";
    private static final String SCOPES =
        "https://outlook.office.com/IMAP.AccessAsUser.All offline_access openid email profile";

    public static String resolveClientId(String overrideClientId, String savedClientId) {
        if (overrideClientId != null && !overrideClientId.trim().isEmpty()) {
            return overrideClientId.trim();
        }
        if (savedClientId != null && !savedClientId.trim().isEmpty()) {
            return savedClientId.trim();
        }
        return DEFAULT_MICROSOFT_CLIENT_ID;
    }

    public static String extractCustomClientId(String savedClientId) {
        if (savedClientId == null) return "";
        String trimmed = savedClientId.trim();
        return (!trimmed.isEmpty() && !DEFAULT_MICROSOFT_CLIENT_ID.equals(trimmed)) ? trimmed : "";
    }

    public static class TokenResult {
        public String accessToken;
        public String refreshToken;
        public long expiresAt;
        public String email;
    }

    private static String randomUrlSafe(int bytes) {
        byte[] b = new byte[bytes];
        new SecureRandom().nextBytes(b);
        return Base64.encodeToString(b, Base64.URL_SAFE | Base64.NO_WRAP | Base64.NO_PADDING);
    }

    private static String sha256Challenge(String verifier) throws Exception {
        byte[] digest = MessageDigest.getInstance("SHA-256")
            .digest(verifier.getBytes(StandardCharsets.US_ASCII));
        return Base64.encodeToString(digest, Base64.URL_SAFE | Base64.NO_WRAP | Base64.NO_PADDING);
    }

    private static String decodeJwtEmail(String idToken) {
        if (idToken == null || !idToken.contains(".")) return null;
        try {
            String[] parts = idToken.split("\\.");
            if (parts.length < 2) return null;
            byte[] decoded = Base64.decode(parts[1], Base64.URL_SAFE | Base64.NO_WRAP);
            JSONObject obj = new JSONObject(new String(decoded, StandardCharsets.UTF_8));
            String candidate = obj.optString("preferred_username", "");
            if (candidate.isEmpty()) candidate = obj.optString("email", "");
            if (candidate.isEmpty()) candidate = obj.optString("upn", "");
            return candidate.isEmpty() ? null : candidate.toLowerCase();
        } catch (Exception e) {
            return null;
        }
    }

    public static TokenResult runPkceLogin(Context context, String clientId, String loginHint) throws Exception {
        if (clientId == null || clientId.trim().isEmpty()) {
            throw new IllegalArgumentException(
                "Client ID Microsoft manquant. Renseigne un Client ID Azure (App publique)."
            );
        }
        String verifier = randomUrlSafe(32);
        String challenge = sha256Challenge(verifier);
        String state = randomUrlSafe(16);

        try (ServerSocket server = new ServerSocket(0, 1, InetAddress.getByName("127.0.0.1"))) {
            server.setSoTimeout(180_000);
            int port = server.getLocalPort();
            String redirectUri = "http://127.0.0.1:" + port + "/callback";

            StringBuilder authUrl = new StringBuilder("https://login.microsoftonline.com/common/oauth2/v2.0/authorize?");
            authUrl.append("client_id=").append(URLEncoder.encode(clientId.trim(), "UTF-8"));
            authUrl.append("&response_type=code");
            authUrl.append("&redirect_uri=").append(URLEncoder.encode(redirectUri, "UTF-8"));
            authUrl.append("&response_mode=query");
            authUrl.append("&scope=").append(URLEncoder.encode(SCOPES, "UTF-8"));
            authUrl.append("&state=").append(URLEncoder.encode(state, "UTF-8"));
            authUrl.append("&code_challenge=").append(URLEncoder.encode(challenge, "UTF-8"));
            authUrl.append("&code_challenge_method=S256");
            if (loginHint != null && !loginHint.trim().isEmpty()) {
                authUrl.append("&login_hint=").append(URLEncoder.encode(loginHint.trim(), "UTF-8"));
            }

            Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(authUrl.toString()));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            context.startActivity(intent);

            while (true) {
                try (Socket client = server.accept()) {
                    BufferedReader reader = new BufferedReader(
                        new InputStreamReader(client.getInputStream(), StandardCharsets.UTF_8)
                    );
                    String firstLine = reader.readLine();
                    if (firstLine == null || !firstLine.contains(" ")) continue;
                    String reqPath = firstLine.split(" ")[1];
                    if (!reqPath.startsWith("/callback")) {
                        writeHttp(client, 404, "Not found");
                        continue;
                    }
                    Map<String, String> query = parseQuery(reqPath);
                    if (query.containsKey("error")) {
                        String err = query.get("error_description") != null ? query.get("error_description") : query.get("error");
                        writeHttp(client, 400, "<h2>Autorisation annulée</h2><p>" + err + "</p>");
                        throw new IllegalStateException(err);
                    }
                    String code = query.get("code");
                    if (code == null || !state.equals(query.get("state"))) {
                        writeHttp(client, 400, "<h2>State OAuth2 invalide</h2>");
                        throw new IllegalStateException("État OAuth2 invalide.");
                    }

                    TokenResult tokens = exchangeToken(clientId.trim(), code, redirectUri, verifier);
                    writeHttp(client, 200, "<h2>Connexion réussie à SortBox E-Mail !</h2><p>Tu peux revenir dans l'application.</p>");
                    return tokens;
                }
            }
        }
    }

    private static TokenResult exchangeToken(String clientId, String code, String redirectUri, String verifier) throws Exception {
        String body =
            "client_id=" + URLEncoder.encode(clientId, "UTF-8") +
            "&grant_type=authorization_code" +
            "&code=" + URLEncoder.encode(code, "UTF-8") +
            "&redirect_uri=" + URLEncoder.encode(redirectUri, "UTF-8") +
            "&code_verifier=" + URLEncoder.encode(verifier, "UTF-8") +
            "&scope=" + URLEncoder.encode(SCOPES, "UTF-8");
        return postTokenRequest(body);
    }

    public static TokenResult refreshToken(String clientId, String refreshToken) throws Exception {
        String body =
            "client_id=" + URLEncoder.encode(clientId, "UTF-8") +
            "&grant_type=refresh_token" +
            "&refresh_token=" + URLEncoder.encode(refreshToken, "UTF-8") +
            "&scope=" + URLEncoder.encode(SCOPES, "UTF-8");
        return postTokenRequest(body);
    }

    private static TokenResult postTokenRequest(String formBody) throws Exception {
        URL url = new URL("https://login.microsoftonline.com/common/oauth2/v2.0/token");
        HttpsURLConnection conn = (HttpsURLConnection) url.openConnection();
        conn.setRequestMethod("POST");
        conn.setRequestProperty("Content-Type", "application/x-www-form-urlencoded");
        conn.setDoOutput(true);
        try (OutputStream os = conn.getOutputStream()) {
            os.write(formBody.getBytes(StandardCharsets.UTF_8));
        }
        int status = conn.getResponseCode();
        BufferedReader br = new BufferedReader(new InputStreamReader(
            status >= 400 ? conn.getErrorStream() : conn.getInputStream(),
            StandardCharsets.UTF_8
        ));
        StringBuilder sb = new StringBuilder();
        String line;
        while ((line = br.readLine()) != null) sb.append(line);
        JSONObject json = new JSONObject(sb.toString());
        if (status >= 400 || !json.has("access_token")) {
            throw new IllegalStateException(json.optString("error_description", json.optString("error", "Échec OAuth2")));
        }
        TokenResult res = new TokenResult();
        res.accessToken = json.getString("access_token");
        res.refreshToken = json.optString("refresh_token", "");
        res.expiresAt = System.currentTimeMillis() + json.optLong("expires_in", 3600) * 1000L;
        res.email = decodeJwtEmail(json.optString("id_token", null));
        return res;
    }

    private static Map<String, String> parseQuery(String pathWithQuery) throws Exception {
        Map<String, String> map = new HashMap<>();
        int idx = pathWithQuery.indexOf('?');
        if (idx < 0) return map;
        String q = pathWithQuery.substring(idx + 1);
        for (String pair : q.split("&")) {
            int eq = pair.indexOf('=');
            if (eq > 0) {
                String k = URLDecoder.decode(pair.substring(0, eq), "UTF-8");
                String v = URLDecoder.decode(pair.substring(eq + 1), "UTF-8");
                map.put(k, v);
            }
        }
        return map;
    }

    private static void writeHttp(Socket client, int code, String html) throws Exception {
        byte[] body = ("<html><meta charset='utf-8'><body>" + html + "</body></html>").getBytes(StandardCharsets.UTF_8);
        String headers =
            "HTTP/1.1 " + code + " OK\r\n" +
            "Content-Type: text/html; charset=utf-8\r\n" +
            "Content-Length: " + body.length + "\r\n" +
            "Connection: close\r\n\r\n";
        OutputStream os = client.getOutputStream();
        os.write(headers.getBytes(StandardCharsets.US_ASCII));
        os.write(body);
        os.flush();
    }
}
