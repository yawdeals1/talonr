import { decrypt, encrypt } from "../lib/crypto.js";

export interface ProxyConfig {
  server: string;
  username?: string;
  password?: string;
}

export function decryptSession(encryptedSession: string): unknown {
  return JSON.parse(decrypt(encryptedSession));
}

export function encryptSession(storageState: object): string {
  return encrypt(JSON.stringify(storageState));
}

export function decryptProxy(encryptedProxy: string): ProxyConfig {
  return JSON.parse(decrypt(encryptedProxy)) as ProxyConfig;
}

export function encryptProxy(proxy: ProxyConfig): string {
  return encrypt(JSON.stringify(proxy));
}
