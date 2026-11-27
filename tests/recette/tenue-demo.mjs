#!/usr/bin/env node
/**
 * Jeu Tenue visuelle sur l'instance de démonstration (port 8188), jamais sur celle des recettes (8088).
 * Usage : node tests/recette/tenue-demo.mjs
 * Prérequis : docker compose -p legalos-demo --env-file .env.demo up -d, puis cargo xtask demo sur cette base.
 * Charge aussi un annuaire fictif (contacts, coordonnées, liens, notes, dossier de démonstration « Annuaire — … »)
 * pour les captures de l'écran Contacts. Rejouable sans doublon : identifiants déterminés, rien n'est recréé s'il existe.
 */
import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { demoAccessToken } from "./lib/demo-auth.mjs";

const demoApi = process.env.LEGALOS_DEMO_API ?? "http://127.0.0.1:8188/api";
const recetteApi = process.env.LEGALOS_INSTANCE_URL ?? "http://127.0.0.1:8088";

function fail(message) {
  console.error(`tenue-demo: FAIL — ${message}`);
  process.exit(1);
}

function ok(message) {
  console.log(`tenue-demo: ${message}`);
}

function sql(requete) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "docker",
      ["exec", "-i", "legalos-demo-postgres-1", "psql", "-U", "legalos", "-d", "legalos", "-tAc", requete],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let sortie = "";
    let erreur = "";
    child.stdout.on("data", (morceau) => {
      sortie += morceau.toString();
    });
    child.stderr.on("data", (morceau) => {
      erreur += morceau.toString();
    });
    child.on("exit", (code) => {
      if (code === 0) resolve(sortie.trim());
      else reject(new Error(erreur.slice(0, 200) || `psql ${code}`));
    });
  });
}

const NOMS = [
  ["Martin", "Durand"],
  ["Bernard", "Petit"],
  ["Dubois", "Laurent"],
  ["Thomas", "Simon"],
  ["Robert", "Michel"],
  ["Richard", "Leroy"],
  ["Moreau", "Roux"],
  ["Fournier", "Girard"],
  ["Mercier", "Blanc"],
  ["Faure", "Guerin"],
  ["Garnier", "Chevalier"],
  ["Boyer", "Colin"],
  ["Gauthier", "Perrin"],
  ["Robin", "Morin"],
  ["Nicolas", "Clement"],
  ["Henry", "Gautier"],
  ["Roussel", "Mathieu"],
  ["David", "Masson"],
  ["Bertrand", "Denis"],
  ["Lambert", "Morel"],
  ["Bonnet", "Girard"],
  ["Francois", "Lefebvre"],
  ["Legrand", "Garcia"],
  ["Rousseau", "Fontaine"],
  ["Vincent", "Chevallier"],
  ["Muller", "Roy"],
  ["Lefevre", "Andre"],
  ["Picard", "Meyer"],
  ["Gaillard", "Barbier"],
  ["Caron", "Roux"],
];
const CHEMISES = ["kraft", "bleu-classeur", "vert-amande", "jaune-paille", "rose-buvard", "lilas", "vert-eau", "gris-perle"];

if (new URL(demoApi).port === new URL(recetteApi).port) fail("l'instance de démonstration n'est pas distincte");
const santeDemo = await fetch(`${demoApi.replace(/\/api$/, "")}/health`).catch(() => null);
if (!santeDemo?.ok) fail("instance de démonstration absente (port 8188)");
const santeRecette = await fetch(`${recetteApi}/health`).catch(() => null);
if (!santeRecette?.ok) fail("l'instance des recettes ne répond plus");
ok("les deux instances répondent, sur des ports différents");

