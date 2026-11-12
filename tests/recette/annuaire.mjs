#!/usr/bin/env node
/**
 * Annuaire — écran de l'app Tauri.
 * Navigation Contacts entre Dossiers et Mails, filtres, onglets, fiche personne, fiche société.
 * La reprise, la recherche des 10 000 contacts, la fusion et les conflits restent dans leurs recettes.
 */
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import http from "node:http";
import { demoAccessToken, demoEmail, demoPassword, totpSecretB32 } from "./lib/demo-auth.mjs";
import { creerSession, sleep, sqliteLocal, sqlServeur } from "./lib/poste-session.mjs";

const ui = creerSession("annuaire");
const { api, fail, ok, resetPostes, startApp, stopApp, waitCdp, connectCdp, login, evaluate, fermer } = ui;

function cliquer(send, selecteur) {
  return evaluate(send, `document.querySelector(${JSON.stringify(selecteur)})?.click()`);
}

async function attendre(send, selecteur) {
  const debut = Date.now();
  while (Date.now() - debut < 30_000) {
    const present = Boolean(await evaluate(send, `Boolean(document.querySelector(${JSON.stringify(selecteur)}))`));
    if (present) return;
    await sleep(250);
  }
  fail(`absent : ${selecteur}`);
}

/** Saisie dans un champ React : valeur native puis événement input. */
async function saisir(send, selecteur, valeur) {
  const pose = await evaluate(
    send,
    `(() => {
      const el = document.querySelector(${JSON.stringify(selecteur)});
      if (!el) return false;
      const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, "value").set.call(el, ${JSON.stringify(valeur)});
      el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
      return true;
    })()`,
  );
  if (!pose) fail(`champ absent : ${selecteur}`);
}

async function attendreSqlite(id, sql, predicat) {
  const debut = Date.now();
  let dernier = "";
  while (Date.now() - debut < 120_000) {
    try {
      dernier = await sqliteLocal(id, sql);
      if (predicat(dernier)) return;
    } catch (err) {
      dernier = err instanceof Error ? err.message : String(err);
    }
    await sleep(1000);
  }
  fail(`SQLite : ${dernier}`);
}

async function attendreImport(send) {
  const debut = Date.now();
  while (Date.now() - debut < 20_000) {
    const etat = await evaluate(
      send,
      `(() => ({
        message: (document.querySelector("[data-testid=contacts-import-message]")?.textContent ?? "").replace(/[\\u00a0\\u202f]/g, " "),
        proposition: document.querySelector("[data-testid=contacts-import-proposition]")?.textContent ?? "",
        manuel: Boolean(document.querySelector("[data-testid=contacts-denomination-nom]")),
      }))()`,
    );
    if (etat.proposition !== "" || etat.message.trim() !== "") return etat;
    await sleep(400);
  }
  fail("l'import n'a pas répondu");
}

const posteId = "annuaire";
const portRegistre = 18099;
let app = null;
let registre = null;
let nomDirigeant = "Martin";

function relancerApi(urlRegistre) {
  const env = { ...process.env };
  if (urlRegistre) env.LEGALOS_RECHERCHE_ENTREPRISES_URL = urlRegistre;
  else delete env.LEGALOS_RECHERCHE_ENTREPRISES_URL;
  const resultat = spawnSync(
    "docker",
    ["compose", "-f", "instance/docker-compose.yml", "--env-file", ".env", "up", "-d", "api"],
    { cwd: ui.root, env, stdio: "inherit" },
  );
  if (resultat.status !== 0) fail(`api non relancée (${resultat.status ?? 1})`);
}

