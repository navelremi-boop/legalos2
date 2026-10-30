-- Reprise des parties vers les intervenants. La table parties reste. Ajouts seulement.

ALTER TABLE contacts ADD COLUMN a_completer BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE dossier_intervenants ADD COLUMN partie_id UUID REFERENCES parties (id) ON DELETE RESTRICT;

CREATE UNIQUE INDEX dossier_intervenants_partie_idx ON dossier_intervenants (partie_id);

CREATE FUNCTION normaliser_nom_contact(p_nom TEXT) RETURNS TEXT
LANGUAGE sql IMMUTABLE AS $$
    SELECT regexp_replace(
        translate(
            lower(trim(p_nom)),
            'àáâãäåèéêëìíîïòóôõöùúûüýÿçñ',
            'aaaaaaeeeeiiiiooooouuuuyycn'
        ),
        '\s+',
        ' ',
        'g'
    );
$$;

CREATE FUNCTION nature_depuis_nom(p_nom TEXT) RETURNS TEXT
LANGUAGE sql IMMUTABLE AS $$
    SELECT CASE upper(split_part(trim(p_nom), ' ', 1))
        WHEN 'SAS' THEN 'morale'
        WHEN 'SARL' THEN 'morale'
        WHEN 'SA' THEN 'morale'
        WHEN 'SCI' THEN 'morale'
        WHEN 'EURL' THEN 'morale'
        WHEN 'SNC' THEN 'morale'
        WHEN 'SELARL' THEN 'morale'
        WHEN 'ASSOCIATION' THEN 'morale'
        ELSE 'physique'
    END;
$$;

CREATE FUNCTION reprendre_parties_intervenants() RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
    INSERT INTO contacts (id, cabinet_id, nature, nom, type_client, a_completer, revision)
    SELECT
        gen_random_uuid(),
        src.cabinet_id,
        src.nature,
        src.nom,
        CASE WHEN src.nature = 'morale' THEN 'professionnel' ELSE 'particulier' END,
        TRUE,
        1
    FROM (
        SELECT DISTINCT ON (p.cabinet_id, normaliser_nom_contact(p.nom))
            p.cabinet_id,
            nature_depuis_nom(p.nom) AS nature,
            p.nom
        FROM parties p
        WHERE NOT EXISTS (
            SELECT 1
            FROM contacts c
            WHERE c.cabinet_id = p.cabinet_id
              AND normaliser_nom_contact(c.nom) = normaliser_nom_contact(p.nom)
        )
        ORDER BY p.cabinet_id, normaliser_nom_contact(p.nom), p.id
    ) src;

    INSERT INTO dossier_intervenants (
        id, cabinet_id, dossier_id, contact_id, qualite_id, partie_id, visibilite, groupe_acces, revision
    )
    SELECT
        gen_random_uuid(),
        p.cabinet_id,
        p.dossier_id,
        choisi.contact_id,
        q.id,
        p.id,
        d.visibilite,
        d.groupe_acces,
        1
    FROM parties p
    JOIN dossiers d ON d.id = p.dossier_id
    JOIN qualites q
        ON q.cabinet_id = p.cabinet_id
       AND q.code = CASE p.role
            WHEN 'client' THEN 'client'
            WHEN 'adversaire' THEN 'adversaire'
            WHEN 'confrere' THEN 'avocat'
            ELSE 'autre'
        END
    JOIN LATERAL (
        SELECT COALESCE(
            p.contact_id,
            (
                SELECT c.id
                FROM contacts c
                WHERE c.cabinet_id = p.cabinet_id
                  AND normaliser_nom_contact(c.nom) = normaliser_nom_contact(p.nom)
                ORDER BY c.cree_le, c.id
                LIMIT 1
            )
        ) AS contact_id
    ) choisi ON TRUE
    WHERE choisi.contact_id IS NOT NULL
      AND NOT EXISTS (
          SELECT 1 FROM dossier_intervenants i WHERE i.partie_id = p.id
      );
END;
$$;

SELECT reprendre_parties_intervenants();
