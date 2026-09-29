#!/usr/bin/env node
/**
 * Acceptation jalon Vue scindée — intercalaire Chrono (§ 7.4).
 * App Tauri ; instance http://127.0.0.1:8088 (démarrée si absente).
 * Si le worktree n'a pas de `.env`, compose utilise le checkout principal
 * (deux niveaux au-dessus) sans afficher le fichier.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { demoAccessToken, demoEmail, demoPassword, totpNow } from "./lib/demo-auth.mjs";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "../..");
const poste = join(root, "apps/poste");
const instanceUrl = process.env.LEGALOS_INSTANCE_URL ?? "http://127.0.0.1:8088";
const api = `${instanceUrl}/api`;
const posteId = "vue-scindee";
const marque = String(Date.now()).slice(-6);
const cdpPort = "9243";

/** Checkout avec `.env` : worktree si présent, sinon principal. */
function envRoot() {
  if (existsSync(join(root, ".env"))) return root;
  const principal = join(root, "..", "..");
  if (existsSync(join(principal, ".env"))) return principal;
  return root;
}

function fail(message) {
  console.error(`vue-scindee: FAIL — ${message}`);
  process.exit(1);
}
function ok(message) {
  console.log(`vue-scindee: ${message}`);
}
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function composeArgs(args) {
  const base = envRoot();
  return {
    cmd: "docker",
    args: [
      "compose",
      "-f",
      join(base, "instance", "docker-compose.yml"),
      "--env-file",
      join(base, ".env"),
      ...args,
    ],
    cwd: base,
  };
}

async function ensureInstance() {
  const sante = await fetch(`${instanceUrl}/health`).catch(() => null);
  if (sante?.ok) return;
  ok("instance absente — démarrage docker compose (checkout avec .env)");
  const { cmd, args, cwd } = composeArgs(["up", "-d", "--wait"]);
  const r = spawnSync(cmd, args, { cwd, stdio: "inherit", shell: false });
  if (r.status !== 0) fail(`docker compose up exit ${r.status ?? 1}`);
  const debut = Date.now();
  while (Date.now() - debut < 120_000) {
    const h = await fetch(`${instanceUrl}/health`).catch(() => null);
    if (h?.ok) return;
    await sleep(2_000);
  }
  fail("instance toujours injoignable après compose up");
}

function resetBase() {
  const roaming = process.env.APPDATA ?? join(homedir(), "AppData", "Roaming");
  const dataDir = join(roaming, "fr.legalos.poste");
  for (const ext of ["", "-shm", "-wal"]) {
    rmSync(join(dataDir, `legalos-powersync-${posteId}.db${ext}`), { force: true });
  }
}

function startApp() {
  const dir = join(tmpdir(), `legalos-webview-vue-scindee-${marque}`);
  mkdirSync(dir, { recursive: true });
  const configPath = join(tmpdir(), `legalos-vue-scindee-${marque}.json`);
  writeFileSync(
    configPath,
    JSON.stringify({
      app: {
        windows: [
          {
            width: 1280,
            height: 900,
            additionalBrowserArgs: `--remote-debugging-port=${cdpPort} --disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection`,
          },
        ],
      },
    }),
  );
  const child = spawn("cmd.exe", ["/d", "/s", "/c", `pnpm tauri dev --config ${configPath}`], {
    cwd: poste,
    env: {
      ...process.env,
      LEGALOS_POSTE_ID: posteId,
      WEBVIEW2_USER_DATA_FOLDER: dir,
      CARGO_BUILD_JOBS: process.env.CARGO_BUILD_JOBS ?? "2",
      VITE_LEGALOS_RECETTE_HOOKS: "1",
      LIBCLANG_PATH: process.env.LIBCLANG_PATH ?? "C:\\Program Files\\LLVM\\bin",
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  let log = "";
  const onData = (chunk) => {
    log += chunk.toString();
    if (log.length > 14_000) log = log.slice(-14_000);
  };
  child.stdout.on("data", onData);
  child.stderr.on("data", onData);
  child.logTail = () => log.slice(-2_000);
  return child;
}

async function stopApp(child) {
  if (!child || child.exitCode !== null) return;
  await new Promise((resolve) => {
    spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
    }).on("exit", resolve);
  });
  await sleep(800);
}

async function connectCdp() {
  const list = await fetch(`http://127.0.0.1:${cdpPort}/json`).then((r) => r.json());
  const page = list.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
  if (!page) throw new Error("webview absente");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve);
    ws.addEventListener("error", () => reject(new Error("websocket")));
  });
  let seq = 0;
  const pending = new Map();
  ws.addEventListener("message", (event) => {
    const msg = JSON.parse(String(event.data));
    const done = pending.get(msg.id);
    if (done) {
      pending.delete(msg.id);
      done(msg);
    }
  });
  const send = (method, params = {}) =>
    new Promise((resolve) => {
      const id = ++seq;
      pending.set(id, resolve);
      ws.send(JSON.stringify({ id, method, params }));
    });
  return { ws, send };
}

