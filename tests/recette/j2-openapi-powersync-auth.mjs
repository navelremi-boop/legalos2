#!/usr/bin/env node
/**
 * J2 — OpenAPI auth + alignement JWT aud / JWKS avec PowerSync client_auth.
 * Hors périmètre : acceptation du jeton par le service PowerSync (J3).
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const apiPort = process.env.API_HOST_PORT ?? "8080";
const baseUrl = process.env.LEGALOS_API_URL ?? `http://127.0.0.1:${apiPort}`;
const expectedAud = process.env.JWT_AUDIENCE ?? "legalos-powersync";

function fail(msg) {
  console.error(`j2-openapi-powersync-auth: FAIL — ${msg}`);
  process.exit(1);
}

const openapiRes = await fetch(`${baseUrl}/openapi.json`, {
  signal: AbortSignal.timeout(15_000),
});
if (!openapiRes.ok) fail(`GET /openapi.json → ${openapiRes.status}`);
const openapi = await openapiRes.json();
const paths = openapi.paths ?? {};
for (const p of ["/auth/connexion", "/auth/totp/verifier", "/auth/jwks"]) {
  if (!paths[p]) fail(`OpenAPI sans chemin ${p}`);
}

const yaml = readFileSync(join(root, "instance/powersync/service.yaml"), "utf8");
if (!/client_auth:\s*\n\s*jwks_uri:\s*http:\/\/api:8080\/auth\/jwks/.test(yaml)) {
  fail("PowerSync client_auth.jwks_uri doit pointer vers l’API /auth/jwks");
}
if (!new RegExp(`audience:\\s*\\n\\s*-\\s*${expectedAud}\\b`).test(yaml)) {
  fail(`PowerSync client_auth.audience doit inclure ${expectedAud}`);
}

const jwksRes = await fetch(`${baseUrl}/auth/jwks`, { signal: AbortSignal.timeout(15_000) });
if (!jwksRes.ok) fail(`GET /auth/jwks → ${jwksRes.status}`);
const jwks = await jwksRes.json();
if (!Array.isArray(jwks.keys) || jwks.keys.length === 0) fail("JWKS vide");
if (!jwks.keys.every((k) => k.alg === "RS256" && k.kty === "RSA" && k.kid)) {
  fail("JWKS : clé RS256/RSA avec kid attendue");
}

console.log("j2-openapi-powersync-auth: OK");
