#!/usr/bin/env node
/**
 * Coque — fonctions à leur place (app Tauri) + onglets ~800 px + sync hors ligne réelle.
 * Instance : http://127.0.0.1:8088. Si le worktree n'a pas de `.env`, compose utilise
 * le checkout principal (deux niveaux au-dessus) sans afficher le fichier.
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
const posteId = "coque";
const marque = String(Date.now()).slice(-6);
const cdpPort = "9242";

/** Checkout avec `.env` : worktree si présent, sinon principal. */
function envRoot() {
  if (existsSync(join(root, ".env"))) return root;
  const principal = join(root, "..", "..");
  if (existsSync(join(principal, ".env"))) return principal;
  return root;
}

function fail(message) {
  console.error(`coque-fonctions: FAIL — ${message}`);
  process.exit(1);
}
function ok(message) {
  console.log(`coque-fonctions: ${message}`);
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

function compose(args) {
  const { cmd, args: a, cwd } = composeArgs(args);
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, a, { cwd, stdio: "ignore", shell: false });
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`compose ${args.join(" ")}`))));
  });
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
  const dir = join(tmpdir(), `legalos-webview-coque-${marque}`);
  mkdirSync(dir, { recursive: true });
  const configPath = join(tmpdir(), `legalos-coque-${marque}.json`);
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
    await setField(send, "nom-appareil", `coque-${marque}`);
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

