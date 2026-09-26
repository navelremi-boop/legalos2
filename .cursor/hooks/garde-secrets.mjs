// Empêche l'agent de lire des fichiers de secrets avec l'outil de lecture.
// Garde-fou, pas un coffre-fort : les secrets réels ne doivent de toute façon pas être dans le dépôt.
import { lireEntree, repondre } from "./lib.mjs";

const lu = await lireEntree();
if (!lu.ok) {
  repondre({
    permission: "deny",
    user_message: `Lecture refusée par garde-secrets : entrée illisible (${lu.erreur}).`,
  });
}

const chemin = String(lu.valeur.file_path || "").replace(/\\/g, "/");
const segments = chemin.toLowerCase().split("/");
const nom = segments.at(-1) || "";

const exemple = nom === ".env.example" || nom === ".env.exemple";
const secret =
  (!exemple && (nom === ".env" || nom.startsWith(".env."))) ||
  /\.(pem|key|p12|pfx|keystore)$/.test(nom) ||
  segments.some((s) => s === "secrets" || s === ".secrets" || s === ".tauri");

repondre(
  secret
    ? { permission: "deny", user_message: "Lecture refusée par garde-secrets : fichier de secrets." }
    : { permission: "allow" },
);
