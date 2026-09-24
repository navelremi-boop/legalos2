const STORAGE_INSTANCE = "legalos.instance_url";
const STORAGE_ACCESS = "legalos.access_token";
const STORAGE_REFRESH = "legalos.refresh_token";

export function loadInstanceUrl(): string | null {
  return localStorage.getItem(STORAGE_INSTANCE);
}

export function saveInstanceUrl(url: string): void {
  localStorage.setItem(STORAGE_INSTANCE, url);
}

export function loadSessionTokens(): {
  accessToken: string | null;
  refreshToken: string | null;
} {
  return {
    accessToken: localStorage.getItem(STORAGE_ACCESS),
    refreshToken: localStorage.getItem(STORAGE_REFRESH),
  };
}

export function saveSessionTokens(accessToken: string, refreshToken: string): void {
  localStorage.setItem(STORAGE_ACCESS, accessToken);
  localStorage.setItem(STORAGE_REFRESH, refreshToken);
}

export function clearSession(): void {
  localStorage.removeItem(STORAGE_ACCESS);
  localStorage.removeItem(STORAGE_REFRESH);
}

export function isOnboardingComplete(): boolean {
  const { accessToken } = loadSessionTokens();
  return accessToken !== null && accessToken.length > 0;
}
