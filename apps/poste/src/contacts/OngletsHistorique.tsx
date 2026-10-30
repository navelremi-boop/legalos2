import type { DossierFiche, FactureFiche, MailFiche, NoteFiche } from "@/contacts/historiqueFiche";
import { syntheseFactures } from "@/contacts/historiqueFiche";
import type { OngletFicheContact } from "@/contacts/listeContacts";
import { formatMontant } from "@/lib/format";
import { fr } from "@/lib/fr";

type HistoriqueFicheProps = {
  onglet: Exclude<OngletFicheContact, "general" | "liens">;
  dossiers: readonly DossierFiche[];
  factures: readonly FactureFiche[];
  mails: readonly MailFiche[];
  notes: readonly NoteFiche[];
};

const VIDE: Record<HistoriqueFicheProps["onglet"], string> = {
  dossiers: "Aucun dossier.",
  factures: "Aucune facture.",
  mails: "Aucun mail.",
  notes: "Aucune note.",
};

export function HistoriqueFiche({ onglet, dossiers, factures, mails, notes }: HistoriqueFicheProps) {
  if (onglet === "dossiers") {
    if (dossiers.length === 0) return <p className="etat-vide">{fr(VIDE.dossiers)}</p>;
    return (
      <ul className="flex flex-col gap-2" data-testid="contacts-dossiers">
        {dossiers.map((dossier) => (
          <li key={dossier.id} data-testid="contacts-dossier">
            {fr(`${dossier.nom} — ${dossier.qualite}`)}
          </li>
        ))}
      </ul>
    );
  }
  if (onglet === "factures") {
    if (factures.length === 0) return <p className="etat-vide">{fr(VIDE.factures)}</p>;
    const synthese = syntheseFactures(factures);
    return (
      <div data-testid="contacts-factures">
        <ul className="flex flex-col gap-2">
          {factures.map((facture) => (
            <li key={facture.id} data-testid="contacts-facture">
              {fr(`${facture.libelle} — ${formatMontant(facture.ttcCentimes)}`)}
            </li>
          ))}
        </ul>
        <p className="mt-3" data-testid="contacts-facture-encaisse">
          {fr(`Encaissé ${formatMontant(synthese.encaisseCentimes)}`)}
        </p>
        <p data-testid="contacts-facture-encours">
          {fr(`Encours ${formatMontant(synthese.encoursCentimes)}`)}
        </p>
      </div>
    );
  }
  if (onglet === "mails") {
    if (mails.length === 0) return <p className="etat-vide">{fr(VIDE.mails)}</p>;
    return (
      <ul className="flex flex-col gap-2" data-testid="contacts-mails">
        {mails.map((mail) => (
          <li key={mail.id} data-testid="contacts-mail">
            {fr(mail.objet)}
          </li>
        ))}
      </ul>
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
