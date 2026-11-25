import fs from "node:fs";
import path from "node:path";

export interface SecretPayload {
  password?: string;
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number;
  customGoogleClientId?: string;
  customGoogleClientSecret?: string;
  aiApiKey?: string;
}

export interface EncryptionProvider {
  isAvailable(): boolean;
  encrypt(plainText: string): string;
  decrypt(encodedCipher: string): string;
}

export class SecretVault {
  private readonly filePath: string;
  private readonly crypto: EncryptionProvider;

  constructor(filePath: string, cryptoProvider: EncryptionProvider) {
    this.filePath = filePath;
    this.crypto = cryptoProvider;
  }

  private readRawMap(): Record<string, string> {
    if (!fs.existsSync(this.filePath)) {
      return {};
    }
    const content = fs.readFileSync(this.filePath, "utf8").trim();
    if (!content) return {};
    const parsed = JSON.parse(content) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("Format invalide du coffre d'identifiants.");
    }
    return parsed as Record<string, string>;
  }

  private writeRawMap(data: Record<string, string>): void {
    const dir = path.dirname(this.filePath);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify(data, null, 2), {
      encoding: "utf8",
      mode: 0o600,
    });
  }

  setSecret(key: string, payload: SecretPayload): void {
    if (!this.crypto.isAvailable()) {
      throw new Error(
        "Le chiffrement Windows DPAPI (safeStorage) n'est pas disponible sur cet environnement.",
      );
    }
    const map = this.readRawMap();
    map[key] = this.crypto.encrypt(JSON.stringify(payload));
    this.writeRawMap(map);
  }

  getSecret(key: string): SecretPayload | null {
    const map = this.readRawMap();
    const cipher = map[key];
    if (!cipher) return null;
    if (!this.crypto.isAvailable()) {
      throw new Error(
        "Le déchiffrement Windows DPAPI (safeStorage) n'est pas disponible.",
      );
    }
    const decrypted = this.crypto.decrypt(cipher);
    return JSON.parse(decrypted) as SecretPayload;
  }

  deleteSecret(key: string): void {
    const map = this.readRawMap();
    if (!(key in map)) return;
    delete map[key];
    this.writeRawMap(map);
  }

  hasSecret(key: string): boolean {
    const map = this.readRawMap();
    return Boolean(map[key]);
  }
}