async function evaluate(send, expression) {
  const msg = await Promise.race([
    send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }),
    sleep(20_000).then(() => {
      throw new Error("cdp sans réponse");
    }),
  ]);
  if (msg.result?.exceptionDetails) {
    throw new Error(String(msg.result.exceptionDetails.text ?? "évaluation").slice(0, 240));
  }
  return msg.result?.result?.value;
}

async function waitCdp(child) {
  const start = Date.now();
  while (Date.now() - start < 420_000) {
    if (child.exitCode !== null) throw new Error(`tauri arrêté (${child.exitCode}) : ${child.logTail()}`);
    try {
      const list = await fetch(`http://127.0.0.1:${cdpPort}/json`);
      if (list.ok) {
        const pages = await list.json();
        if (pages.some((t) => t.type === "page" && t.webSocketDebuggerUrl)) return;
      }
    } catch {
      /* pas encore */
    }
    await sleep(400);
  }
  throw new Error(`webview ${cdpPort} — ${child.logTail()}`);
}

async function setField(send, id, value) {
  const okField = await evaluate(
    send,
    `(() => {
      const el = document.getElementById(${JSON.stringify(id)});
      if (!el) return false;
      const proto = Object.getOwnPropertyDescriptor(
        el.tagName === "TEXTAREA" ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype,
        "value",
      );
      if (el._valueTracker) el._valueTracker.setValue("");
      proto.set.call(el, ${JSON.stringify(value)});
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    })()`,
  );
  if (!okField) throw new Error(`champ ${id}`);
}

async function ecranAuth(send) {
  return String(
    (await evaluate(
      send,
      `document.getElementById("instance-url")
        ? "login"
        : document.getElementById("email")
          ? "creds"
          : document.getElementById("code-totp")
            ? "totp"
            : document.getElementById("cabinet-nom")
              ? "local"
              : ""`,
    )) ?? "",
  );
}

async function login(send) {
  const pret = Date.now();
  let ecran = "";
  while (Date.now() - pret < 90_000) {
    ecran = await ecranAuth(send);
    if (ecran === "login" || ecran === "creds" || ecran === "totp" || ecran === "local") break;
    const coque = await evaluate(
      send,
      `Boolean(document.querySelector("[data-testid=barre-haut]")) && !document.getElementById("instance-url")`,
    );
    if (coque) return;
    await sleep(250);
  }
  if (!ecran) throw new Error("écran auth absent");
  if (ecran === "login") {
    await setField(send, "instance-url", instanceUrl);
    await evaluate(send, `document.getElementById("instance-url")?.closest("form")?.requestSubmit()`);
  }
  if (ecran === "login" || ecran === "creds") {
    const debut = Date.now();
    while (Date.now() - debut < 45_000) {
      if (await evaluate(send, `Boolean(document.getElementById("email"))`)) break;
      await sleep(200);
    }
    await setField(send, "email", demoEmail);
    await setField(send, "password", demoPassword);
    await setField(send, "nom-appareil", `vue-scindee-${marque}`);
    await evaluate(send, `document.getElementById("email")?.closest("form")?.requestSubmit()`);
  }
  let totpSoumis = ecran === "totp";
  const totpStart = Date.now();
  while (Date.now() - totpStart < 180_000) {
    if (!totpSoumis && (await evaluate(send, `Boolean(document.getElementById("code-totp"))`))) {
      await setField(send, "code-totp", totpNow());
      await evaluate(send, `document.getElementById("code-totp")?.closest("form")?.requestSubmit()`);
      totpSoumis = true;
    }
    const coque = await evaluate(
      send,
      `Boolean(document.querySelector("[data-testid=barre-haut]")) && !document.getElementById("instance-url") && !document.getElementById("code-totp")`,
    );
    if (totpSoumis && coque) return;
    if (ecran === "local" && coque) return;
    await sleep(250);
  }
  throw new Error("coque absente après auth");
}

