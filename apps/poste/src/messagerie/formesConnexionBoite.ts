import type { CorpsRequete } from "@/api/contrat";
import type { RequeteApi } from "@/messagerie/formesApiRedaction";

/**
 * Connexion d'une boîte (Réglages, Messagerie) : ajout d'une boîte nominative et reconnexion d'une boîte dont les
 * identifiants sont refusés. Pures : le réseau est dans `apiConnexionBoites.ts`. Contrat :
 * `crates/api/src/routes/messagerie.rs` (création) et `connexion_boites.rs` (reconnexion).
 *
 * Les identifiants vont du formulaire au serveur et n'en reviennent jamais : le poste ne les garde pas, et la
 * reconnexion les redemande en entier.
 */

export type ChampsConnexion = {
  adresse: string;
  hote: string;
  /** Texte saisi ; converti à l'envoi. */
  port: string;
  utilisateur: string;
  motDePasse: string;
  tls: boolean;
  smtpHote: string;
  smtpPort: string;
  smtpUtilisateur: string;
  smtpMotDePasse: string;
  repondreA: string;
};

export type ModeConnexion = "ajout" | "reconnexion";

export function champsVides(adresse = ""): ChampsConnexion {
  return {
    adresse,
    hote: "",
    port: "993",
    utilisateur: "",
    motDePasse: "",
    tls: true,
    smtpHote: "",
    smtpPort: "",
    smtpUtilisateur: "",
    smtpMotDePasse: "",
    repondreA: "",
  };
}

/** Port IMAP usuel selon le chiffrement : 993 (TLS) ou 143. */
export function portImapParDefaut(tls: boolean): string {
  return tls ? "993" : "143";
}

const ADRESSE = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]{2,}$/u;

/** Vrai si le texte ressemble à une adresse de messagerie (une vraie vérification a lieu chez le fournisseur). */
export function adresseValide(texte: string): boolean {
  return ADRESSE.test(texte.trim());
}

function propre(valeur: string): string {
  return valeur.trim();
}

function portValide(texte: string): number | null {
  if (!/^\d{1,5}$/u.test(texte)) return null;
  const port = Number(texte);
  return port >= 1 && port <= 65_535 ? port : null;
}

function sansEspaceNiControle(texte: string): boolean {
  return !/[\s\p{Cc}]/u.test(texte);
}

/** Premier problème de la saisie, en français, ou `null` si le serveur peut la recevoir. */
export function problemeConnexion(champs: ChampsConnexion, mode: ModeConnexion): string | null {
  if (mode === "ajout" && !ADRESSE.test(propre(champs.adresse))) return "Saisissez l'adresse de la boîte, par exemple prenom.nom@cabinet.example.";
  const hote = propre(champs.hote);
  if (hote === "") return "Saisissez le serveur IMAP.";
  if (!sansEspaceNiControle(hote)) return "Le serveur IMAP ne contient ni espace ni retour à la ligne.";
  if (portValide(propre(champs.port)) === null) return "Le port IMAP est un nombre entre 1 et 65535.";
  if (propre(champs.utilisateur) === "") return "Saisissez l'identifiant de connexion.";
  if (/\p{Cc}/u.test(champs.utilisateur)) return "L'identifiant ne contient pas de retour à la ligne.";
  if (champs.motDePasse === "") return "Saisissez le mot de passe.";
  const smtpHote = propre(champs.smtpHote);
  const smtpAutre = propre(champs.smtpPort) !== "" || propre(champs.smtpUtilisateur) !== "" || champs.smtpMotDePasse !== "";
  if (smtpHote === "" && smtpAutre) return "Saisissez aussi le serveur SMTP, ou videz les autres champs d'envoi.";
  if (smtpHote !== "") {
    if (!sansEspaceNiControle(smtpHote)) return "Le serveur SMTP ne contient ni espace ni retour à la ligne.";
    if (propre(champs.smtpPort) !== "" && portValide(propre(champs.smtpPort)) === null) return "Le port SMTP est un nombre entre 1 et 65535.";
    if (/\p{Cc}/u.test(champs.smtpUtilisateur)) return "L'identifiant d'envoi ne contient pas de retour à la ligne.";
  }
  if (propre(champs.repondreA) !== "" && !ADRESSE.test(propre(champs.repondreA))) return "L'adresse de réponse n'est pas une adresse valide.";
  return null;
}

function corpsReglages(champs: ChampsConnexion): CorpsRequete<"ModifierConnexion"> {
  const corps: CorpsRequete<"ModifierConnexion"> = {
    hote: propre(champs.hote),
    port: portValide(propre(champs.port)) ?? 993,
    utilisateur: propre(champs.utilisateur),
    mot_de_passe: champs.motDePasse,
    tls: champs.tls,
  };
  const smtpHote = propre(champs.smtpHote);
  if (smtpHote !== "") {
    corps.smtp_hote = smtpHote;
    const port = propre(champs.smtpPort);
    if (port !== "") corps.smtp_port = portValide(port);
    if (propre(champs.smtpUtilisateur) !== "") corps.smtp_utilisateur = propre(champs.smtpUtilisateur);
    if (champs.smtpMotDePasse !== "") corps.smtp_mot_de_passe = champs.smtpMotDePasse;
  }
  if (propre(champs.repondreA) !== "") corps.repondre_a = propre(champs.repondreA);
  return corps;
}

export function requeteAjouterBoite(id: string, champs: ChampsConnexion): RequeteApi {
  return { methode: "POST", chemin: "/messagerie/comptes", corps: { id, adresse: propre(champs.adresse), ...corpsReglages(champs) } satisfies CorpsRequete<"CreerCompte"> };
}

export function requeteReconnecterBoite(compteId: string, champs: ChampsConnexion): RequeteApi {
  return {
    methode: "PUT",
    chemin: `/messagerie/comptes/${encodeURIComponent(compteId)}/connexion`,
    corps: corpsReglages(champs),
  };
}

/** Le serveur peut relever une boîte : sa santé dit « connectée » ou « identifiants refusés » (ou « serveur indisponible » ; jamais « inconnu »). */
export function verificationTerminee(etatConnexion: string): boolean {
  return etatConnexion === "connecte" || etatConnexion === "identifiants_refuses" || etatConnexion === "indisponible";
}
