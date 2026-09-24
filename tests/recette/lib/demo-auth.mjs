import { createHmac } from "node:crypto";

export const demoEmail = process.env.LEGALOS_DEMO_EMAIL ?? "demo@cabinet-fictif.example";
export const demoPassword = process.env.LEGALOS_DEMO_PASSWORD ?? "MotDePasseDemo123!";
export const totpSecretB32 =
  process.env.LEGALOS_DEMO_TOTP_SECRET_BASE32 ?? "MFRGG43FMZQXIZLTMVRXG43FNZQXIZLTO";

function base32Decode(input) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const cleaned = input.replace(/=+$/, "").toUpperCase();
  let bits = "";
  for (const c of cleaned) {
    const val = alphabet.indexOf(c);
    if (val < 0) throw new Error(`base32 invalide: ${c}`);
    bits += val.toString(2).padStart(5, "0");
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.slice(i, i + 8), 2));
  }
  return Buffer.from(bytes);
}

export function totpNow(secretBase32 = totpSecretB32) {
  const key = base32Decode(secretBase32);
  const counter = Math.floor(Date.now() / 1000 / 30);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac("sha1", key).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return String(code % 1_000_000).padStart(6, "0");
}

/** Jetons après connexion + TOTP (API directe port 8080). */
export async function demoAccessToken(apiBase, nomAppareil) {
  const connexion = await fetch(`${apiBase}/auth/connexion`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email: demoEmail,
      password: demoPassword,
      nom_appareil: nomAppareil,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!connexion.ok) {
    throw new Error(`connexion → ${connexion.status}`);
  }
  const connexionBody = await connexion.json();
  const verify = await fetch(`${apiBase}/auth/totp/verifier`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      session_token: connexionBody.session_token,
      code_totp: totpNow(),
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!verify.ok) {
    throw new Error(`totp → ${verify.status}`);
  }
  const tokens = await verify.json();
  if (!tokens.access_token) {
    throw new Error("access_token absent");
  }
  return tokens.access_token;
}
