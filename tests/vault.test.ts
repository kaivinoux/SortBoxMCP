import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  SecretVault,
  type EncryptionProvider,
} from "../src/main/credentials/vault.js";

describe("SecretVault", () => {
  const tmpDirs: string[] = [];

  afterEach(() => {
    for (const d of tmpDirs) {
      fs.rmSync(d, { recursive: true, force: true });
    }
    tmpDirs.length = 0;
  });

  it("encrypts secrets at rest and rejects insecure plain fallback", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sortbox-vault-"));
    tmpDirs.push(dir);
    const vaultPath = path.join(dir, "vault.json");

    const mockCrypto: EncryptionProvider = {
      isAvailable: () => true,
      encrypt: (plain) => Buffer.from(`ENC:${plain}`, "utf8").toString("base64"),
      decrypt: (cipher) => {
        const decoded = Buffer.from(cipher, "base64").toString("utf8");
        return decoded.replace(/^ENC:/, "");
      },
    };

    const vault = new SecretVault(vaultPath, mockCrypto);
    vault.setSecret("acc1", { password: "super-secret-app-password" });

    const rawFile = fs.readFileSync(vaultPath, "utf8");
    expect(rawFile).not.toContain("super-secret-app-password");
    expect(vault.getSecret("acc1")?.password).toBe("super-secret-app-password");

    vault.deleteSecret("acc1");
    expect(vault.getSecret("acc1")).toBeNull();
  });

  it("throws if DPAPI encryption is unavailable", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sortbox-vault-err-"));
    tmpDirs.push(dir);
    const vault = new SecretVault(path.join(dir, "vault.json"), {
      isAvailable: () => false,
      encrypt: () => "",
      decrypt: () => "",
    });
    expect(() => vault.setSecret("acc1", { password: "x" })).toThrow();
  });
});
