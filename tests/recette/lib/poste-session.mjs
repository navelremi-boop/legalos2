/**
 * Session Tauri partagée par les recettes dossiers-contacts.
 * Ne journalise aucun secret.
 */
import { spawn, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { totpNow } from "./demo-auth.mjs";
import {
  activerDiagnostic,
  creerCollecteur,
  creerRelanceUnique,
  diagnosticLancement,
  EchecLancement,
} from "./lancement.mjs";

const repoRoot = join(fileURLToPath(new URL(".", import.meta.url)), "../../..");

/** Clichés complets du filet de recette (attache cdb), hors du rapport d'erreurs Windows. */
export const DOSSIER_CLICHES_POSTE = "C:\\Users\\PC\\CrashDumps\\legal-os-poste";

export function racineInstance() {
  if (existsSync(join(repoRoot, ".env"))) return repoRoot;
  const principal = join(repoRoot, "..", "..");
  if (existsSync(join(principal, ".env"))) return principal;
  return repoRoot;
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Dernières lignes du journal d'erreurs du poste (D4, consigne de l'architecte du 24/10/2026) : panics, erreurs JavaScript
 * non capturées, sessions dont le processus a disparu sans sortie normale. Lues dans le répertoire de données, sans passer
 * par l'app, qui peut avoir disparu. Les trois fichiers de rotation, du plus ancien au plus récent.
 */
export function lireJournalErreursPoste(n = 200) {
  const roaming = process.env.APPDATA ?? join(homedir(), "AppData", "Roaming");
  const dossier = join(roaming, "fr.legalos.poste", "journal-erreurs");
  const lignes = [];
  for (const nom of ["poste.log.2", "poste.log.1", "poste.log"]) {
    try {
      lignes.push(...readFileSync(join(dossier, nom), "utf8").split(/\r?\n/u).filter((l) => l !== ""));
    } catch {
      /* fichier absent : pas encore de rotation, ou pas de journal */
    }
  }
  return lignes.slice(-n);
}

/**
 * État du poste à l'instant d'un échec (D4) : le lanceur (code de sortie), le processus `legal-os-poste` (présent ? répond ?
 * fils d'exécution, temps de processeur sur 2 s : un processus vivant et inactif n'est pas un processus qui tourne en
 * boucle), l'écoute du port de débogage et la fin de la sortie standard du poste. À appeler AVANT `stopApp`, qui tue le
 * processus. N'écrit ni ne lit aucun contenu de l'app. Ne lève jamais.
 */
export function diagnosticProcessusPoste(child) {
  const lignes = [];
  try {
    if (!child) return ["aucun poste lancé"];
    const nomCrash = child.exitCode === 3221226356 ? " (0xC0000374 STATUS_HEAP_CORRUPTION)" : "";
    const lanceur =
      child.exitCode !== null
        ? `terminé, code ${child.exitCode}${nomCrash}`
        : child.signalCode
          ? `signal ${child.signalCode}`
          : "encore actif";
    lignes.push(`lanceur (pid ${child.pid}) : ${lanceur}`);
    if (process.platform === "win32") {
      const script = [
        "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8",
        "$p=@(Get-Process -Name 'legal-os-poste*' -ErrorAction SilentlyContinue)",
        "if($p.Count -eq 0){ 'aucun processus legal-os-poste' } else {",
        "$c=@{}; $p | ForEach-Object { $c[$_.Id]=$_.CPU }; Start-Sleep 2",
        "$p | ForEach-Object { $q=Get-Process -Id $_.Id -ErrorAction SilentlyContinue;",
        "if($q){ 'processus ' + $q.Id + ' : répond=' + $q.Responding + ' fils=' + $q.Threads.Count + ' processeur=+' + [math]::Round($q.CPU-$c[$q.Id],2) + ' s en 2 s, mémoire=' + [int]($q.WorkingSet64/1MB) + ' Mo' } else { 'processus ' + $_.Id + ' : disparu pendant la mesure' } } }",
        "'webviews : ' + @(Get-Process -Name msedgewebview2 -ErrorAction SilentlyContinue).Count",
        `$e=Get-NetTCPConnection -LocalPort ${Number(child.port) || 0} -State Listen -ErrorAction SilentlyContinue; if($e){ 'port ${Number(child.port) || 0} : écouté par le processus ' + $e[0].OwningProcess } else { 'port ${Number(child.port) || 0} : personne n''écoute' }`,
      ].join("; ");
      const r = spawnSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", script], { encoding: "utf8", timeout: 30_000, windowsHide: true });
      for (const l of String(r.stdout ?? "").split(/\r?\n/u)) if (l.trim() !== "") lignes.push(l.trim());
    }
    // Poste vivant mais muet : piles d'appels de tous ses fils (débogueur Windows, attache sans interruption). Uniquement
    // des noms de modules et de fonctions : jamais la mémoire du processus. Facultatif : `LEGALOS_CDB` ou l'emplacement
    // usuel du kit de débogage ; absent, rien n'est tenté.
    if (process.platform === "win32") {
      const cdb = process.env.LEGALOS_CDB ?? "C:\\Program Files (x86)\\Windows Kits\\10\\Debuggers\\x64\\cdb.exe";
      const vivants = lignes.map((l) => /^processus (\d+) : répond=/u.exec(l)?.[1]).filter(Boolean);
      for (const pid of vivants.slice(0, 1)) {
        if (!existsSync(cdb)) break;
        const symboles = `srv*${join(tmpdir(), "legalos-symboles")}*https://msdl.microsoft.com/download/symbols`;
        const r = spawnSync(cdb, ["-pv", "-p", String(pid), "-y", symboles, "-c", "~*kn 30;q"], { encoding: "utf8", timeout: 240_000, windowsHide: true });
        const piles = String(r.stdout ?? "")
          .split(/\r?\n/u)
          .filter((l) => /!|\bId:\s/u.test(l))
          .slice(0, 400);
        lignes.push(`piles d'appels du processus ${pid} (${piles.length} lignes) :`);
        for (const l of piles) lignes.push(`  ${l.trim().slice(0, 200)}`);
      }
    }
    const sortie = typeof child.logTail === "function" ? child.logTail().replace(/\x1b\[[0-9;]*m/g, "").trim() : "";
    lignes.push(`fin de la sortie du poste : ${sortie === "" ? "(vide)" : sortie.split(/\r?\n/u).slice(-12).join(" ⏎ ").slice(-1_200)}`);
  } catch (err) {
    lignes.push(`diagnostic du processus impossible : ${String(err instanceof Error ? err.message : err).slice(0, 200)}`);
  }
  return lignes;
}

export function sqlServeur(requete) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "docker",
      [
        "compose",
        "-f",
        "instance/docker-compose.yml",
        "--env-file",
        ".env",
        "exec",
        "-T",
        "postgres",
        "psql",
        "-U",
        "legalos",
        "-d",
        "legalos",
        "-tAc",
        requete,
      ],
      { cwd: racineInstance(), stdio: ["ignore", "pipe", "pipe"] },
    );
    let out = "";
    let err = "";
    // Un `docker compose exec` qui ne rend jamais la main suspendait toute la recette (série du 22/10) :
    // après 90 s l'appel échoue et nomme la requête.
    const garde = setTimeout(() => {
      child.kill();
      reject(new Error(`sql sans réponse après 90 s : ${requete.slice(0, 120)}`));
    }, 90_000);
    child.stdout.on("data", (chunk) => {
      out += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      err += chunk.toString();
    });
    child.on("exit", (code) => {
      clearTimeout(garde);
      if (code === 0) resolve(out.trim());
      else reject(new Error(`sql ${code}: ${err.slice(0, 200)}`));
    });
  });
}

