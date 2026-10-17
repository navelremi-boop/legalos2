/**
 * Client IMAP de contrôle des recettes de messagerie (python imaplib) : dépose un message brut, lit un message par
 * son en-tête, vide un dossier, liste les dossiers. Ce client joue « l'extérieur » (dépôt d'un mail entrant) et la
 * lecture de contrôle côté serveur ; il n'est jamais le chemin d'une action de l'utilisateur.
 *
 * Le mot de passe et le message passent par l'environnement, jamais par la ligne de commande.
 */
import { spawnSync } from "node:child_process";

const SCRIPT = String.raw`
import email, email.policy, imaplib, json, os, re, sys
hote, port, login, action, dossier, entete, valeur = sys.argv[1:8]
boite = imaplib.IMAP4(hote, int(port))
boite.login(login, os.environ['IMAP_SECRET'])
if action == 'ajouter':
    typ, _ = boite.append(dossier, None, None, os.environ['IMAP_BRUT'].encode('utf-8'))
    assert typ == 'OK', typ
    print('[]')
elif action == 'purger':
    typ, _ = boite.select(dossier)
    n = 0
    if typ == 'OK':
        typ, data = boite.search(None, 'ALL')
        for num in (data[0].split() if data and data[0] else []):
            boite.store(num, '+FLAGS', '(\\Deleted)')
            n += 1
        boite.expunge()
    print(json.dumps(n))
elif action == 'chercher':
    typ, _ = boite.select(dossier)
    if typ != 'OK':
        print('[]'); sys.exit(0)
    typ, data = boite.search(None, 'HEADER', entete, '"' + valeur + '"')
    sortie = []
    for num in (data[0].split() if data and data[0] else []):
        typ, brut = boite.fetch(num, '(FLAGS RFC822)')
        tete = brut[0][0].decode('utf-8', 'replace')
        m = re.search(r'FLAGS \(([^)]*)\)', tete)
        drapeaux = sorted(m.group(1).split()) if m else []
        msg = email.message_from_bytes(brut[0][1], policy=email.policy.default)
        parties = []
        for p in msg.walk():
            if p.is_multipart():
                continue
            ct = p.get_content_type()
            parties.append({
                'type': ct,
                'nom': p.get_filename(),
                'methode': p.get_param('method'),
                'disposition': p.get_content_disposition(),
                'texte': p.get_content() if ct.startswith('text/') else '',
            })
        sortie.append({'drapeaux': drapeaux, 'brut': brut[0][1].decode('utf-8', 'replace'), 'parties': parties})
    print(json.dumps(sortie))
elif action == 'drapeaux':
    typ, _ = boite.select(dossier, readonly=True)
    sortie = []
    if typ == 'OK':
        typ, data = boite.search(None, 'HEADER', entete, '"' + valeur + '"')
        for num in (data[0].split() if data and data[0] else []):
            typ, brut = boite.fetch(num, '(FLAGS)')
            tete = brut[0].decode('utf-8', 'replace') if isinstance(brut[0], bytes) else str(brut[0])
            m = re.search(r'FLAGS \(([^)]*)\)', tete)
            sortie.append(sorted(m.group(1).split()) if m else [])
    print(json.dumps(sortie))
elif action == 'dossiers':
    typ, data = boite.list()
    print(json.dumps([l.decode('utf-8', 'replace').rsplit(' ', 1)[-1].strip('"') for l in data if l]))
boite.logout()
`;

/**
 * @param {{ hote: string, port: string|number, login: string, secret: string }} boite
 */
export function creerClientImap(boite) {
  function appeler({ action, dossier = "INBOX", entete = "", valeur = "", brut = "" }) {
    const run = spawnSync(
      "python",
      ["-c", SCRIPT, boite.hote, String(boite.port), boite.login, action, dossier, entete, valeur],
      { encoding: "utf8", env: { ...process.env, IMAP_SECRET: boite.secret, IMAP_BRUT: brut } },
    );
    if (run.status !== 0) {
      throw new Error(`imap ${action} ${dossier} : ${(run.stderr || run.stdout).slice(0, 200)}`);
    }
    return JSON.parse(run.stdout || "[]");
  }
  return {
    /** Dépose un message brut (CRLF) dans un dossier. */
    ajouter: (dossier, brut) => appeler({ action: "ajouter", dossier, brut }),
    /** Supprime tous les messages d'un dossier ; rend leur nombre. */
    purger: (dossier = "INBOX") => appeler({ action: "purger", dossier }),
    /** Messages dont l'en-tête vaut `valeur` (recherche IMAP HEADER) : drapeaux, brut, parties décodées. */
    chercher: (dossier, entete, valeur) => appeler({ action: "chercher", dossier, entete, valeur }),
    /** Drapeaux de chaque message dont l'en-tête vaut `valeur`, sans le lire (ne pose jamais \Seen) : une liste par message. */
    drapeaux: (dossier, entete, valeur) => appeler({ action: "drapeaux", dossier, entete, valeur }),
    dossiers: () => appeler({ action: "dossiers" }),
  };
}

/** Valeur d'un en-tête (lignes repliées dépliées) dans un message brut ; chaîne vide s'il est absent. */
export function valeurEnTete(brut, nom) {
  const tete = brut.split(/\r?\n\r?\n/)[0];
  const m = new RegExp(`^${nom}:[ \\t]*((?:.*)(?:\\r?\\n[ \\t].*)*)`, "im").exec(tete);
  return m ? m[1].replace(/\r?\n[ \t]+/g, " ").trim() : "";
}

/** Texte décodé (text/plain et text/html) d'un message lu en IMAP. */
export const corpsDe = (copie) =>
  copie.parties
    .filter((p) => p.type.startsWith("text/") && p.type !== "text/calendar")
    .map((p) => p.texte)
    .join("\n");
/** Noms des pièces jointes d'un message lu en IMAP. */
export const piecesDe = (copie) => copie.parties.map((p) => p.nom).filter(Boolean);