try {
  await ui.assurerInstance();
  registre = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const q = url.searchParams.get("q") ?? "";
    if (q.includes("130025265")) {
      res.writeHead(503, { "content-type": "text/plain" });
      res.end("coupe");
      return;
    }
    if (q.includes("100000009")) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          results: [
            {
              siren: "100000009",
              nom_complet: "DUCLOS REGISTRE",
              nom_raison_sociale: "DUCLOS REGISTRE",
              nature_juridique: "5499",
              activite_principale: "25.11Z",
              siege: { adresse: "8 QUAI SAINT-VINCENT 69001 LYON" },
              dirigeants: [
                {
                  nom: nomDirigeant,
                  prenoms: "Camille",
                  date_de_naissance: "1980-03-14",
                  qualite: "Gérant",
                  type_dirigeant: "personne physique",
                },
                {
                  nom: "Renard",
                  prenoms: "Paul",
                  date_de_naissance: "1975-01-02",
                  qualite: "Président",
                  type_dirigeant: "personne physique",
                },
              ],
            },
          ],
        }),
      );
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ results: [] }));
  });
  await new Promise((resolve) => registre.listen(portRegistre, "0.0.0.0", resolve));
  relancerApi(`http://host.docker.internal:${portRegistre}/search`);
  const marque = ui.marque;
  nomDirigeant = `Martin ${marque}`;
  const jeton = await demoAccessToken(api, `annuaire-${marque}`);
  const personneId = randomUUID();
  const societeId = randomUUID();
  const personne = await ui.apiJson(jeton, "POST", "/contacts", {
    id: personneId,
    idempotence_cle: `annuaire-personne-${marque}`,
    nature: "physique",
    nom: `Martin ${marque}`,
    prenoms: "Camille",
    civilite: "Madame",
    type_client: "particulier",
    nom_naissance: "Dupont",
    date_naissance: "1980-03-14",
    lieu_naissance: "Lyon",
    nationalite: "française",
    profession: "avocate",
    situation_familiale: "marie",
  });
  if (personne.status !== 200) fail(`personne ${personne.status} ${personne.texte.slice(0, 180)}`);
  const societe = await ui.apiJson(jeton, "POST", "/contacts", {
    id: societeId,
    idempotence_cle: `annuaire-societe-${marque}`,
    nature: "morale",
    nom: `Duclos ${marque}`,
    type_client: "professionnel",
    siren: "100000009",
    numero_tva: "FR88100000009",
    forme: "5499",
    capital_centimes: 1_000_000,
    monnaie: "EUR",
    greffe_rcs: "RCS de Lyon",
    activite: "Metallurgie",
  });
  if (societe.status !== 200) fail(`société ${societe.status} ${societe.texte.slice(0, 180)}`);
  const coupeId = randomUUID();
  const coupe = await ui.apiJson(jeton, "POST", "/contacts", {
    id: coupeId,
    idempotence_cle: `annuaire-coupe-${marque}`,
    nature: "morale",
    nom: `Coupe ${marque}`,
    type_client: "professionnel",
    siren: "130025265",
  });
  if (coupe.status !== 200) fail(`société coupée ${coupe.status} ${coupe.texte.slice(0, 180)}`);
  const jumeauId = randomUUID();
  const jumeau = await ui.apiJson(jeton, "POST", "/contacts", {
    id: jumeauId,
    idempotence_cle: `annuaire-jumeau-${marque}`,
    nature: "physique",
    nom: `Martin ${marque}`,
    prenoms: "Camille",
    type_client: "particulier",
    date_naissance: "1980-03-14",
  });
  if (jumeau.status !== 200) fail(`doublon ${jumeau.status} ${jumeau.texte.slice(0, 180)}`);
  await sqlServeur(
    `UPDATE contacts SET prenoms = 'Camille', civilite = 'Madame', nom_naissance = 'Dupont',
       date_naissance = '1980-03-14', lieu_naissance = 'Lyon', nationalite = 'française',
       profession = 'avocate', situation_familiale = 'marie' WHERE id = '${personneId}'`,
  );
  await sqlServeur(
    `UPDATE contacts SET prenoms = 'Camille', date_naissance = '1980-03-14' WHERE id = '${jumeauId}'`,
  );
  const telJumeau = `06${marque}`;
  await sqlServeur(
    `INSERT INTO contact_coordonnees (id, cabinet_id, contact_id, genre, usage, valeur, principale)
     SELECT '${randomUUID()}', cabinet_id, id, 'telephone', 'domicile', '${telJumeau}', TRUE
     FROM contacts WHERE id = '${jumeauId}'`,
  );
  await sqlServeur(
    `UPDATE contacts SET forme = '5499', capital_centimes = 1000000, monnaie = 'EUR',
       greffe_rcs = 'RCS de Lyon', activite = 'Metallurgie', numero_tva = 'FR88100000009'
     WHERE id = '${societeId}'`,
  );
  const dossierId = randomUUID();
  const dossier = await ui.apiJson(jeton, "POST", "/dossiers", {
    id: dossierId,
    idempotence_cle: `annuaire-dossier-${marque}`,
    nom: `Dossier ${marque}`,
    chemise: "kraft",
    juridiction: "TJ fictif",
    numero_rg: `RG-ANNU-${marque}`,
    restreint: false,
  });
  if (dossier.status !== 200) fail(`dossier ${dossier.status} ${dossier.texte.slice(0, 180)}`);
  const email = `camille-${marque}@example.test`;
  const intervenantId = randomUUID();
  const coordId = randomUUID();
  const factureId = randomUUID();
  const encaissementId = randomUUID();
  const noteId = randomUUID();
  const messageId = randomUUID();
  await sqlServeur(
    `INSERT INTO dossier_intervenants (id, cabinet_id, dossier_id, contact_id, qualite_id, visibilite, revision)
     SELECT '${intervenantId}', c.cabinet_id, '${dossierId}', c.id, q.id, 'public', 1
     FROM contacts c
     JOIN qualites q ON q.cabinet_id = c.cabinet_id AND q.code = 'client'
     WHERE c.id = '${personneId}'`,
  );
  await sqlServeur(
    `INSERT INTO contact_coordonnees (id, cabinet_id, contact_id, genre, usage, valeur, principale)
     SELECT '${coordId}', cabinet_id, id, 'email', 'domicile', '${email}', TRUE
     FROM contacts WHERE id = '${personneId}'`,
  );
  await sqlServeur(
    `INSERT INTO factures (
       id, cabinet_id, dossier_id, contact_id, type, statut,
       montant_ht_centimes, montant_tva_centimes, montant_ttc_centimes, taux_tva_bp
     )
     SELECT '${factureId}', cabinet_id, '${dossierId}', id, 'facture', 'brouillon',
            10000, 2000, 12000, 2000
     FROM contacts WHERE id = '${personneId}'`,
  );
  await sqlServeur(
    `INSERT INTO facture_encaissements (id, facture_id, montant_centimes, cle_idempotence)
     VALUES ('${encaissementId}', '${factureId}', 4000, 'annuaire-enc-${marque}')`,
  );
  await sqlServeur(
    `INSERT INTO contact_notes (id, cabinet_id, contact_id, texte)
     SELECT '${noteId}', cabinet_id, id, 'Note ${marque}'
     FROM contacts WHERE id = '${personneId}'`,
  );
  let compte = (
    await sqlServeur(
      `SELECT id FROM comptes_mail WHERE type_compte = 'classement' AND cabinet_id = (SELECT cabinet_id FROM contacts WHERE id = '${personneId}') LIMIT 1`,
    )
  ).trim();
  if (compte === "") {
    compte = randomUUID();
    await sqlServeur(
      `INSERT INTO comptes_mail (id, cabinet_id, type_compte, adresse, secret_ref)
       SELECT '${compte}', cabinet_id, 'classement', 'classement@cabinet.example', 'srv:annuaire'
       FROM contacts WHERE id = '${personneId}'`,
    );
  }
  const uid = Date.now() % 1_000_000_000;
  await sqlServeur(
    `INSERT INTO messages (
       id, cabinet_id, compte_id, dossier_id, message_id, uid_validity, uid,
       objet, expediteur, etat_classement, visibilite, restreint
     )
     SELECT '${messageId}', cabinet_id, '${compte}', '${dossierId}',
            '<annuaire-${marque}@cabinet.example>', 1, ${uid},
            'Courrier ${marque}', '${email}', 'classe', 'public', FALSE
     FROM contacts WHERE id = '${personneId}'`,
  );
  ok("fiches créées");

  spawnSync("docker", ["restart", "legalos-instance-powersync-1"], { stdio: "inherit" });
  await sleep(8000);

  resetPostes([posteId]);
  app = startApp(posteId, 9356);
  await waitCdp(app);
  const cdp = await connectCdp(app.port);
  await login(cdp.send, demoEmail, demoPassword, totpSecretB32, `Annuaire ${marque}`);
  await attendreSqlite(posteId, `SELECT COUNT(*) FROM contacts WHERE id = '${personneId}'`, (v) => v === "1");
  await attendreSqlite(posteId, `SELECT COUNT(*) FROM contacts WHERE id = '${coupeId}'`, (v) => v === "1");
  await attendreSqlite(posteId, `SELECT COUNT(*) FROM dossier_intervenants WHERE id = '${intervenantId}'`, (v) => v === "1");
  await attendreSqlite(posteId, `SELECT COUNT(*) FROM factures WHERE id = '${factureId}'`, (v) => v === "1");
  await attendreSqlite(posteId, `SELECT COUNT(*) FROM facture_encaissements WHERE id = '${encaissementId}'`, (v) => v === "1");
  await attendreSqlite(posteId, `SELECT COUNT(*) FROM contact_notes WHERE id = '${noteId}'`, (v) => v === "1");
  await attendreSqlite(posteId, `SELECT COUNT(*) FROM messages WHERE id = '${messageId}'`, (v) => v === "1");
  ok("synchronisé");

  const ordre = await evaluate(
    cdp.send,
    `(() => {
      const ids = ["dossiers", "contacts", "mails"].map((id) => document.querySelector("[data-testid=nav-" + id + "]"));
      if (ids.some((el) => el === null)) return "nav absente";
      if ((ids[0].compareDocumentPosition(ids[1]) & Node.DOCUMENT_POSITION_FOLLOWING) === 0) return "Contacts n'est pas après Dossiers";
      if ((ids[1].compareDocumentPosition(ids[2]) & Node.DOCUMENT_POSITION_FOLLOWING) === 0) return "Mails n'est pas après Contacts";
      return "";
    })()`,
  );
  if (ordre) fail(String(ordre));

  await cliquer(cdp.send, "[data-testid=nav-contacts]");
  await attendre(cdp.send, "[data-testid=barre-actions]");
  await attendre(cdp.send, "[data-testid=contacts-nouveau]");
  await attendre(cdp.send, "[data-testid=contacts-importer-siren]");
  // Création dans la fiche (maquette) : étiquette, bascule morale / physique, formulaire de chaque nature.
  await cliquer(cdp.send, "[data-testid=contacts-nouveau]");
  await attendre(cdp.send, "[data-testid=contacts-nouveau-contact]");
  await attendre(cdp.send, "[data-testid=contacts-creation-nature-morale]");
  await attendre(cdp.send, "[data-testid=contacts-creation-nature-physique]");
  await attendre(cdp.send, "[data-testid=contacts-creation-personne]");
  await cliquer(cdp.send, "[data-testid=contacts-creation-nature-morale]");
  await attendre(cdp.send, "[data-testid=contacts-creation-siren]");
  await attendre(cdp.send, "[data-testid=contacts-creation-interroger]");
  await attendre(cdp.send, "[data-testid=contacts-creation-creer]");
  const creationTexte = String(
    (await evaluate(cdp.send, `document.querySelector("[data-testid=contacts-nouveau-contact]")?.textContent ?? ""`)) ?? "",
  ).replace(/\s/g, " ");
  for (const attendu of ["Nouveau contact", "La fiche rejoint l'annuaire commun du cabinet.", "Chercher dans le registre", "Calculé à partir du SIREN", "Code postal", "Commune", "Enregistrer la fiche"]) {
    if (!creationTexte.replace(/’/g, "'").includes(attendu)) fail(`création : « ${attendu} » absent`);
  }
  await cliquer(cdp.send, "[data-testid=contacts-creation-annuler]");
  await sleep(300);
  if ((await evaluate(cdp.send, `document.querySelector("[data-testid=contacts-nouveau-contact]") !== null`)) === true) {
    fail("la création reste ouverte après Annuler");
  }
  // Enregistrement d'une société depuis le formulaire : SIREN contrôlé, TVA calculée, adresse assemblée.
  const nomCreation = `Atelier ${marque}`;
  // SIREN propre à chaque exécution (clé de Luhn valide) : l'annuaire d'un poste de développement
  // garde les sociétés créées par les exécutions précédentes, et un SIREN déjà connu bloque la création.
  const sirenCreation = (() => {
    const base = `1${String(marque).replace(/\D/g, "").padStart(6, "0").slice(-6)}0`;
    for (let cle = 0; cle < 10; cle += 1) {
      const candidat = `${base}${String(cle)}`;
      let somme = 0;
      for (let i = 0; i < 9; i += 1) {
        let chiffre = Number(candidat[8 - i]);
        if (i % 2 === 1) {
          chiffre *= 2;
          if (chiffre > 9) chiffre -= 9;
        }
        somme += chiffre;
      }
      if (somme % 10 === 0) return candidat;
    }
    return "100000108";
  })();
  await cliquer(cdp.send, "[data-testid=contacts-importer-siren]");
  await attendre(cdp.send, "[data-testid=contacts-creation-siren]");
  await saisir(cdp.send, "[data-testid=contacts-creation-siren]", "123456789");
  await cliquer(cdp.send, "[data-testid=contacts-creation-interroger]");
  await attendre(cdp.send, "[data-testid=contacts-creation-siren-erreur]");
  await saisir(cdp.send, "[data-testid=contacts-creation-siren]", sirenCreation);
  const tvaCalculee = String(
    (await evaluate(cdp.send, `document.querySelector("[data-testid=contacts-creation-tva]")?.value ?? ""`)) ?? "",
  );
  if (!new RegExp(`^FR\\d{2}${sirenCreation}$`).test(tvaCalculee)) fail(`TVA calculée : ${tvaCalculee}`);
  await saisir(cdp.send, "[data-testid=contacts-creation-denomination]", nomCreation);
  await saisir(cdp.send, "[data-testid=contacts-creation-forme]", "5710");
  await saisir(cdp.send, "[data-testid=contacts-creation-capital]", "50 000");
  await saisir(cdp.send, "[data-testid=contacts-creation-greffe]", "Lyon");
  await saisir(cdp.send, "[data-testid=contacts-creation-adresse]", "14 rue de la Forge");
  await saisir(cdp.send, "[data-testid=contacts-creation-code-postal]", "69007");
  await attendre(cdp.send, "select[data-testid=contacts-creation-commune]");
  await cliquer(cdp.send, "[data-testid=contacts-creation-creer]");
  let creee = "";
  const debutCreation = Date.now();
  while (Date.now() - debutCreation < 20_000) {
    creee = (
      await sqlServeur(
        `SELECT COALESCE(siren,'') || '|' || COALESCE(numero_tva,'') || '|' || COALESCE(forme,'') || '|' || COALESCE(capital_centimes::text,'') FROM contacts WHERE nom = '${nomCreation}'`,
      )
    ).trim();
    if (creee !== "") break;
    await sleep(500);
  }
  if (creee !== `${sirenCreation}|${tvaCalculee}|5710|5000000`) fail(`société créée depuis le formulaire : ${creee}`);
  const siegeCree = (
    await sqlServeur(
      `SELECT valeur FROM contact_coordonnees WHERE contact_id = (SELECT id FROM contacts WHERE nom = '${nomCreation}') AND usage = 'siege'`,
    )
  ).trim();
  if (!siegeCree.startsWith("14 rue de la Forge, 69007")) fail(`siège créé : ${siegeCree}`);
  await attendre(cdp.send, "[data-testid=contacts-fiche] [data-testid=contacts-onglet-general]");
  if ((await evaluate(cdp.send, `document.querySelector("[data-testid=contacts-nouveau-contact]") !== null`)) === true) {
    fail("la création reste ouverte après Enregistrer");
  }
  ok("société créée depuis le formulaire");
  await attendre(cdp.send, `[data-testid=contacts-ligne][data-contact-id="${personneId}"]`);
  await cliquer(cdp.send, `[data-testid=contacts-ligne][data-contact-id="${personneId}"]`);
  await sleep(400);
  // Comme la maquette, « Factures » n'apparaît que pour un contact qui en a : la personne en a une,
  // lue en base locale après l'ouverture de la fiche.
  {
    const debutOnglet = Date.now();
    while (
      (await evaluate(cdp.send, `document.querySelector("[data-testid=contacts-onglet-factures]") !== null`)) !== true
    ) {
      if (Date.now() - debutOnglet > 20_000) fail("onglet Factures absent pour une personne qui a une facture");
      await sleep(300);
    }
  }
  const personneEcran = await evaluate(
    cdp.send,
    `(() => {
      const boutons = [...document.querySelectorAll("button")].map((el) => el.textContent.replace(/\\s+/g, " ").trim());
      const civilite = document.querySelector("[data-testid=contacts-civilite]");
      const options = civilite ? [...civilite.options].map((o) => o.textContent.trim()) : [];
      const fax = /fax/i.test(document.body.innerText);
      const sexe = [...document.querySelectorAll("label, span")].some((el) => el.textContent.trim() === "Sexe");
      return {
        filtres: ["Tous", "Personnes", "Sociétés", "Professions"].every((mot) => boutons.some((b) => b.startsWith(mot))),
        onglets: ["Général", "Liens", "Dossiers", "Factures", "Mails", "Notes"].every((mot) => boutons.some((b) => b === mot || (b.startsWith(mot) && /^[0-9]+$/.test(b.slice(mot.length))))),
        options,
        fax,
        sexe,
        designation: document.querySelector("[data-testid=contacts-designation]")?.textContent ?? "",
        mademoiselle: options.some((o) => /mademoiselle/i.test(o)),
        // Lecture de l'état civil : « Née le 14 mars 1980 à Lyon », valeurs à la majuscule initiale.
        etatCivil: Object.fromEntries(
          [...document.querySelectorAll("[data-testid=contacts-fiche] .faits > div")].map((ligne) => [
            (ligne.querySelector("dt")?.textContent ?? "").replace(/[\\u00a0\\u202f\\s]+/g, " ").trim(),
            (ligne.querySelector("dd")?.textContent ?? "").replace(/[\\u00a0\\u202f\\s]+/g, " ").trim(),
          ]),
        ),
      };
    })()`,
  );
  if (!personneEcran.filtres) fail("filtres absents");
  if (!personneEcran.onglets) fail("onglets absents");
  if (personneEcran.fax) fail("un champ fax est présent");
  if (personneEcran.sexe) fail("un champ sexe est présent");
  if (personneEcran.mademoiselle) fail("Mademoiselle est proposée");
  if (!personneEcran.options.includes("Madame") || !personneEcran.options.includes("Maître")) fail("civilités de départ absentes");
  if (!personneEcran.designation.includes("Camille")) fail(`désignation : ${personneEcran.designation.slice(0, 120)}`);
  // Lieu de naissance : la fiche en lecture écrit la date puis le lieu saisi (14 mars 1980, Lyon).
  if (personneEcran.etatCivil["Née le"] !== "14 mars 1980 à Lyon") {
    fail(`naissance en lecture : ${JSON.stringify(personneEcran.etatCivil["Née le"] ?? personneEcran.etatCivil["Né le"])}`);
  }
  // Valeurs stockées en minuscules (« française », « avocate »), affichées à la majuscule initiale.
  if (personneEcran.etatCivil["Nationalité"] !== "Française") {
    fail(`nationalité en lecture : ${JSON.stringify(personneEcran.etatCivil["Nationalité"])}`);
  }
  if (personneEcran.etatCivil["Profession"] !== "Avocate") {
    fail(`profession en lecture : ${JSON.stringify(personneEcran.etatCivil["Profession"])}`);
  }
  ok("fiche personne");

  async function attendreTexte(selecteur, morceau) {
    const debut = Date.now();
    while (Date.now() - debut < 20_000) {
      const lu = String(
        (await evaluate(cdp.send, `document.querySelector(${JSON.stringify(selecteur)})?.textContent ?? ""`)) ?? "",
      ).replace(/[\u00a0\u202f]/g, " ");
      if (lu.includes(morceau)) return;
      await sleep(400);
    }
    fail(`texte absent (${selecteur}) : ${morceau}`);
  }

  await cliquer(cdp.send, "[data-testid=contacts-onglet-dossiers]");
  await attendreTexte("[data-testid=contacts-dossiers]", `Dossier ${marque}`);
  await attendreTexte("[data-testid=contacts-dossiers]", "Client");
  await attendreTexte("[data-testid=contacts-dossier] .contacts-dos__ref", "20");
  // Point de chemise de la pastille : une couleur résolue depuis le jeton, jamais transparente.
  const pointChemise = String(
    await evaluate(
      cdp.send,
      `getComputedStyle(document.querySelector("[data-testid=contacts-dossier] .contacts-dos__ref i")).backgroundColor`,
    ),
  );
  if (pointChemise === "rgba(0, 0, 0, 0)" || pointChemise === "") fail("point de chemise de la pastille sans couleur");
  await cliquer(cdp.send, "[data-testid=contacts-onglet-factures]");
  await attendreTexte("[data-testid=contacts-factures]", "120,00");
  await attendreTexte("[data-testid=contacts-facture-encaisse]", "40,00");
  await attendreTexte("[data-testid=contacts-facture-encours]", "80,00");
  // La base locale n'a ni date ni objet de facture : la tuile ne cite pas d'année et les colonnes sont absentes.
  await attendreTexte("[data-testid=contacts-facture-facture]", "Facturé");
  await attendreTexte("[data-testid=contacts-facture-facture]", "120,00");
  if ((await evaluate(cdp.send, `document.querySelector("[data-testid=contacts-factures] table")?.innerText ?? ""`)).includes("Objet")) {
    fail("colonne Objet affichée sans donnée d'objet en base locale");
  }
  await cliquer(cdp.send, "[data-testid=contacts-onglet-notes]");
  await attendreTexte("[data-testid=contacts-notes]", `Note ${marque}`);
  // Bloc de notes de la maquette : fond teinté, rayon 12 px, rembourrage 12 et 14 px, 13 px, interligne 1,55.
  const blocNotes = String(
    await evaluate(
      cdp.send,
      `(() => { const c = getComputedStyle(document.querySelector("[data-testid=contacts-notes]")); return [c.backgroundColor, c.borderTopLeftRadius, c.paddingTop, c.paddingLeft, c.fontSize, String(parseFloat(c.lineHeight) / parseFloat(c.fontSize))].join("|"); })()`,
    ),
  );
  const [fondNotes, rayonNotes, hautNotes, gaucheNotes, tailleNotes, interligneNotes] = blocNotes.split("|");
  if (
    fondNotes === "rgba(0, 0, 0, 0)" ||
    rayonNotes !== "12px" ||
    hautNotes !== "12px" ||
    gaucheNotes !== "14px" ||
    tailleNotes !== "13px" ||
    Number(interligneNotes) < 1.54 ||
    Number(interligneNotes) > 1.56
  ) {
    fail(`bloc de notes différent de la maquette : ${blocNotes}`);
  }
  await cliquer(cdp.send, "[data-testid=contacts-onglet-mails]");
  await attendreTexte("[data-testid=contacts-mails]", `Courrier ${marque}`);
  await attendreTexte(
    "[data-testid=contacts-mails-mention]",
    "Mails classés dont l’expéditeur ou un destinataire est une adresse de cette fiche.",
  );
  ok("historique");

  await cliquer(cdp.send, "[data-testid=contacts-onglet-general]");
  // Alerte passive (maquette) : la détection part seule à l'ouverture de la fiche, sans clic.
  await attendreTexte("[data-testid=contacts-doublon]", "Doublon possible");
  await attendreTexte("[data-testid=contacts-doublon]", "mêmes nom");
  await cliquer(cdp.send, "[data-testid=contacts-doublon-comparer]");
  await attendre(cdp.send, "[data-testid=contacts-doublon-fusionner]");
  const fusionInactive = await evaluate(
    cdp.send,
    `document.querySelector("[data-testid=contacts-doublon-fusionner]")?.disabled ?? true`,
  );
  if (fusionInactive) fail("la fusion est désactivée en ligne");
  await cliquer(cdp.send, "[data-testid=contacts-doublon-fusionner]");
  const debutFusion = Date.now();
  let fusion = "";
  while (Date.now() - debutFusion < 12_000) {
    fusion = String(
      (await evaluate(cdp.send, `document.querySelector("[data-testid=contacts-doublons-message]")?.textContent ?? ""`)) ?? "",
    );
    if (fusion.includes("Fusion enregistrée") || fusion.includes("échoué")) break;
    await sleep(300);
  }
  if (!fusion.includes("Fusion enregistrée")) fail(`fusion : ${fusion.slice(0, 160)}`);
  const absorbee = (
    await sqlServeur(
      `SELECT archivee::text || '|' || COALESCE(fusionnee_dans::text, '') FROM contacts WHERE id = '${jumeauId}'`,
    )
  ).trim();
  if (absorbee !== `true|${personneId}`) fail(`fiche absorbée : ${absorbee}`);
  const tel = (
    await sqlServeur(
      `SELECT COUNT(*) FROM contact_coordonnees WHERE contact_id = '${personneId}' AND valeur = '${telJumeau}'`,
    )
  ).trim();
  if (tel !== "1") fail(`téléphone non reporté : ${tel}`);
  const deuxieme = await ui.apiJson(jeton, "POST", `/contacts/${personneId}/fusion`, {
    idempotence_cle: randomUUID(),
    absorbee_id: jumeauId,
    champs_absorbes: [],
  });
  if (deuxieme.status !== 200) fail(`deuxième fusion ${deuxieme.status} ${deuxieme.texte.slice(0, 120)}`);
  const telApres = (
    await sqlServeur(
      `SELECT COUNT(*) FROM contact_coordonnees WHERE valeur = '${telJumeau}'`,
    )
  ).trim();
  if (telApres !== "1") fail(`téléphone dupliqué : ${telApres}`);
  ok("doublon fusionné");

  await cliquer(cdp.send, `[data-testid=contacts-ligne][data-contact-id="${societeId}"]`);
  await sleep(400);
  const societeEcran = await evaluate(
    cdp.send,
    `(() => {
      const valeur = (id) => document.querySelector("[data-testid=" + JSON.stringify(id) + "]")?.value ?? "";
      const designation = document.querySelector("[data-testid=contacts-designation]")?.textContent ?? "";
      return {
        denomination: valeur("contacts-denomination-nom"),
        siren: valeur("contacts-siren"),
        tva: valeur("contacts-tva"),
        greffe: valeur("contacts-greffe"),
        activite: valeur("contacts-activite"),
        forme: Boolean(document.querySelector("[data-testid=contacts-forme]")),
        capital: Boolean(document.querySelector("[data-testid=contacts-capital]")),
        designation,
      };
    })()`,
  );
  if (!societeEcran.denomination.includes(marque)) fail(`dénomination : ${societeEcran.denomination}`);
  if (societeEcran.siren !== "100000009") fail(`SIREN : ${societeEcran.siren}`);
  if (societeEcran.tva !== "FR88100000009") fail(`TVA : ${societeEcran.tva}`);
  if (societeEcran.greffe !== "RCS de Lyon") fail(`greffe : ${societeEcran.greffe}`);
  if (societeEcran.activite !== "Metallurgie") fail(`activité : ${societeEcran.activite}`);
  if (!societeEcran.forme || !societeEcran.capital) fail("forme ou capital absent");
  if (!societeEcran.designation.includes("100000009")) fail("la désignation ne reprend pas le SIREN");
  {
    // Le compteur de la fiche précédente disparaît dès que la lecture locale de la société aboutit.
    const debutAbsent = Date.now();
    while ((await evaluate(cdp.send, `document.querySelector("[data-testid=contacts-onglet-factures]") !== null`)) === true) {
      if (Date.now() - debutAbsent > 8_000) fail("onglet Factures présent pour une société sans facture");
      await sleep(300);
    }
  }
  ok("fiche société");

  const sirenInvalide = await ui.apiJson(jeton, "GET", "/contacts/recherche-siren/123456789");
  if (sirenInvalide.status !== 400 || !sirenInvalide.texte.includes("SIREN invalide")) {
    fail(`SIREN invalide → ${sirenInvalide.status} ${sirenInvalide.texte.slice(0, 120)}`);
  }
  const boutonInactif = await evaluate(
    cdp.send,
    `document.querySelector("[data-testid=contacts-import-siren]")?.disabled ?? true`,
  );
  if (boutonInactif) fail("le bouton d'import est désactivé en ligne");
  await cliquer(cdp.send, "[data-testid=contacts-import-siren]");
  const importEcran = await attendreImport(cdp.send);
  if (!importEcran.manuel) fail("la saisie manuelle a disparu");
  if (!importEcran.proposition.includes("DUCLOS REGISTRE") || !importEcran.proposition.includes("capital") || !importEcran.proposition.includes("greffe")) {
    fail(`proposition : ${(importEcran.proposition || importEcran.message).slice(0, 180)}`);
  }
  ok("proposition du registre");

  await cliquer(cdp.send, "[data-testid=contacts-import-retenir-denomination]");
  const debutRetenu = Date.now();
  let retenu = "";
  while (Date.now() - debutRetenu < 5_000) {
    retenu = String(
      (await evaluate(cdp.send, `document.querySelector("[data-testid=contacts-import-retenu]")?.textContent ?? ""`)) ?? "",
    );
    if (retenu.includes("Dénomination")) break;
    await sleep(200);
  }
  if (!retenu.includes("Dénomination")) fail(`champ non retenu : ${retenu.slice(0, 120)}`);
  await cliquer(cdp.send, "[data-testid=contacts-import-enregistrer]");
  const debutSource = Date.now();
  let source = "";
  while (Date.now() - debutSource < 15_000) {
    source = String(
      (await evaluate(
        cdp.send,
        `document.querySelector("[data-testid=contacts-import-source]")?.textContent ?? ""`,
      )) ?? "",
    ).replace(/[\u00a0\u202f]/g, " ").replace(/\u2019/g, "'");
    if (source.includes("Recherche d'entreprises")) break;
    await sleep(300);
  }
  if (!source.includes("Recherche d'entreprises")) fail(`source : ${source.slice(0, 160)}`);
  const conserve = (
    await sqlServeur(
      `SELECT nom || '|' || COALESCE(source_import, '') || '|' || COALESCE(greffe_rcs, '') || '|' || capital_centimes::text
       FROM contacts WHERE id = '${societeId}'`,
    )
  ).trim();
  if (conserve !== "DUCLOS REGISTRE|recherche-entreprises|RCS de Lyon|1000000") {
    fail(`fiche après import : ${conserve}`);
  }
  ok("champ retenu");

  const dirigeants = String(
    (await evaluate(cdp.send, `document.querySelector("[data-testid=contacts-dirigeants]")?.textContent ?? ""`)) ?? "",
  );
  if (!dirigeants.includes("Camille") || !dirigeants.includes("Paul Renard")) {
    fail(`dirigeants : ${dirigeants.slice(0, 200)}`);
  }
  if (!dirigeants.includes("Créer une fiche") || !dirigeants.includes("Ignorer")) fail("les choix créer et ignorer manquent");
  await cliquer(cdp.send, "[data-testid=contacts-dirigeant-relier]");
  const debutLien = Date.now();
  let etatDirigeant = "";
  while (Date.now() - debutLien < 12_000) {
    etatDirigeant = String(
      (await evaluate(cdp.send, `document.querySelector("[data-testid=contacts-dirigeants]")?.textContent ?? ""`)) ?? "",
    );
    if (etatDirigeant.includes("Relié") || etatDirigeant.includes("pas été enregistré")) break;
    await sleep(300);
  }
  if (!etatDirigeant.includes("Relié")) fail(`lien dirigeant : ${etatDirigeant.slice(0, 200)}`);
  const ignore = await evaluate(
    cdp.send,
    `(() => { const boutons = document.querySelectorAll("[data-testid=contacts-dirigeant-ignorer]"); boutons[1]?.click(); return boutons.length; })()`,
  );
  if (ignore !== 2) fail(`boutons ignorer : ${String(ignore)}`);
  const debutIgnore = Date.now();
  while (Date.now() - debutIgnore < 5_000) {
    etatDirigeant = String(
      (await evaluate(cdp.send, `document.querySelector("[data-testid=contacts-dirigeants]")?.textContent ?? ""`)) ?? "",
    );
    if (etatDirigeant.includes("Ignoré")) break;
    await sleep(200);
  }
  if (!etatDirigeant.includes("Ignoré")) fail(`dirigeant ignoré : ${etatDirigeant.slice(0, 200)}`);
  const lien = (
    await sqlServeur(
      `SELECT COUNT(*) FROM contact_liens
       WHERE contact_source_id = '${personneId}' AND contact_cible_id = '${societeId}'
         AND type_lien = 'mandat_social' AND fonction = 'gerant'`,
    )
  ).trim();
  if (lien !== "1") fail(`lien en base : ${lien}`);
  const paul = (
    await sqlServeur(`SELECT COUNT(*) FROM contacts WHERE nom = 'Renard' AND prenoms = 'Paul'`)
  ).trim();
  if (paul !== "0") fail("Paul Renard a été créé d'office");
  ok("dirigeants");

  await cliquer(cdp.send, `[data-testid=contacts-ligne][data-contact-id="${coupeId}"]`);
  await attendre(cdp.send, "[data-testid=contacts-import-siren]");
  await cliquer(cdp.send, "[data-testid=contacts-import-siren]");
  const coupeEcran = await attendreImport(cdp.send);
  if (!coupeEcran.manuel) fail("la saisie manuelle a disparu quand le registre est coupé");
  if (!coupeEcran.message.includes("indisponible")) fail(`registre coupé : ${coupeEcran.message.slice(0, 160)}`);
  ok("registre coupé");

  await attendre(cdp.send, "[data-testid=contacts-supprimer]");
  await cliquer(cdp.send, "[data-testid=contacts-supprimer]");
  const debutSeul = Date.now();
  let seulPresent = true;
  while (Date.now() - debutSeul < 12_000) {
    seulPresent = Boolean(
      await evaluate(
        cdp.send,
        `Boolean(document.querySelector("[data-testid=contacts-ligne][data-contact-id='${coupeId}']"))`,
      ),
    );
    if (!seulPresent) break;
    await sleep(300);
  }
  if (seulPresent) fail("le contact jamais lié est encore dans la liste");
  const seulReste = (await sqlServeur(`SELECT COUNT(*) FROM contacts WHERE id = '${coupeId}'`)).trim();
  if (seulReste !== "0") fail(`contact jamais lié encore en base : ${seulReste}`);
  const journalSuppression = (
    await sqlServeur(
      `SELECT COUNT(*) FROM journal_modifications WHERE enregistrement_id = '${coupeId}' AND champ = 'suppression'`,
    )
  ).trim();
  if (journalSuppression === "0") fail("la suppression n'est pas journalisée");
  ok("contact jamais lié supprimé");

  await cliquer(cdp.send, `[data-testid=contacts-ligne][data-contact-id="${societeId}"]`);
  await attendre(cdp.send, "[data-testid=contacts-archiver]");
  await cliquer(cdp.send, "[data-testid=contacts-archiver]");
  const debutArchive = Date.now();
  let archive = "";
  while (Date.now() - debutArchive < 12_000) {
    archive = String(
      (await evaluate(
        cdp.send,
        `document.querySelector("[data-testid=contacts-ligne][data-contact-id='${societeId}']")?.textContent ?? ""`,
      )) ?? "",
    );
    if (archive.includes("Archivé")) break;
    await sleep(300);
  }
  if (!archive.includes("Archivé")) fail(`contact lié : ${archive.slice(0, 160)}`);
  const societeReste = (
    await sqlServeur(`SELECT archivee::text FROM contacts WHERE id = '${societeId}'`)
  ).trim();
  if (societeReste !== "true") fail(`fiche liée : ${societeReste}`);
  const journalArchive = (
    await sqlServeur(
      `SELECT COUNT(*) FROM journal_modifications WHERE enregistrement_id = '${societeId}' AND champ = 'archive'`,
    )
  ).trim();
  if (journalArchive === "0") fail("l'archivage n'est pas journalisé");
  ok("contact lié archivé");

  await cliquer(cdp.send, "[data-testid=nav-dossiers]");
  await sleep(300);
  await cliquer(cdp.send, "[aria-label='Palette de commandes']");
  await attendre(cdp.send, "[data-testid=palette-contacts]");
  await cliquer(cdp.send, "[data-testid=palette-contacts]");
  await attendre(cdp.send, "[data-testid=ecran-contacts]");
  ok("palette");
  ok("OK");
} catch (err) {
  if (app) console.error(app.logTail?.() ?? "");
  if (!(err instanceof Error) || !String(err.message).includes("FAIL")) {
    fail(err instanceof Error ? err.message : String(err));
  }
  process.exitCode = 1;
} finally {
  if (app) await stopApp(app);
  if (registre) registre.close();
  relancerApi();
  fermer();
}
