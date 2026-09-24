#!/usr/bin/env node
/**
 * Recette S2 (minimal) — connexion HTTP + TOTP + JWKS, sans UI poste.
 * Prérequis : instance S1 up (`node tests/recette/s1.mjs` ou compose), `.env` avec SECRETS_CHIFFREMENT_KEY.
 */
import { createHmac } from "node:crypto";
const demoEmail = process.env.LEGALOS_DEMO_EMAIL ?? "demo@cabinet-fictif.example";
const demoPassword = process.env.LEGALOS_DEMO_PASSWORD ?? "MotDePasseDemo123!";
const totpSecretB32 =
  process.env.LEGALOS_DEMO_TOTP_SECRET_BASE32 ?? "MFRGG43FMZQXIZLTMVRXG43FNZQXIZLTO";
const apiPort = process.env.API_HOST_PORT ?? "8080";
const baseUrl = process.env.LEGALOS_API_URL ?? `http://127.0.0.1:${apiPort}`;

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

function totpNow(secretBase32, step = 30, digits = 6) {
  const key = base32Decode(secretBase32);
  const counter = Math.floor(Date.now() / 1000 / step);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac("sha1", key).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return String(code % 10 ** digits).padStart(digits, "0");
}

function fail(msg) {
  console.error(`s2: FAIL — ${msg}`);
  process.exit(1);
}

const health = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(15_000) });
if (!health.ok) fail(`GET /health → ${health.status}`);

const connexion = await fetch(`${baseUrl}/auth/connexion`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    email: demoEmail,
    password: demoPassword,
    nom_appareil: "recette-s2",
  }),
  signal: AbortSignal.timeout(15_000),
});
if (!connexion.ok) fail(`POST /auth/connexion → ${connexion.status}`);
const connexionBody = await connexion.json();
if (!connexionBody.totp_requis || !connexionBody.session_token) {
  fail("réponse connexion sans totp_requis/session_token");
}

const verify = await fetch(`${baseUrl}/auth/totp/verifier`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    session_token: connexionBody.session_token,
    code_totp: totpNow(totpSecretB32),
  }),
  signal: AbortSignal.timeout(15_000),
});
if (!verify.ok) fail(`POST /auth/totp/verifier → ${verify.status}`);
const tokens = await verify.json();
if (!tokens.access_token || !tokens.refresh_token) {
  fail("jetons absents après TOTP");
}

const jwks = await fetch(`${baseUrl}/auth/jwks`, { signal: AbortSignal.timeout(15_000) });
if (!jwks.ok) fail(`GET /auth/jwks → ${jwks.status}`);
const jwksBody = await jwks.json();
if (!Array.isArray(jwksBody.keys) || jwksBody.keys.length === 0) {
  fail("JWKS vide");
}

const accessParts = tokens.access_token.split(".");
if (accessParts.length !== 3) fail("access_token JWT mal formé");
const headerJson = JSON.parse(Buffer.from(accessParts[0], "base64url").toString("utf8"));
if (headerJson.alg !== "RS256") fail(`JWT alg attendu RS256, reçu ${headerJson.alg ?? "?"}`);
const kid = headerJson.kid;
if (!kid) fail("JWT sans kid");
if (!jwksBody.keys.some((k) => k.kid === kid && k.alg === "RS256")) {
  fail("kid du JWT absent du JWKS");
}
const payloadJson = JSON.parse(Buffer.from(accessParts[1], "base64url").toString("utf8"));
const expectedAud = process.env.JWT_AUDIENCE ?? "legalos-powersync";
if (payloadJson.aud !== expectedAud) {
  fail(`JWT aud attendu ${expectedAud}, reçu ${payloadJson.aud ?? "?"}`);
}

console.log("s2: OK");
