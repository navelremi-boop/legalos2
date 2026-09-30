/**
 * Aide des recettes du moteur mail. Ne journalise aucun secret.
 */
import { createConnection } from "node:net";
import { spawnSync } from "node:child_process";
import { sqlServeur, sleep } from "./poste-session.mjs";

export const MOT_IMAP_TEST = "MotDePasseCapa123!";

export function conteneur(filtre) {
  const run = spawnSync(
    "docker",
    ["ps", "--format", "{{.Names}}", "--filter", `name=${filtre}`],
    { encoding: "utf8" },
  );
  return run.stdout
    .split(/\r?\n/)
    .map((ligne) => ligne.trim())
    .filter(Boolean);
}

export function connecterAuReseauApi(nomConteneur) {
  const api = conteneur("legalos-instance-api")[0];
  if (!api) throw new Error("conteneur api absent");
  const inspect = spawnSync(
    "docker",
    ["inspect", "-f", "{{range $k, $v := .NetworkSettings.Networks}}{{$k}} {{end}}", api],
    { encoding: "utf8" },
  );
  const reseau = inspect.stdout.trim().split(/\s+/).filter(Boolean)[0];
  if (!reseau) throw new Error("réseau de l'api absent");
  spawnSync("docker", ["network", "connect", reseau, nomConteneur], { encoding: "utf8" });
  return { api, reseau };
}

export function envoyerSmtp({ port, de, a, messageId, sujet }) {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    socket.setTimeout(15_000, () => {
      socket.destroy();
      reject(new Error("SMTP timeout"));
    });
    socket.on("error", reject);
    let buffer = "";
    const reponses = [];
    let attente = null;
    const livrer = (ligne) => {
      if (attente) {
        const suite = attente;
        attente = null;
        suite(ligne);
      } else reponses.push(ligne);
    };
    const suivante = () => {
      const deja = reponses.shift();
      if (deja !== undefined) return Promise.resolve(deja);
      return new Promise((res) => {
        attente = res;
      });
    };
    const exiger = async (prefixe) => {
      const ligne = await suivante();
      if (!ligne.startsWith(prefixe)) throw new Error(`SMTP ${ligne}`);
    };
    socket.on("data", (chunk) => {
      buffer += chunk.toString("latin1");
      while (buffer.includes("\n")) {
        const nl = buffer.indexOf("\n");
        const ligne = buffer.slice(0, nl).replace(/\r$/, "");
        buffer = buffer.slice(nl + 1);
        if (ligne.length >= 4 && ligne[3] === "-") continue;
        if (/^\d{3}( |$)/.test(ligne)) livrer(ligne);
      }
    });
    (async () => {
      await exiger("220");
      socket.write("EHLO legalos.test\r\n");
      await exiger("250");
      socket.write(`MAIL FROM:<${de}>\r\n`);
      await exiger("250");
      socket.write(`RCPT TO:<${a}>\r\n`);
      await exiger("250");
      socket.write("DATA\r\n");
      await exiger("354");
      socket.write(
        [`From: ${de}`, `To: ${a}`, `Subject: ${sujet}`, `Message-ID: ${messageId}`, "", "corps", ".", ""].join(
          "\r\n",
        ),
      );
      await exiger("250");
      socket.write("QUIT\r\n");
      await exiger("221");
      socket.end();
      resolve();
    })().catch((err) => {
      socket.destroy();
      reject(err);
    });
  });
}

export function agirImap({ hote, port, utilisateur, action, uid, messageId, sujet }) {
  const script = [
    "import imaplib, os, sys",
    "hote, port, utilisateur, action, uid = sys.argv[1:6]",
    "boite = imaplib.IMAP4(hote, int(port))",
    "boite.login(utilisateur, os.environ['IMAP_SECRET'])",
    "boite.select('INBOX')",
    "if action == 'creer':",
    "    try:",
    "        boite.create('Sent')",
    "    except imaplib.IMAP4.error:",
    "        pass",
    "elif action == 'drapeaux':",
    "    typ, _ = boite.uid('STORE', uid, '+FLAGS', '(\\\\Seen \\\\Flagged)')",
    "    assert typ == 'OK', typ",
    "elif action == 'deplacer':",
    "    try:",
    "        boite.create('Sent')",
    "    except imaplib.IMAP4.error:",
    "        pass",
    "    typ, _ = boite.uid('COPY', uid, 'Sent')",
    "    assert typ == 'OK', typ",
    "    boite.uid('STORE', uid, '+FLAGS', '(\\\\Deleted)')",
    "    boite.expunge()",
    "elif action == 'supprimer':",
    "    boite.uid('STORE', uid, '+FLAGS', '(\\\\Deleted)')",
    "    boite.expunge()",
    "elif action == 'ajouter':",
    "    mid = os.environ['IMAP_MID']",
    "    sujet = os.environ['IMAP_SUJET']",
    "    brut = 'From: tiers@example.com\\r\\nTo: capa@localhost\\r\\nSubject: ' + sujet + '\\r\\nMessage-ID: ' + mid + '\\r\\n\\r\\ncorps\\r\\n'",
    "    typ = boite.append('INBOX', None, None, brut.encode())",
    "    assert typ[0] == 'OK', typ",
    "else:",
    "    raise SystemExit('action')",
    "boite.logout()",
  ].join("\n");
  const run = spawnSync("python", ["-c", script, hote, String(port), utilisateur, action, String(uid)], {
    encoding: "utf8",
    env: {
      ...process.env,
      IMAP_SECRET: MOT_IMAP_TEST,
      IMAP_MID: messageId ?? "",
      IMAP_SUJET: sujet ?? "",
    },
  });
  if (run.status !== 0) {
    throw new Error(run.stderr?.slice(0, 300) || run.stdout?.slice(0, 300) || "imap");
  }
}

export async function attendreSql(requete, predicat, delaiMs) {
  const debut = Date.now();
  let dernier = "";
  while (Date.now() - debut < delaiMs) {
    try {
      dernier = await sqlServeur(requete);
      if (predicat(dernier)) return dernier;
    } catch (err) {
      dernier = err instanceof Error ? err.message : String(err);
    }
    await sleep(1000);
  }
  throw new Error(dernier);
}
