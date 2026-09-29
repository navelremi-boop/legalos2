import type { ChronoItem } from "./types";

/**
 * Jeu fictif du chrono (§ 7.4) — couvre périodes, filtres, types d’aperçu et badges définitifs.
 * Données uniquement fictives (cahier des charges).
 */
export const CHRONO_DEMO: ChronoItem[] = [
  {
    id: "mail-pieces-adverses",
    type: "mail",
    periode: "aujourdhui",
    titre: "Communication de pièces adverses n° 14 à 19",
    metadonnees: "Me Clément Vasseur, 6 pièces jointes",
    heure: "9 h 12",
    apercu: {
      mono: "CV",
      qui: "Me Clément Vasseur",
      sousTitre: "c.vasseur@cabinet-vasseur.example",
      quand: "Aujourd’hui, 9 h 12",
      titre: "Communication de pièces adverses n° 14 à 19",
      corps: [
        "Cher Confrère,",
        "Je vous prie de bien vouloir trouver ci-joint communication des pièces n° 14 à 19, dont le bordereau récapitulatif est joint au présent envoi.",
        "Bien confraternellement.",
      ],
      piecesJointes: [
        { extension: "PDF", nom: "Bordereau n° 4" },
        { extension: "PDF", nom: "Pièce 14, contrat de prêt" },
        { extension: "PDF", nom: "Pièce 15, avenant" },
      ],
      piecesJointesPlus: "+ 4 autres",
      encart: {
        variante: "classement",
        titre: "Classé automatiquement dans ce dossier",
        detail: "La référence 2026-042 figure dans l’objet du mail.",
        actionChanger: true,
      },
    },
  },
  {
    id: "pieces-communiquees",
    type: "piece",
    periode: "cette-semaine",
    titre: "Pièces n° 12 et 13 communiquées",
    metadonnees: "Bordereau n° 3, à Me Vasseur",
    badge: "Communiquées",
    apercu: {
      mono: "Vous",
      qui: "Communication de pièces",
      sousTitre: "à Me Clément Vasseur",
      quand: "22 sept., 15 h 05",
      titre: "Bordereau n° 3",
      corps: [
        "Deux pièces communiquées par mail avec leur bordereau. Une pièce communiquée ne peut plus être modifiée ni renumérotée.",
      ],
      piecesJointes: [
        { extension: "PDF", nom: "Pièce 12, mise en demeure" },
        { extension: "PDF", nom: "Pièce 13, relevé de compte" },
      ],
      encart: {
        variante: "definitif",
        titre: "Définitif",
        detail: "Copie du mail d’envoi rangée dans le dossier.",
      },
    },
  },
  {
    id: "facture-provision",
    type: "facture",
    periode: "cette-semaine",
    titre: "Facture 2026-0142, provision sur honoraires",
    metadonnees: "2 400,00 € TTC",
    badge: "Validée",
    apercu: {
      mono: "F",
      qui: "Facture 2026-0142",
      sousTitre: "SCI Les Tilleuls",
      quand: "19 sept.",
      titre: "Provision sur honoraires",
      chiffres: [
        { libelle: "Montant TTC", valeur: "2 400,00 €" },
        { libelle: "Encaissé", valeur: "1 200,00 €" },
        { libelle: "Reste dû", valeur: "1 200,00 €" },
      ],
      progres: 0.5,
      encart: {
        variante: "definitif",
        titre: "Déposée sur la plateforme agréée",
        detail: "Encaissement partiel transmis le 23 septembre.",
      },
    },
  },
  {
    id: "audience-mise-en-etat",
    type: "audience",
    periode: "plus-tot",
    titre: "Mise en état : renvoi au 12 novembre",
    metadonnees: "Conseiller de la mise en état",
    heure: "15 sept.",
    apercu: {
      mono: "CA",
      qui: "Cour d’appel de Lyon",
      sousTitre: "Conseiller de la mise en état",
      quand: "15 sept.",
      titre: "Renvoi au 12 novembre",
      corps: [
        "Audience de mise en état. L’affaire est renvoyée au 12 novembre pour les conclusions de l’appelant.",
      ],
      encart: {
        variante: "agenda",
        titre: "Ajouté à l’agenda",
        detail: "Mise en état du 12 novembre, rappel la veille.",
      },
    },
  },
  {
    id: "note-appel",
    type: "note",
    periode: "plus-tot",
    titre: "Appel de Mme Moreau",
    metadonnees: "Désaccord sur l’évaluation de la maison",
    heure: "21 sept.",
    apercu: {
      mono: "Vous",
      qui: "Note d’entretien",
      sousTitre: "Rédigée par vous",
      quand: "21 sept., 16 h 45",
      titre: "Appel de Mme Moreau",
      corps: [
        "Mme Moreau conteste l’évaluation de la maison de Caluire retenue par l’étude. Elle souhaite une contre-expertise avant la signature.",
      ],
      encart: {
        variante: "note",
        titre: "Note privée",
        detail: "Visible uniquement par les membres du dossier.",
      },
    },
  },
  {
    id: "mail-envoye",
    type: "mail",
    periode: "plus-tot",
    titre: "Pièces demandées par l’étude",
    metadonnees: "À Me Lucas Garnier",
    badge: "Envoyé",
    apercu: {
      mono: "Vous",
      qui: "Mail envoyé",
      sousTitre: "à Me Lucas Garnier",
      quand: "9 sept., 9 h 40",
      titre: "Pièces demandées par l’étude",
      corps: ["Envoi des pièces d’état civil et des relevés bancaires demandés."],
      encart: {
        variante: "definitif",
        titre: "Envoyé",
        detail: "Copie dans « Envoyés » confirmée.",
      },
    },
  },
  {
    id: "facture-encaisee",
    type: "facture",
    periode: "plus-tot",
    titre: "Facture 2026-0131, honoraires de procédure",
    metadonnees: "3 600,00 € TTC",
    badge: "Encaissée",
    apercu: {
      mono: "F",
      qui: "Facture 2026-0131",
      sousTitre: "SAS Ferrand Métal",
      quand: "12 sept.",
      titre: "Honoraires de procédure",
      chiffres: [
        { libelle: "Montant TTC", valeur: "3 600,00 €" },
        { libelle: "Encaissé", valeur: "3 600,00 €" },
        { libelle: "Reste dû", valeur: "0,00 €" },
      ],
      progres: 1,
      encart: {
        variante: "definitif",
        titre: "Encaissée",
        detail: "Statut transmis à la plateforme agréée.",
      },
    },
  },
];

export const PERIODE_LIBELLES = {
  aujourdhui: "Aujourd’hui",
  "cette-semaine": "Cette semaine",
  "plus-tot": "Plus tôt",
} as const;

export const FILTRE_LIBELLES = {
  tout: "Tout",
  mails: "Mails",
  pieces: "Pièces",
  factures: "Factures",
} as const;