export function sqliteLocal(id, requete) {
  const roaming = process.env.APPDATA ?? join(homedir(), "AppData", "Roaming");
  const fichier = join(roaming, "fr.legalos.poste", `legalos-powersync-${id}.db`);
  return new Promise((resolve, reject) => {
    const child = spawn(
      "python",
      [
        "-c",
        "import sqlite3,sys; c=sqlite3.connect(sys.argv[1]); r=c.execute(sys.argv[2]).fetchone(); print('' if r is None else r[0])",
        fichier,
        requete,
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let out = "";
    let err = "";
    child.stdout.on("data", (chunk) => {
      out += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      err += chunk.toString();
    });
    child.on("exit", (code) => {
      if (code === 0) resolve(out.trim());
      else reject(new Error(err.slice(-200) || `sqlite ${code}`));
    });
  });
}

export function creerSession(etiquette) {
  const root = repoRoot;
  const poste = join(root, "apps/poste");
  const instanceUrl = process.env.LEGALOS_INSTANCE_URL ?? "http://127.0.0.1:8088";
  const api = `${instanceUrl}/api`;
  const marque = String(Date.now()).slice(-6);

  const sockets = [];

  function fermer() {
    for (const ws of sockets) {
      try {
        ws.close();
      } catch {
        /* déjà fermé */
      }
    }
  }
  /** Postes lancés par cette session et dont l'état a déjà été relevé à un échec (D4). */
  const postesLances = [];
  const postesReleves = new WeakSet();
  /**
   * À tout échec, avant que l'appelant n'arrête le poste : son état (mort de `STATUS_HEAP_CORRUPTION`, figé, vivant).
   * Sans cela, un poste mort passe pour un « délai dépassé » de l'interface.
   */
  function releverEtatPoste() {
    const poste = postesLances.at(-1);
    if (!poste || postesReleves.has(poste)) return;
    postesReleves.add(poste);
    console.error(`${etiquette}: état du poste à l'instant de l'échec :`);
    for (const ligne of diagnosticProcessusPoste(poste)) console.error(`  ${ligne}`);
  }
  /** Page CDP la plus récente de la session : sa console et sa capture sont jointes à tout échec. */
  let pageCourante = null;
  const pagesCapturees = new WeakSet();
  /**
   * D12 (consigne de l'architecte du 26/10/2026) : à toute attente dépassée ou tout échec d'une recette du poste,
   * la console de la WebView, le journal du poste et une capture d'écran. Les deux premiers sont écrits tout de suite ;
   * la capture part sans attendre et finit pendant l'arrêt du poste (fichier du dossier temporaire, hors dépôt).
   */
  function joindreEtatPage() {
    const page = pageCourante;
    if (!page || pagesCapturees.has(page.send)) return;
    pagesCapturees.add(page.send);
    const console_ = page.collecteur?.console ?? [];
    console.error(`${etiquette}: console de la WebView à l'échec (${console_.length} entrée(s)) :`);
    for (const ligne of console_.slice(-40)) console.error(`  ${ligne}`);
    const erreurs = page.collecteur?.erreurs ?? [];
    if (erreurs.length > 0) {
      console.error(`${etiquette}: erreurs JavaScript et réseau vues par la page :`);
      for (const ligne of erreurs) console.error(`  ${ligne}`);
    }
    try {
      const journal = lireJournalErreursPoste(30);
      console.error(`${etiquette}: journal du poste (${journal.length} dernière(s) ligne(s)) :`);
      for (const ligne of journal) console.error(`  ${ligne}`);
    } catch {
      /* journal absent */
    }
    const chemin = join(tmpdir(), `legalos-echec-${etiquette}-${Date.now()}.png`);
    void Promise.race([page.send("Page.captureScreenshot", { format: "png" }), sleep(10_000).then(() => null)])
      .then((reponse) => {
        const donnees = reponse?.result?.data;
        if (donnees) {
          writeFileSync(chemin, Buffer.from(donnees, "base64"));
          console.error(`${etiquette}: capture d'écran à l'échec : ${chemin}`);
        } else {
          console.error(`${etiquette}: capture d'écran à l'échec impossible (page muette)`);
        }
      })
      .catch(() => {});
  }
  function fail(message) {
    console.error(`${etiquette}: FAIL — ${message}`);
    joindreEtatPage();
    releverEtatPoste();
    throw new Error(message);
  }
  function ok(message) {
    console.log(`${etiquette}: ${message}`);
  }

  function resetPostes(ids) {
    const roaming = process.env.APPDATA ?? join(homedir(), "AppData", "Roaming");
    const dataDir = join(roaming, "fr.legalos.poste");
    for (const id of ids) {
      for (const ext of ["", "-shm", "-wal"]) {
        const chemin = join(dataDir, `legalos-powersync-${id}.db${ext}`);
        for (let essai = 0; essai < 8; essai += 1) {
          try {
            rmSync(chemin, { force: true });
            break;
          } catch (err) {
            if (essai === 7) throw err;
            spawnSync("taskkill", ["/IM", "legal-os-poste.exe", "/T", "/F"], { stdio: "ignore" });
            Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 400);
          }
        }
      }
    }
  }

  function cheminBinairePoste() {
    // `.cargo/config.toml` fixe `target-dir = "target"` à la racine du dépôt.
    const target = process.env.CARGO_TARGET_DIR ?? join(root, "target");
    return join(target, "debug", "legal-os-poste.exe");
  }

  /**
   * Filet de recette (consigne du 27/10/2026) : attache cdb au processus déjà créé.
   * Lancer le poste sous le débogueur activerait le tas de débogage ; l'attache, non.
   * Sur `c0000374`, écrit un cliché complet puis quitte. Le fichier n'existe qu'en cas d'exception.
   */
  function attacherFiletCdb(pid) {
    if (process.platform !== "win32") return null;
    const cdb = process.env.LEGALOS_CDB ?? "C:\\Program Files (x86)\\Windows Kits\\10\\Debuggers\\x64\\cdb.exe";
    if (!existsSync(cdb)) {
      console.error(`${etiquette}: cdb introuvable, le filet de cliché n'est pas posé`);
      return null;
    }
    mkdirSync(DOSSIER_CLICHES_POSTE, { recursive: true });
    const cliche = join(DOSSIER_CLICHES_POSTE, `legal-os-poste-${pid}-${Date.now()}.dmp`).replaceAll("\\", "/");
    const journal = join(tmpdir(), `cdb-filet-${pid}.log`);
    const symboles = dirname(cheminBinairePoste());
    const commande = `.echo CDB_ATTACHE; sxe -c ".echo CRASH_C0000374; .dump /ma ${cliche}; ~*kn 80; lmv; !heap -s; q" c0000374; g`;
    const filet = spawn(cdb, ["-p", String(pid), "-logo", journal, "-y", symboles, "-c", commande], {
      stdio: "ignore",
      windowsHide: true,
    });
    filet.cliche = cliche;
    filet.journal = journal;
    return filet;
  }

  function pidsImage(image) {
    const r = spawnSync("tasklist", ["/FI", `IMAGENAME eq ${image}`, "/FO", "CSV", "/NH"], {
      encoding: "utf8",
      windowsHide: true,
    });
    const pids = [];
    for (const ligne of String(r.stdout ?? "").split(/\r?\n/u)) {
      const m = /^"[^"]+","(\d+)"/u.exec(ligne.trim());
      if (m) pids.push(m[1]);
    }
    return pids;
  }

  /** Le lancement `tauri dev` n'est pas le poste : on attache le filet quand `legal-os-poste.exe` apparaît. */
  function surveillerPoste(child) {
    if (process.platform !== "win32") return;
    const deja = new Set(pidsImage("legal-os-poste.exe"));
    const timer = setInterval(() => {
      if (child.filet) {
        clearInterval(timer);
        return;
      }
      for (const pid of pidsImage("legal-os-poste.exe")) {
        if (!deja.has(pid)) {
          child.filet = attacherFiletCdb(pid);
          clearInterval(timer);
          return;
        }
      }
    }, 1000);
    child.filetTimer = timer;
    child.on("exit", () => clearInterval(timer));
  }

  function ecrireConfig(id, port) {
    const configPath = join(tmpdir(), `legalos-${etiquette}-${id}-${marque}.json`);
    writeFileSync(
      configPath,
      JSON.stringify({
        app: {
          windows: [
            {
              width: 1280,
              height: 900,
              additionalBrowserArgs: `--remote-debugging-port=${port} --disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection`,
            },
          ],
        },
      }),
    );
    return configPath;
  }

  function startApp(id, port, mode, args = []) {
    const dir = join(tmpdir(), `legalos-webview-${etiquette}-${id}-${marque}`);
    mkdirSync(dir, { recursive: true });
    const env = {
      ...process.env,
      LEGALOS_POSTE_ID: id,
      WEBVIEW2_USER_DATA_FOLDER: dir,
      CARGO_BUILD_JOBS: process.env.CARGO_BUILD_JOBS ?? "2",
      VITE_LEGALOS_RECETTE_HOOKS: "1",
      LIBCLANG_PATH: process.env.LIBCLANG_PATH ?? "C:\\Program Files\\LLVM\\bin",
    };
    if (process.env.LEGALOS_CARGO_TARGET) {
      env.CARGO_TARGET_DIR = process.env.LEGALOS_CARGO_TARGET;
    } else {
      delete env.CARGO_TARGET_DIR;
    }
    let child;
    if (mode === "copie") {
      const src = cheminBinairePoste();
      if (!existsSync(src)) throw new Error(`binaire absent (${src})`);
      const dest = join(tmpdir(), `legal-os-poste-${etiquette}-${id}-${marque}.exe`);
      copyFileSync(src, dest);
      env.WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = `--remote-debugging-port=${port} --disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection`;
      child = spawn(dest, args, { cwd: poste, env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
      child.exeCopie = dest;
      child.filet = attacherFiletCdb(child.pid);
    } else {
      const configPath = ecrireConfig(id, port);
      child = spawn("cmd.exe", ["/d", "/s", "/c", `pnpm tauri dev --config ${configPath}`], {
        cwd: poste,
        env,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
      surveillerPoste(child);
    }
    let log = "";
    const onData = (chunk) => {
      log += chunk.toString();
      if (log.length > 14_000) log = log.slice(-14_000);
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.port = port;
    postesLances.push(child);
    child.logTail = () => log.slice(-2_000);
    child.logVite = (n = 3_000) =>
      log
        .replace(/\x1b\[[0-9;]*m/g, "")
        .split(/\r?\n/)
        .filter((l) => l.trim() !== "" && !/Building \[|Compiling/.test(l))
        .join(" ⏎ ")
        .slice(-n);
    return child;
  }

  async function stopApp(child) {
    if (child?.filetTimer) clearInterval(child.filetTimer);
    if (child?.filet && child.filet.exitCode === null) {
      await new Promise((resolve) => {
        spawn("taskkill", ["/PID", String(child.filet.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true }).on("exit", resolve);
      });
    }
    if (!child || child.exitCode !== null) return;
    await new Promise((resolve) => {
      spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true,
      }).on("exit", resolve);
    });
    await sleep(2_000);
    if (child.exeCopie) {
      for (let i = 0; i < 8; i += 1) {
        try {
          rmSync(child.exeCopie, { force: true });
          break;
        } catch {
          await sleep(400);
        }
      }
    }
  }

  async function waitCdp(child) {
    const start = Date.now();
    while (Date.now() - start < 420_000) {
      if (child.exitCode !== null) {
        throw new Error(`tauri arrêté (${child.exitCode}) : ${child.logTail()}`);
      }
      try {
        const list = await fetch(`http://127.0.0.1:${child.port}/json`);
        if (list.ok) {
          const pages = await list.json();
          if (pages.some((t) => t.type === "page" && t.webSocketDebuggerUrl)) return;
        }
      } catch {
        /* pas encore */
      }
      await sleep(400);
    }
    throw new Error(`webview ${child.port} — ${child.logTail()}`);
  }

  async function connectCdp(port, { diagnostic = false } = {}) {
    const list = await fetch(`http://127.0.0.1:${port}/json`).then((r) => r.json());
    const page = list.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
    if (!page) throw new Error("webview absente");
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      ws.addEventListener("open", resolve);
      ws.addEventListener("error", () => reject(new Error("websocket")));
    });
    let seq = 0;
    const pending = new Map();
    sockets.push(ws);
    // Le collecteur existe toujours : la console de la WebView est jointe à tout échec (D12). Sans `diagnostic`, seuls la
    // console et le journal du navigateur sont activés (pas le réseau).
    const collecteur = creerCollecteur();
    ws.addEventListener("message", (event) => {
      const msg = JSON.parse(String(event.data));
      const done = pending.get(msg.id);
      if (done) {
        pending.delete(msg.id);
        done(msg);
      } else if (collecteur) {
        collecteur.traiter(msg);
      }
    });
    const send = (method, params = {}) =>
      new Promise((resolve) => {
        const id = ++seq;
        pending.set(id, resolve);
        ws.send(JSON.stringify({ id, method, params }));
      });
    send.collecteur = collecteur;
    await activerDiagnostic(send, { complet: diagnostic });
    pageCourante = { send, collecteur };
    return { ws, send };
  }

  async function evaluate(send, expression, delaiMs = 30_000) {
    const msg = await Promise.race([
      send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }),
      sleep(delaiMs).then(() => {
        throw new Error("cdp sans réponse");
      }),
    ]);
    if (msg.result?.exceptionDetails) {
      throw new Error(String(msg.result.exceptionDetails.text ?? "évaluation").slice(0, 240));
    }
    return msg.result?.result?.value;
  }

  async function setField(send, id, value) {
    const okField = await evaluate(
      send,
      `(() => {
        const el = document.getElementById(${JSON.stringify(id)});
        if (!el) return false;
        const proto = el.tagName === "SELECT"
          ? Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value")
          : Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value");
        if (el._valueTracker) el._valueTracker.setValue("");
        proto.set.call(el, ${JSON.stringify(value)});
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
        return el.value === ${JSON.stringify(value)};
      })()`,
    );
    if (!okField) throw new Error(`champ ${id} absent`);
  }

  async function ecranAuth(send) {
    return evaluate(
      send,
      `(() => {
        if (document.getElementById("code-totp")?.offsetParent) return "totp";
        if (document.getElementById("email")?.offsetParent) return "creds";
        if (document.getElementById("instance-url")?.offsetParent) return "login";
        if (document.querySelector("[data-testid=se-reconnecter]")) return "local";
        return "";
      })()`,
    );
  }

  /**
   * Connexion. Sur un poste qui a déjà ses données locales et aucune écriture en attente, l'app s'ouvre hors ligne et
   * la connexion est considérée faite (reprise de travail hors ligne). `forcer` : se reconnecter vraiment (jeton,
   * synchronisation), pour une recette qui attend des données arrivées pendant que le poste était fermé.
   */
  async function login(send, email, password, secret, nomAppareil, { forcer = false } = {}) {
    const pret = Date.now();
    let ecran = "";
    while (Date.now() - pret < 90_000) {
      const deja = await evaluate(
        send,
        `(async () => {
          if (typeof window.__legalosRecette?.lireSqlite !== "function") return false;
          const rows = await window.__legalosRecette.lireSqlite("SELECT id FROM cabinets LIMIT 1");
          if (!Array.isArray(rows) || rows.length === 0) return false;
          return Boolean(document.querySelector("[data-testid=barre-haut]"));
        })()`,
      );
      if (deja) {
        const formulaire = await ecranAuth(send);
        if (formulaire === "login" || formulaire === "creds" || formulaire === "totp") {
          ecran = formulaire;
          break;
        }
        const nFile = await evaluate(
          send,
          `(async () => {
            const rows = await window.__legalosRecette.lireSqlite("SELECT COUNT(*) AS n FROM ps_crud");
            return Number(rows?.[0]?.n ?? 0);
          })()`,
        );
        if (Number(nFile) === 0 && !forcer) return;
        await evaluate(
          send,
          `(() => {
            const compte =
              document.querySelector("[data-testid=menu-compte]") ??
              [...document.querySelectorAll("button")].find((b) => /^Compte$/i.test((b.textContent || "").trim()));
            compte?.click();
            return Boolean(compte);
          })()`,
        );
        await sleep(400);
        await evaluate(
          send,
          `(() => {
            const reglages =
              document.querySelector("[data-testid=menu-reglages]") ??
              [...document.querySelectorAll("button")].find((b) => /réglages|reglages/i.test(b.textContent || ""));
            reglages?.click();
            return Boolean(reglages);
          })()`,
        );
        await sleep(400);
        await evaluate(send, `document.querySelector("[data-testid=se-reconnecter]")?.click()`);
        await sleep(500);
      }
      ecran = await ecranAuth(send);
      if (ecran === "login" || ecran === "creds" || ecran === "totp") break;
      const coque = await evaluate(
        send,
        `Boolean(document.querySelector("[data-testid=barre-haut]")) && !document.getElementById("instance-url")`,
      );
      if (coque) {
        await evaluate(send, `document.querySelector("[data-testid=se-reconnecter]")?.click()`);
        await sleep(400);
        continue;
      }
      await sleep(250);
    }
    if (!ecran) {
      const deja = await evaluate(send, `Boolean(document.querySelector("[data-testid=barre-haut]"))`);
      if (deja) return;
      throw new Error("écran auth absent");
    }
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
      await setField(send, "email", email);
      await setField(send, "password", password);
      await setField(send, "nom-appareil", nomAppareil);
      await evaluate(send, `document.getElementById("email")?.closest("form")?.requestSubmit()`);
    }
    let totpSoumis = ecran === "totp";
    const totpStart = Date.now();
    while (Date.now() - totpStart < 180_000) {
      if (!totpSoumis && (await evaluate(send, `Boolean(document.getElementById("code-totp"))`))) {
        await setField(send, "code-totp", totpNow(secret));
        await evaluate(send, `document.getElementById("code-totp")?.closest("form")?.requestSubmit()`);
        totpSoumis = true;
      }
      const syncOk = await evaluate(
        send,
        `(async () => {
          if (typeof window.__legalosRecette?.lireSqlite !== "function") return false;
          const rows = await window.__legalosRecette.lireSqlite("SELECT id FROM cabinets LIMIT 1");
          if (!Array.isArray(rows) || rows.length === 0) return false;
          const coque = document.querySelector("[data-testid=barre-haut]");
          if (!coque) return false;
          const visible = (id) => {
            const el = document.getElementById(id);
            return Boolean(el && el.offsetParent !== null);
          };
          return !visible("code-totp") && !visible("instance-url") && !visible("email");
        })()`,
        // La lecture locale attend la fin de l'écriture de la synchronisation initiale. Juste après un redémarrage de
        // PowerSync (j11-redaction), cette première synchronisation dépasse 30 s sur la base de développement
        // (188 seaux) ; la boucle de 180 s borne l'attente, les autres appels gardent leur garde-fou de 30 s.
        120_000,
      );
      if (totpSoumis && syncOk) return;
      await sleep(250);
    }
    throw new Error("coque absente après auth");
  }

  /**
   * Relance unique d'un lancement (dette conflits-poste-tauri, décision du 10/10/2026) : un échec de
   * lancement portant la signature « #root vide, sans erreur JavaScript, Vite répond » est relancé UNE
   * fois ; la relance est journalisée et comptée, la deuxième de l'exécution fait échouer la recette ;
   * tout autre échec n'est jamais relancé. Sans serveur Vite (mode « copie »), aucune relance.
   */
  const relance = creerRelanceUnique({ etiquette });
  process.on("exit", () => {
    console.log(`${etiquette}: relances de lancement : ${relance.relances}`);
  });

  /**
   * Lance le poste, attend la webview, connecte CDP et authentifie. Retourne { child, page } ;
   * l'appelant arrête l'app (stopApp) et ferme la page. Une application d'un essai raté est arrêtée.
   */
  function ouvrirPoste(id, port, { email, password, secret, nomAppareil, mode, forcer = false } = {}) {
    return relance.lancer(`poste ${id}`, async () => {
      const child = startApp(id, port, mode);
      let page;
      try {
        await waitCdp(child);
        page = await connectCdp(child.port, { diagnostic: true });
        await login(page.send, email, password, secret, nomAppareil, { forcer });
        return { child, page };
      } catch (err) {
        let echec = err;
        if (page && /écran auth absent/.test(String(err.message))) {
          const diag = await diagnosticLancement({
            send: page.send,
            evaluer: evaluate,
            child,
            collecteur: page.send.collecteur,
            dossierCaptures: tmpdir(),
            marque,
            modeBuild: mode === "copie",
          });
          echec = new EchecLancement(`${err.message} — ${diag.texte}`, { signatureRootVide: diag.signature });
        }
        // Un lancement qui échoue avant tout `fail` (page muette à la connexion, application absente) laisse son état
        // au poste : mort (code de sortie), figé ou vivant. À relever avant de l'arrêter.
        console.error(`${etiquette}: échec du lancement du poste : ${String(err instanceof Error ? err.message : err).slice(0, 200)}`);
        joindreEtatPage();
        releverEtatPoste();
        try {
          page?.ws.close();
        } catch {
          /* déjà fermé */
        }
        await stopApp(child);
        throw echec;
      }
    });
  }

  async function ouvrirFormulaire(send) {
    if (await evaluate(send, `Boolean(document.getElementById("dossier-nom"))`)) return;
    await evaluate(
      send,
      `([...document.querySelectorAll("button")].find((b) => /^Dossiers$/u.test((b.textContent || "").trim())) || null)?.click()`,
    );
    await sleep(400);
    if (await evaluate(send, `Boolean(document.getElementById("dossier-nom"))`)) return;
    await evaluate(
      send,
      `([...document.querySelectorAll("button")].find((b) => /nouveau dossier/i.test(b.textContent || "")) || null)?.click()`,
    );
    const debut = Date.now();
    while (Date.now() - debut < 15_000) {
      if (await evaluate(send, `Boolean(document.getElementById("dossier-nom"))`)) return;
      await sleep(200);
    }
    throw new Error("formulaire dossier absent");
  }

  async function creerDossier(send, { nom, juridiction, rg, partie, typeDossier, etape, precedent = "" }) {
    await ouvrirFormulaire(send);
    await setField(send, "dossier-nom", nom);
    await setField(send, "dossier-juridiction", juridiction);
    await setField(send, "dossier-rg", rg);
    await setField(send, "dossier-partie", partie);
    await setField(send, "dossier-type", typeDossier);
    await setField(send, "dossier-etape", etape);
    const attente = Date.now();
    while (Date.now() - attente < 25_000) {
      const pret = await evaluate(
        send,
        `(() => {
          const sel = document.getElementById("dossier-responsable");
          if (sel && sel.value) return true;
          const hid = document.querySelector("input[name=responsable_id]");
          return Boolean(hid && hid.value);
        })()`,
      );
      if (pret) break;
      await sleep(300);
    }
    await evaluate(
      send,
      `(() => { const n = document.querySelector("[data-testid=dossier-cree]"); if (n) n.textContent = ""; })()`,
    );
    await evaluate(send, `document.getElementById("dossier-nom")?.closest("form")?.requestSubmit()`);
    const debut = Date.now();
    while (Date.now() - debut < 45_000) {
      const cree = await evaluate(
        send,
        `document.querySelector("[data-testid=dossier-cree]")?.textContent ?? ""`,
      );
      const texte = String(cree).trim();
      if (/[0-9a-f-]{36}/i.test(texte) && texte !== precedent) return texte.match(/[0-9a-f-]{36}/i)[0];
      const ouvert = String(
        (await evaluate(
          send,
          `document.querySelector("[data-testid=ecran-dossier]")?.getAttribute("data-dossier-id") ?? ""`,
        )) ?? "",
      ).trim();
      if (/^[0-9a-f-]{36}$/i.test(ouvert) && ouvert !== precedent) return ouvert;
      await sleep(200);
    }
    throw new Error(`dossier ${rg} non créé`);
  }

  async function ouvrirDossier(send, id) {
    const deja = await evaluate(
      send,
      `document.querySelector("[data-testid=ecran-dossier]")?.getAttribute("data-dossier-id") === ${JSON.stringify(id)}`,
    );
    if (deja) return;
    await evaluate(
      send,
      `([...document.querySelectorAll("button")].find((b) => /^Dossiers$/u.test((b.textContent || "").trim())) || null)?.click()`,
    );
    const debut = Date.now();
    while (Date.now() - debut < 20_000) {
      const clicked = await evaluate(
        send,
        `(() => {
          const b = document.querySelector(${JSON.stringify(`[data-testid=liste-dossier][data-dossier-id="${id}"]`)});
          if (!b) return false;
          b.click();
          return true;
        })()`,
      );
      if (clicked) break;
      await sleep(300);
    }
    const fin = Date.now();
    while (Date.now() - fin < 15_000) {
      const ouvert = await evaluate(
        send,
        `document.querySelector("[data-testid=ecran-dossier]")?.getAttribute("data-dossier-id") === ${JSON.stringify(id)}`,
      );
      if (ouvert) return;
      await sleep(200);
    }
    throw new Error(`dossier ${id} non ouvert`);
  }

  async function texte(send, testid) {
    return String(
      (await evaluate(
        send,
        `document.querySelector(${JSON.stringify(`[data-testid=${testid}]`)})?.textContent ?? ""`,
      )) ?? "",
    );
  }

  async function apiJson(jeton, methode, chemin, corps) {
    const reponse = await fetch(`${api}${chemin}`, {
      method: methode,
      headers: { authorization: `Bearer ${jeton}`, "content-type": "application/json" },
      body: methode === "GET" || corps === undefined ? undefined : JSON.stringify(corps),
    });
    const texteReponse = await reponse.text();
    let json = null;
    try {
      json = texteReponse ? JSON.parse(texteReponse) : null;
    } catch {
      json = null;
    }
    return { status: reponse.status, json, texte: texteReponse };
  }

  async function assurerInstance() {
    const sante = await fetch(`${instanceUrl}/health`).catch(() => null);
    if (!sante?.ok) {
      const r = spawnSync(
        "docker",
        ["compose", "-f", "instance/docker-compose.yml", "--env-file", ".env", "up", "-d", "--wait"],
        { cwd: racineInstance(), stdio: "inherit" },
      );
      if (r.status !== 0) fail(`docker compose up exit ${r.status ?? 1}`);
    }
  }

  return {
    root,
    poste,
    instanceUrl,
    api,
    marque,
    fail,
    ok,
    resetPostes,
    startApp,
    stopApp,
    waitCdp,
    connectCdp,
    ouvrirPoste,
    evaluate,
    setField,
    ecranAuth,
    login,
    creerDossier,
    ouvrirDossier,
    texte,
    apiJson,
    assurerInstance,
    fermer,
  };
}
