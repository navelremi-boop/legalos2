import { IconInfoCircle } from "@tabler/icons-react";
import {
  colonnesFactures,
  etatVideDossiers,
  lignesDossiers,
  lignesFactures,
  lignesMails,
  MENTION_MAILS,
  tuilesFactures,
  type DossierFiche,
  type FactureFiche,
  type MailFiche,
  type NoteFiche,
} from "@/contacts/historiqueFiche";
import type { OngletFicheContact } from "@/contacts/listeContacts";
import { isChemiseId } from "@/lib/chemise";
import { fr } from "@/lib/fr";

type HistoriqueFicheProps = {
  onglet: Exclude<OngletFicheContact, "general" | "liens">;
  dossiers: readonly DossierFiche[];
  factures: readonly FactureFiche[];
  mails: readonly MailFiche[];
  notes: readonly NoteFiche[];
  /** Année en cours, injectable pour la date des mails. */
  anneeCourante?: number;
};

const VIDE = {
  factures: "Aucune facture.",
  mails: "Aucun mail.",
  notes: "Aucune note.",
} as const;

export function HistoriqueFiche({
  onglet,
  dossiers,
  factures,
  mails,
  notes,
  anneeCourante = new Date().getFullYear(),
}: HistoriqueFicheProps) {
  if (onglet === "dossiers") {
    const lignes = lignesDossiers(dossiers);
    if (lignes.length === 0) {
      const vide = etatVideDossiers();
      return (
        <div className="contacts-vide" data-testid="contacts-dossiers-vide">
          <b>{fr(vide.titre)}</b>
          {fr(vide.phrase)}
        </div>
      );
    }
    return (
      <ul className="contacts-dossiers" data-testid="contacts-dossiers">
        {lignes.map((dossier) => (
          <li
            key={dossier.id}
            className="contacts-dos"
            data-chemise={dossier.chemise !== null && isChemiseId(dossier.chemise) ? dossier.chemise : undefined}
            data-testid="contacts-dossier"
          >
            <span className="contacts-dos__ref chiffres-reference">
              <i aria-hidden />
              {fr(dossier.reference)}
            </span>
            <span>
              <span className="contacts-dos__nom">{fr(dossier.nom)}</span>
              <small>{fr(dossier.qualite)}</small>
            </span>
          </li>
        ))}
      </ul>
    );
  }
  if (onglet === "factures") {
    if (factures.length === 0) return <p className="etat-vide">{fr(VIDE.factures)}</p>;
    const lignes = lignesFactures(factures);
    const colonnes = colonnesFactures(lignes);
    return (
      <div data-testid="contacts-factures">
        <div className="contacts-chiffres">
          {tuilesFactures(factures).map((tuile) => (
            <div key={tuile.id} data-testid={`contacts-facture-${tuile.id}`}>
              <span>{fr(tuile.libelle)}</span>
              <b>{tuile.montant}</b>
            </div>
          ))}
        </div>
        <table className="contacts-tab">
          <thead>
            <tr>
              <th scope="col">{fr("Facture")}</th>
              {colonnes.date ? <th scope="col">{fr("Date")}</th> : null}
              {colonnes.objet ? <th scope="col">{fr("Objet")}</th> : null}
              <th scope="col" className="contacts-tab__n">
                {fr("Montant TTC")}
              </th>
              <th scope="col">{fr("Statut")}</th>
            </tr>
          </thead>
          <tbody>
            {lignes.map((facture) => (
              <tr key={facture.id} data-testid="contacts-facture">
                <td>
                  <span className="chiffres-reference contacts-tab__ref">{fr(facture.reference)}</span>
                </td>
                {colonnes.date ? <td>{facture.date === null ? "" : fr(facture.date)}</td> : null}
                {colonnes.objet ? <td>{facture.objet === null ? "" : fr(facture.objet)}</td> : null}
                <td className="contacts-tab__n">{facture.montant}</td>
                <td className={`contacts-statut contacts-statut--${facture.statut}`}>{fr(facture.statutLibelle)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  if (onglet === "mails") {
    if (mails.length === 0) return <p className="etat-vide">{fr(VIDE.mails)}</p>;
    return (
      <div data-testid="contacts-mails">
        <ul className="contacts-mails">
          {lignesMails(mails, anneeCourante).map((mail) => (
            <li key={mail.id} className="contacts-mail" data-testid="contacts-mail">
              <span>
                <b>{fr(mail.objet)}</b>
                <small>{fr(mail.auteur)}</small>
              </span>
              <small>{mail.date === null ? "" : fr(mail.date)}</small>
            </li>
          ))}
        </ul>
        <p className="contacts-mention" data-testid="contacts-mails-mention">
          <IconInfoCircle size={14} stroke={1.7} aria-hidden />
          <span>{fr(MENTION_MAILS)}</span>
        </p>
      </div>
    );
  }
  if (notes.length === 0) return <p className="etat-vide">{fr(VIDE.notes)}</p>;
  return (
    <ul className="flex flex-col gap-2" data-testid="contacts-notes">
      {notes.map((note) => (
        <li key={note.id} data-testid="contacts-note">
          {fr(note.texte)}
        </li>
      ))}
    </ul>
  );
}
