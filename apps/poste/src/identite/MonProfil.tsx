import { useEffect, useState } from "react";
import { FormulaireProfil } from "@/identite/FormulaireProfil";
import { INVITATION_PROFIL, inviterACompleter } from "@/identite/libelleMembre";
import { lireProfilLocal } from "@/identite/lireMembres";
import { enregistrerProfil, lireMonProfil } from "@/identite/profilApi";
import type { ProfilMembre } from "@/identite/profilMembre";
import { fr } from "@/lib/fr";
import { loadSessionTokens } from "@/lib/session/storage";
import { utilisateurIdDepuisJeton } from "@/lib/session/utilisateurCourant";

type MonProfilProps = {
  instanceUrl: string;
  horsLigne: boolean;
  /** Galerie : profil figé, aucune lecture ni écriture. */
  profilFixe?: ProfilMembre;
};

/**
 * « Mon profil » : l'identité de l'utilisateur connecté, lue et écrite en ligne (`/moi/profil`). Hors ligne,
 * la base locale montre ce qui est connu et la saisie est désactivée. Tant que l'identité est vide, l'invitation
 * « Complétez votre profil » s'affiche.
 */
export function MonProfil({ instanceUrl, horsLigne, profilFixe }: MonProfilProps) {
  const [profil, setProfil] = useState<ProfilMembre | null>(profilFixe ?? null);
  const [erreur, setErreur] = useState("");

  useEffect(() => {
    if (profilFixe !== undefined) return;
    const etat = { annule: false };
    void (async () => {
      if (!horsLigne) {
        const lu = await lireMonProfil(instanceUrl);
        if (etat.annule) return;
        if (lu.ok) {
          setProfil(lu.profil);
          setErreur("");
          return;
        }
        setErreur(lu.message);
      }
      const moi = utilisateurIdDepuisJeton(loadSessionTokens().accessToken);
      const local = moi === null ? null : await lireProfilLocal(moi).catch(() => null);
      if (!etat.annule && local !== null) setProfil(local);
    })();
    return () => {
      etat.annule = true;
    };
  }, [instanceUrl, horsLigne, profilFixe]);

  if (profil === null) {
    return erreur !== "" ? (
      <p className="message-erreur" role="alert" data-testid="profil-erreur">
        {fr(erreur)}
      </p>
    ) : (
      <p className="etat-vide" data-testid="profil-chargement">
        {fr("Chargement du profil.")}
      </p>
    );
  }

  return (
    <div data-testid="mon-profil">
      {inviterACompleter(profil) ? (
        <p className="message-attention profil-invitation" data-testid="profil-invitation">
          <span>
            <b>{fr(INVITATION_PROFIL)}</b>
            <br />
            {fr("Votre nom signe les notes que vous écrivez sur les fiches de l'annuaire.")}
          </span>
        </p>
      ) : null}
      <p className="profil-email" data-testid="profil-email">
        <span className="etiquette-champ">{fr("Adresse e-mail")}</span>
        {profil.email}
      </p>
      <FormulaireProfil
        key={profil.id}
        profil={profil}
        horsLigne={horsLigne && profilFixe === undefined}
        prefixe="profil"
        onEnregistrer={(saisie) =>
          profilFixe === undefined
            ? enregistrerProfil(instanceUrl, profil, saisie, true)
            : Promise.resolve({ ok: true as const, profil })
        }
        onEnregistre={setProfil}
      />
    </div>
  );
}
