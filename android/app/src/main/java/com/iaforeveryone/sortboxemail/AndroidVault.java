package com.iaforeveryone.sortboxemail;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import org.json.JSONObject;

public class AndroidVault {
    private static final String KEYSTORE_PROVIDER = "AndroidKeyStore";
    private static final String KEY_ALIAS = "sortbox_vault_aes_key";
    private static final String PREFS_NAME = "sortbox_secure_vault";
    private static final int GCM_TAG_BITS = 128;
    private static final int GCM_IV_BYTES = 12;

    private final SharedPreferences prefs;

    public AndroidVault(Context context) {
        this.prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
    }

    private SecretKey getOrCreateKey() throws Exception {
        KeyStore ks = KeyStore.getInstance(KEYSTORE_PROVIDER);
        ks.load(null);
        if (ks.containsAlias(KEY_ALIAS)) {
            KeyStore.Entry entry = ks.getEntry(KEY_ALIAS, null);
            if (entry instanceof KeyStore.SecretKeyEntry) {
                return ((KeyStore.SecretKeyEntry) entry).getSecretKey();
            }
        }
        KeyGenerator keyGenerator = KeyGenerator.getInstance(
            KeyProperties.KEY_ALGORITHM_AES,
            KEYSTORE_PROVIDER
        );
        KeyGenParameterSpec spec = new KeyGenParameterSpec.Builder(
            KEY_ALIAS,
            KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT
        )
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256)
            .build();
        keyGenerator.init(spec);
        return keyGenerator.generateKey();
    }

    public synchronized void setSecret(String key, JSONObject payload) throws Exception {
        SecretKey secretKey = getOrCreateKey();
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, secretKey);
        byte[] iv = cipher.getIV();
        byte[] plainBytes = payload.toString().getBytes(StandardCharsets.UTF_8);
        byte[] encrypted = cipher.doFinal(plainBytes);

        ByteBuffer buf = ByteBuffer.allocate(4 + iv.length + encrypted.length);
        buf.putInt(iv.length);
        buf.put(iv);
        buf.put(encrypted);

        String encoded = Base64.encodeToString(buf.array(), Base64.NO_WRAP);
        prefs.edit().putString(key, encoded).apply();
    }

    public synchronized JSONObject getSecret(String key) throws Exception {
        String encoded = prefs.getString(key, null);
        if (encoded == null || encoded.isEmpty()) {
            return null;
        }
        byte[] raw = Base64.decode(encoded, Base64.NO_WRAP);
        ByteBuffer buf = ByteBuffer.wrap(raw);
        int ivLen = buf.getInt();
        if (ivLen <= 0 || ivLen > 32) {
            throw new IllegalStateException("Corrupted vault IV length");
        }
        byte[] iv = new byte[ivLen];
        buf.get(iv);
        byte[] encrypted = new byte[buf.remaining()];
        buf.get(encrypted);

        SecretKey secretKey = getOrCreateKey();
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, secretKey, new GCMParameterSpec(GCM_TAG_BITS, iv));
        byte[] plainBytes = cipher.doFinal(encrypted);
        return new JSONObject(new String(plainBytes, StandardCharsets.UTF_8));
    }

    public synchronized void deleteSecret(String key) {
        prefs.edit().remove(key).apply();
    }

    public synchronized boolean hasSecret(String key) {
        return prefs.contains(key);
    }
}