const deja = Number(await sql(`SELECT COUNT(*) FROM dossiers WHERE nom LIKE 'Tenue — %'`));
if (deja > 0 && deja < NOMS.length) {
  await sql(`DELETE FROM brouillons_facture WHERE dossier_id IN (SELECT id FROM dossiers WHERE nom LIKE 'Tenue — %')`);
  await sql(`DELETE FROM temps_saisis WHERE dossier_id IN (SELECT id FROM dossiers WHERE nom LIKE 'Tenue — %')`);
  await sql(`DELETE FROM agenda_elements WHERE dossier_id IN (SELECT id FROM dossiers WHERE nom LIKE 'Tenue — %')`);
  await sql(`DELETE FROM parties WHERE dossier_id IN (SELECT id FROM dossiers WHERE nom LIKE 'Tenue — %')`);
  await sql(`DELETE FROM dossiers WHERE nom LIKE 'Tenue — %'`);
  await sql(`DELETE FROM upload_idempotence WHERE cle LIKE '%tenue-demo%'`);
  ok("jeu incomplet retiré");
}
const presents = Number(await sql(`SELECT COUNT(*) FROM dossiers WHERE nom LIKE 'Tenue — %'`));
if (presents >= NOMS.length) {
  const parties = Number(await sql(`SELECT COUNT(*) FROM parties p JOIN dossiers d ON d.id = p.dossier_id WHERE d.nom LIKE 'Tenue — %'`));
  const agenda = Number(await sql(`SELECT COUNT(*) FROM agenda_elements a JOIN dossiers d ON d.id = a.dossier_id WHERE d.nom LIKE 'Tenue — %'`));
  const temps = Number(await sql(`SELECT COUNT(*) FROM temps_saisis t JOIN dossiers d ON d.id = t.dossier_id WHERE d.nom LIKE 'Tenue — %'`));
  if (parties < NOMS.length || agenda < NOMS.length || temps < NOMS.length) {
    fail(`jeu incomplet (parties ${parties}, agenda ${agenda}, temps ${temps})`);
  }
  ok(`jeu déjà chargé (${presents} dossiers)`);
}
const jeton = await demoAccessToken(demoApi, "tenue-demo");
await assurerMails();
await assurerContacts();
if (presents >= NOMS.length) process.exit(0);

async function creer(chemin, corps) {
  const reponse = await fetch(`${demoApi}${chemin}`, {
    method: "POST",
    headers: { authorization: `Bearer ${jeton}`, "content-type": "application/json" },
    body: JSON.stringify(corps),
  });
  const texte = await reponse.text();
  if (!reponse.ok) fail(`${chemin} → ${reponse.status} ${texte.slice(0, 180)}`);
  return texte ? JSON.parse(texte) : null;
}

for (let index = 0; index < NOMS.length; index += 1) {
  const [demandeur, adversaire] = NOMS[index];
  const nom = `Tenue — ${demandeur} c/ ${adversaire}`;
  const dossierId = randomUUID();
  await creer("/dossiers", {
    id: dossierId,
    idempotence_cle: `tenue-demo-${nom}`,
    nom,
    chemise: CHEMISES[index % CHEMISES.length],
    juridiction: "TJ Paris",
    numero_rg: `TD${String(index + 1).padStart(2, "0")}`,
    restreint: false,
    type_dossier: index % 2 === 0 ? "contentieux" : "conseil",
    etape: "instruction",
  });
  await creer(`/dossiers/${dossierId}/parties`, {
    id: randomUUID(),
    idempotence_cle: `tenue-demo-client-${index}`,
    role: "client",
    nom: `Sas ${demandeur}`,
  });
  await creer(`/dossiers/${dossierId}/parties`, {
    id: randomUUID(),
    idempotence_cle: `tenue-demo-adv-${index}`,
    role: "adversaire",
    nom: adversaire,
  });
  const jour = String((index % 21) + 1).padStart(2, "0");
  await creer(`/dossiers/${dossierId}/agenda`, {
    id: randomUUID(),
    idempotence_cle: `tenue-demo-ag-${index}`,
    type_element: index % 3 === 0 ? "audience" : "rendez_vous",
    titre: index % 3 === 0 ? `Audience ${demandeur}` : `Rendez-vous ${demandeur}`,
    debut: `2026-10-${jour}T09:30:00.000Z`,
  });
  const tempsId = randomUUID();
  await creer("/temps", {
    id: tempsId,
    dossier_id: dossierId,
    minutes: 30 + index,
    libelle: `Lecture ${demandeur}`,
    taux_centimes_heure: 25_000,
    idempotence_cle: `tenue-demo-temps-${index}`,
  });
  await creer("/brouillons-facture", {
    id: randomUUID(),
    dossier_id: dossierId,
    temps_id: tempsId,
    libelle: `Lecture ${demandeur}`,
    ht_centimes: Math.round(((30 + index) * 25_000) / 60),
    taux_centimes_heure: 25_000,
    idempotence_cle: `tenue-demo-br-${index}`,
  });
}