async function attendreCoque(send) {
  const debut = Date.now();
  while (Date.now() - debut < 120_000) {
    const okCoque = await evaluate(
      send,
      `Boolean(document.querySelector("[data-testid=barre-haut]"))`,
    );
    if (okCoque) return;
    await sleep(300);
  }
  throw new Error("barre-haut absente");
}

async function creerDossierUi(send, { nom, chemise, juridiction, rg, partie }) {
  await evaluate(
    send,
    `([...document.querySelectorAll("button")].find((b) => /^Dossiers$/u.test((b.textContent || "").trim())) || null)?.click()`,
  );
  await sleep(400);
  if (!(await evaluate(send, `Boolean(document.getElementById("dossier-nom"))`))) {
    await evaluate(
      send,
      `([...document.querySelectorAll("button")].find((b) => /nouveau dossier/i.test(b.textContent || "")) || null)?.click()`,
    );
    const debut = Date.now();
    while (Date.now() - debut < 15_000) {
      if (await evaluate(send, `Boolean(document.getElementById("dossier-nom"))`)) break;
      await sleep(200);
    }
  }
  if (!(await evaluate(send, `Boolean(document.getElementById("dossier-nom"))`))) {
    throw new Error("formulaire nouveau dossier absent");
  }
  await setField(send, "dossier-nom", nom);
  await evaluate(
    send,
    `(() => {
      const sel = document.getElementById("dossier-chemise");
      if (!sel) return false;
      sel.value = ${JSON.stringify(chemise)};
      sel.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    })()`,
  );
  await setField(send, "dossier-juridiction", juridiction);
  await setField(send, "dossier-rg", rg);
  await setField(send, "dossier-partie", partie);
  await evaluate(send, `document.getElementById("dossier-nom")?.closest("form")?.requestSubmit()`);
  const debut = Date.now();
  while (Date.now() - debut < 30_000) {
    const id = await evaluate(
      send,
      `document.querySelector("[data-testid=dossier-cree]")?.textContent?.trim() ?? ""`,
    );
    if (id && /^[0-9a-f-]{36}$/i.test(String(id))) return String(id);
    const ouvert = await evaluate(
      send,
      `document.querySelector("[data-testid=ecran-dossier]")?.getAttribute("data-dossier-id") ?? ""`,
    );
    if (ouvert) return String(ouvert);
    await sleep(250);
  }
  throw new Error(`création dossier échouée (${nom})`);
}

async function attendreChrono(send) {
  const debut = Date.now();
  while (Date.now() - debut < 30_000) {
    const okChrono = await evaluate(
      send,
      `Boolean(document.querySelector("[data-testid=chrono-liste]") && document.querySelector("[data-testid=chrono-apercu]"))`,
    );
    if (okChrono) return;
    await sleep(250);
  }
  throw new Error("vue scindée absente");
}

