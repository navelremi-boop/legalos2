-- Conflits généralisés : dossier_id au journal, révision des tables J8, cohérence restreint/visibilité.

ALTER TABLE journal_modifications
    ADD COLUMN dossier_id UUID REFERENCES dossiers (id);

CREATE INDEX journal_modifications_dossier_id_idx
    ON journal_modifications (dossier_id)
    WHERE dossier_id IS NOT NULL;

ALTER TABLE temps_saisis
    ADD COLUMN revision BIGINT NOT NULL DEFAULT 1;

ALTER TABLE brouillons_facture
    ADD COLUMN revision BIGINT NOT NULL DEFAULT 1;

ALTER TABLE taux_horaires
    ADD COLUMN revision BIGINT NOT NULL DEFAULT 1;

ALTER TABLE dossiers
    ADD CONSTRAINT dossiers_restreint_visibilite_coherent
    CHECK (restreint = (visibilite = 'restreint'));
