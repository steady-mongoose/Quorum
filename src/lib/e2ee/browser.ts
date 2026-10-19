import { apiFetch } from "../api-base.ts";
import type { DmTransport, VaultState, VaultStore } from "./mailbox.ts";

const VAULT_KEY = "avouch-e2ee-vault-v1";

export function browserTransport(): DmTransport {
  return {
    async post(path, body) {
      const response = await apiFetch(path, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      return { status: response.status, body: await response.json().catch(() => null) };
    },
    async get(path) {
      const response = await apiFetch(path, { credentials: "include" });
      return { status: response.status, body: await response.json().catch(() => null) };
    },
  };
}

export function readBrowserVault(): VaultState | null {
  try {
    const raw = localStorage.getItem(VAULT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as VaultState;
    if (!parsed?.device?.boxSecret || !parsed.userId) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeBrowserVault(state: VaultState): void {
  localStorage.setItem(VAULT_KEY, JSON.stringify(state));
}

export function browserVaultStore(onWrite?: (state: VaultState) => void): VaultStore {
  return {
    read: readBrowserVault,
    write(state) {
      writeBrowserVault(state);
      onWrite?.(state);
    },
  };
}