const comptes = await sql(
  `SELECT (SELECT COUNT(*) FROM dossiers WHERE nom LIKE 'Tenue — %') || ',' ||
          (SELECT COUNT(*) FROM parties p JOIN dossiers d ON d.id = p.dossier_id WHERE d.nom LIKE 'Tenue — %') || ',' ||
          (SELECT COUNT(*) FROM agenda_elements a JOIN dossiers d ON d.id = a.dossier_id WHERE d.nom LIKE 'Tenue — %') || ',' ||
          (SELECT COUNT(*) FROM temps_saisis t JOIN dossiers d ON d.id = t.dossier_id WHERE d.nom LIKE 'Tenue — %')`,
);
ok(`jeu chargé sur l'instance de démonstration (${comptes})`);
await assurerMails();

async function assurerMails() {
  const compte = "0195e100-0000-7000-8000-000000000001";
  await sql(
    `INSERT INTO comptes_mail (id, cabinet_id, type_compte, titulaire_id, adresse, secret_ref)
     SELECT '${compte}', c.id, 'classement', u.id, 'demo@cabinet-fictif.example', 'demo-local'
     FROM cabinets c
     JOIN utilisateurs u ON u.cabinet_id = c.id AND u.email = 'demo@cabinet-fictif.example'
     ON CONFLICT (id) DO NOTHING`,
  );
  const ajoutes = await sql(
    `WITH manquants AS (
       SELECT d.id, d.cabinet_id, d.nom,
              row_number() OVER (ORDER BY d.nom) AS n
       FROM dossiers d
       WHERE d.nom LIKE 'Tenue — %'
         AND NOT EXISTS (SELECT 1 FROM messages m WHERE m.dossier_id = d.id)
     ), base AS (
       SELECT COALESCE(MAX(uid), 0) AS dernier FROM messages WHERE compte_id = '${compte}'
     )
     INSERT INTO messages (
       id, cabinet_id, compte_id, dossier_id, message_id, uid_validity, uid,
       objet, expediteur, etat_classement, visibilite, restreint, extrait_texte, date_entete, lu
     )
     SELECT gen_random_uuid(), m.cabinet_id, '${compte}', m.id,
            '<tenue-' || m.id || '@cabinet-fictif.example>',
            1, base.dernier + m.n,
            'Au sujet de ' || m.nom,
            'greffe@example.com',
            'classe', 'public', false,
            'Message fictif, pour la tenue visuelle.',
            timestamptz '2026-10-01' + ((m.n % 21) * interval '1 day'),
            false
     FROM manquants m CROSS JOIN base
     RETURNING id`,
  );
  const total = await sql(
    `SELECT COUNT(*) FROM messages m JOIN dossiers d ON d.id = m.dossier_id WHERE d.nom LIKE 'Tenue — %'`,
  );
  if (Number(total) < NOMS.length) fail(`mails du jeu : ${total}`);
  ok(`mails classés du jeu : ${total}${ajoutes ? ` (ajoutés ${ajoutes.split("\n").filter(Boolean).length})` : ""}`);
}

/**
 * Annuaire fictif de l'instance de démonstration (écran Contacts, captures de la tenue visuelle).
 * Tout passe par l'API, comme `annuaire.mjs`. Identifiants déterminés par le nom de chaque élément : un rejeu ne crée
 * rien de ce qui existe déjà. SIREN fictifs de la forme 1000000xx (clé de Luhn valide), jamais un numéro réel.
 */
