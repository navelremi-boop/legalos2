import { invoke } from "@tauri-apps/api/core";

const STORAGE_INSTANCE = "legalos.instance_url";
const LEGACY_ACCESS = "legalos.access_token";
const LEGACY_REFRESH = "legalos.refresh_token";

let accessToken: string | null = null;

function purgeBrowserTokens(): void {
  localStorage.removeItem(LEGACY_ACCESS);
  localStorage.removeItem(LEGACY_REFRESH);
}

export function loadInstanceUrl(): string | null {
  return localStorage.getItem(STORAGE_INSTANCE);
}

export function saveInstanceUrl(url: string): void {
  localStorage.setItem(STORAGE_INSTANCE, url);
}

export function loadSessionTokens(): {
  accessToken: string | null;
  refreshToken: null;
} {
  purgeBrowserTokens();
  return {
    accessToken,
    refreshToken: null,
  };
}

export async function saveSessionTokens(access: string, refresh: string): Promise<void> {
  accessToken = access;
  purgeBrowserTokens();
  await invoke("keyring_store_refresh", { token: refresh });
}

export async function clearSession(): Promise<void> {
  accessToken = null;
  purgeBrowserTokens();
  await invoke("keyring_clear_refresh");
}

export function isOnboardingComplete(): boolean {
  return accessToken !== null && accessToken.length > 0;
}
