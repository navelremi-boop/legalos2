-- Jeton OAuth du titulaire. Le rafraîchissement est chiffré, jamais synchronisé vers le poste.

ALTER TABLE comptes_mail ADD COLUMN fournisseur TEXT;
ALTER TABLE comptes_mail ADD COLUMN jeton_url TEXT;
ALTER TABLE comptes_mail ADD COLUMN jeton_rafraichissement_chiffre TEXT;
ALTER TABLE comptes_mail ADD COLUMN jeton_acces_chiffre TEXT;
ALTER TABLE comptes_mail ADD COLUMN jeton_expire_le TIMESTAMPTZ;

CREATE TABLE oauth_etats (
    state TEXT PRIMARY KEY,
    cabinet_id UUID NOT NULL REFERENCES cabinets (id) ON DELETE RESTRICT,
    titulaire_id UUID NOT NULL REFERENCES utilisateurs (id) ON DELETE RESTRICT,
    compte_id UUID NOT NULL,
    adresse TEXT NOT NULL,
    fournisseur TEXT NOT NULL,
    jeton_url TEXT NOT NULL,
    auth_url TEXT NOT NULL,
    pkce_verifier TEXT NOT NULL,
    cree_le TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
