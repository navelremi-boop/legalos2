/**
 * Retire d'une instance de développement les boîtes qu'une recette a créées, avec leurs lignes dépendantes (consigne de
 * l'architecte du 26/10/2026 : chaque recette supprime, en fin de passe et même en cas d'échec, les boîtes qu'elle a
 * créées ; les restes alourdissaient les connexions de `capa` des recettes suivantes). Même ordre que `retirerComptes`
 * de `j11-connexion-boites.mjs`.
 */

const lit = (texte) => `'${String(texte).replaceAll("'", "''")}'`;

/**
 * @param {(requete: string) => Promise<string>} sqlServeur
 * @param {string[]} adresses adresses exactes des boîtes à retirer
 */
export async function retirerBoitesParAdresse(sqlServeur, adresses) {
  if (adresses.length === 0) return;
  const liste = adresses.map(lit).join(", ");
  const ids = `SELECT id FROM comptes_mail WHERE adresse IN (${liste})`;
  for (const requete of [
    `DELETE FROM oauth_etats WHERE adresse IN (${liste})`,
    `DELETE FROM actions_messages WHERE compte_id IN (${ids})`,
    `DELETE FROM file_envoi WHERE compte_id IN (${ids})`,
    `DELETE FROM releve_curseurs WHERE compte_id IN (${ids})`,
    `DELETE FROM moteur_connexions WHERE compte_id IN (${ids})`,
    `DELETE FROM membres_boite_partagee WHERE compte_id IN (${ids})`,
    `DELETE FROM signatures_messagerie WHERE compte_id IN (${ids})`,
    `DELETE FROM brouillons_message WHERE compte_id IN (${ids})`,
    `DELETE FROM invitations_agenda WHERE compte_id IN (${ids})`,
    `DELETE FROM messages WHERE compte_id IN (${ids})`,
    `DELETE FROM comptes_mail WHERE adresse IN (${liste})`,
  ]) {
    await sqlServeur(requete);
  }
}

/** Comme `retirerBoitesParAdresse`, sans jamais faire échouer la recette : l'échec du nettoyage est écrit, pas relancé. */
export async function retirerBoitesSansEchec(etiquette, sqlServeur, adresses) {
  try {
    await retirerBoitesParAdresse(sqlServeur, adresses);
  } catch (err) {
    console.error(`${etiquette}: nettoyage des boîtes de la recette impossible : ${String(err instanceof Error ? err.message : err).slice(0, 200)}`);
  }
}