async function assurerContacts() {
  const idDe = (nom) => {
    const h = createHash("sha1").update(`legalos-demo-annuaire:${nom}`).digest("hex");
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
  };
  const tvaFr = (siren) => `FR${String((12 + 3 * (Number(siren) % 97)) % 97).padStart(2, "0")}${siren}`;
  const luhn = (siren) => {
    let somme = 0;
    [...siren].reverse().forEach((c, i) => {
      let n = Number(c);
      if (i % 2 === 1) {
        n *= 2;
        if (n > 9) n -= 9;
      }
      somme += n;
    });
    return somme % 10 === 0;
  };
  const TABLES = new Set(["contacts", "contact_coordonnees", "contact_liens", "contact_notes", "dossier_intervenants", "dossiers"]);
  const compte = { crees: 0, presents: 0 };
  async function assurer(table, chemin, corps) {
    if (!TABLES.has(table)) fail(`table inattendue : ${table}`);
    const present = Number(await sql(`SELECT COUNT(*) FROM ${table} WHERE id = '${corps.id}'`)) > 0;
    if (present) {
      compte.presents += 1;
      return;
    }
    await creer(chemin, corps);
    compte.crees += 1;
  }
  const qualite = async (code) => {
    const id = await sql(
      `SELECT q.id FROM qualites q JOIN utilisateurs u ON u.cabinet_id = q.cabinet_id
       WHERE u.email = 'demo@cabinet-fictif.example' AND q.code = '${code}' LIMIT 1`,
    );
    if (id === "") fail(`qualité absente : ${code}`);
    return id;
  };

  const SOCIETES = [
    {
      cle: "ferrand", nom: "Ferrand Métal", forme: "5710", siren: "100000017", capital: 5_000_000, greffe: "RCS de Lyon",
      activite: "Fabrication de structures métalliques",
      coord: [
        ["adresse", "siege", "14 rue de la Forge, 69007 Lyon"],
        ["adresse", "facturation", "BP 3021, 69341 Lyon Cedex 07"],
        ["telephone", "siege", "04 65 71 41 18"],
        ["email", "siege", "direction@ferrand-metal.example"],
        ["email", "facturation", "compta@ferrand-metal.example"],
      ],
    },
    {
      cle: "duclos", nom: "Duclos Industrie", forme: "5499", siren: "100000009", capital: 1_000_000, greffe: "RCS de Villefranche-Tarare",
      activite: "Chaudronnerie et tuyauterie",
      coord: [
        ["adresse", "siege", "120 rue de la République, 69400 Villefranche-sur-Saône"],
        ["telephone", "siege", "04 65 71 20 07"],
      ],
    },
    {
      cle: "banque", nom: "Banque Rhodanienne", forme: "5599", siren: "100000025", capital: 8_400_000_000, greffe: "RCS de Lyon",
      activite: "Intermédiation monétaire",
      coord: [["adresse", "siege", "2 place de la Bourse, 69002 Lyon"]],
    },
    {
      cle: "rivegauche", nom: "Rive Gauche Expertise", forme: "5499", siren: "100000033", capital: 2_000_000, greffe: "RCS de Lyon",
      activite: "Activités comptables",
      coord: [
        ["adresse", "siege", "31 cours Gambetta, 69003 Lyon"],
        ["telephone", "siege", "04 65 71 19 40"],
      ],
    },
    {
      cle: "perrache", nom: "Holding Perrache", forme: "5710", siren: "100000041", capital: 25_000_000, greffe: "RCS de Lyon",
      activite: "Activités des sociétés holding",
      coord: [["adresse", "siege", "11 cours de Verdun, 69002 Lyon"]],
    },
  ];
  const PERSONNES = [
    {
      cle: "antoine", civilite: "Monsieur", accord: "masculin", prenoms: "Antoine Louis", nom: "Ferrand", type: "particulier",
      naissance: "1968-06-17", lieu: "Grenoble (Isère)", nationalite: "française", profession: "Dirigeant de société", situation: "marie",
      coord: [
        ["adresse", "domicile", "22 rue Vauban, 69006 Lyon"],
        ["telephone", "domicile", "06 39 98 41 18"],
        ["email", "domicile", "antoine.ferrand@ferrand-metal.example"],
      ],
    },
    {
      cle: "claire", civilite: "Madame", accord: "feminin", prenoms: "Claire", nom: "Ferrand", nomNaissance: "Morel", type: "particulier",
      naissance: "1972-02-09", lieu: "Annecy (Haute-Savoie)", nationalite: "française", profession: "Directrice financière", situation: "marie",
      coord: [["adresse", "domicile", "22 rue Vauban, 69006 Lyon"]],
    },
    {
      cle: "moreau", civilite: "Madame", accord: "feminin", prenoms: "Hélène", nom: "Moreau", nomNaissance: "Bouvier", type: "particulier",
      naissance: "1951-11-04", lieu: "Mâcon (Saône-et-Loire)", nationalite: "française", profession: "Retraitée", situation: "veuf",
      coord: [
        ["adresse", "domicile", "3 allée des Cèdres, 69130 Écully"],
        ["telephone", "domicile", "04 65 71 33 08"],
        ["email", "domicile", "helene.moreau@messagerie-fictive.example"],
      ],
    },
    {
      cle: "perrin", civilite: "Maître", accord: "feminin", prenoms: "Anne", nom: "Perrin", type: "professionnel",
      regl: "avocat", barreau: "Lyon", toque: "1187", profession: "Avocate",
      coord: [
        ["adresse", "cabinet", "18 quai de Bondy, 69005 Lyon"],
        ["telephone", "cabinet", "04 65 71 52 10"],
        ["email", "cabinet", "a.perrin@perrin-avocats.example"],
      ],
    },
    {
      cle: "vasseur", civilite: "Maître", accord: "masculin", prenoms: "Clément", nom: "Vasseur", type: "professionnel",
      regl: "avocat", barreau: "Lyon", toque: "874", profession: "Avocat",
      coord: [
        ["adresse", "cabinet", "6 rue de la Bourse, 69002 Lyon"],
        ["email", "cabinet", "c.vasseur@vasseur-associes.example"],
      ],
    },
    {
      cle: "rambert", civilite: "Maître", accord: "feminin", prenoms: "Julie", nom: "Rambert", type: "professionnel",
      regl: "commissaire_justice", cour: "Cour d'appel de Lyon", profession: "Commissaire de justice",
      coord: [
        ["adresse", "etude", "9 rue Servient, 69003 Lyon"],
        ["telephone", "etude", "04 65 71 60 21"],
      ],
    },
    {
      cle: "operrache", civilite: "Monsieur", accord: "masculin", prenoms: "Olivier", nom: "Perrache", type: "particulier",
      naissance: "1968-06-17", lieu: "Grenoble (Isère)", nationalite: "française", profession: "Dirigeant de société", situation: "marie",
      coord: [
        ["adresse", "domicile", "27 quai Saint-Antoine, 69002 Lyon"],
        ["email", "domicile", "o.perrache@holding-perrache.example"],
      ],
    },
    {
      cle: "ines", civilite: "Madame", accord: "feminin", prenoms: "Inès", nom: "Garnier", type: "particulier",
      naissance: "1983-09-30", lieu: "Villeurbanne (Rhône)", nationalite: "française", profession: "Expert-comptable", situation: "pacse",
      coord: [["adresse", "domicile", "5 rue Garibaldi, 69003 Lyon"]],
    },
  ];

  for (const s of SOCIETES) {
    if (!luhn(s.siren)) fail(`SIREN fictif invalide : ${s.siren}`);
    s.id = idDe(`contact:${s.cle}`);
    await assurer("contacts", "/contacts", {
      id: s.id,
      idempotence_cle: `tenue-annuaire-${s.cle}`,
      nature: "morale",
      nom: s.nom,
      type_client: "professionnel",
      siren: s.siren,
      numero_tva: tvaFr(s.siren),
      forme: s.forme,
      capital_centimes: s.capital,
      monnaie: "EUR",
      greffe_rcs: s.greffe,
      activite: s.activite,
    });
  }
  for (const p of PERSONNES) {
    p.id = idDe(`contact:${p.cle}`);
    await assurer("contacts", "/contacts", {
      id: p.id,
      idempotence_cle: `tenue-annuaire-${p.cle}`,
      nature: "physique",
      nom: p.nom,
      prenoms: p.prenoms,
      civilite: p.civilite,
      accord: p.accord,
      type_client: p.type,
      nom_naissance: p.nomNaissance,
      date_naissance: p.naissance,
      lieu_naissance: p.lieu,
      nationalite: p.nationalite,
      profession: p.profession,
      situation_familiale: p.situation,
      profession_reglementee: p.regl,
      barreau: p.barreau,
      toque: p.toque,
      cour_appel: p.cour,
    });
  }
  for (const c of [...SOCIETES, ...PERSONNES]) {
    const vus = new Set();
    for (const [genre, usage, valeur] of c.coord) {
      const principale = !vus.has(genre);
      vus.add(genre);
      await assurer("contact_coordonnees", `/contacts/${c.id}/coordonnees`, {
        id: idDe(`coord:${c.cle}:${genre}:${usage}:${valeur}`),
        idempotence_cle: `tenue-annuaire-coord-${c.cle}-${genre}-${usage}`,
        genre,
        usage,
        valeur,
        principale,
      });
    }
  }

  const contact = (cle) => [...SOCIETES, ...PERSONNES].find((c) => c.cle === cle).id;
  const LIENS = [
    ["antoine", "ferrand", { type_lien: "mandat_social", fonction: "president", represente_societe: true, debut: "2019-04-04", source: "Kbis du 2 octobre 2026" }],
    ["claire", "ferrand", { type_lien: "mandat_social", fonction: "directeur_general", represente_societe: false, debut: "2019-04-04", fin: "2025-03-12", source: "Procès-verbal du 12 mars 2025" }],
    ["rivegauche", "ferrand", { type_lien: "expert_comptable", represente_societe: false, debut: "2019-06-01", source: "Lettre de mission" }],
    ["ines", "rivegauche", { type_lien: "mandat_social", fonction: "gerant", represente_societe: true, debut: "2018-02-12", source: "Kbis du 2 octobre 2026" }],
    ["operrache", "perrache", { type_lien: "mandat_social", fonction: "president", represente_societe: true, debut: "2022-07-01", source: "Kbis du 6 septembre 2026" }],
  ];
  for (const [source, cible, champs] of LIENS) {
    await assurer("contact_liens", `/contacts/${contact(source)}/liens`, {
      id: idDe(`lien:${source}:${cible}:${champs.type_lien}`),
      idempotence_cle: `tenue-annuaire-lien-${source}-${cible}`,
      contact_cible_id: contact(cible),
      ...champs,
    });
  }

  const NOTES = [
    ["ferrand", "Capital saisi d'après le procès-verbal du 12 mars 2025. Contact comptable : Mme Garnier, de Rive Gauche Expertise."],
    ["antoine", "Rendez-vous du 14 octobre 2026 : joindre de préférence le matin ; pièces comptables attendues avant la fin du mois."],
  ];
  for (const [cle, texte] of NOTES) {
    await assurer("contact_notes", `/contacts/${contact(cle)}/notes`, {
      id: idDe(`note:${cle}`),
      idempotence_cle: `tenue-annuaire-note-${cle}`,
      texte,
    });
  }

  const DOSSIERS = [
    {
      cle: "ferrand-duclos", nom: "Annuaire — Ferrand Métal c/ Duclos Industrie", chemise: "bleu-classeur", rg: "2026J00311",
      juridiction: "Tribunal des activités économiques de Lyon", type: "contentieux",
      intervenants: [
        ["ferrand", "client", null],
        ["antoine", "representant_legal", "ferrand"],
        ["duclos", "adversaire", null],
        ["perrin", "avocat", "duclos"],
        ["rambert", "commissaire_justice", null],
      ],
    },
    {
      cle: "moreau", nom: "Annuaire — Succession Moreau", chemise: "vert-amande", rg: "2026S00057",
      juridiction: "TJ Lyon", type: "conseil",
      intervenants: [["moreau", "client", null]],
    },
    {
      cle: "perrache", nom: "Annuaire — Holding Perrache, restructuration", chemise: "kraft", rg: "2026C00021",
      juridiction: "TJ Lyon", type: "conseil",
      intervenants: [
        ["perrache", "client", null],
        ["operrache", "representant_legal", "perrache"],
        ["vasseur", "avocat", "perrache"],
      ],
    },
  ];
  for (const d of DOSSIERS) {
    const dossierId = idDe(`dossier:${d.cle}`);
    await assurer("dossiers", "/dossiers", {
      id: dossierId,
      idempotence_cle: `tenue-annuaire-dossier-${d.cle}`,
      nom: d.nom,
      chemise: d.chemise,
      juridiction: d.juridiction,
      numero_rg: d.rg,
      restreint: false,
      type_dossier: d.type,
      etape: "instruction",
    });
    for (const [cle, code, rattache] of d.intervenants) {
      const corps = {
        id: idDe(`intervenant:${d.cle}:${cle}`),
        idempotence_cle: `tenue-annuaire-interv-${d.cle}-${cle}`,
        contact_id: contact(cle),
        qualite_id: await qualite(code),
      };
      if (rattache !== null) corps.rattache_a = idDe(`intervenant:${d.cle}:${rattache}`);
      await assurer("dossier_intervenants", `/dossiers/${dossierId}/intervenants`, corps);
    }
  }
  ok(`annuaire fictif : ${compte.crees} éléments créés, ${compte.presents} déjà présents`);
}