async function syncTexte(send) {
  return String(
    (await evaluate(
      send,
      `document.querySelector("[data-testid=indicateur-sync]")?.textContent?.trim() ?? ""`,
    )) ?? "",
  );
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

async function main() {
  await ensureInstance();
  const jeton = await demoAccessToken(api, `coque-api-${marque}`);
  if (!jeton) fail("jeton démo absent");

  resetBase();
  const app = startApp();
  try {
    await waitCdp(app);
    const { send, ws } = await connectCdp();
    await login(send);
    await attendreCoque(send);

    // Aucun onglet de démonstration au démarrage.
    const ongletsInit = Number(
      await evaluate(send, `document.querySelectorAll(".onglet-dossier").length`),
    );
    if (ongletsInit !== 0) fail(`onglets démo présents au démarrage (${ongletsInit})`);
    ok("aucun onglet de démonstration");

    // Pas de bouton « hors ligne » / « en ligne ».
    const boutonsSync = await evaluate(
      send,
      `([...document.querySelectorAll("button")].some((b) => /^(hors ligne|en ligne)$/iu.test((b.textContent || "").trim())))`,
    );
    if (boutonsSync) fail("bouton hors ligne / en ligne interdit");

    // Nouveau dossier depuis la vue Dossiers.
    const id1 = await creerDossierUi(send, {
      nom: `Coque Alpha ${marque}`,
      chemise: "kraft",
      juridiction: "TJ Nanterre",
      rg: `RG${marque}A`,
      partie: "Client Alpha",
    });
    ok(`dossier créé depuis Dossiers (${id1.slice(0, 8)})`);

    // Contenu réel, pas Ferrand Métal / Conclusions adverses.
    const ecran = await evaluate(
      send,
      `(() => {
        const root = document.querySelector("[data-testid=ecran-dossier]");
        if (!root) return { err: "ecran absent" };
        const txt = root.textContent || "";
        return {
          id: root.getAttribute("data-dossier-id"),
          ferrand: /Ferrand Métal/u.test(txt),
          conclusions: /Conclusions adverses/u.test(txt),
          client: /Client Alpha/u.test(txt),
          nom: /Coque Alpha/u.test(txt),
        };
      })()`,
    );
    if (ecran?.err) fail(ecran.err);
    if (ecran.ferrand || ecran.conclusions) fail("contenu de démonstration dans un vrai dossier");
    if (!ecran.client || !ecran.nom) fail(`infos dossier réelles absentes (${JSON.stringify(ecran)})`);
    if (ecran.id !== id1) fail(`dossier ouvert ${ecran.id} ≠ ${id1}`);
    ok("vue dossier réelle (sans démo)");

    // Nouveau dossier depuis la palette (Ctrl K → panneau).
    await evaluate(
      send,
      `([...document.querySelectorAll("button")].find((b) => /rechercher/i.test(b.textContent || "")) || null)?.click()`,
    );
    await sleep(300);
    const paletteOuverte = await evaluate(
      send,
      `Boolean(document.getElementById("palette-recherche") || document.getElementById("ouvrir-palette"))`,
    );
    if (!paletteOuverte) {
      // Ouvrir via Ctrl K simulé
      await evaluate(
        send,
        `document.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true }))`,
      );
      await sleep(400);
    }
    // Créer un second dossier via formulaire (palette sert surtout à ouvrir) —
    // preuve palette : ouvrir le premier par recherche.
    if (await evaluate(send, `Boolean(document.getElementById("ouvrir-palette"))`)) {
      await evaluate(send, `document.getElementById("ouvrir-palette")?.click()`);
      await sleep(300);
    }
    if (!(await evaluate(send, `Boolean(document.getElementById("palette-recherche"))`))) {
      // Fermer éventuel panneau et rouvrir palette depuis Dossiers
      await evaluate(send, `document.querySelector(".panneau-modal")?.click()`);
      await sleep(200);
      await evaluate(
        send,
        `([...document.querySelectorAll("button")].find((b) => /^Dossiers$/u.test((b.textContent || "").trim())) || null)?.click()`,
      );
      await sleep(300);
      await evaluate(send, `document.getElementById("ouvrir-palette")?.click()`);
      await sleep(300);
    }
    if (!(await evaluate(send, `Boolean(document.getElementById("palette-recherche"))`))) {
      fail("palette absente");
    }
    await setField(send, "palette-recherche", `RG${marque}A`);
    const debutPal = Date.now();
    let choisi = false;
    while (Date.now() - debutPal < 10_000) {
      const btn = await evaluate(
        send,
        `Boolean(document.querySelector('[data-testid=palette-resultat][data-dossier-id="${id1}"]'))`,
      );
      if (btn) {
        await evaluate(
          send,
          `document.querySelector('[data-testid=palette-resultat][data-dossier-id="${id1}"]')?.click()`,
        );
        choisi = true;
        break;
      }
      await sleep(250);
    }
    if (!choisi) fail("résultat palette absent");
    ok("ouverture depuis la palette");

    // Deux autres dossiers pour overflow onglets.
    const id2 = await creerDossierUi(send, {
      nom: `Coque Beta ${marque}`,
      chemise: "bleu-classeur",
      juridiction: "CA Paris",
      rg: `RG${marque}B`,
      partie: "Client Beta",
    });
    const id3 = await creerDossierUi(send, {
      nom: `Coque Gamma ${marque}`,
      chemise: "vert-amande",
      juridiction: "TJ Lyon",
      rg: `RG${marque}C`,
      partie: "Client Gamma",
    });
    const id4 = await creerDossierUi(send, {
      nom: `Coque Delta ${marque}`,
      chemise: "lilas",
      juridiction: "TJ Bordeaux",
      rg: `RG${marque}D`,
      partie: "Client Delta",
    });
    void id2;
    void id3;
    void id4;

    // Réduire la barre à ~800 px : menu des dossiers ouverts.
    const overflow = await evaluate(
      send,
      `(() => {
        const barre = document.querySelector(".barre-haut");
        if (!barre) return Promise.resolve({ err: "barre" });
        const prev = barre.style.width;
        barre.style.width = "800px";
        barre.style.maxWidth = "800px";
        return new Promise((resolve) => {
          window.setTimeout(() => {
            const menu = document.querySelector("[data-testid=onglets-overflow]");
            const onglets = document.querySelectorAll(".onglet-dossier").length;
            barre.style.width = prev;
            barre.style.maxWidth = "";
            resolve({ menu: Boolean(menu), onglets });
          }, 400);
        });
      })()`,
    );
    if (overflow?.err) fail(overflow.err);
    if (!overflow.menu) {
      fail(`menu overflow absent à 800 px (onglets visibles=${overflow.onglets})`);
    }
    ok("onglets → menu overflow à ~800 px");

    // Saisie de temps depuis la barre d'actions (dossier ouvert) + chrono.
    const dossierOuvert = await evaluate(
      send,
      `Boolean(document.querySelector("[data-testid=ecran-dossier]"))`,
    );
    if (!dossierOuvert) {
      await evaluate(
        send,
        `([...document.querySelectorAll("button")].find((b) => /^Dossiers$/u.test((b.textContent || "").trim())) || null)?.click()`,
      );
      await sleep(400);
      await evaluate(send, `document.querySelector("[data-testid=liste-dossier]")?.click()`);
      await sleep(800);
    }
    if (!(await evaluate(send, `Boolean(document.querySelector("[data-testid=ecran-dossier]"))`))) {
      fail("aucun dossier ouvert pour la saisie de temps");
    }
    await evaluate(
      send,
      `([...document.querySelectorAll("[data-testid=barre-actions] button")].find((b) => /saisir du temps/i.test(b.textContent || "")) || null)?.click()`,
    );
    const debutTemps = Date.now();
    let prefere = "";
    while (Date.now() - debutTemps < 20_000) {
      const formOk = await evaluate(send, `Boolean(document.getElementById("temps-dossier"))`);
      if (formOk) {
        prefere = String(
          (await evaluate(send, `document.getElementById("temps-dossier")?.value ?? ""`)) ?? "",
        );
        const options = Number(
          await evaluate(send, `document.querySelectorAll("#temps-dossier option").length`),
        );
        if (prefere && options > 1) break;
      }
      await sleep(300);
    }
    if (!prefere) fail("dossier non pré-sélectionné pour la saisie de temps");
    await evaluate(send, `document.querySelector(".panneau-modal")?.click()`);
    await sleep(200);
    await evaluate(send, `document.querySelector("[data-testid=chrono-barre]")?.click()`);
    const debutChrono = Date.now();
    while (Date.now() - debutChrono < 15_000) {
      if (await evaluate(send, `Boolean(document.getElementById("temps-dossier"))`)) break;
      await sleep(200);
    }
    if (!(await evaluate(send, `Boolean(document.getElementById("temps-dossier"))`))) {
      fail("formulaire temps (chronomètre) absent");
    }
    ok("saisie de temps depuis barre d'actions et chronomètre");
    await evaluate(send, `document.querySelector(".panneau-modal")?.click()`);
    await sleep(200);

    // Calcul de délai depuis la barre d'actions.
    await evaluate(
      send,
      `([...document.querySelectorAll("[data-testid=barre-actions] button")].find((b) => /calculer un d[eé]lai/i.test(b.textContent || "")) || null)?.click()`,
    );
    const debutDelai = Date.now();
    while (Date.now() - debutDelai < 10_000) {
      if (await evaluate(send, `Boolean(document.querySelector("[data-testid=formulaire-delai]"))`)) break;
      await sleep(200);
    }
    const delaiOk = await evaluate(
      send,
      `(() => {
        const form = document.querySelector("[data-testid=formulaire-delai]");
        if (!form) return { err: "form" };
        const lieu = document.getElementById("delai-lieu");
        const type = document.getElementById("delai-type");
        const txt = form.textContent || "";
        const h7 = /jours chômés locaux/u.test(txt);
        const optionsLieu = lieu ? [...lieu.options].map((o) => o.value) : [];
        return {
          h7,
          type: Boolean(type && type.options.length > 1),
          lieu: optionsLieu.includes("metropole") && optionsLieu.includes("outre-mer") && optionsLieu.includes("etranger"),
        };
      })()`,
    );
    if (delaiOk?.err) fail("formulaire délai absent");
    if (!delaiOk.h7) fail("rappel H7 (jours chômés locaux) absent");
    if (!delaiOk.type) fail("bibliothèque de types de délai absente");
    if (!delaiOk.lieu) fail("lieu partie (métropole / outre-mer / étranger) incomplet");
    ok("calcul de délai (bibliothèque, lieu, H7)");
    await evaluate(send, `document.querySelector(".panneau-modal")?.click()`);
    await sleep(200);

    // Réglages : nom du cabinet + thème.
    await evaluate(
      send,
      `([...document.querySelectorAll("button")].find((b) => /^Compte$/u.test((b.textContent || "").trim())) || null)?.click()`,
    );
    await sleep(200);
    await evaluate(
      send,
      `([...document.querySelectorAll("[role=menuitem]")].find((b) => /r[eé]glages/i.test(b.textContent || "")) || null)?.click()`,
    );
    const debutReg = Date.now();
    while (Date.now() - debutReg < 15_000) {
      if (await evaluate(send, `Boolean(document.getElementById("cabinet-nom") && document.getElementById("theme"))`)) break;
      await sleep(250);
    }
    if (!(await evaluate(send, `Boolean(document.getElementById("cabinet-nom"))`))) {
      fail("réglages : nom du cabinet absent");
    }
    if (!(await evaluate(send, `Boolean(document.getElementById("theme"))`))) {
      fail("réglages : thème absent");
    }
    const nomAvant = String(
      (await evaluate(send, `document.getElementById("cabinet-nom")?.value ?? ""`)) ?? "",
    );
    const nomTest = `Cabinet Coque ${marque}`;
    await setField(send, "cabinet-nom", nomTest);
    await evaluate(send, `document.getElementById("cabinet-nom")?.closest("form")?.requestSubmit()`);
    await sleep(500);
    await evaluate(
      send,
      `(() => {
        const sel = document.getElementById("theme");
        if (!sel) return false;
        sel.value = "dark";
        sel.dispatchEvent(new Event("change", { bubbles: true }));
        return true;
      })()`,
    );
    await sleep(300);
    const themeDark = await evaluate(
      send,
      `document.documentElement.dataset.theme === "dark"`,
    );
    if (!themeDark) fail("thème nuit non appliqué");
    await evaluate(
      send,
      `(() => {
        const sel = document.getElementById("theme");
        if (!sel) return false;
        sel.value = "light";
        sel.dispatchEvent(new Event("change", { bubbles: true }));
        return true;
      })()`,
    );
    ok(`réglages nom (${nomAvant.slice(0, 20)}…) et thème`);

    // Synchronisation : coupure réelle (pause api + powersync), puis reprise.
    let syncAvant = await syncTexte(send);
    const syncDebut = Date.now();
    while (Date.now() - syncDebut < 20_000) {
      syncAvant = await syncTexte(send);
      if (/Synchronisé/u.test(syncAvant)) break;
      await sleep(500);
    }
    // Écriture locale pour avoir N > 0 en file.
    await evaluate(
      send,
      `window.__legalosRecette?.disconnectSync?.() ?? Promise.resolve()`,
    );
    await evaluate(
      send,
      `window.__legalosRecette?.patchCabinetNom?.(${JSON.stringify(`Hors ligne ${marque}`)}) ?? Promise.resolve()`,
    );
    await sleep(800);

    await compose(["pause", "api", "powersync"]).catch(() =>
      compose(["pause", "api"]).then(() => compose(["pause", "powersync"]).catch(() => undefined)),
    );
    ok("api + powersync en pause (coupure réelle)");

    let horsLigneVu = false;
    const cutDebut = Date.now();
    let dernier = "";
    while (Date.now() - cutDebut < 45_000) {
      dernier = await syncTexte(send);
      if (/Hors ligne,/u.test(dernier) && /modifications en attente/u.test(dernier)) {
        horsLigneVu = true;
        break;
      }
      await sleep(1_000);
    }
    if (!horsLigneVu) {
      await compose(["unpause", "api", "powersync"]).catch(() => undefined);
      fail(`indicateur hors ligne absent pendant la coupure (« ${dernier} »)`);
    }
    if (/Synchronisé/u.test(dernier)) {
      await compose(["unpause", "api", "powersync"]).catch(() => undefined);
      fail("« Synchronisé » affiché pendant la coupure");
    }
    ok(`pendant coupure : « ${dernier} »`);

    await compose(["unpause", "api", "powersync"]).catch(async () => {
      await compose(["unpause", "api"]).catch(() => undefined);
      await compose(["unpause", "powersync"]).catch(() => undefined);
    });

    let syncRetour = false;
    const retDebut = Date.now();
    while (Date.now() - retDebut < 60_000) {
      const t = await syncTexte(send);
      if (/^Synchronisé$/u.test(t.trim()) || t.trim() === "Synchronisé") {
        syncRetour = true;
        break;
      }
      dernier = t;
      await sleep(1_000);
    }
    if (!syncRetour) fail(`retour Synchronisé absent (« ${dernier} »)`);
    ok("Synchronisé au retour du réseau");

    ws.close();
    console.log("coque-fonctions: OK");
  } catch (error) {
    console.error(app.logTail());
    try {
      await compose(["unpause", "api", "powersync"]);
    } catch {
      /* ignore */
    }
    fail(error instanceof Error ? error.message : String(error));
  } finally {
    await stopApp(app);
  }
}

await main();
