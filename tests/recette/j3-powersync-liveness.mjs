#!/usr/bin/env node
/**
 * J3 — PowerSync joignable via Caddy (/sync) après auth S2.
 */
import { createHmac } from "node:crypto";

const demoEmail = process.env.LEGALOS_DEMO_EMAIL ?? "demo@cabinet-fictif.example";
const demoPassword = process.env.LEGALOS_DEMO_PASSWORD ?? "MotDePasseDemo123!";
const totpSecretB32 =
  process.env.LEGALOS_DEMO_TOTP_SECRET_BASE32 ?? "MFRGG43FMZQXIZLTMVRXG43FNZQXIZLTO";
const apiPort = process.env.API_HOST_PORT ?? "8080";
const caddyPort = process.env.CADDY_HTTP_PORT ?? "8088";
const apiBase = process.env.LEGALOS_API_URL ?? `http://127.0.0.1:${apiPort}`;
const caddyBase = process.env.LEGALOS_CADDY_URL ?? `http://127.0.0.1:${caddyPort}`;

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

function totpNow(secretBase32) {
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

function fail(msg) {
  console.error(`j3-powersync-liveness: FAIL — ${msg}`);
  process.exit(1);
}

const live = await fetch(`${caddyBase}/sync/probes/liveness`, {
  signal: AbortSignal.timeout(15_000),
});
if (!live.ok) fail(`GET /sync/probes/liveness → ${live.status}`);

const connexion = await fetch(`${apiBase}/auth/connexion`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    email: demoEmail,
    password: demoPassword,
    nom_appareil: "recette-j3-powersync",
  }),
  signal: AbortSignal.timeout(15_000),
});
if (!connexion.ok) fail(`POST /auth/connexion → ${connexion.status}`);
const connexionBody = await connexion.json();
if (!connexionBody.session_token) fail("session_token absent");

const verify = await fetch(`${apiBase}/auth/totp/verifier`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    session_token: connexionBody.session_token,
    code_totp: totpNow(totpSecretB32),
  }),
  signal: AbortSignal.timeout(15_000),
});
if (!verify.ok) fail(`POST /auth/totp/verifier → ${verify.status}`);
const { access_token: accessToken } = await verify.json();
if (!accessToken) fail("access_token absent");

const syncApi = await fetch(`${caddyBase}/sync/probes/readiness`, {
  headers: { Authorization: `Bearer ${accessToken}` },
  signal: AbortSignal.timeout(15_000),
});
if (syncApi.status === 401 || syncApi.status === 403) {
  fail(`PowerSync refuse le JWT post-TOTP (${syncApi.status})`);
}
if (!syncApi.ok) {
  fail(`GET /sync/probes/readiness → ${syncApi.status}`);
}

console.log("j3-powersync-liveness: OK");