async function etatChrono(send) {
  return evaluate(
    send,
    `(() => {
      const periodes = [...document.querySelectorAll("[data-testid^=chrono-groupe-]")].map(
        (el) => el.getAttribute("data-testid")?.replace("chrono-groupe-", "") ?? "",
      );
      const filtres = [...document.querySelectorAll("[data-testid^=chrono-filtre-]")].map((el) => ({
        id: el.getAttribute("data-testid")?.replace("chrono-filtre-", "") ?? "",
        actif: el.getAttribute("aria-pressed") === "true",
        texte: (el.textContent || "").trim(),
      }));
      const items = [...document.querySelectorAll("[data-testid=chrono-item]")].map((el) => ({
        id: el.getAttribute("data-id") ?? "",
        type: el.getAttribute("data-type") ?? "",
        sel: el.getAttribute("aria-selected") === "true",
        tuile: Boolean(el.querySelector(".chrono-tuile")),
        titre: (el.querySelector(".chrono-item__titre")?.textContent || "").trim(),
        meta: (el.querySelector(".chrono-item__meta")?.textContent || "").trim(),
        badge: (el.querySelector("[data-testid=badge-definitif]")?.textContent || "").trim(),
        heure: (el.querySelector(".chrono-item__heure")?.textContent || "").trim(),
        teinteSel: el.classList.contains("chrono-item--sel")
          ? getComputedStyle(el).backgroundColor
          : null,
      }));
      const badges = [...document.querySelectorAll("[data-testid=badge-definitif]")].map((el) => {
        const cs = getComputedStyle(el);
        return {
          texte: (el.textContent || "").trim(),
          cadenas: Boolean(el.querySelector("svg")),
          color: cs.color,
          fond: cs.backgroundColor,
        };
      });
      const apercu = document.querySelector("[data-testid=chrono-apercu]");
      const apercuType = apercu?.getAttribute("data-type") ?? "";
      const encart = document.querySelector("[data-testid=chrono-encart]");
      const definitifVar = getComputedStyle(document.documentElement).getPropertyValue("--definitif").trim();
      const teinte = getComputedStyle(document.querySelector("[data-testid=ecran-dossier]") || document.documentElement)
        .getPropertyValue("--chemise-teinte")
        .trim();
      return {
        periodes,
        filtres,
        items,
        badges,
        apercuType,
        encartVariante: encart?.getAttribute("data-variante") ?? "",
        definitifVar,
        teinte,
        pointMedian: /\\u00b7|·/.test(document.body?.innerText || ""),
      };
    })()`,
  );
}

async function cliquerFiltre(send, id) {
  await evaluate(
    send,
    `document.querySelector("[data-testid=chrono-filtre-${id}]")?.click()`,
  );
  await sleep(150);
}

async function cliquerItemType(send, type) {
  const okClick = await evaluate(
    send,
    `(() => {
      const el = [...document.querySelectorAll("[data-testid=chrono-item]")].find(
        (n) => n.getAttribute("data-type") === ${JSON.stringify(type)},
      );
      if (!el) return false;
      el.click();
      return true;
    })()`,
  );
  if (!okClick) throw new Error(`item type ${type} absent`);
  await sleep(150);
}

