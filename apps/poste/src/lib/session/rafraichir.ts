import { invoke } from "@tauri-apps/api/core";
import { apiUrl } from "@/lib/auth/client";
import { jetonExpireBientot } from "@/lib/session/expirationJeton";
import { loadInstanceUrl, loadSessionTokens, saveSessionTokens } from "@/lib/session/storage";

const MARGE_MS = 60_000;

let enCours: Promise<string | null> | null = null;

/** Jeton d'accès utilisable. Le renouvelle depuis le trousseau s'il manque ou s'il expire bientôt. */
export function assurerJetonAcces(forcer = false): Promise<string | null> {
  const actuel = loadSessionTokens().accessToken;
  if (!forcer && actuel !== null && actuel !== "" && !jetonExpireBientot(actuel, Date.now(), MARGE_MS)) {
    return Promise.resolve(actuel);
  }
  if (enCours === null) {
    enCours = renouveler().finally(() => {
      enCours = null;
    });
  }
  return enCours;
}

async function renouveler(): Promise<string | null> {
  const instanceUrl = loadInstanceUrl();
  if (instanceUrl === null) return loadSessionTokens().accessToken;
  let refresh = "";
  try {
    refresh = await invoke<string>("keyring_read_refresh");
  } catch {
    return loadSessionTokens().accessToken;
  }
  if (refresh === "") return loadSessionTokens().accessToken;
  try {
    const reponse = await fetch(apiUrl(instanceUrl, "/auth/rafraichir"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ refresh_token: refresh }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!reponse.ok) return null;
    const json: unknown = await reponse.json();
    const access =
      typeof json === "object" && json !== null && "access_token" in json ? json.access_token : "";
    if (typeof access !== "string" || access === "") return null;
    await saveSessionTokens(access, refresh);
    return access;
  } catch {
    return loadSessionTokens().accessToken;
  }
}
