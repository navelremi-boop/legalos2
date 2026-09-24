import type {
  ApiErrorBody,
  ConnexionRequest,
  ConnexionResponse,
  TotpVerifyRequest,
  TotpVerifyResponse,
} from "@/lib/auth/types";

export const DEFAULT_INSTANCE_URL = "http://127.0.0.1:8088";

export function normalizeInstanceUrl(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed === "") {
    return DEFAULT_INSTANCE_URL;
  }
  return trimmed.replace(/\/+$/, "");
}

/** Chemins API exposés via Caddy (`/api/*` → service Rust). */
export function apiUrl(instanceUrl: string, path: string): string {
  const base = normalizeInstanceUrl(instanceUrl);
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  if (normalizedPath.startsWith("/api/")) {
    return `${base}${normalizedPath}`;
  }
  return `${base}/api${normalizedPath}`;
}

type ApiResult<T> =
  | { ok: true; status: number; data: T }
  | { ok: false; status: number; error: ApiErrorBody };

async function postJson<T>(
  instanceUrl: string,
  path: string,
  body: unknown,
): Promise<ApiResult<T>> {
  const base = normalizeInstanceUrl(instanceUrl);
  let response: Response;
  try {
    response = await fetch(apiUrl(base, path), {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    return {
      ok: false,
      status: 0,
      error: {
        code: "network_error",
        message: "Impossible de joindre l’instance. Vérifiez l’adresse et le réseau.",
      },
    };
  }

  const text = await response.text();
  let parsed: unknown = null;
  if (text !== "") {
    try {
      parsed = JSON.parse(text) as unknown;
    } catch {
      return {
        ok: false,
        status: response.status,
        error: {
          code: "invalid_response",
          message: "Réponse inattendue du serveur.",
        },
      };
    }
  }

  if (!response.ok) {
    const error =
      parsed !== null &&
      typeof parsed === "object" &&
      "code" in parsed &&
      "message" in parsed
        ? (parsed as ApiErrorBody)
        : {
            code: "http_error",
            message: `Erreur serveur (${String(response.status)}).`,
          };
    return { ok: false, status: response.status, error };
  }

  return { ok: true, status: response.status, data: parsed as T };
}

export function connexion(
  instanceUrl: string,
  body: ConnexionRequest,
): Promise<ApiResult<ConnexionResponse>> {
  return postJson<ConnexionResponse>(instanceUrl, "/auth/connexion", body);
}

export function verifierTotp(
  instanceUrl: string,
  body: TotpVerifyRequest,
): Promise<ApiResult<TotpVerifyResponse>> {
  return postJson<TotpVerifyResponse>(instanceUrl, "/auth/totp/verifier", body);
}
