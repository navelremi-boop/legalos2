// Empêche l'agent de lire des fichiers de secrets avec l'outil de lecture.
// Garde-fou, pas un coffre-fort : les secrets réels ne doivent de toute façon pas être dans le dépôt.
import { autoriser, fichierDe, lireEntree, refuser, refuserIllisible } from "./lib.mjs";

const lu = await lireEntree();
if (!lu.ok) {
  refuserIllisible(`Lecture refusée par garde-secrets : entrée illisible (${lu.erreur}).`);
}

const chemin = fichierDe(lu.valeur).replace(/\\/g, "/");
const segments = chemin.toLowerCase().split("/");
const nom = segments.at(-1) || "";

const exemple = nom === ".env.example" || nom === ".env.exemple";
const secret =
  (!exemple && (nom === ".env" || nom.startsWith(".env."))) ||
  /\.(pem|key|p12|pfx|keystore)$/.test(nom) ||
  segments.some((s) => s === "secrets" || s === ".secrets" || s === ".tauri");

if (secret) refuser(lu.valeur, "Lecture refusée par garde-secrets : fichier de secrets.");
autoriser(lu.valeur);