async function main() {
  await ensureInstance();
  const jeton = await demoAccessToken(api, `vue-scindee-api-${marque}`);
  if (!jeton) fail("jeton démo absent");

  resetBase();
  const app = startApp();
  try {
    await waitCdp(app);
    const { send, ws } = await connectCdp();
    await login(send);
    await attendreCoque(send);

    const dossierId = await creerDossierUi(send, {
      nom: `Vue scindée ${marque}`,
      chemise: "kraft",
      juridiction: "TJ Nanterre",
      rg: `26/${marque}`,
      partie: "SAS Démo Chrono",
    });
    ok(`dossier ouvert ${dossierId.slice(0, 8)}`);

    const debutOuvert = Date.now();
    while (Date.now() - debutOuvert < 30_000) {
      const ouvert = await evaluate(
        send,
        `Boolean(document.querySelector("[data-testid=ecran-dossier]"))`,
      );
      if (ouvert) break;
      await sleep(250);
    }
    await attendreChrono(send);
    ok("vue scindée affichée");

    let etat = await etatChrono(send);
    if (!etat) fail("état chrono vide");

    for (const p of ["aujourdhui", "cette-semaine", "plus-tot"]) {
      if (!etat.periodes.includes(p)) fail(`période manquante : ${p}`);
    }
    ok("périodes Aujourd’hui / Cette semaine / Plus tôt");

    const idsFiltre = etat.filtres.map((f) => f.id).sort().join(",");
    if (idsFiltre !== "factures,mails,pieces,tout") {
      fail(`filtres incomplets : ${idsFiltre}`);
    }
    const libelles = etat.filtres.map((f) => f.texte);
    for (const attendu of ["Tout", "Mails", "Pièces", "Factures"]) {
      if (!libelles.includes(attendu)) fail(`filtre libellé manquant : ${attendu}`);
    }
    ok("filtres Tout, Mails, Pièces, Factures");

    if (etat.items.length < 4) fail(`trop peu d’items (${etat.items.length})`);
    for (const item of etat.items) {
      if (!item.tuile) fail(`tuile absente sur ${item.id}`);
      if (!item.titre) fail(`titre absent sur ${item.id}`);
      if (!item.meta) fail(`métadonnées absentes sur ${item.id}`);
      if (!item.badge && !item.heure) fail(`ni heure ni badge sur ${item.id}`);
    }
    const sel = etat.items.find((i) => i.sel);
    if (!sel) fail("aucune sélection");
    if (!sel.teinteSel || sel.teinteSel === "rgba(0, 0, 0, 0)" || sel.teinteSel === "transparent") {
      fail(`sélection sans teinte chemise (${sel.teinteSel})`);
    }
    ok("lignes : tuile, titre, métadonnées, heure ou badge ; sélection teintée");

    await cliquerFiltre(send, "mails");
    etat = await etatChrono(send);
    if (!etat.items.every((i) => i.type === "mail")) fail("filtre Mails non appliqué");
    await cliquerFiltre(send, "pieces");
    etat = await etatChrono(send);
    if (!etat.items.every((i) => i.type === "piece")) fail("filtre Pièces non appliqué");
    await cliquerFiltre(send, "factures");
    etat = await etatChrono(send);
    if (!etat.items.every((i) => i.type === "facture")) fail("filtre Factures non appliqué");
    await cliquerFiltre(send, "tout");
    ok("filtres appliqués");

    for (const type of ["mail", "piece", "facture", "audience", "note"]) {
      await cliquerFiltre(send, "tout");
      await cliquerItemType(send, type);
      etat = await etatChrono(send);
      if (etat.apercuType !== type) fail(`aperçu type attendu ${type}, reçu ${etat.apercuType}`);
    }
    ok("aperçus mail, pièces, facture, audience, note");

    await cliquerFiltre(send, "tout");
    etat = await etatChrono(send);
    const libellesBadge = new Set(etat.badges.map((b) => b.texte.replace(/\s+/g, " ").trim()));
    for (const attendu of ["Communiquées", "Validée", "Encaissée", "Envoyé"]) {
      const trouve = [...libellesBadge].some((t) => t.includes(attendu));
      if (!trouve) fail(`badge définitif manquant : ${attendu}`);
    }
    for (const b of etat.badges) {
      if (!b.cadenas) fail(`cadenas absent sur badge « ${b.texte} »`);
    }
    if (!etat.definitifVar) fail("jeton --definitif absent");
    ok("badges définitifs (cadenas + Communiquées / Validée / Encaissée / Envoyé)");

    if (etat.pointMedian) fail("point médian « · » détecté dans l’interface");
    ok("pas de point médian");

    ws.close();
    console.log("vue-scindee: OK");
  } catch (err) {
    fail(String(err?.message ?? err));
  } finally {
    await stopApp(app);
  }
}

main().catch((err) => fail(String(err?.message ?? err)));
